"""PrintBridge Desktop — agente de estación de impresión para PrintFlow ERP.

Paquete autónomo Python 3.10+.  Todas las dependencias externas son opcionales:
el agente degrada a modo DEMO / solo-log cuando falta alguna de ellas.
"""

from __future__ import annotations

__version__ = "1.0.0"
__all__ = [
    "config",
    "auth",
    "crypto",
    "local_queue",
    "discovery",
    "spooler",
    "printer_job",
    "ws_client",
    "console",
    "tray",
    "main",
]
