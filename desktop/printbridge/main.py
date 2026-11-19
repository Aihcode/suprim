"""Punto de entrada del agente PrintBridge Desktop.

Ejemplos:
    python3 -m printbridge.main --demo --console
    python3 desktop/printbridge/main.py --demo --tray
    python3 -m printbridge.main --install-autostart
"""

from __future__ import annotations

import argparse
import logging
import logging.handlers
import os
import signal
import sys
import threading
from pathlib import Path
from typing import Any

# Permite ejecutar también como script: python desktop/printbridge/main.py
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from printbridge.config import Config, ConfigError  # type: ignore
    from printbridge.console import Console, ConsoleUnavailable  # type: ignore
    from printbridge.discovery import Discovery  # type: ignore
    from printbridge.local_queue import LocalQueue  # type: ignore
    from printbridge.printer_job import JobExecutor  # type: ignore
    from printbridge.spooler import Spooler  # type: ignore
    from printbridge.tray import TrayController, install_autostart, uninstall_autostart  # type: ignore
    from printbridge.ws_client import StationClient  # type: ignore
else:
    from .config import Config, ConfigError
    from .console import Console, ConsoleUnavailable
    from .discovery import Discovery
    from .local_queue import LocalQueue
    from .printer_job import JobExecutor
    from .spooler import Spooler
    from .tray import TrayController, install_autostart, uninstall_autostart
    from .ws_client import StationClient

log = logging.getLogger("printbridge")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="printbridge",
        description="PrintBridge Desktop — agente de estación de impresión PrintFlow ERP",
    )
    parser.add_argument("--demo", action="store_true", help="Modo DEMO: impresoras e impresión simuladas, backend opcional")
    parser.add_argument("--console", action="store_true", help="Mostrar la consola visual Tkinter")
    parser.add_argument("--tray", action="store_true", help="Mostrar icono en bandeja del sistema")
    parser.add_argument("--config", metavar="PATH", help="Ruta al fichero .env de la estación")
    parser.add_argument("--install-autostart", action="store_true", help="Registrar inicio automático y salir")
    parser.add_argument("--uninstall-autostart", action="store_true", help="Quitar inicio automático y salir")
    parser.add_argument("--log-level", default=None, choices=["DEBUG", "INFO", "WARNING", "ERROR"],
                        help="Nivel de logging (sobrescribe LOG_LEVEL)")
    return parser


def setup_logging(config: Config) -> None:
    level = getattr(logging, config.log_level.upper(), logging.INFO)
    root = logging.getLogger()
    root.setLevel(level)
    for handler in list(root.handlers):
        root.removeHandler(handler)
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    )
    stream = logging.StreamHandler(sys.stdout)
    stream.setLevel(level)
    stream.setFormatter(formatter)
    root.addHandler(stream)
    try:
        path = Path(config.log_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.handlers.RotatingFileHandler(
            path, maxBytes=2_000_000, backupCount=3, encoding="utf-8"
        )
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)
    except OSError as exc:  # noqa: BLE001
        log.warning("No se pudo crear log en archivo %s: %s", config.log_file, exc)


class AgentApp:
    """Orquesta WS, spooler, cola local, telemetría, consola y bandeja."""

    def __init__(self, config: Config, with_console: bool = False, with_tray: bool = False):
        self.config = config
        self._stop_event = threading.Event()
        self._threads: list[threading.Thread] = []
        self.console: Console | None = None
        self._wants_console = with_console

        self.discovery = Discovery(config)
        self.spooler = Spooler(config, self.discovery)
        self.queue = LocalQueue(config.queue_db_path)
        self.ws = StationClient(config)
        self.executor = JobExecutor(
            config, self.spooler, self.queue, reporter=self.ws, on_event=self._on_job_event
        )
        self.tray = TrayController(
            config,
            {
                "open_console": self.open_console,
                "pause_all": self.pause_all,
                "sync_now": self.sync_now,
                "quit": self.request_stop,
            },
        )
        self._wire_ws()

    # ------------------------------------------------------------- cableado
    def _wire_ws(self) -> None:
        self.ws.on_print_job(self.executor.submit)
        self.ws.on_control(self.handle_control)
        self.ws.on_telemetry_request(lambda _payload: self.emit_telemetry())
        self.ws.on_reconnect(self._on_reconnect)
        self.ws.on_status_change(self._on_connection)

    def _make_console(self) -> Console | None:
        try:
            console = Console(
                self.config,
                {
                    "pause": lambda name: self._spooler_action("pause", name),
                    "resume": lambda name: self._spooler_action("resume", name),
                    "cancel": lambda job_id: self._spooler_action("cancel", job_id),
                    "test_page": lambda name: self._spooler_action("test_page", name),
                    "save_credentials": self.save_credentials,
                    "reconnect": self.ws.reconnect,
                    "sync_now": self.sync_now,
                    "on_close": self._on_console_close,
                },
            )
            return console
        except ConsoleUnavailable as exc:
            log.warning("Consola no disponible: %s (modo solo-log)", exc)
            return None

    def _on_connection(self, online: bool, detail: str) -> None:
        if self.console:
            self.console.set_connection(online, detail)
        if online:
            self.tray.notify("Estación conectada al backend")
            self.sync_now()

    def _on_job_event(self, event: str, payload: dict[str, Any]) -> None:
        if event == "job.progress" and self.console:
            self.console.update_job(payload)

    def _on_reconnect(self) -> None:
        log.info("Reconexión detectada: sincronizando cola local")
        self.executor.retry_queued()
        self.executor.sync_pending()

    def _on_console_close(self) -> None:
        if self.tray.icon is not None:
            if self.console:
                self.console.stop()
            log.info("Consola oculta; el agente sigue en la bandeja")
        else:
            self.request_stop()

    # ------------------------------------------------------------------ ciclo
    def start(self) -> None:
        log.info("Configuración: %s", self.config.public_dict())
        if self.config.demo_mode:
            log.warning("MODO DEMO activo: impresoras e impresión simuladas; NO usar para producción")
        if self._wants_console:
            self.console = self._make_console()
        if self.console:
            self.console.update_printers(self.spooler.list_printers())
            self.console.log("INFO", f"Estación {self.config.station_id} iniciando…")
        self.ws.start()
        self.tray.start()

        self._spawn(self._telemetry_loop, "pb-telemetry")
        self._spawn(self._discovery_loop, "pb-discovery")
        self._spawn(self._queue_loop, "pb-queue")
        self.emit_telemetry()
        log.info("Agente PrintBridge iniciado")

    def _spawn(self, target: Any, name: str) -> None:
        thread = threading.Thread(target=target, name=name, daemon=True)
        thread.start()
        self._threads.append(thread)

    def wait(self) -> None:
        self._stop_event.wait()

    def request_stop(self) -> None:
        if self._stop_event.is_set():
            return
        log.info("Deteniendo agente…")
        self._stop_event.set()
        if self.console:
            self.console.stop()

    def stop(self) -> None:
        self.request_stop()
        self.ws.stop()
        self.tray.stop()
        if self.console:
            self.console.stop()
        for thread in self._threads:
            if thread.is_alive() and thread is not threading.current_thread():
                thread.join(timeout=2.0)
        self.executor.shutdown()
        self.queue.close()
        log.info("Agente detenido")

    # ----------------------------------------------------------------- loops
    def _telemetry_loop(self) -> None:
        while not self._stop_event.wait(self.config.interval_telemetry_s):
            self.emit_telemetry()

    def _discovery_loop(self) -> None:
        while not self._stop_event.wait(max(60, self.config.discovery_cache_s)):
            try:
                printers = self.discovery.discover(force=True)
                if self.console:
                    self.console.update_printers(printers)
                self.emit_telemetry()
                log.info("Redescubrimiento completado: %d impresora(s)", len(printers))
            except Exception as exc:  # noqa: BLE001
                log.warning("Error en redescubrimiento: %s", exc)

    def _queue_loop(self) -> None:
        while not self._stop_event.wait(self.config.poll_interval_s):
            try:
                if self.ws.is_online:
                    self.executor.sync_pending()
            except Exception as exc:  # noqa: BLE001
                log.debug("Error en bucle de cola local: %s", exc)

    def emit_telemetry(self) -> None:
        from datetime import datetime, timezone

        printers = self.spooler.list_printers()
        payload: list[dict[str, Any]] = []
        now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        for printer in printers:
            name = str(printer.get("name") or printer.get("printer_id") or "")
            status = self.spooler.get_status(name)
            item = dict(printer)
            item["status"] = status.get("status", printer.get("status", "ONLINE"))
            item["message"] = status.get("message", printer.get("message", "Listo"))
            item["timestamp"] = now
            payload.append(
                {
                    "printer_id": printer.get("printer_id"),
                    "name": name,
                    "status": item["status"],
                    "message": item["message"],
                    "timestamp": now,
                }
            )
        if self.console:
            self.console.update_printers(printers_with_status(printers, payload))
        self.ws.send_telemetry(payload)
        log.debug("Telemetría enviada: %s", [(p["name"], p["status"]) for p in payload])

    # --------------------------------------------------------------- acciones
    def _spooler_action(self, action: str, value: str) -> bool:
        try:
            if action == "pause":
                ok = self.spooler.pause(value)
            elif action == "resume":
                ok = self.spooler.resume(value)
            elif action == "cancel":
                ok = self.spooler.cancel_job(value)
            elif action == "test_page":
                ok = self.spooler.test_page(value)
            else:
                ok = False
        except Exception as exc:  # noqa: BLE001
            log.error("Acción %s sobre %s falló: %s", action, value, exc)
            ok = False
        if self.console:
            self.console.log("OK" if ok else "ERROR", f"{action} · {value}: {'OK' if ok else 'ERROR'}")
        return ok

    def handle_control(self, payload: dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            return
        action = str(payload.get("action") or "")
        if action == "cancel":
            self.spooler.cancel_job(str(payload.get("job_id") or ""))
        elif action in ("pause", "resume"):
            printers = self.spooler.list_printers()
            target = payload.get("printer_id") or (printers[0].get("name") if printers else None)
            if target:
                self._spooler_action(action, str(target))
        elif action == "test_page":
            printers = self.spooler.list_printers()
            target = payload.get("printer_id") or (printers[0].get("name") if printers else None)
            if target:
                self._spooler_action("test_page", str(target))
        else:
            log.warning("print.control con acción desconocida: %s", action)

    def pause_all(self) -> None:
        printers = self.spooler.list_printers()
        for printer in printers:
            self.spooler.pause(str(printer.get("name") or ""))
        if self.console:
            self.console.log("INFO", f"Pausadas {len(printers)} impresora(s)")

    def sync_now(self) -> None:
        if not self.ws.is_online:
            if self.console:
                self.console.log("WARN", "Sin conexión: la sincronización se reintentará después")
            return
        count = self.executor.sync_pending()
        if self.console:
            self.console.log("OK", f"Sincronización completada ({count} trabajo(s))")

    def save_credentials(self, station_id: str, token: str, station_name: str) -> None:
        self.ws.set_credentials(station_id, token, station_name or None)

    def open_console(self) -> None:
        if self.console is not None:
            # Si la ventana fue cerrada, el objeto queda inactivo; se recrea.
            if getattr(self.console, "root", None) is not None:
                return
        self.console = self._make_console()
        if self.console:
            self.console.update_printers(self.spooler.list_printers())
            self.console.start_thread()


def printers_with_status(
    printers: list[dict[str, Any]], statuses: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Combina inventario y telemetría para la tabla de la consola."""
    by_name = {str(s.get("name")): s for s in statuses}
    result: list[dict[str, Any]] = []
    for printer in printers:
        item = dict(printer)
        status = by_name.get(str(printer.get("name"))) or by_name.get(str(printer.get("printer_id")))
        if status:
            item["status"] = status.get("status")
            item["message"] = status.get("message")
        result.append(item)
    return result


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    overrides = {"DEMO_MODE": "true"} if args.demo else None
    config = Config.from_env(args.config, overrides=overrides)
    config.demo_mode = bool(config.demo_mode or args.demo)
    if args.log_level:
        config.log_level = args.log_level
    setup_logging(config)

    if args.install_autostart:
        return 0 if install_autostart(config) else 1
    if args.uninstall_autostart:
        return 0 if uninstall_autostart(config) else 1
    try:
        config.validate()
    except ConfigError as exc:
        log.error("Configuración inválida: %s", exc)
        return 2

    app = AgentApp(config, with_console=args.console, with_tray=args.tray)

    def handle_signal(_signum: int, _frame: Any) -> None:
        app.request_stop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, handle_signal)
        except (ValueError, OSError):  # noqa: PERF203 - señales no disponibles en algunos hilos
            pass

    app.start()
    exit_code = 0
    try:
        if args.console and app.console is not None:
            try:
                app.console.run()  # Tkinter exige el hilo principal
            except ConsoleUnavailable as exc:
                log.warning("Consola no disponible, continuando solo-log: %s", exc)
                app.console = None
            if not app._stop_event.is_set() and app.tray.icon is not None:
                app.wait()
        else:
            app.wait()
    except KeyboardInterrupt:
        log.info("Interrumpido por el usuario")
    finally:
        app.stop()
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
