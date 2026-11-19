"""Consola visual Tkinter del operador.

Todas las actualizaciones que llegan desde hilos WS/spooler se encolan con
``queue.Queue`` y se aplican en el hilo de la UI mediante ``after()``.  Si
Tkinter no está disponible (headless), se lanza :class:`ConsoleUnavailable` y
``main.py`` continúa en modo solo-log.
"""

from __future__ import annotations

import logging
import queue
import threading
from datetime import datetime
from typing import Any, Callable

log = logging.getLogger(__name__)

try:  # pragma: no cover - depende del entorno
    import tkinter as tk
    from tkinter import ttk
except ImportError:  # pragma: no cover
    tk = None  # type: ignore
    ttk = None  # type: ignore

BG = "#F8FAFC"
CARD = "#FFFFFF"
BORDER = "#E2E8F0"
TEXT = "#0F172A"
MUTED = "#475569"
PRIMARY = "#2563EB"
CYAN = "#0891B2"
ONLINE = "#16A34A"
OFFLINE = "#DC2626"
WARNING = "#D97706"

STATUS_COLORS = {
    "ONLINE": ONLINE,
    "PRINTING": CYAN,
    "LOW_TONER": WARNING,
    "NO_PAPER": WARNING,
    "JAM": OFFLINE,
    "OFFLINE": OFFLINE,
    "PAUSED": WARNING,
    "LOCAL_QUEUE": WARNING,
    "COMPLETED": ONLINE,
    "FAILED": OFFLINE,
}


class ConsoleUnavailable(RuntimeError):
    """Tkinter no se puede inicializar (entorno headless)."""


class Console:
    """Ventana principal de la estación."""

    def __init__(self, config: Any, actions: dict[str, Callable[..., Any]] | None = None):
        if tk is None:
            raise ConsoleUnavailable("Tkinter no está disponible (entorno headless)")
        self.config = config
        self.actions = actions or {}
        self.events: queue.Queue[tuple[Any, ...]] = queue.Queue()
        self.root: Any | None = None
        self._ui_thread: threading.Thread | None = None
        self._closed = False
        self._job_rows: dict[str, str] = {}
        self._printer_rows: dict[str, str] = {}

        # Variables Tk (se crean en _build).
        self.connection_var: Any = None
        self.connection_detail_var: Any = None
        self.station_var: Any = None
        self.station_id_var: Any = None
        self.station_token_var: Any = None
        self.station_name_var: Any = None
        self.job_id_var: Any = None
        self.progress_var: Any = None
        self.progress_label_var: Any = None

    # --------------------------------------------------- actualizaciones (hilos)
    def set_connection(self, online: bool, detail: str = "") -> None:
        self.events.put(("connection", bool(online), str(detail)))

    def update_printers(self, printers: list[dict[str, Any]]) -> None:
        self.events.put(("printers", [dict(p) for p in printers]))

    def update_job(self, payload: dict[str, Any]) -> None:
        self.events.put(("job", dict(payload)))

    def log(self, level: str, message: str) -> None:
        self.events.put(("log", str(level).upper(), str(message)))

    def set_station(self, station_id: str, token: str, station_name: str) -> None:
        self.events.put(("station", station_id, token, station_name))

    # ------------------------------------------------------------------ ciclo
    def run(self) -> None:
        """Construye la UI y bloquea en mainloop (llamar en el hilo principal)."""
        self._build()
        if self.root is None:
            raise ConsoleUnavailable("No se pudo crear la ventana Tkinter")
        self._drain()
        try:
            self.root.mainloop()
        except tk.TclError as exc:
            raise ConsoleUnavailable(f"Tkinter falló al iniciar: {exc}") from exc

    def start_thread(self) -> None:
        """Arranca la consola en un hilo propio (útil en pruebas)."""
        if self._ui_thread and self._ui_thread.is_alive():
            return
        self._ui_thread = threading.Thread(target=self.run, name="pb-console", daemon=True)
        self._ui_thread.start()

    def stop(self) -> None:
        if self.root is not None and not self._closed:
            try:
                self.root.after(0, self._destroy)
            except Exception:  # noqa: BLE001
                pass

    def _destroy(self) -> None:
        self._closed = True
        if self.root is not None:
            try:
                self.root.destroy()
            except tk.TclError:
                pass
            self.root = None

    # -------------------------------------------------------------------- UI
    def _build(self) -> None:
        self.root = tk.Tk()
        self.root.title("PrintBridge Desktop — Consola de estación")
        self.root.geometry("1080x680")
        self.root.minsize(900, 560)
        self.root.configure(bg=BG)
        try:
            self.root.iconphoto(False, tk.PhotoImage(file=self._icon_path()))
        except Exception:  # noqa: BLE001 - icono opcional
            pass
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        self.connection_var = tk.StringVar(value="DESCONECTADO")
        self.connection_detail_var = tk.StringVar(value="Iniciando…")
        self.station_var = tk.StringVar(value=self.config.station_id or "-")
        self.station_id_var = tk.StringVar(value=self.config.station_id or "")
        self.station_token_var = tk.StringVar(value=self.config.station_token or "")
        self.station_name_var = tk.StringVar(value=self.config.station_name or "")
        self.job_id_var = tk.StringVar(value="")
        self.progress_var = tk.IntVar(value=0)
        self.progress_label_var = tk.StringVar(value="Sin trabajo seleccionado")

        header = tk.Frame(self.root, bg=CARD, height=76, padx=18, pady=10)
        header.pack(fill="x", side="top")
        header.pack_propagate(False)
        self.dot = tk.Canvas(header, width=18, height=18, bg=CARD, highlightthickness=0)
        self.dot.pack(side="left", padx=(0, 10))
        self.dot_id = self.dot.create_oval(3, 3, 15, 15, fill=OFFLINE, outline=OFFLINE)
        title_frame = tk.Frame(header, bg=CARD)
        title_frame.pack(side="left", fill="y")
        tk.Label(title_frame, text="PrintBridge Desktop", bg=CARD, fg=TEXT,
                 font=("Roboto", 15, "bold")).pack(anchor="w")
        tk.Label(title_frame, textvariable=self.connection_detail_var, bg=CARD, fg=MUTED,
                 font=("Roboto", 9)).pack(anchor="w")
        self.connection_label = tk.Label(header, textvariable=self.connection_var, bg=CARD, fg=OFFLINE,
                                         font=("Roboto", 11, "bold"))
        self.connection_label.pack(side="right")
        tk.Label(header, textvariable=self.station_var, bg=CARD, fg=PRIMARY,
                 font=("Roboto", 10)).pack(side="right", padx=16)

        notebook = ttk.Notebook(self.root)
        notebook.pack(fill="both", expand=True, padx=14, pady=(12, 6))

        printers_frame = ttk.Frame(notebook, padding=10)
        jobs_frame = ttk.Frame(notebook, padding=10)
        config_frame = ttk.Frame(notebook, padding=10)
        log_frame = ttk.Frame(notebook, padding=10)
        notebook.add(printers_frame, text="Impresoras")
        notebook.add(jobs_frame, text="Trabajos")
        notebook.add(config_frame, text="Configuración")
        notebook.add(log_frame, text="Registro")

        self._build_printers(printers_frame)
        self._build_jobs(jobs_frame)
        self._build_config(config_frame)
        self._build_log(log_frame)

        status_bar = tk.Label(
            self.root, text="PrintFlow ERP · PrintBridge Desktop v1.0", bd=1,
            relief="sunken", anchor="w", bg=CARD, fg=MUTED, font=("Roboto", 8),
        )
        status_bar.pack(fill="x", side="bottom")

    @staticmethod
    def _icon_path() -> str:
        from pathlib import Path

        return str(Path(__file__).resolve().parent.parent / "resources" / "icon.png")

    def _build_printers(self, parent: Any) -> None:
        columns = ("name", "type", "status", "details")
        tree = ttk.Treeview(parent, columns=columns, show="headings", height=15)
        for key, label, width in zip(columns, ("Impresora", "Tipo", "Estado", "Detalles"), (300, 110, 130, 300)):
            tree.heading(key, text=label)
            tree.column(key, width=width, anchor="w")
        scrollbar = ttk.Scrollbar(parent, orient="vertical", command=tree.yview)
        tree.configure(yscrollcommand=scrollbar.set)
        tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        self.printer_tree = tree

        toolbar = ttk.Frame(self.root)
        toolbar.pack(fill="x", padx=14, pady=(4, 10))
        ttk.Button(toolbar, text="Pausar", command=lambda: self._printer_action("pause")).pack(side="left", padx=4)
        ttk.Button(toolbar, text="Reanudar", command=lambda: self._printer_action("resume")).pack(side="left", padx=4)
        ttk.Button(toolbar, text="Página de prueba", command=lambda: self._printer_action("test_page")).pack(side="left", padx=4)
        ttk.Label(toolbar, text="Job ID:").pack(side="left", padx=(18, 4))
        ttk.Entry(toolbar, textvariable=self.job_id_var, width=18).pack(side="left", padx=4)
        ttk.Button(toolbar, text="Cancelar trabajo", command=self._cancel_job).pack(side="left", padx=4)

    def _build_jobs(self, parent: Any) -> None:
        columns = ("job", "order", "status", "progress", "message")
        tree = ttk.Treeview(parent, columns=columns, show="headings", height=14)
        for key, label, width in zip(columns, ("Job", "Orden", "Estado", "Progreso", "Mensaje"), (170, 150, 130, 100, 400)):
            tree.heading(key, text=label)
            tree.column(key, width=width, anchor="w")
        scrollbar = ttk.Scrollbar(parent, orient="vertical", command=tree.yview)
        tree.configure(yscrollcommand=scrollbar.set)
        tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        tree.bind("<<TreeviewSelect>>", self._on_job_selected)
        self.job_tree = tree

        progress_frame = ttk.Frame(parent)
        progress_frame.pack(fill="x", pady=(8, 0))
        ttk.Label(progress_frame, textvariable=self.progress_label_var).pack(anchor="w")
        self.progress_bar = ttk.Progressbar(progress_frame, variable=self.progress_var, maximum=100)
        self.progress_bar.pack(fill="x", pady=4)

    def _build_config(self, parent: Any) -> None:
        frame = ttk.LabelFrame(parent, text="Emparejamiento de estación", padding=14)
        frame.pack(fill="x")
        rows = (
            ("Station ID", self.station_id_var, False),
            ("Station Token", self.station_token_var, True),
            ("Nombre", self.station_name_var, False),
        )
        for index, (label, variable, secret) in enumerate(rows):
            ttk.Label(frame, text=label).grid(row=index, column=0, sticky="w", pady=6)
            entry = ttk.Entry(frame, textvariable=variable, width=62, show="*" if secret else "")
            entry.grid(row=index, column=1, sticky="ew", padx=8, pady=6)
        frame.columnconfigure(1, weight=1)
        ttk.Label(
            frame,
            text="El Station ID y Token se generan en el panel Admin → Estaciones (PrintBridge).",
            foreground=MUTED,
        ).grid(row=3, column=0, columnspan=2, sticky="w", pady=(8, 2))
        buttons = ttk.Frame(frame)
        buttons.grid(row=4, column=0, columnspan=2, sticky="w", pady=(8, 0))
        ttk.Button(buttons, text="Guardar y reconectar", command=self._save_credentials).pack(side="left", padx=4)
        ttk.Button(buttons, text="Reconectar", command=self._reconnect).pack(side="left", padx=4)
        ttk.Button(buttons, text="Sincronizar ahora", command=self._sync_now).pack(side="left", padx=4)

    def _build_log(self, parent: Any) -> None:
        self.log_text = tk.Text(parent, wrap="word", height=20, bg="#0F172A", fg="#E2E8F0",
                                insertbackground="#E2E8F0", font=("Consolas", 9))
        scrollbar = ttk.Scrollbar(parent, orient="vertical", command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scrollbar.set)
        self.log_text.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        self.log_text.configure(state="disabled")
        self.log_text.tag_config("INFO", foreground="#94A3B8")
        self.log_text.tag_config("DEBUG", foreground="#64748B")
        self.log_text.tag_config("OK", foreground="#4ADE80")
        self.log_text.tag_config("WARN", foreground="#FBBF24")
        self.log_text.tag_config("ERROR", foreground="#F87171")

    # ---------------------------------------------------------------- acciones
    def _printer_action(self, action: str) -> None:
        selected = self.printer_tree.selection()
        if not selected:
            self.log("WARN", "Seleccione una impresora primero")
            return
        name = self.printer_tree.item(selected[0], "values")[0]
        callback = self.actions.get(action)
        if callback:
            try:
                callback(name)
            except Exception as exc:  # noqa: BLE001
                self.log("ERROR", f"Error al {action}: {exc}")
        else:
            self.log("WARN", f"Acción {action} no disponible")

    def _cancel_job(self) -> None:
        job_id = self.job_id_var.get().strip()
        if not job_id:
            self.log("WARN", "Ingrese el Job ID a cancelar")
            return
        callback = self.actions.get("cancel")
        if callback:
            try:
                callback(job_id)
            except Exception as exc:  # noqa: BLE001
                self.log("ERROR", f"Error cancelando trabajo: {exc}")

    def _save_credentials(self) -> None:
        callback = self.actions.get("save_credentials")
        if not callback:
            return
        try:
            callback(self.station_id_var.get().strip(), self.station_token_var.get().strip(),
                     self.station_name_var.get().strip())
            self.station_var.set(self.station_id_var.get().strip() or "-")
            self.log("OK", "Credenciales guardadas")
        except Exception as exc:  # noqa: BLE001
            self.log("ERROR", f"No se pudieron guardar credenciales: {exc}")

    def _reconnect(self) -> None:
        callback = self.actions.get("reconnect")
        if callback:
            callback()

    def _sync_now(self) -> None:
        callback = self.actions.get("sync_now")
        if callback:
            callback()

    def _on_job_selected(self, _event: Any) -> None:
        selected = self.job_tree.selection()
        if not selected:
            return
        values = self.job_tree.item(selected[0], "values")
        if len(values) >= 4:
            try:
                self.progress_var.set(int(str(values[3]).rstrip("%") or 0))
            except ValueError:
                self.progress_var.set(0)
            self.progress_label_var.set(f"{values[0]} — {values[2]}")

    def _on_close(self) -> None:
        callback = self.actions.get("on_close")
        if callback:
            callback()
        else:
            self._destroy()

    # -------------------------------------------------------------- cola UI
    def _drain(self) -> None:
        processed = 0
        try:
            while processed < 200:
                item = self.events.get_nowait()
                kind = item[0]
                if kind == "connection":
                    self._apply_connection(item[1], item[2])
                elif kind == "printers":
                    self._apply_printers(item[1])
                elif kind == "job":
                    self._apply_job(item[1])
                elif kind == "log":
                    self._append_log(item[1], item[2])
                elif kind == "station":
                    self.station_id_var.set(item[1])
                    self.station_token_var.set(item[2])
                    self.station_name_var.set(item[3])
                    self.station_var.set(item[1] or "-")
                processed += 1
        except queue.Empty:
            pass
        if self.root is not None:
            try:
                self.root.after(100, self._drain)
            except tk.TclError:
                pass

    def _apply_connection(self, online: bool, detail: str) -> None:
        color = ONLINE if online else OFFLINE
        self.dot.itemconfig(self.dot_id, fill=color, outline=color)
        self.connection_var.set("EN LÍNEA" if online else "DESCONECTADO")
        self.connection_label.configure(fg=color)
        self.connection_detail_var.set(detail or ("Backend conectado" if online else "Sin backend / modo contingencia"))

    def _apply_printers(self, printers: list[dict[str, Any]]) -> None:
        if not hasattr(self, "printer_tree"):
            return
        self.printer_tree.delete(*self.printer_tree.get_children())
        self._printer_rows.clear()
        for printer in printers:
            name = str(printer.get("name") or printer.get("printer_id") or "-")
            status = str(printer.get("status") or "ONLINE")
            details = printer.get("ip") or printer.get("protocol") or printer.get("printer_id") or ""
            item = self.printer_tree.insert("", "end", values=(name, printer.get("type", "-"), status, details))
            self._printer_rows[name] = item
            self.printer_tree.tag_configure(status, foreground=STATUS_COLORS.get(status, TEXT))
            self.printer_tree.item(item, tags=(status,))

    def _apply_job(self, payload: dict[str, Any]) -> None:
        if not hasattr(self, "job_tree"):
            return
        job_id = str(payload.get("job_id") or "-")
        status = str(payload.get("status") or "RECEIVED")
        current = int(payload.get("page_current") or 0)
        total = int(payload.get("page_total") or 0)
        percent = int(current * 100 / total) if total > 0 else (100 if status == "COMPLETED" else 0)
        message = str(payload.get("message") or "")
        values = (job_id, str(payload.get("order_id") or "-"), status, f"{percent}%", message)
        item = self._job_rows.get(job_id)
        if item and self.job_tree.exists(item):
            self.job_tree.item(item, values=values)
        else:
            item = self.job_tree.insert("", "end", values=values)
            self._job_rows[job_id] = item
        self.job_tree.tag_configure(status, foreground=STATUS_COLORS.get(status, TEXT))
        self.job_tree.item(item, tags=(status,))
        if status in ("COMPLETED", "FAILED", "LOCAL_QUEUE"):
            self.log("OK" if status != "FAILED" else "ERROR", f"{job_id}: {status} — {message}")

    def _append_log(self, level: str, message: str) -> None:
        if not hasattr(self, "log_text"):
            return
        stamp = datetime.now().strftime("%H:%M:%S")
        tag = level if level in ("INFO", "DEBUG", "WARN", "ERROR", "OK") else "INFO"
        self.log_text.configure(state="normal")
        self.log_text.insert("end", f"[{stamp}] ", tag)
        self.log_text.insert("end", f"{message}\n", tag)
        self.log_text.see("end")
        self.log_text.configure(state="disabled")
