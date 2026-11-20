"""Cliente de comunicación con el backend.

Prioriza ``python-socketio[client]`` (namespace ``/station``).  Si no está,
implementa el handshake Engine.IO v4 sobre HTTP + ``websocket-client`` con
subida a WebSocket, keepalive ``2``/``3`` y eventos ``42/station,[...]``.
Mientras no hay WS, hace polling REST cada ``POLL_INTERVAL_S`` y reporta por
``POST /api/station/jobs/:id/progress``.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable

from .config import Config

log = logging.getLogger(__name__)

try:  # pragma: no cover - depende del entorno
    import socketio  # type: ignore
except ImportError:
    socketio = None  # type: ignore

try:  # pragma: no cover
    import websocket  # type: ignore
except ImportError:
    websocket = None  # type: ignore

try:  # pragma: no cover
    import requests  # type: ignore
except ImportError:
    requests = None  # type: ignore


BACKOFF_SECONDS = (1, 2, 4, 8, 30)
STATION_EVENTS = (
    "station.auth.ok", "station.auth.fail", "print.job", "print.control",
    "telemetry.request", "job.progress", "printer.status", "jobs.sync",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class HttpResponse:
    def __init__(self, status_code: int, text: str):
        self.status_code = status_code
        self.text = text

    def json(self) -> Any:
        return json.loads(self.text) if self.text else None

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300


def http_request(
    method: str,
    url: str,
    *,
    json_body: Any | None = None,
    data: str | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 10.0,
) -> HttpResponse | None:
    """Petición HTTP best-effort con requests o urllib (sin dependencia fija)."""
    final_headers = dict(headers or {})
    if requests is not None:
        try:
            kwargs: dict[str, Any] = {"headers": final_headers, "timeout": timeout}
            if json_body is not None:
                kwargs["json"] = json_body
            elif data is not None:
                # requests calcula Content-Length con len(str) (caracteres),
                # pero urllib3 envía UTF-8 (bytes). Con acentos el servidor
                # recorta el paquete y Socket.io cierra la sesión por
                # "invalid payload". Enviar bytes evita el desfase.
                kwargs["data"] = data.encode("utf-8") if isinstance(data, str) else data
            response = requests.request(method, url, **kwargs)
            if not (200 <= response.status_code < 300):
                log.debug("HTTP %s %s -> %s %s", method, url, response.status_code, (response.text or "")[:160])
            return HttpResponse(response.status_code, response.text or "")
        except Exception as exc:  # noqa: BLE001
            log.debug("HTTP %s %s falló: %s", method, url, exc)
            return None

    payload: bytes | None = None
    if json_body is not None:
        payload = json.dumps(json_body).encode("utf-8")
        final_headers.setdefault("Content-Type", "application/json")
    elif data is not None:
        payload = data.encode("utf-8")
    request = urllib.request.Request(url, data=payload, headers=final_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return HttpResponse(response.status, response.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        log.debug("HTTP %s %s -> %s %s", method, url, exc.code, body[:160])
        return HttpResponse(exc.code, body)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        log.debug("HTTP %s %s falló: %s", method, url, exc)
        return None


class _RawEngineIO:
    """Handshake Engine.IO v4: polling para obtener sid y upgrade a WebSocket."""

    def __init__(self, client: "StationClient"):
        self.client = client
        self.config = client.config
        self.sid = ""
        self.ws: Any | None = None
        self.mode = "polling"
        self.ping_interval_ms = 25000
        self._send_lock = threading.Lock()
        self._base_url = self.config.engineio_base_url()
        self._closed = threading.Event()
        self._namespace_ready = False

    # ------------------------------------------------------------- conexión
    def connect(self) -> None:
        handshake_url = f"{self._base_url}/?EIO=4&transport=polling&t={time.time_ns()}"
        response = http_request("GET", handshake_url, timeout=10.0)
        if response is None or not response.ok or not response.text.startswith("0"):
            raise ConnectionError(f"Handshake Engine.IO falló: {getattr(response, 'text', 'sin respuesta')[:120]}")
        info = json.loads(response.text[1:])
        self.sid = str(info.get("sid") or "")
        if not self.sid:
            raise ConnectionError("Engine.IO no devolvió sid")
        self.ping_interval_ms = int(info.get("pingInterval") or 25000)
        log.debug("Engine.IO sid=%s (ping=%sms)", self.sid[:8], self.ping_interval_ms)

        self._closed.clear()
        # Socket.IO exige el packet de conexión al namespace antes de cualquier
        # evento. Sin esto el servidor nunca responde con `40` ni acepta
        # `station.auth`, y la estación queda "conectada" pero invisible.
        self._connect_namespace()

        self.mode = "polling"
        if websocket is not None:
            try:
                ws_url = self.config.websocket_upgrade_url(urllib.parse.quote(self.sid, safe=""))
                headers = {"Authorization": f"Bearer {self.config.station_token}"}
                self.ws = websocket.create_connection(
                    ws_url, timeout=max(20.0, self.ping_interval_ms / 1000 + 5), header=headers
                )
                self.mode = "websocket"
                # Engine.IO exige un probe '2probe'/'3probe' antes de considerar el upgrade.
                self._send("2probe")
            except Exception as exc:  # noqa: BLE001
                log.warning("No se pudo elevar a WebSocket (%s); se usa long-polling", exc)
                self.ws = None
        else:
            log.warning("websocket-client no disponible; Engine.IO usa long-polling")

        if self.mode == "websocket" and self.ws is not None:
            self._loop_websocket()
        else:
            self._loop_polling()

    def close(self) -> None:
        self._closed.set()
        if self.ws is not None:
            try:
                self.ws.close()
            except Exception:  # noqa: BLE001
                pass
            self.ws = None

    def _connect_namespace(self) -> None:
        if self._namespace_ready:
            return
        self._namespace_ready = True
        self._send("40/station,")

    # --------------------------------------------------------------- envío
    def _send(self, packet: str) -> None:
        log.debug("Engine.IO TX %s", packet[:160])
        with self._send_lock:
            if self.mode == "websocket" and self.ws is not None:
                try:
                    self.ws.send(packet)
                    return
                except Exception as exc:  # noqa: BLE001
                    log.debug("No se pudo enviar por WS: %s", exc)
            url = f"{self._base_url}/?EIO=4&transport=polling&sid={urllib.parse.quote(self.sid, safe='')}"
            http_request(
                "POST", url, data=packet,
                headers={"Content-Type": "text/plain;charset=UTF-8"}, timeout=10.0,
            )

    def ping(self) -> None:
        self._send("2")

    def send_event(self, event: str, payload: dict[str, Any]) -> None:
        self._send(f"42/station,{json.dumps([event, payload], ensure_ascii=False)}")

    # -------------------------------------------------------------- bucles
    def _loop_websocket(self) -> None:
        assert self.ws is not None
        while not self.client._stop.is_set() and not self._closed.is_set():
            try:
                message = self.ws.recv()
            except Exception as exc:  # noqa: BLE001
                if self.client._stop.is_set():
                    break
                log.debug("WebSocket cerrado: %s", exc)
                break
            if not message:
                break
            self._handle_packet(str(message))

    def _loop_polling(self) -> None:
        while not self.client._stop.is_set() and not self._closed.is_set():
            url = (
                f"{self._base_url}/?EIO=4&transport=polling&sid="
                f"{urllib.parse.quote(self.sid, safe='')}&t={time.time_ns()}"
            )
            # El long-poll debe durar más que el pingInterval del servidor:
            # si el cliente aborta la petición a los 25s, Engine.IO lo interpreta
            # como "poll connection closed prematurely" y cierra la sesión.
            poll_timeout = max(60.0, self.ping_interval_ms / 1000 + 20)
            response = http_request("GET", url, timeout=poll_timeout)
            if response is None or not response.ok:
                if response is not None:
                    log.debug("Polling Engine.IO devolvió %s", response.status_code)
                break
            packets = [packet for packet in response.text.split("\x1e") if packet]
            log.debug("Engine.IO RX %s", [packet[:160] for packet in packets])
            for packet in packets:
                self._handle_packet(packet)

    # ------------------------------------------------------------- paquetes
    def _handle_packet(self, packet: str) -> None:
        if packet == "2":
            self._send("3")
            return
        if packet == "3":
            return
        if packet == "3probe":
            self._send("5")  # confirmación de upgrade a WebSocket (Engine.IO v4)
            return
        if packet == "1":
            log.debug("Engine.IO CLOSE recibido")
            # El servidor ya cerró la sesión: seguir haciendo polling sólo
            # produce 400 "Session ID unknown". Cortar el bucle de inmediato.
            self._closed.set()
            self.client._mark_disconnected()
            return
        if packet.startswith("0"):
            try:
                self.ping_interval_ms = int(json.loads(packet[1:]).get("pingInterval") or 25000)
            except (ValueError, TypeError):
                pass
            return
        if packet.startswith("40"):
            # El servidor confirmó el namespace; sólo falta autenticar. No
            # reenviar `40` aquí o se genera un bucle de ack infinito.
            self._namespace_ready = True
            self._send_event_auth()
            return
        if packet.startswith("42"):
            self._parse_event(packet[2:])
            return
        if packet.startswith("44"):
            log.warning("Engine.IO CONNECT_ERROR en /station: %s", packet[:200])
            self.client._mark_disconnected()
            return

    def _send_event_auth(self) -> None:
        self.send_event("station.auth", self.client.auth_payload())

    def _parse_event(self, body: str) -> None:
        # Ejemplos: '/station,["print.job",{...}]'  o  '1/station,["event",{}]'
        if body.startswith("/"):
            _namespace, separator, raw_data = body.partition(",")
        else:
            _ack, slash, rest = body.partition("/")
            if not slash:
                return
            _namespace, separator, raw_data = rest.partition(",")
        if not separator:
            return
        try:
            decoded = json.loads(raw_data)
        except ValueError as exc:
            log.debug("Evento Engine.IO no JSON: %s (%s)", raw_data[:120], exc)
            return
        if isinstance(decoded, list) and decoded:
            event = str(decoded[0])
            payload = decoded[1] if len(decoded) > 1 else {}
            self.client.dispatch(event, payload)


class StationClient:
    """Cliente WS + REST con reconexión exponencial y heartbeat."""

    def __init__(self, config: Config):
        self.config = config
        self._stop = threading.Event()
        self._connected = threading.Event()
        self._auth_event = threading.Event()
        self._auth_failed = threading.Event()
        self._authenticated = False
        self._callbacks: dict[str, list[Callable[[Any], None]]] = {}
        self._callbacks_lock = threading.RLock()
        self._seen_jobs: set[str] = set()
        self._seen_lock = threading.Lock()
        self._sio: Any | None = None
        self._raw: _RawEngineIO | None = None
        self._thread: threading.Thread | None = None
        self._poll_thread: threading.Thread | None = None
        self._heartbeat_thread: threading.Thread | None = None
        self._synced_this_connection = False
        self._credentials_version = 0
        self._version_lock = threading.Lock()

    # ------------------------------------------------------------------ API
    @property
    def is_online(self) -> bool:
        return self._connected.is_set() and self._authenticated and not self._stop.is_set()

    def on(self, event: str, callback: Callable[[Any], None]) -> None:
        with self._callbacks_lock:
            self._callbacks.setdefault(event, []).append(callback)

    def on_print_job(self, callback: Callable[[dict[str, Any]], None]) -> None:
        self.on("print.job", callback)

    def on_control(self, callback: Callable[[dict[str, Any]], None]) -> None:
        self.on("print.control", callback)

    def on_telemetry_request(self, callback: Callable[[Any], None]) -> None:
        self.on("telemetry.request", callback)

    def on_status_change(self, callback: Callable[[bool, str], None]) -> None:
        self.on("_status", callback)

    def on_reconnect(self, callback: Callable[[], None]) -> None:
        self.on("_reconnect", callback)

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        log.info(
            "Conectando estación %s a %s (socketio=%s, websocket-client=%s)",
            self.config.station_id, self.config.ws_url, bool(socketio), bool(websocket),
        )
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="pb-ws", daemon=True)
        self._poll_thread = threading.Thread(target=self._rest_poll_loop, name="pb-rest", daemon=True)
        self._heartbeat_thread = threading.Thread(target=self._heartbeat_loop, name="pb-heartbeat", daemon=True)
        self._thread.start()
        self._poll_thread.start()
        self._heartbeat_thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._disconnect_current()
        for thread in (self._thread, self._poll_thread, self._heartbeat_thread):
            if thread and thread.is_alive() and thread is not threading.current_thread():
                thread.join(timeout=3.0)
        log.info("Cliente WS detenido")

    def reconnect(self) -> None:
        with self._version_lock:
            self._credentials_version += 1
        self._mark_disconnected()
        self._disconnect_current()
        log.info("Reconexión solicitada por el operador")

    def set_credentials(self, station_id: str, token: str, station_name: str | None = None) -> None:
        self.config.save_credentials(station_id, token, station_name)
        self.reconnect()

    def auth_payload(self) -> dict[str, Any]:
        return {
            "station_id": self.config.station_id,
            "token": self.config.station_token,
            "computer_name": self.config.computer_name,
            "os": self.config.os_type,
            "capabilities": ["print", "telemetry", "discovery"],
        }

    def send(self, event: str, payload: dict[str, Any]) -> bool:
        """Envía un evento por WS; si no hay WS, usa el endpoint REST equivalente."""
        if self._sio is not None and self.is_online:
            try:
                self._sio.emit(event, payload, namespace="/station")
                return True
            except Exception as exc:  # noqa: BLE001
                log.debug("No se pudo emitir %s por socketio: %s", event, exc)
        if self._raw is not None and self.is_online:
            try:
                self._raw.send_event(event, payload)
                return True
            except Exception as exc:  # noqa: BLE001
                log.debug("No se pudo emitir %s por Engine.IO: %s", event, exc)
        return self._send_rest(event, payload)

    def report_progress(self, payload: dict[str, Any]) -> bool:
        return self.send("job.progress", payload)

    def send_telemetry(self, printers: list[dict[str, Any]]) -> bool:
        payload = {
            "type": "printer.status",
            "station_id": self.config.station_id,
            "printers": printers,
            "timestamp": utc_now(),
        }
        return self.send("printer.status", payload)

    def send_heartbeat(self) -> bool:
        payload = {
            "type": "station.heartbeat",
            "station_id": self.config.station_id,
            "timestamp": utc_now(),
        }
        # NO enviar el ping Engine.IO (`2`): ese paquete es sólo servidor→cliente.
        # El servidor lo rechaza con "transport error" y cierra la sesión. El
        # heartbeat de aplicación (`station.heartbeat`) ya renueva `lastSeen`.
        return self.send("station.heartbeat", payload)

    def dispatch(self, event: str, payload: Any) -> None:
        """Despacha eventos del servidor a los callbacks registrados."""
        if event == "station.auth.ok":
            was_online = self.is_online
            station = payload.get("station_id") if isinstance(payload, dict) else None
            if station:
                self.config.station_id = str(station)
            self._authenticated = True
            self._auth_event.set()
            self._connected.set()
            if not was_online:
                self._emit_status("online", "Autenticado en el backend")
            log.info("Estación autenticada correctamente")
            # Recuperar pendientes por REST: este endpoint entrega el payload
            # completo (file_url, claves AES y parámetros), a diferencia de un
            # simple evento `print.job` con sólo el id.
            threading.Thread(
                target=self.fetch_pending_jobs, name="pb-pending", daemon=True
            ).start()
            if not self._synced_this_connection:
                self._synced_this_connection = True
                self._emit("_reconnect", None)
            return
        if event == "station.auth.fail":
            reason = payload.get("reason") if isinstance(payload, dict) else payload
            log.error("Autenticación de estación rechazada: %s", reason)
            if self.config.demo_mode:
                log.warning("DEMO: se continúa con virtualización aunque el backend rechazó el token")
                self._authenticated = True
                self._auth_event.set()
                self._connected.set()
                self._emit_status("online", "DEMO (backend rechazó token)")
            else:
                self._auth_failed.set()
                self._mark_disconnected()
                # Cortar el bucle Engine.IO para que `_run` pueda reintentar
                # con el backoff en lugar de quedarse en un polling muerto.
                self._disconnect_current()
            return

        if event == "print.job":
            job = dict(payload) if isinstance(payload, dict) else {}
            job_id = str(job.get("job_id") or "")
            if not self._remember_job(job_id):
                log.debug("print.job duplicado ignorado: %s", job_id)
                return
            job.setdefault("job_id", job_id)
            job.setdefault("type", "print.job")
            self._emit("print.job", job)
            return
        if event == "telemetry.request":
            self._emit("telemetry.request", payload)
            return
        if event == "print.control":
            self._emit("print.control", payload)
            return
        log.debug("Evento no manejado: %s", event)

    # ------------------------------------------------------------- conexión
    def _run(self) -> None:
        attempt = 0
        while not self._stop.is_set():
            version_before = self._credentials_version
            connected = False
            try:
                connected = self._connect_once()
            except Exception as exc:  # noqa: BLE001
                log.warning("No se pudo conectar al backend: %s", exc)
            if self._stop.is_set():
                break
            if connected and self._wait_for_auth(version_before):
                attempt = 0
                log.info("Conexión WS establecida")
                while self.is_online and not self._stop.is_set():
                    self._stop.wait(1.0)
            else:
                self._mark_disconnected()
                self._disconnect_current()
            delay = BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)]
            attempt += 1
            log.info("Reintentando WS en %ds (intento %d)", delay, attempt)
            if self._stop.wait(delay):
                break

    def _connect_once(self) -> bool:
        if not self.config.station_id or not self.config.station_token:
            log.warning("Sin STATION_ID/STATION_TOKEN; sólo modo REST/DEMO disponible")
            return False
        if socketio is not None:
            return self._connect_socketio()
        self._raw = _RawEngineIO(self)
        self._connected.set()
        self._emit_status("connecting", "Handshake Engine.IO")
        raw = self._raw
        threading.Thread(
            target=self._raw_connect_worker, args=(raw,), name="pb-engineio", daemon=True
        ).start()
        return True

    def _raw_connect_worker(self, raw: _RawEngineIO) -> None:
        """Mantiene el handshake Engine.IO fuera de `_run` para poder hacer
        timeout de autenticación y reconectar igual que con python-socketio."""
        try:
            raw.connect()
        except Exception as exc:  # noqa: BLE001
            if self._stop.is_set():
                return
            log.warning("No se pudo conectar al backend: %s", exc)
        finally:
            if not self._stop.is_set():
                self._mark_disconnected()
                self._disconnect_current()

    def _connect_socketio(self) -> bool:
        client = socketio.Client(
            logger=False, engineio_logger=False, reconnection=False, request_timeout=10
        )
        for event in STATION_EVENTS:
            client.on(event, lambda data, e=event: self.dispatch(e, data), namespace="/station")
        def on_any(data: Any) -> None:  # pragma: no cover - depende de librería externa
            if isinstance(data, dict):
                self.dispatch(str(data.get("type") or ""), data)

        try:
            client.on("*", on_any, namespace="/station")
        except Exception:  # noqa: BLE001 - versiones antiguas sin wildcard
            pass

        @client.on("connect", namespace="/station")
        def on_connect() -> None:  # pragma: no cover - depende de librería externa
            self._connected.set()
            self._emit_status("connecting", "WS conectado, autenticando…")
            client.emit("station.auth", self.auth_payload(), namespace="/station")

        @client.on("disconnect", namespace="/station")
        def on_disconnect() -> None:  # pragma: no cover
            self._mark_disconnected()

        @client.on("connect_error", namespace="/station")
        def on_error(reason: Any) -> None:  # pragma: no cover
            log.debug("socket.io connect_error: %s", reason)

        try:
            client.connect(
                self.config.ws_url,
                namespaces=["/station"],
                transports=["websocket", "polling"],
                headers={"Authorization": f"Bearer {self.config.station_token}"},
                wait_timeout=10,
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("socket.io connect falló: %s", exc)
            return False
        self._sio = client
        return True

    def _wait_for_auth(self, version_before: int) -> bool:
        self._auth_event.clear()
        self._auth_failed.clear()
        deadline = time.monotonic() + 12.0
        while time.monotonic() < deadline and not self._stop.is_set():
            if version_before != self._credentials_version:
                return False
            if self._auth_failed.is_set():
                return False
            if self._authenticated and self._connected.is_set():
                return True
            self._stop.wait(0.1)
        if self.is_online:
            return True
        log.warning("El backend no confirmó station.auth.ok en 12s")
        return False

    def _disconnect_current(self) -> None:
        if self._sio is not None:
            try:
                self._sio.disconnect()
            except Exception:  # noqa: BLE001
                pass
            self._sio = None
        if self._raw is not None:
            self._raw.close()
            self._raw = None

    def _mark_disconnected(self) -> None:
        was_online = self.is_online
        self._connected.clear()
        self._authenticated = False
        self._auth_event.clear()
        self._synced_this_connection = False
        if was_online:
            log.warning("Conexión con el backend perdida; usando fallback REST")
            self._emit_status("offline", "Sin conexión con el backend")

    # ------------------------------------------------------------- fallback
    def _rest_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.config.station_token}",
            "Content-Type": "application/json",
            "User-Agent": "PrintBridge-Desktop/1.0",
        }

    def _send_rest(self, event: str, payload: dict[str, Any]) -> bool:
        headers = self._rest_headers()
        if event == "job.progress":
            job_id = payload.get("job_id")
            if not job_id:
                return False
            body = {k: v for k, v in payload.items() if k not in ("type", "job_id")}
            response = http_request(
                "POST", self.config.rest_url(f"/api/station/jobs/{job_id}/progress"),
                json_body=body, headers=headers, timeout=8.0,
            )
            return bool(response and response.ok)
        if event == "jobs.sync":
            response = http_request(
                "POST", self.config.rest_url("/api/station/jobs/sync"),
                json_body=payload, headers=headers, timeout=10.0,
            )
            return bool(response and response.ok)
        if event == "station.heartbeat":
            response = http_request(
                "POST", self.config.rest_url("/api/station/heartbeat"),
                json_body=payload, headers=headers, timeout=8.0,
            )
            return bool(response and response.ok)
        log.debug("Evento %s sin mapeo REST; se descarta", event)
        return False

    def _remember_job(self, job_id: str) -> bool:
        if not job_id:
            return True
        with self._seen_lock:
            if job_id in self._seen_jobs:
                return False
            self._seen_jobs.add(job_id)
        return True

    def fetch_pending_jobs(self) -> int:
        """Obtiene los pendientes con payload completo y los encola para imprimir."""
        response = http_request(
            "GET", self.config.rest_url("/api/station/jobs/pending"),
            headers=self._rest_headers(), timeout=10.0,
        )
        if response is None or not response.ok:
            log.debug(
                "No se pudieron obtener trabajos pendientes: %s",
                getattr(response, "status_code", "sin respuesta"),
            )
            return 0
        try:
            data = response.json() or {}
        except ValueError:
            log.debug("Endpoint de pendientes devolvió JSON inválido")
            return 0
        jobs = data.get("jobs", []) if isinstance(data, dict) else data
        if not isinstance(jobs, list):
            return 0
        count = 0
        for raw in jobs:
            if not isinstance(raw, dict):
                continue
            job = dict(raw)
            job_id = str(job.get("job_id") or job.get("id") or "")
            job.setdefault("job_id", job_id)
            job.setdefault("type", "print.job")
            if not job.get("file_url"):
                log.warning("Trabajo %s sigue sin file_url; se omite", job_id or "-")
                continue
            if not self._remember_job(job_id):
                continue
            log.info("Trabajo %s obtenido de /api/station/jobs/pending", job_id or "-")
            self._emit("print.job", job)
            count += 1
        return count

    def _rest_poll_loop(self) -> None:
        while not self._stop.is_set():
            self._stop.wait(self.config.poll_interval_s)
            if self._stop.is_set() or self.is_online:
                continue
            self.fetch_pending_jobs()

    def _heartbeat_loop(self) -> None:
        while not self._stop.is_set():
            self._stop.wait(self.config.interval_telemetry_s)
            if not self._stop.is_set():
                self.send_heartbeat()

    # ------------------------------------------------------------ callbacks
    def _emit(self, event: str, payload: Any) -> None:
        with self._callbacks_lock:
            callbacks = list(self._callbacks.get(event, []))
        for callback in callbacks:
            try:
                callback(payload)
            except Exception as exc:  # noqa: BLE001
                log.debug("Callback %s falló: %s", event, exc)

    def _emit_status(self, state: str, detail: str) -> None:
        with self._callbacks_lock:
            callbacks = list(self._callbacks.get("_status", []))
        for callback in callbacks:
            try:
                callback(state == "online", detail)
            except Exception:  # noqa: BLE001
                pass
