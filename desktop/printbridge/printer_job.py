"""Ejecución silenciosa de trabajos ``print.job`` y modo contingencia.

Descarga → descifra → verifica SHA-256 → imprime → reporta progreso → borra
el archivo temporal.  Si la red falla después de la descarga, el trabajo se
persiste en SQLite (LOCAL_QUEUE), se imprime igualmente y se sincroniza después.
"""

from __future__ import annotations

import copy
import logging
import shutil
import tempfile
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

from .config import Config
from .crypto import CryptoError, decrypt_file, verify_checksum, wipe_file
from .local_queue import LocalQueue
from .spooler import PrintError, Spooler, minimal_pdf

log = logging.getLogger(__name__)

Reporter = Callable[[str, dict[str, Any]], bool]


class JobExecutor:
    """Procesa trabajos en un pool de hilos y mantiene la cola local."""

    def __init__(
        self,
        config: Config,
        spooler: Spooler,
        queue: LocalQueue,
        reporter: Any | None = None,
        on_event: Callable[[str, dict[str, Any]], None] | None = None,
    ):
        self.config = config
        self.spooler = spooler
        self.queue = queue
        self.reporter = reporter
        self.on_event = on_event
        self._pool = ThreadPoolExecutor(
            max_workers=config.max_concurrent_jobs, thread_name_prefix="pb-job"
        )
        self._processed: set[str] = set()

    # ------------------------------------------------------------------ API
    def submit(self, job: dict[str, Any]) -> None:
        """Encola un trabajo del protocolo (llamado desde el hilo del WS)."""
        if not isinstance(job, dict):
            log.warning("Trabajo ignorado: payload no es un objeto JSON")
            return
        job_id = str(job.get("job_id") or "")
        if job_id and job_id in self._processed:
            log.info("Trabajo %s duplicado; se ignora", job_id)
            return
        if job_id:
            self._processed.add(job_id)
        self._pool.submit(self._safe_execute, job)

    @property
    def is_online(self) -> bool:
        return bool(getattr(self.reporter, "is_online", False))

    def _safe_execute(self, job: dict[str, Any]) -> None:
        try:
            self.execute(job)
        except Exception as exc:  # noqa: BLE001 - un trabajo nunca tumba el agente
            log.exception("Error no controlado ejecutando trabajo: %s", exc)

    # ---------------------------------------------------------------- flujo
    def execute(self, job: dict[str, Any]) -> bool:
        job_id = str(job.get("job_id") or "job-local")
        order_id = str(job.get("order_id") or "")
        params = dict(job.get("parameters") or {})
        printer_name = job.get("printer_name") or params.get("printer") or params.get("printer_id")
        network_failed = False
        encrypted_path: Path | None = None
        plaintext_path: Path | None = None

        def emit(status: str, current: int = 0, total: int = 0, message: str = "") -> bool:
            payload = self._progress_payload(job_id, order_id, status, current, total, message)
            if self.on_event:
                try:
                    self.on_event("job.progress", payload)
                except Exception:  # noqa: BLE001
                    pass
            return self._report("job.progress", payload)

        emit("RECEIVED", message="Trabajo recibido en estación")
        try:
            with tempfile.TemporaryDirectory(prefix="printbridge-job-") as folder:
                workdir = Path(folder)
                encrypted_path = workdir / "payload.enc"
                plaintext_path = workdir / "payload.print"

                ok = emit("DOWNLOADING", message="Descargando documento cifrado")
                network_failed = network_failed or not ok
                self._materialize(job, encrypted_path, workdir)

                encrypted = bool(job.get("file_encrypted", True))
                checksum = str(job.get("file_checksum") or "")
                checksum_ok = verify_checksum(encrypted_path, checksum) if encrypted else False

                if encrypted:
                    try:
                        plaintext_path = decrypt_file(
                            encrypted_path,
                            plaintext_path,
                            key_b64=job.get("encryption_key_b64") or params.get("encryption_key_b64"),
                            iv_b64=job.get("iv_b64") or params.get("iv_b64"),
                            auth_tag_b64=job.get("auth_tag_b64") or job.get("encryption_auth_tag_b64"),
                            config=self.config,
                        )
                    except CryptoError as exc:
                        raise PrintError("DECRYPT_FAILED", str(exc)) from exc
                else:
                    shutil.copyfile(encrypted_path, plaintext_path)
                    plaintext_path.chmod(0o600)

                if not encrypted or not checksum_ok:
                    if not verify_checksum(plaintext_path, checksum):
                        raise PrintError("CHECKSUM_MISMATCH", "El SHA-256 del documento no coincide")

                emit("DOWNLOADING", 1, 1, "Documento listo para impresión")

                def on_progress(current: int, total: int, message: str) -> None:
                    sent = emit("PRINTING", current, total, message)
                    if not sent:
                        nonlocal network_failed
                        network_failed = True

                emit("PRINTING", 0, 0, "Enviando al spooler")
                self.spooler.print_file(
                    plaintext_path,
                    params,
                    progress_callback=on_progress,
                    printer_name=printer_name,
                    job_id=job_id,
                )

                if network_failed or not self.is_online:
                    cached = self._persist(job_id, order_id, encrypted_path, job, params, encrypted)
                    emit("LOCAL_QUEUE", message=f"Sin conexión: {cached.name} en cola local")
                    log.warning("Trabajo %s completado localmente; pendiente de sincronización", job_id)
                else:
                    if not emit("COMPLETED", message="Impresión completada"):
                        self._persist(job_id, order_id, encrypted_path, job, params, encrypted)
                        emit("LOCAL_QUEUE", message="No se pudo reportar COMPLETED; en cola local")
            return True
        except PrintError as exc:
            log.error("Trabajo %s falló (%s): %s", job_id, exc.code, exc.message)
            emit("FAILED", message=exc.message[:200])
            self._report(
                "agent.error",
                {"job_id": job_id, "code": exc.code, "message": exc.message[:200]},
            )
            return False
        except Exception as exc:  # noqa: BLE001
            log.exception("Trabajo %s falló inesperadamente", job_id)
            emit("FAILED", message=str(exc)[:200])
            self._report("agent.error", {"job_id": job_id, "code": "UNEXPECTED", "message": str(exc)[:200]})
            return False
        finally:
            for candidate in (plaintext_path, encrypted_path):
                if candidate is not None:
                    wipe_file(candidate)

    # ---------------------------------------------------------------- helpers
    @staticmethod
    def _progress_payload(
        job_id: str, order_id: str, status: str,
        page_current: int, page_total: int, message: str,
    ) -> dict[str, Any]:
        from datetime import datetime, timezone

        timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        return {
            "type": "job.progress",
            "job_id": job_id,
            "order_id": order_id,
            "status": status,
            "page_current": int(page_current or 0),
            "page_total": int(page_total or 0),
            "message": str(message or "")[:240],
            "timestamp": timestamp,
        }

    def _report(self, event: str, payload: dict[str, Any]) -> bool:
        if self.reporter is None:
            return False
        try:
            sender = getattr(self.reporter, "send", None)
            if callable(sender):
                return bool(sender(event, payload))
            return bool(self.reporter(event, payload))
        except Exception as exc:  # noqa: BLE001
            log.debug("No se pudo reportar %s: %s", event, exc)
            return False

    def _materialize(self, job: dict[str, Any], destination: Path, workdir: Path) -> None:
        """Descarga file_url o genera un PDF de prueba en DEMO."""
        url = str(job.get("file_url") or "")
        scheme = urllib.parse.urlparse(url).scheme.lower()
        if scheme in ("", "demo"):
            if not self.config.demo_mode:
                raise PrintError("INVALID_FILE_URL", "El trabajo no incluye file_url válido")
            log.warning("DEMO: generando documento de prueba para %s", job.get("job_id"))
            destination.write_bytes(minimal_pdf("PrintBridge DEMO - " + str(job.get("order_id") or "demo")))
            job["file_encrypted"] = False  # el PDF generado localmente ya está en claro
            return

        headers = {"User-Agent": "PrintBridge-Desktop/1.0"}
        backend_host = urllib.parse.urlparse(self.config.backend_url).netloc
        target_host = urllib.parse.urlparse(url).netloc
        if backend_host and target_host == backend_host and self.config.station_token:
            headers["Authorization"] = f"Bearer {self.config.station_token}"
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=45.0) as response:
                with destination.open("wb") as handle:
                    while True:
                        chunk = response.read(65536)
                        if not chunk:
                            break
                        handle.write(chunk)
            destination.chmod(0o600)
        except Exception as exc:  # noqa: BLE001
            if self.config.demo_mode:
                log.warning("DEMO: descarga fallida (%s); se genera PDF local", exc)
                destination.write_bytes(minimal_pdf("PrintBridge DEMO - descarga simulada"))
                job["file_encrypted"] = False
                return
            raise PrintError("DOWNLOAD_FAILED", f"No se pudo descargar el documento: {exc}") from exc
        log.info("Descargado %s (%d bytes)", url.split("/")[-1][:60], destination.stat().st_size)

    def _persist(
        self,
        job_id: str,
        order_id: str,
        source: Path | None,
        job: dict[str, Any],
        params: dict[str, Any],
        encrypted: bool,
    ) -> Path:
        cache_dir = Path(self.config.cache_dir)
        cache_dir.mkdir(parents=True, exist_ok=True)
        safe = "".join(ch for ch in job_id if ch.isalnum() or ch in "-_")[:120] or "job"
        destination = cache_dir / f"{safe}.bin"
        if source is not None and source.is_file():
            shutil.copy2(source, destination)
            try:
                destination.chmod(0o600)
            except OSError:
                pass

        stored_params = copy.deepcopy(params)
        stored_params["__pb_file"] = {
            "encrypted": encrypted,
            "key_b64": job.get("encryption_key_b64") or params.get("encryption_key_b64") or "",
            "iv_b64": job.get("iv_b64") or params.get("iv_b64") or "",
            "auth_tag_b64": job.get("auth_tag_b64") or "",
            "file_checksum": job.get("file_checksum") or "",
            "printed": True,
            "printer": params.get("printer") or job.get("printer_name") or "",
        }
        self.queue.add(job_id, order_id, destination, stored_params, "LOCAL_QUEUE")
        return destination

    # ------------------------------------------------------- cola local / sync
    def retry_queued(self) -> int:
        """Reintenta impresiones que quedaron pendientes antes de imprimir."""
        done = 0
        for row in self.queue.pending():
            meta = dict(row.get("parameters") or {}).get("__pb_file") or {}
            if meta.get("printed"):
                continue
            source = Path(row.get("file_path") or "")
            if not source.is_file():
                log.warning("Archivo en cola local no existe: %s", source)
                continue
            self.queue.increment_attempts(str(row["job_id"]))
            with tempfile.TemporaryDirectory(prefix="pb-retry-") as folder:
                target = Path(folder) / "payload.print"
                try:
                    if meta.get("encrypted"):
                        decrypt_file(
                            source, target,
                            key_b64=meta.get("key_b64"), iv_b64=meta.get("iv_b64"),
                            auth_tag_b64=meta.get("auth_tag_b64") or None,
                            config=self.config,
                        )
                    else:
                        shutil.copyfile(source, target)
                    params = {k: v for k, v in (row.get("parameters") or {}).items() if k != "__pb_file"}
                    self.spooler.print_file(target, params, job_id=str(row["job_id"]))
                    meta["printed"] = True
                    updated = dict(row.get("parameters") or {})
                    updated["__pb_file"] = meta
                    self.queue.add(
                        str(row["job_id"]), str(row.get("order_id") or ""), source, updated, "LOCAL_QUEUE"
                    )
                    done += 1
                except Exception as exc:  # noqa: BLE001
                    log.warning("No se pudo reimprimir trabajo %s: %s", row["job_id"], exc)
                finally:
                    wipe_file(target)
        return done

    def sync_pending(self) -> int:
        """Envía estados pendientes al backend y limpia la cola local."""
        rows = self.queue.pending()
        if not rows:
            return 0
        if not self.is_online:
            log.debug("Sin conexión; se pospone sincronización de %d trabajo(s)", len(rows))
            return 0
        jobs = self.queue.to_sync_payload(rows)
        ok = self._report("jobs.sync", {"jobs": jobs})
        if not ok:
            log.warning("El backend no confirmó la sincronización de %d trabajo(s)", len(rows))
            return 0
        for row in rows:
            job_id = str(row["job_id"])
            self.queue.mark_done(job_id, "SYNCED")
            self.queue.delete(job_id)
            wipe_file(row.get("file_path") or "")
        log.info("Sincronizados %d trabajo(s) de la cola local", len(rows))
        return len(rows)

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
