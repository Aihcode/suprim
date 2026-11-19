"""Icono de bandeja (pystray) y helpers de inicio automático por SO.

Si pystray/Pillow no están disponibles o no hay sesión gráfica, el controlador
no hace nada y deja constancia en el log: el agente sigue funcionando en primer
plano o en modo solo-log.
"""

from __future__ import annotations

import logging
import os
import plistlib
import sys
import threading
from pathlib import Path
from typing import Any, Callable

from .config import RESOURCES_DIR, Config

log = logging.getLogger(__name__)

try:  # pragma: no cover - depende del entorno
    import pystray  # type: ignore
    from PIL import Image, ImageDraw  # type: ignore
except ImportError:
    pystray = None  # type: ignore
    Image = None  # type: ignore
    ImageDraw = None  # type: ignore


def autostart_command(config: Config | None = None) -> str:
    """Comando que se registrará para iniciar el agente con el SO."""
    executable = sys.executable or "python3"
    if getattr(sys, "frozen", False):
        return f'"{executable}" --tray'
    main_py = Path(__file__).resolve().with_name("main.py")
    return f'"{executable}" "{main_py}" --tray'


def _linux_desktop_entry(command: str) -> str:
    template = RESOURCES_DIR / "printbridge.desktop"
    try:
        text = template.read_text(encoding="utf-8") if template.is_file() else ""
    except OSError:
        text = ""
    if not text:
        text = (
            "[Desktop Entry]\nType=Application\nName=PrintBridge Desktop\n"
            "Comment=Agente de estación de impresión PrintFlow\nTerminal=false\n"
        )
    lines = [line for line in text.splitlines() if not line.startswith("Exec=")]
    lines.append(f"Exec={command}")
    return "\n".join(lines).rstrip() + "\n"


def install_autostart(config: Config) -> bool:
    """Instala el inicio automático.  Devuelve True si tuvo éxito."""
    command = autostart_command(config)
    os_type = config.os_type
    try:
        if os_type == "WINDOWS":
            import winreg  # type: ignore

            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                0,
                winreg.KEY_SET_VALUE,
            )
            try:
                winreg.SetValueEx(key, "PrintBridgeDesktop", 0, winreg.REG_SZ, command)
            finally:
                winreg.CloseKey(key)
        elif os_type == "MACOS":
            folder = Path.home() / "Library" / "LaunchAgents"
            folder.mkdir(parents=True, exist_ok=True)
            payload = {
                "Label": "com.printflow.printbridge",
                "ProgramArguments": [sys.executable or "python3", str(Path(__file__).with_name("main.py")), "--tray"],
                "RunAtLoad": True,
                "KeepAlive": True,
            }
            path = folder / "com.printflow.printbridge.plist"
            with path.open("wb") as handle:
                plistlib.dump(payload, handle)
        else:
            folder = Path.home() / ".config" / "autostart"
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / "printbridge.desktop"
            path.write_text(_linux_desktop_entry(command), encoding="utf-8")
            try:
                path.chmod(0o644)
            except OSError:
                pass
        log.info("Inicio automático instalado (%s): %s", os_type, command)
        return True
    except Exception as exc:  # noqa: BLE001
        log.error("No se pudo instalar inicio automático: %s", exc)
        return False


def uninstall_autostart(config: Config) -> bool:
    """Quita el inicio automático (best-effort)."""
    try:
        if config.os_type == "WINDOWS":
            import winreg  # type: ignore

            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                0,
                winreg.KEY_SET_VALUE,
            )
            try:
                winreg.DeleteValue(key, "PrintBridgeDesktop")
            finally:
                winreg.CloseKey(key)
        elif config.os_type == "MACOS":
            (Path.home() / "Library" / "LaunchAgents" / "com.printflow.printbridge.plist").unlink(missing_ok=True)
        else:
            (Path.home() / ".config" / "autostart" / "printbridge.desktop").unlink(missing_ok=True)
        log.info("Inicio automático desinstalado")
        return True
    except FileNotFoundError:
        log.info("No había inicio automático instalado")
        return True
    except Exception as exc:  # noqa: BLE001
        log.error("No se pudo desinstalar inicio automático: %s", exc)
        return False


def is_autostart_installed(config: Config) -> bool:
    try:
        if config.os_type == "WINDOWS":
            import winreg  # type: ignore

            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                0,
                winreg.KEY_READ,
            )
            try:
                winreg.QueryValueEx(key, "PrintBridgeDesktop")
                return True
            finally:
                winreg.CloseKey(key)
        if config.os_type == "MACOS":
            return (Path.home() / "Library" / "LaunchAgents" / "com.printflow.printbridge.plist").is_file()
        return (Path.home() / ".config" / "autostart" / "printbridge.desktop").is_file()
    except Exception:  # noqa: BLE001
        return False


class TrayController:
    """Menú de bandeja: consola, pausa, sincronizar y salir."""

    def __init__(self, config: Config, actions: dict[str, Callable[[], Any]] | None = None):
        self.config = config
        self.actions = actions or {}
        self.icon: Any | None = None
        self._thread: threading.Thread | None = None

    @property
    def available(self) -> bool:
        return pystray is not None and Image is not None

    def _image(self) -> Any:
        icon_file = RESOURCES_DIR / "icon.png"
        try:
            if icon_file.is_file():
                return Image.open(icon_file).convert("RGBA")
        except Exception as exc:  # noqa: BLE001
            log.warning("No se pudo cargar %s: %s", icon_file, exc)
        image = Image.new("RGBA", (64, 64), (30, 64, 175, 255))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((10, 22, 54, 42), radius=5, fill=(255, 255, 255, 255))
        draw.rectangle((16, 42, 48, 47), fill=(8, 145, 178, 255))
        return image

    def start(self) -> None:
        if not self.available:
            log.warning("pystray/Pillow no disponibles o sin bandeja gráfica; se omite icono")
            return
        try:
            menu = pystray.Menu(
                pystray.MenuItem("Abrir consola", self._open_console, default=True),
                pystray.MenuItem("Pausar impresoras", self._pause_all),
                pystray.MenuItem("Sincronizar ahora", self._sync_now),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Salir", self._quit),
            )
            self.icon = pystray.Icon("PrintBridge", self._image(), "PrintBridge Desktop", menu)
            self._thread = threading.Thread(target=self.icon.run, name="pb-tray", daemon=True)
            self._thread.start()
            log.info("Icono de bandeja iniciado")
        except Exception as exc:  # noqa: BLE001
            log.warning("No se pudo iniciar bandeja (entorno headless): %s", exc)
            self.icon = None

    def _open_console(self, _icon: Any = None, _item: Any = None) -> None:
        self._call("open_console")

    def _pause_all(self, _icon: Any = None, _item: Any = None) -> None:
        self._call("pause_all")

    def _sync_now(self, _icon: Any = None, _item: Any = None) -> None:
        self._call("sync_now")

    def _quit(self, _icon: Any = None, _item: Any = None) -> None:
        self._call("quit")

    def _call(self, name: str) -> None:
        callback = self.actions.get(name)
        if callback:
            try:
                callback()
            except Exception as exc:  # noqa: BLE001
                log.error("Acción de bandeja %s falló: %s", name, exc)

    def notify(self, message: str, title: str = "PrintBridge Desktop") -> None:
        if self.icon is not None:
            try:
                self.icon.notify(message, title)
            except Exception:  # noqa: BLE001
                pass

    def stop(self) -> None:
        if self.icon is not None:
            try:
                self.icon.stop()
            except Exception:  # noqa: BLE001
                pass
            self.icon = None
