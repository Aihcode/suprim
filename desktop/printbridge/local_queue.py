"""Cola local SQLite para el modo contingencia (DESKTOP_AGENT_SPEC §8)."""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS local_jobs (
  job_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  parameters JSON NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_jobs_status ON local_jobs(status);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class LocalQueue:
    """Acceso thread-safe a ``local_queue.db``."""

    def __init__(self, db_path: str | Path | None = None):
        self.db_path = Path(db_path) if db_path else Path(__file__).resolve().parent.parent / "local_queue.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._conn.commit()
        log.info("Cola local SQLite lista en %s", self.db_path)

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _encode(parameters: dict[str, Any] | str | None) -> str:
        if parameters is None:
            return "{}"
        if isinstance(parameters, str):
            return parameters
        return json.dumps(parameters, ensure_ascii=False, separators=(",", ":"))

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        item = dict(row)
        try:
            item["parameters"] = json.loads(item.get("parameters") or "{}")
        except (ValueError, TypeError):
            item["parameters"] = {}
        return item

    # ------------------------------------------------------------------ CRUD
    def add(
        self,
        job_id: str,
        order_id: str,
        file_path: str | Path,
        parameters: dict[str, Any] | str | None,
        status: str = "LOCAL_QUEUE",
    ) -> None:
        with self._lock:
            self._conn.execute(
                """INSERT INTO local_jobs
                   (job_id, order_id, file_path, parameters, status, attempts, created_at)
                   VALUES (?, ?, ?, ?, ?, 0, ?)
                   ON CONFLICT(job_id) DO UPDATE SET
                     order_id=excluded.order_id,
                     file_path=excluded.file_path,
                     parameters=excluded.parameters,
                     status=excluded.status,
                     created_at=excluded.created_at""",
                (
                    str(job_id),
                    str(order_id or ""),
                    str(file_path),
                    self._encode(parameters),
                    str(status),
                    utc_now(),
                ),
            )
            self._conn.commit()
        log.info("Trabajo %s persistido en cola local (%s)", job_id, status)

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM local_jobs WHERE job_id = ?", (str(job_id),)
            ).fetchone()
        return self._row_to_dict(row) if row else None

    def list(self, status: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            if status:
                rows = self._conn.execute(
                    "SELECT * FROM local_jobs WHERE status = ? ORDER BY created_at ASC",
                    (str(status),),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT * FROM local_jobs ORDER BY created_at ASC"
                ).fetchall()
        return [self._row_to_dict(row) for row in rows]

    def mark_done(self, job_id: str, status: str = "COMPLETED") -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE local_jobs SET status = ? WHERE job_id = ?", (str(status), str(job_id))
            )
            self._conn.commit()
        log.info("Trabajo %s marcado como %s en cola local", job_id, status)

    def increment_attempts(self, job_id: str) -> int:
        with self._lock:
            self._conn.execute(
                "UPDATE local_jobs SET attempts = attempts + 1 WHERE job_id = ?", (str(job_id),)
            )
            self._conn.commit()
            row = self._conn.execute(
                "SELECT attempts FROM local_jobs WHERE job_id = ?", (str(job_id),)
            ).fetchone()
        attempts = int(row["attempts"]) if row else 0
        log.debug("Trabajo %s: intento %d", job_id, attempts)
        return attempts

    def delete(self, job_id: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM local_jobs WHERE job_id = ?", (str(job_id),))
            self._conn.commit()
        log.debug("Trabajo %s eliminado de cola local", job_id)

    def pending(self) -> list[dict[str, Any]]:
        return [row for row in self.list() if str(row.get("status")) == "LOCAL_QUEUE"]

    def to_sync_payload(self, rows: Iterable[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        items = list(rows) if rows is not None else self.pending()
        return [
            {
                "job_id": row.get("job_id"),
                "order_id": row.get("order_id"),
                "status": row.get("status"),
                "attempts": row.get("attempts", 0),
                "created_at": row.get("created_at"),
                "parameters": row.get("parameters", {}),
            }
            for row in items
        ]

    def close(self) -> None:
        with self._lock:
            try:
                self._conn.close()
            except sqlite3.Error:
                pass
