"""Autodescubrimiento de impresoras locales, USB, LAN, IPP, RAW, mDNS y SMB.

Todas las sondas son *best-effort*: si falta una librería o el comando del SO no
existe, se registra un aviso y se continúa.  El resultado se cachea 5 minutos.
"""

from __future__ import annotations

import ipaddress
import logging
import re
import shutil
import socket
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from .config import Config, detect_os_type

log = logging.getLogger(__name__)


def _default_capabilities() -> dict[str, Any]:
    return {"color": True, "duplex": True, "trays": ["default"], "paper_sizes": ["A4", "LETTER"]}


def _run(command: list[str], timeout: float = 4.0) -> str:
    try:
        completed = subprocess.run(
            command, capture_output=True, text=True, timeout=timeout, check=False
        )
        return completed.stdout or ""
    except FileNotFoundError:
        log.debug("Comando no disponible: %s", command[0])
    except subprocess.TimeoutExpired:
        log.debug("Timeout ejecutando %s", " ".join(command))
    except OSError as exc:
        log.debug("Error ejecutando %s: %s", " ".join(command), exc)
    return ""


def _capabilities_from_lpoptions(name: str) -> dict[str, Any]:
    caps = _default_capabilities()
    output = _run(["lpoptions", "-p", name, "-l"], timeout=3.0)
    for line in output.splitlines():
        lower = line.lower()
        if lower.startswith(("pagesize", "media")):
            sizes = re.findall(r"\*?([A-Za-z0-9_.-]+)", line.split(":", 1)[-1])
            if sizes:
                caps["paper_sizes"] = list(dict.fromkeys(sizes))[:12]
        elif lower.startswith("duplex"):
            caps["duplex"] = any(token in lower for token in ("duplex", "two", "long-edge", "short-edge"))
            if "none" in lower and "none" not in line.split(":", 1)[-1][:1].lower():
                caps["duplex"] = "duplex" in lower.replace("none", "")
        elif lower.startswith("colormodel"):
            starred = re.search(r"\*([^\s]+)", line.split(":", 1)[-1])
            caps["color"] = bool(starred and "gray" not in starred.group(1).lower())
        elif lower.startswith(("inputslot", "mediaposition", "tray")):
            slots = re.findall(r"\*?([A-Za-z0-9_.-]+)", line.split(":", 1)[-1])
            if slots:
                caps["trays"] = list(dict.fromkeys(slots))[:8]
    return caps


def _capabilities_from_cups(info: dict[str, Any]) -> dict[str, Any]:
    caps = _default_capabilities()
    color = info.get("printer-color-mode-supported") or info.get("print-color-mode-supported")
    if color:
        text = str(color).lower()
        caps["color"] = "monochrome" not in text and "gray" not in text
    caps["duplex"] = bool(info.get("printer-duplex-supported") or info.get("sides-supported"))
    sizes = info.get("printer-media-supported") or []
    if sizes:
        caps["paper_sizes"] = [str(s).replace("iso_", "").upper() for s in sizes[:12]]
    trays = info.get("printer-input-slot-supported") or []
    if trays:
        caps["trays"] = [str(t) for t in trays[:8]]
    return caps


def _printer(name: str, ptype: str, protocol: str, *, ip: str | None = None,
             port: int | None = None, capabilities: dict[str, Any] | None = None,
             status: str = "ONLINE", message: str = "Listo") -> dict[str, Any]:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("_") or "printer"
    return {
        "printer_id": f"pb-{ptype.lower()}-{safe}",
        "name": name,
        "type": ptype,
        "ip": ip,
        "port": port,
        "protocol": protocol,
        "capabilities": capabilities or _default_capabilities(),
        "status": status,
        "message": message,
    }


def demo_printers() -> list[dict[str, Any]]:
    """Dos impresoras simuladas con estados ONLINE y LOW_TONER."""
    return [
        _printer(
            "Demo HP LaserJet Pro", "LOCAL", "LOCAL",
            capabilities={"color": False, "duplex": True, "trays": ["default", "Tray1"], "paper_sizes": ["A4", "LETTER"]},
            status="ONLINE", message="Listo (demo)",
        ),
        _printer(
            "Demo EPSON Color IPP", "NETWORK", "IPP", ip="192.168.1.50", port=631,
            capabilities={"color": True, "duplex": True, "trays": ["default"], "paper_sizes": ["A4", "LETTER", "A3"]},
            status="LOW_TONER", message="Tóner bajo (demo)",
        ),
    ]


class Discovery:
    """Descubre y cachea impresoras."""

    def __init__(self, config: Config | None = None):
        self.config = config
        self._cache: list[dict[str, Any]] = []
        self._cached_at = 0.0
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ API
    def discover(self, force: bool = False) -> list[dict[str, Any]]:
        if self.config is not None and self.config.demo_mode:
            return demo_printers()
        ttl = self.config.discovery_cache_s if self.config else 300
        now = time.monotonic()
        with self._lock:
            if not force and self._cache and (now - self._cached_at) < ttl:
                return [dict(item) for item in self._cache]

        printers: list[dict[str, Any]] = []
        try:
            printers.extend(self._local_printers())
        except Exception as exc:  # noqa: BLE001 - nunca derribar el descubrimiento
            log.warning("Fallo descubriendo impresoras locales: %s", exc)
        try:
            printers.extend(self._shared_printers())
        except Exception as exc:  # noqa: BLE001
            log.debug("Fallo descubriendo impresoras compartidas: %s", exc)
        try:
            printers.extend(self.network_printers())
        except Exception as exc:  # noqa: BLE001
            log.warning("Fallo escaneando LAN: %s", exc)
        try:
            printers.extend(self.mdns_printers())
        except Exception as exc:  # noqa: BLE001
            log.debug("Fallo descubriendo mDNS: %s", exc)

        printers = self._dedupe(printers)
        if not printers:
            log.warning("No se detectaron impresoras reales; se activan 2 impresoras demo")
            printers = demo_printers()
        with self._lock:
            self._cache = printers
            self._cached_at = time.monotonic()
        return [dict(item) for item in printers]

    def list_printers(self, force: bool = False) -> list[dict[str, Any]]:
        return self.discover(force=force)

    def get_printer(self, name_or_id: str) -> dict[str, Any] | None:
        for item in self.discover():
            if item.get("name") == name_or_id or item.get("printer_id") == name_or_id:
                return item
        return None

    @staticmethod
    def _dedupe(printers: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        result: list[dict[str, Any]] = []
        for item in printers:
            key = str(item.get("printer_id") or item.get("name"))
            if key in seen:
                continue
            seen.add(key)
            result.append(item)
        return result

    # --------------------------------------------------------------- locales
    def _local_printers(self) -> list[dict[str, Any]]:
        os_type = self.config.os_type if self.config else detect_os_type()
        if os_type == "WINDOWS":
            return self._windows_printers()
        return self._cups_printers()

    def _windows_printers(self) -> list[dict[str, Any]]:
        try:
            import win32print  # type: ignore
        except ImportError:
            log.warning("pywin32 no disponible; impresoras Windows no listadas")
            return []
        flags = getattr(win32print, "PRINTER_ENUM_LOCAL", 2) | getattr(
            win32print, "PRINTER_ENUM_CONNECTIONS", 4
        )
        result: list[dict[str, Any]] = []
        for raw in win32print.EnumPrinters(flags):
            name = str(raw[2]) if len(raw) > 2 else str(raw)
            caps = _default_capabilities()
            try:
                handle = win32print.OpenPrinter(name)
                info = win32print.GetPrinter(handle, 2)
                devmode = info.get("pDevMode") if isinstance(info, dict) else None
                if devmode:
                    caps["color"] = devmode.get("dmColor", 2) == getattr(win32print, "DMCOLOR_COLOR", 2)
                    caps["duplex"] = int(devmode.get("dmDuplex", 1)) > 1
                    caps["trays"] = [str(devmode.get("dmDefaultSource", "default"))]
                    caps["paper_sizes"] = [str(devmode.get("dmPaperSize", "A4"))]
                win32print.ClosePrinter(handle)
            except Exception as exc:  # noqa: BLE001
                log.debug("No se pudieron leer capacidades de %s: %s", name, exc)
            result.append(_printer(name, "LOCAL", "WIN32", capabilities=caps))
        return result

    def _cups_printers(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        try:
            import cups  # type: ignore

            connection = cups.Connection()
            for name, info in (connection.getPrinters() or {}).items():
                state = int(info.get("printer-state", 3))
                status = {3: "ONLINE", 4: "PRINTING", 5: "OFFLINE"}.get(state, "ONLINE")
                result.append(
                    _printer(
                        str(info.get("printer-info") or name),
                        "LOCAL", "CUPS",
                        capabilities=_capabilities_from_cups(info),
                        status=status,
                        message=str(info.get("printer-state-message") or "Listo"),
                    )
                )
            if result:
                return result
        except ImportError:
            log.debug("pycups no disponible; se usa lpstat/lpoptions")
        except Exception as exc:  # noqa: BLE001
            log.debug("CUPS no disponible: %s", exc)

        output = _run(["lpstat", "-p", "-d"], timeout=4.0)
        names: list[str] = []
        for line in output.splitlines():
            match = re.match(r"\s*printer\s+(\S+)", line)
            if match:
                names.append(match.group(1))
        if not names:
            log.debug("lpstat no devolvió impresoras")
            return []
        devices = _run(["lpstat", "-v"], timeout=4.0)
        device_map: dict[str, str] = {}
        for line in devices.splitlines():
            match = re.match(r"\s*device for (\S+):\s*(.+)$", line)
            if match:
                device_map[match.group(1)] = match.group(2).strip()
        for name in names:
            device = device_map.get(name, "")
            ip = None
            host_match = re.search(r"://([^:/]+)", device)
            if host_match and re.match(r"^\d+\.\d+\.\d+\.\d+$", host_match.group(1)):
                ip = host_match.group(1)
            is_network = bool(ip) or device.lower().startswith(("ipp:", "ipps:", "smb:", "lpd:"))
            result.append(
                _printer(
                    name,
                    "NETWORK" if is_network else "LOCAL",
                    device.split(":", 1)[0].upper() if device else "CUPS",
                    ip=ip,
                    capabilities=_capabilities_from_lpoptions(name),
                )
            )
        return result

    def _shared_printers(self) -> list[dict[str, Any]]:
        """SMB/WSD best-effort: Windows vía EnumPrinters, Linux vía smbtree."""
        os_type = self.config.os_type if self.config else detect_os_type()
        if os_type == "WINDOWS":
            try:
                import win32print  # type: ignore

                flag = getattr(win32print, "PRINTER_ENUM_NETWORK", 64)
                result = []
                for raw in win32print.EnumPrinters(flag):
                    name = str(raw[2]) if len(raw) > 2 else str(raw)
                    result.append(_printer(name, "SHARED", "SMB"))
                return result
            except Exception as exc:  # noqa: BLE001
                log.debug("EnumPrinters(network) no disponible: %s", exc)
                return []
        if not shutil.which("smbtree"):
            log.debug("smbtree no instalado; se omite descubrimiento SMB/WSD")
            return []
        output = _run(["smbtree", "-N"], timeout=5.0)
        result: list[dict[str, Any]] = []
        for line in output.splitlines():
            match = re.search(r"\\\\([^\\\s]+)\\([^\s]+)", line)
            if not match:
                continue
            host, share = match.group(1), match.group(2)
            if "print" not in share.lower() and "print" not in line.lower():
                continue
            result.append(_printer(f"{share} ({host})", "SHARED", "SMB", ip=host if re.match(r"^\d+\.\d+\.\d+\.\d+$", host) else None))
        return result

    # ------------------------------------------------------------------ LAN
    def _local_subnet(self) -> ipaddress.IPv4Network | None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("8.8.8.8", 80))
            ip = sock.getsockname()[0]
        except OSError:
            ip = "127.0.0.1"
        finally:
            sock.close()
        if ip.startswith("127."):
            return None
        try:
            return ipaddress.IPv4Network(f"{ip}/24", strict=False)
        except ValueError:
            return None

    @staticmethod
    def _probe(host: str, timeout: float) -> list[tuple[int, str]]:
        found: list[tuple[int, str]] = []
        for port, protocol in ((631, "IPP"), (9100, "RAW")):
            try:
                with socket.create_connection((host, port), timeout=timeout):
                    found.append((port, protocol))
            except OSError:
                continue
        return found

    def network_printers(self) -> list[dict[str, Any]]:
        if self.config is not None and not self.config.network_scan_enabled:
            return []
        subnet = self._local_subnet()
        if subnet is None:
            log.debug("Sin subred local detectable; se omite escaneo LAN")
            return []
        timeout = float(getattr(self.config, "network_scan_timeout", 0.18)) if self.config else 0.18
        timeout = max(0.05, min(timeout, 1.0))
        hosts = [str(host) for host in subnet.hosts()][:254]
        result: list[dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=32, thread_name_prefix="pb-scan") as pool:
            futures = {pool.submit(self._probe, host, timeout): host for host in hosts}
            for future in as_completed(futures):
                host = futures[future]
                try:
                    found = future.result()
                except Exception:  # noqa: BLE001
                    continue
                for port, protocol in found:
                    result.append(
                        _printer(
                            f"{protocol} {host}", "NETWORK", protocol, ip=host, port=port,
                            capabilities=_default_capabilities(), status="ONLINE",
                        )
                    )
        log.info("Escaneo LAN: %d dispositivo(s) encontrado(s)", len(result))
        return result

    def mdns_printers(self) -> list[dict[str, Any]]:
        try:
            from zeroconf import ServiceBrowser, ServiceListener, Zeroconf  # type: ignore
        except ImportError:
            log.debug("zeroconf no disponible; se omite mDNS")
            return []

        found: list[dict[str, Any]] = []

        class _Listener(ServiceListener):  # type: ignore[misc]
            def add_service(self, zc: Any, service_type: str, name: str) -> None:
                try:
                    info = zc.get_service_info(service_type, name, timeout=1000)
                    if info is None:
                        return
                    ip = socket.inet_ntoa(info.addresses[0]) if info.addresses else None
                    protocol = "RAW" if "pdl-datastream" in service_type else "IPP"
                    found.append(
                        _printer(
                            str(info.server or name).rstrip("."),
                            "NETWORK", protocol, ip=ip, port=int(info.port or 631),
                            capabilities=_default_capabilities(),
                        )
                    )
                except Exception as exc:  # noqa: BLE001
                    log.debug("Error resolviendo servicio mDNS %s: %s", name, exc)

            def remove_service(self, zc: Any, service_type: str, name: str) -> None:
                return

            def update_service(self, zc: Any, service_type: str, name: str) -> None:
                return

        zc = Zeroconf()
        browser = None
        try:
            listener = _Listener()
            browser = ServiceBrowser(zc, ["_ipp._tcp.local.", "_printer._tcp.local.", "_pdl-datastream._tcp.local."], listener)
            threading.Event().wait(2.0)
        finally:
            try:
                if browser is not None:
                    browser.cancel()
                zc.close()
            except Exception:  # noqa: BLE001
                pass
        return found
