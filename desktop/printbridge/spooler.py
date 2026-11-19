"""Control del spooler del SO e impresión silenciosa (sin diálogos).

Windows: pywin32 / RawPrinterHelper (StartDocPrinter + WritePrinter).
Linux/macOS: lp, lpstat, lpoptions, cancel, cupsenable/cupsdisable por subprocess.
DEMO: progreso simulado sin hardware.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

from .config import Config, detect_os_type
from .discovery import Discovery, demo_printers

log = logging.getLogger(__name__)

ProgressCallback = Callable[[int, int, str], None]

PAPER_MAP = {
    "A3": "8", "A4": "9", "A5": "11", "LETTER": "1", "LEGAL": "5", "TABLOID": "3",
}
TRAY_MAP = {"default": "15", "tray1": "1", "tray2": "2", "manual": "4"}


class PrintError(RuntimeError):
    """Error de impresión con código legible para el protocolo agent.error."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def minimal_pdf(text: str = "PrintBridge Desktop - pagina de prueba") -> bytes:
    """Genera un PDF válido de una página sin dependencias externas."""
    safe = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 18 Tf 60 760 Td ({safe}) Tj ET\n".encode("latin-1", "replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: list[int] = []
    for index, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{index} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_pos = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF\n"
    ).encode()
    return bytes(out)


class RawPrinterHelper:
    """Envío RAW al spooler de Windows sin interfaz gráfica."""

    @staticmethod
    def send(printer_name: str, data: bytes, doc_name: str = "PrintBridge job") -> None:
        import win32print  # type: ignore

        try:
            import win32api  # type: ignore

            writer = win32api.WritePrinter
        except ImportError:  # pragma: no cover
            writer = win32print.WritePrinter
        handle = win32print.OpenPrinter(printer_name)
        try:
            win32print.StartDocPrinter(handle, 1, (doc_name, None, "RAW"))
            try:
                win32print.StartPagePrinter(handle)
                for offset in range(0, len(data), 65536):
                    writer(handle, data[offset : offset + 65536])
                win32print.EndPagePrinter(handle)
            except Exception:
                try:
                    win32print.EndPagePrinter(handle)
                except Exception:  # noqa: BLE001
                    pass
                raise
            win32print.EndDocPrinter(handle)
        finally:
            win32print.ClosePrinter(handle)


class Spooler:
    """Fachada del spooler con API uniforme para todas las plataformas."""

    def __init__(self, config: Config | None = None, discovery: Discovery | None = None):
        self.config = config
        self.demo = bool(config and config.demo_mode)
        self.os_type = config.os_type if config else detect_os_type()
        self.discovery = discovery or Discovery(config)

    # ------------------------------------------------------------------ consulta
    def list_printers(self) -> list[dict[str, Any]]:
        return self.discovery.discover()

    def get_status(self, name: str) -> dict[str, Any]:
        """Devuelve {name, status, message} con estados del protocolo."""
        base: dict[str, Any] = {"name": name, "status": "ONLINE", "message": "Listo"}
        if self.demo:
            for printer in demo_printers():
                if printer["name"] == name or printer["printer_id"] == name:
                    base.update(status=printer["status"], message=printer["message"])
                    return base
            return base

        if self.os_type == "WINDOWS":
            return self._status_windows(name, base)
        return self._status_cups(name, base)

    def _status_windows(self, name: str, base: dict[str, Any]) -> dict[str, Any]:
        try:
            import win32print  # type: ignore

            handle = win32print.OpenPrinter(name)
            try:
                info = win32print.GetPrinter(handle, 2)
            finally:
                win32print.ClosePrinter(handle)
            status = int(info.get("Status", 0) or 0)
            attributes = int(info.get("Attributes", 0) or 0)
            jobs = int(info.get("cJobs", 0) or 0)
            flag = lambda constant: getattr(win32print, constant, 0)  # noqa: E731

            if status & flag("PRINTER_STATUS_PAUSED"):
                base.update(status="PAUSED", message="Impresora pausada")
            elif status & (flag("PRINTER_STATUS_PAPER_OUT") | flag("PRINTER_STATUS_NO_PAPER")):
                base.update(status="NO_PAPER", message="Sin papel")
            elif status & flag("PRINTER_STATUS_PAPER_JAM"):
                base.update(status="JAM", message="Atasco de papel")
            elif status & (flag("PRINTER_STATUS_TONER_LOW") | flag("PRINTER_STATUS_NO_TONER")):
                base.update(status="LOW_TONER", message="Tóner bajo")
            elif status & (flag("PRINTER_STATUS_OFFLINE") | flag("PRINTER_STATUS_ERROR") | flag("PRINTER_STATUS_NOT_AVAILABLE")):
                base.update(status="OFFLINE", message="Impresora desconectada")
            elif status & (flag("PRINTER_STATUS_PRINTING") | flag("PRINTER_STATUS_PROCESSING") | flag("PRINTER_STATUS_IO_ACTIVE")) or jobs > 0:
                base.update(status="PRINTING", message=f"Imprimiendo ({jobs} trabajo(s))")
            elif attributes & flag("PRINTER_ATTRIBUTE_WORK_OFFLINE"):
                base.update(status="OFFLINE", message="Trabajo sin conexión")
            return base
        except Exception as exc:  # noqa: BLE001
            log.warning("No se pudo leer estado de %s: %s", name, exc)
            base.update(status="OFFLINE", message=str(exc)[:160])
            return base

    def _status_cups(self, name: str, base: dict[str, Any]) -> dict[str, Any]:
        output = self._run(["lpstat", "-p", name], timeout=4.0)
        if not output.strip():
            base.update(status="OFFLINE", message="Impresora no encontrada en CUPS")
            return base
        text = output.lower()
        if "disabled" in text or "paused" in text:
            base.update(status="PAUSED", message="Cola pausada")
        elif "toner" in text or "low" in text:
            base.update(status="LOW_TONER", message="Tóner bajo")
        elif "paper" in text and ("out" in text or "empty" in text):
            base.update(status="NO_PAPER", message="Sin papel")
        elif "jam" in text:
            base.update(status="JAM", message="Atasco")
        elif "printing" in text:
            base.update(status="PRINTING", message="Imprimiendo")
        else:
            queued = self._run(["lpstat", "-o", name], timeout=3.0)
            if queued.strip():
                base.update(status="PRINTING", message=f"{len(queued.splitlines())} trabajo(s) en cola")
        base["message"] = output.strip().splitlines()[0][:160]
        return base

    # ------------------------------------------------------------------ control
    def pause(self, name: str) -> bool:
        if self.demo:
            log.info("DEMO: pausa simulada de %s", name)
            return True
        if self.os_type == "WINDOWS":
            try:
                import win32print  # type: ignore

                handle = win32print.OpenPrinter(name)
                try:
                    win32print.SetPrinter(handle, 0, win32print.PRINTER_CONTROL_PAUSE, 0)
                finally:
                    win32print.ClosePrinter(handle)
                return True
            except Exception as exc:  # noqa: BLE001
                log.error("No se pudo pausar %s: %s", name, exc)
                return False
        return self._run_bool(["cupsdisable", name], f"No se pudo pausar {name}")

    def resume(self, name: str) -> bool:
        if self.demo:
            log.info("DEMO: reanudación simulada de %s", name)
            return True
        if self.os_type == "WINDOWS":
            try:
                import win32print  # type: ignore

                handle = win32print.OpenPrinter(name)
                try:
                    win32print.SetPrinter(handle, 0, win32print.PRINTER_CONTROL_RESUME, 0)
                finally:
                    win32print.ClosePrinter(handle)
                return True
            except Exception as exc:  # noqa: BLE001
                log.error("No se pudo reanudar %s: %s", name, exc)
                return False
        return self._run_bool(["cupsenable", name], f"No se pudo reanudar {name}")

    def cancel_job(self, job_id: str, printer_name: str | None = None) -> bool:
        if self.demo:
            log.info("DEMO: cancelación simulada del trabajo %s", job_id)
            return True
        if self.os_type == "WINDOWS":
            try:
                import win32print  # type: ignore

                target = printer_name or self.list_printers()[0]["name"]
                handle = win32print.OpenPrinter(target)
                try:
                    win32print.SetJob(handle, 0, int(job_id), None, win32print.JOB_CONTROL_DELETE)
                finally:
                    win32print.ClosePrinter(handle)
                return True
            except Exception as exc:  # noqa: BLE001
                log.error("No se pudo cancelar trabajo %s: %s", job_id, exc)
                return False
        return self._run_bool(["cancel", str(job_id)], f"No se pudo cancelar trabajo {job_id}")

    def test_page(self, name: str) -> bool:
        with tempfile.TemporaryDirectory(prefix="pb-test-") as folder:
            path = Path(folder) / "test-page.pdf"
            path.write_bytes(minimal_pdf(f"PrintBridge Desktop - prueba de {name}"))
            return self.print_file(path, {"copies": 1, "color": True}, printer_name=name)

    # ------------------------------------------------------------------ impresión
    def print_file(
        self,
        path: str | Path,
        params: dict[str, Any] | None = None,
        progress_callback: ProgressCallback | None = None,
        printer_name: str | None = None,
        job_id: str | None = None,
    ) -> bool:
        """Imprime un archivo sin UI y reporta progreso página por página."""
        params = dict(params or {})
        source = Path(path)
        if not source.is_file():
            raise PrintError("FILE_NOT_FOUND", f"Archivo a imprimir no encontrado: {source}")

        printers = self.list_printers()
        target = printer_name or params.get("printer") or params.get("printer_name") or params.get("printer_id")
        printer = next((p for p in printers if p["name"] == target or p["printer_id"] == target), None)
        if printer is None and printers:
            printer = printers[0]
        name = str(printer["name"]) if printer else str(target or "impresora-por-defecto")

        total = self._count_pages(source)
        report = self._progress(progress_callback)
        report(0, total, f"Preparando impresión en {name}")

        simulate = params.get("simulate_error") or os.environ.get("PRINTBRIDGE_SIMULATE_ERROR")
        if self.demo and simulate:
            raise PrintError(str(simulate), f"Error simulado en impresora {name}")

        try:
            if self.demo:
                self._simulate_send(source, name, params)
            elif self.os_type == "WINDOWS":
                self._send_windows(source, name, params)
            else:
                protocol = str((printer or {}).get("protocol") or "")
                if protocol == "RAW" and (printer or {}).get("ip"):
                    self._send_raw_socket(source, str(printer["ip"]), int(printer.get("port") or 9100))
                else:
                    self._send_cups(source, name, params)
        except PrintError:
            report(0, total, "Error de impresión")
            raise
        except Exception as exc:  # noqa: BLE001
            message = str(exc)
            code = self._classify_error(message)
            report(0, total, message[:160])
            raise PrintError(code, message) from exc

        for page in range(1, total + 1):
            report(page, total, f"Imprimiendo página {page} de {total}")
            time.sleep(0.12 if self.demo else 0.03)
        report(total, total, "Impresión enviada al spooler")
        log.info("Trabajo %s impreso en %s (%d página(s))", job_id or "-", name, total)
        return True

    # ---------------------------------------------------------------- internals
    @staticmethod
    def _progress(callback: ProgressCallback | None) -> ProgressCallback:
        def report(current: int, total: int, message: str) -> None:
            if callback is None:
                return
            try:
                callback(int(current), int(total), str(message))
            except Exception as exc:  # noqa: BLE001
                log.debug("progress_callback falló: %s", exc)

        return report

    @staticmethod
    def _count_pages(path: Path) -> int:
        try:
            head = path.read_bytes()[: 4 * 1024 * 1024]
            pages = len(re.findall(rb"/Type\s*/Page\b", head))
            if pages > 0:
                return pages
            if head.startswith(b"%PDF"):
                return 1
            return max(1, head.count(b"\f") + 1)
        except OSError:
            return 1

    @staticmethod
    def _run(command: list[str], timeout: float = 30.0) -> str:
        try:
            result = subprocess.run(
                command, capture_output=True, text=True, timeout=timeout, check=False
            )
            if result.returncode != 0:
                log.debug("Comando %s devolvió %d: %s", command[0], result.returncode, result.stderr.strip())
            return result.stdout or ""
        except FileNotFoundError:
            raise PrintError("SPOOLER_UNAVAILABLE", f"Comando no disponible: {command[0]}")
        except subprocess.TimeoutExpired as exc:
            raise PrintError("PRINT_TIMEOUT", f"Timeout imprimiendo: {command[0]}") from exc

    @staticmethod
    def _run_bool(command: list[str], error_message: str) -> bool:
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=10.0, check=False)
            if result.returncode == 0:
                return True
            log.error("%s: %s", error_message, result.stderr.strip())
            return False
        except (OSError, subprocess.TimeoutExpired) as exc:
            log.error("%s: %s", error_message, exc)
            return False

    @staticmethod
    def _classify_error(message: str) -> str:
        text = message.lower()
        if "paper" in text or "sin papel" in text:
            return "NO_PAPER"
        if "jam" in text or "atasco" in text:
            return "JAM"
        if "toner" in text or "tóner" in text:
            return "LOW_TONER"
        if "offline" in text or "desconectad" in text or "unreachable" in text:
            return "PRINTER_OFFLINE"
        if "paused" in text or "disabled" in text or "pausad" in text:
            return "PRINTER_PAUSED"
        return "PRINT_FAILED"

    @staticmethod
    def _simulate_send(source: Path, name: str, params: dict[str, Any]) -> None:
        log.info(
            "DEMO: envío simulado de %s a %s (copias=%s, color=%s, dúplex=%s)",
            source.name, name, params.get("copies", 1), params.get("color", False), params.get("duplex", False),
        )
        time.sleep(0.15)

    def _send_windows(self, source: Path, name: str, params: dict[str, Any]) -> None:
        try:
            import win32print  # type: ignore
        except ImportError as exc:
            raise PrintError("SPOOLER_UNAVAILABLE", "pywin32 no está instalado en Windows") from exc
        try:
            handle = win32print.OpenPrinter(name)
            try:
                info = win32print.GetPrinter(handle, 2)
                devmode = info.get("pDevMode") if isinstance(info, dict) else None
                if devmode is not None:
                    try:
                        devmode.dmCopies = max(1, min(999, int(params.get("copies", 1))))
                        if "color" in params:
                            devmode.dmColor = (
                                getattr(win32print, "DMCOLOR_COLOR", 2)
                                if params.get("color")
                                else getattr(win32print, "DMCOLOR_MONOCHROME", 1)
                            )
                        if params.get("duplex"):
                            devmode.dmDuplex = getattr(win32print, "DMDUP_SIMPLEX", 1) + 1
                        paper = str(params.get("paper_size") or "").upper()
                        if paper in PAPER_MAP:
                            devmode.dmPaperSize = int(PAPER_MAP[paper])
                        tray = str(params.get("tray") or "default").lower()
                        if tray in TRAY_MAP:
                            devmode.dmDefaultSource = int(TRAY_MAP[tray])
                        info["pDevMode"] = devmode
                        win32print.SetPrinter(handle, 2, info, 0)
                    except Exception as exc:  # noqa: BLE001
                        log.warning("No se pudieron aplicar parámetros DEVMODE: %s", exc)
            finally:
                win32print.ClosePrinter(handle)
        except Exception as exc:  # noqa: BLE001
            log.debug("No se pudo abrir impresora para ajustar DEVMODE: %s", exc)
        RawPrinterHelper.send(name, source.read_bytes(), f"PrintBridge {source.name}")

    def _send_cups(self, source: Path, name: str, params: dict[str, Any]) -> None:
        if not shutil.which("lp"):
            raise PrintError("SPOOLER_UNAVAILABLE", "Comando lp no disponible")
        copies = max(1, min(999, int(params.get("copies", 1) or 1)))
        command = ["lp", "-d", name, "-n", str(copies)]
        options: list[str] = []
        if params.get("page_range"):
            options.append(f"page-ranges={params['page_range']}")
        if "color" in params:
            options.append("ColorModel=Color" if params["color"] else "ColorModel=Gray")
        if params.get("duplex"):
            options.append("sides=two-sided-long-edge")
        else:
            options.append("sides=one-sided")
        if params.get("paper_size"):
            options.append(f"media={params['paper_size']}")
        tray = str(params.get("tray") or "").strip()
        if tray and tray.lower() != "default":
            options.append(f"InputSlot={tray}")
        for option in options:
            command += ["-o", option]
        command.append(str(source))
        output = self._run(command, timeout=120.0)
        log.debug("lp: %s", output.strip()[:200])

    @staticmethod
    def _send_raw_socket(source: Path, ip: str, port: int) -> None:
        try:
            with socket.create_connection((ip, port), timeout=15.0) as sock:
                with source.open("rb") as handle:
                    for chunk in iter(lambda: handle.read(65536), b""):
                        sock.sendall(chunk)
        except OSError as exc:
            raise PrintError("PRINTER_OFFLINE", f"No se pudo enviar RAW a {ip}:{port}: {exc}") from exc
