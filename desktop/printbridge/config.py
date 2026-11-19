"""Carga y validación de la configuración del agente PrintBridge Desktop.

Lee variables de entorno desde ``desktop/.env`` (o la ruta indicada).  Usa
``python-dotenv`` si está instalado; si no, un parser manual mínimo.  Ninguna
librería externa es obligatoria para importar este módulo.
"""

from __future__ import annotations

import logging
import os
import platform
import re
import socket
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlsplit, urlunsplit

log = logging.getLogger(__name__)

DESKTOP_DIR = Path(__file__).resolve().parent.parent
DEFAULT_ENV_FILE = DESKTOP_DIR / ".env"
RESOURCES_DIR = DESKTOP_DIR / "resources"

_TRUTHY = {"1", "true", "yes", "y", "on"}
_FALSY = {"0", "false", "no", "n", "off", ""}


class ConfigError(ValueError):
    """Configuración inválida o incompleta."""


def as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in _TRUTHY:
        return True
    if text in _FALSY:
        return False
    return default


def as_int(value: Any, default: int, minimum: int = 0) -> int:
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return default
    return number if number >= minimum else default


def detect_os_type() -> str:
    system = platform.system().lower()
    if system.startswith("win"):
        return "WINDOWS"
    if system.startswith("darwin") or system.startswith("mac"):
        return "MACOS"
    return "LINUX"


def load_env_file(path: Path | str | None = None) -> Path:
    """Carga un fichero .env en ``os.environ`` sin sobrescribir variables reales."""
    env_path = Path(path) if path else DEFAULT_ENV_FILE
    try:
        from dotenv import load_dotenv  # type: ignore

        load_dotenv(dotenv_path=env_path, override=False)
        return env_path
    except ImportError:
        pass

    if not env_path.is_file():
        return env_path
    try:
        content = env_path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        log.warning("No se pudo leer %s: %s", env_path, exc)
        return env_path

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("\"", "'"):
            value = value[1:-1]
        else:
            # Comentario en línea sólo en valores sin comillas.
            value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
        if key and key not in os.environ:
            os.environ[key] = value
    return env_path


def _resolve_inside_desktop(value: str) -> str:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = DESKTOP_DIR / path
    return str(path)


@dataclass
class Config:
    """Configuración en memoria del agente."""

    backend_url: str = "http://localhost:3000"
    ws_url: str = "ws://localhost:3000/socket.io"
    station_id: str = ""
    station_token: str = ""
    station_name: str = ""
    os_type: str = field(default_factory=detect_os_type)
    demo_mode: bool = False
    interval_telemetry_s: int = 30
    poll_interval_s: int = 10
    encryption_key: str = ""
    jwt_secret: str = ""
    computer_name: str = field(default_factory=socket.gethostname)
    discovery_cache_s: int = 300
    log_level: str = "INFO"
    log_file: str = "printbridge.log"
    queue_db_path: str = field(default_factory=lambda: str(DESKTOP_DIR / "local_queue.db"))
    cache_dir: str = field(default_factory=lambda: str(DESKTOP_DIR / ".cache" / "jobs"))
    config_path: str = str(DEFAULT_ENV_FILE)
    max_concurrent_jobs: int = 2
    network_scan_enabled: bool = True
    network_scan_timeout: float = 0.18

    def __post_init__(self) -> None:
        self.backend_url = (self.backend_url or "http://localhost:3000").rstrip("/")
        self.ws_url = (self.ws_url or "ws://localhost:3000/socket.io").rstrip("/")
        self.station_id = str(self.station_id or "").strip()
        self.station_token = str(self.station_token or "").strip()
        self.station_name = str(self.station_name or "").strip()
        self.interval_telemetry_s = as_int(self.interval_telemetry_s, 30, 1)
        self.poll_interval_s = as_int(self.poll_interval_s, 10, 1)
        self.discovery_cache_s = as_int(self.discovery_cache_s, 300, 1)
        self.max_concurrent_jobs = as_int(self.max_concurrent_jobs, 2, 1)
        self.log_level = str(self.log_level or "INFO").upper()
        self.log_file = _resolve_inside_desktop(self.log_file or "printbridge.log")
        self.queue_db_path = _resolve_inside_desktop(
            self.queue_db_path or str(DESKTOP_DIR / "local_queue.db")
        )
        self.cache_dir = _resolve_inside_desktop(
            self.cache_dir or str(DESKTOP_DIR / ".cache" / "jobs")
        )
        self.config_path = _resolve_inside_desktop(self.config_path or str(DEFAULT_ENV_FILE))
        if self.demo_mode:
            if not self.station_id:
                self.station_id = "demo-station"
            if not self.station_token:
                self.station_token = "demo-token"
        if not self.station_name:
            self.station_name = self.station_id or self.computer_name

    # ------------------------------------------------------------------ factory
    @classmethod
    def from_env(
        cls,
        env_file: Path | str | None = None,
        overrides: Mapping[str, Any] | None = None,
    ) -> "Config":
        path = load_env_file(env_file)
        extra = dict(overrides or {})

        def get(name: str, default: str = "") -> str:
            if name in extra and extra[name] is not None:
                return str(extra[name])
            return os.environ.get(name, default)

        cfg = cls(
            backend_url=get("BACKEND_URL", "http://localhost:3000"),
            ws_url=get("WS_URL", "ws://localhost:3000/socket.io"),
            station_id=get("STATION_ID"),
            station_token=get("STATION_TOKEN"),
            station_name=get("STATION_NAME"),
            os_type=get("OS_TYPE") or detect_os_type(),
            demo_mode=as_bool(get("DEMO_MODE", "false"), False),
            interval_telemetry_s=as_int(get("INTERVAL_TELEMETRY_S", "30"), 30, 1),
            poll_interval_s=as_int(get("POLL_INTERVAL_S", "10"), 10, 1),
            encryption_key=get("ENCRYPTION_KEY"),
            jwt_secret=get("JWT_SECRET") or get("NEXTAUTH_SECRET"),
            computer_name=get("COMPUTER_NAME") or socket.gethostname(),
            discovery_cache_s=as_int(get("DISCOVERY_CACHE_S", "300"), 300, 1),
            log_level=get("LOG_LEVEL", "INFO"),
            log_file=get("LOG_FILE", "printbridge.log"),
            queue_db_path=get("QUEUE_DB_PATH", str(DESKTOP_DIR / "local_queue.db")),
            cache_dir=get("CACHE_DIR", str(DESKTOP_DIR / ".cache" / "jobs")),
            config_path=str(path),
            max_concurrent_jobs=as_int(get("MAX_CONCURRENT_JOBS", "2"), 2, 1),
            network_scan_enabled=as_bool(get("NETWORK_SCAN_ENABLED", "true"), True),
            network_scan_timeout=float(get("NETWORK_SCAN_TIMEOUT", "0.18") or 0.18),
        )
        return cfg

    # ---------------------------------------------------------------- validation
    def validate(self) -> None:
        """Exige credenciales fuera de DEMO.  Lanza :class:`ConfigError`."""
        if self.demo_mode:
            return
        missing: list[str] = []
        if not self.station_id:
            missing.append("STATION_ID")
        if not self.station_token:
            missing.append("STATION_TOKEN")
        if missing:
            raise ConfigError(
                "Faltan variables obligatorias: "
                + ", ".join(missing)
                + ". Configúralas en desktop/.env o desde la consola."
            )
        key = self.encryption_key.strip()
        if key and not re.fullmatch(r"[0-9a-fA-F]{64}", key):
            log.warning("ENCRYPTION_KEY no es hexadecimal de 32 bytes; se ignorará.")

    @property
    def is_configured(self) -> bool:
        return self.demo_mode or bool(self.station_id and self.station_token)

    def rest_url(self, path: str) -> str:
        return f"{self.backend_url}/{str(path).lstrip('/')}"

    def engineio_base_url(self) -> str:
        """URL HTTP de Engine.IO derivada de ``WS_URL`` (p. ej. /socket.io)."""
        parts = urlsplit(self.ws_url)
        scheme = "https" if parts.scheme in ("wss", "https") else "http"
        path = parts.path.rstrip("/") or "/socket.io"
        return urlunsplit((scheme, parts.netloc, path, "", ""))

    def websocket_upgrade_url(self, sid: str) -> str:
        parts = urlsplit(self.ws_url)
        scheme = "wss" if parts.scheme in ("wss", "https") else "ws"
        path = parts.path.rstrip("/") or "/socket.io"
        return urlunsplit((scheme, parts.netloc, path, f"EIO=4&transport=websocket&sid={sid}", ""))

    def save_credentials(
        self, station_id: str, station_token: str, station_name: str | None = None
    ) -> Path:
        """Persiste credenciales en el .env de desktop y actualiza esta instancia."""
        self.station_id = str(station_id or "").strip()
        self.station_token = str(station_token or "").strip()
        if station_name is not None:
            self.station_name = str(station_name).strip()
        path = Path(self.config_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        values = {
            "STATION_ID": self.station_id,
            "STATION_TOKEN": self.station_token,
            "STATION_NAME": self.station_name,
        }
        original = path.read_text(encoding="utf-8") if path.is_file() else ""
        lines = original.splitlines()
        seen: set[str] = set()
        for index, line in enumerate(lines):
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key = stripped.split("=", 1)[0].strip()
            if key in values:
                lines[index] = f"{key}={values[key]}"
                seen.add(key)
        for key, value in values.items():
            if key not in seen:
                lines.append(f"{key}={value}")
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
        try:
            tmp.chmod(0o600)
        except OSError:
            pass
        os.replace(tmp, path)
        try:
            path.chmod(0o600)
        except OSError:
            pass
        os.environ["STATION_ID"] = self.station_id
        os.environ["STATION_TOKEN"] = self.station_token
        log.info("Credenciales guardadas en %s", path)
        return path

    def public_dict(self) -> dict[str, Any]:
        token = self.station_token
        masked = (token[:6] + "..." + token[-4:]) if len(token) > 12 else "***"
        return {
            "station_id": self.station_id,
            "station_token": masked,
            "station_name": self.station_name,
            "backend_url": self.backend_url,
            "ws_url": self.ws_url,
            "os_type": self.os_type,
            "demo_mode": self.demo_mode,
            "computer_name": self.computer_name,
            "interval_telemetry_s": self.interval_telemetry_s,
            "poll_interval_s": self.poll_interval_s,
        }
