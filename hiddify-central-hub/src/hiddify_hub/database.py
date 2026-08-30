from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .models import UserRecord

DEFAULT_DB_PATH = Path(os.environ.get("HIDDIFY_HUB_DB", "data/hub.db"))


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class HubDatabase:
    def __init__(self, db_path: Path | str | None = None) -> None:
        self.db_path = Path(db_path) if db_path else DEFAULT_DB_PATH
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    uuid TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    comment TEXT DEFAULT '',
                    package_days INTEGER NOT NULL,
                    usage_limit_gb REAL NOT NULL,
                    mode TEXT DEFAULT 'no_reset',
                    enable INTEGER DEFAULT 1,
                    start_date TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    node_sync TEXT DEFAULT '{}'
                );

                CREATE TABLE IF NOT EXISTS node_health (
                    node_id TEXT PRIMARY KEY,
                    healthy INTEGER NOT NULL,
                    latency_ms REAL,
                    error TEXT,
                    checked_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT NOT NULL,
                    user_uuid TEXT,
                    details TEXT,
                    created_at TEXT NOT NULL
                );
                """
            )

    def log_action(self, action: str, user_uuid: str | None = None, details: dict | None = None) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO audit_log (action, user_uuid, details, created_at) VALUES (?, ?, ?, ?)",
                (action, user_uuid, json.dumps(details or {}), _utcnow().isoformat()),
            )

    def upsert_user(self, user: UserRecord) -> None:
        now = _utcnow().isoformat()
        created = user.created_at.isoformat() if user.created_at else now
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO users (
                    uuid, name, comment, package_days, usage_limit_gb, mode, enable,
                    start_date, created_at, updated_at, node_sync
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(uuid) DO UPDATE SET
                    name=excluded.name,
                    comment=excluded.comment,
                    package_days=excluded.package_days,
                    usage_limit_gb=excluded.usage_limit_gb,
                    mode=excluded.mode,
                    enable=excluded.enable,
                    start_date=excluded.start_date,
                    updated_at=excluded.updated_at,
                    node_sync=excluded.node_sync
                """,
                (
                    user.uuid,
                    user.name,
                    user.comment,
                    user.package_days,
                    user.usage_limit_gb,
                    user.mode,
                    1 if user.enable else 0,
                    user.start_date,
                    created,
                    now,
                    json.dumps(user.node_sync),
                ),
            )

    def get_user(self, uuid: str) -> UserRecord | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM users WHERE uuid = ?", (uuid,)).fetchone()
        return self._row_to_user(row) if row else None

    def list_users(self) -> list[UserRecord]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM users ORDER BY name COLLATE NOCASE").fetchall()
        return [self._row_to_user(r) for r in rows]

    def delete_user(self, uuid: str) -> None:
        with self._conn() as conn:
            conn.execute("DELETE FROM users WHERE uuid = ?", (uuid,))

    def set_node_sync(self, user_uuid: str, node_id: str, status: str) -> None:
        user = self.get_user(user_uuid)
        if not user:
            return
        user.node_sync[node_id] = status
        user.updated_at = _utcnow()
        self.upsert_user(user)

    def save_node_health(self, node_id: str, healthy: bool, latency_ms: float | None, error: str | None) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO node_health (node_id, healthy, latency_ms, error, checked_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(node_id) DO UPDATE SET
                    healthy=excluded.healthy,
                    latency_ms=excluded.latency_ms,
                    error=excluded.error,
                    checked_at=excluded.checked_at
                """,
                (node_id, 1 if healthy else 0, latency_ms, error, _utcnow().isoformat()),
            )

    def get_node_health(self) -> dict[str, dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM node_health").fetchall()
        return {r["node_id"]: dict(r) for r in rows}

    def is_node_healthy(self, node_id: str) -> bool:
        health = self.get_node_health().get(node_id)
        if not health:
            return True
        return bool(health.get("healthy"))

    @staticmethod
    def _row_to_user(row: sqlite3.Row) -> UserRecord:
        return UserRecord(
            uuid=row["uuid"],
            name=row["name"],
            comment=row["comment"] or "",
            package_days=row["package_days"],
            usage_limit_gb=row["usage_limit_gb"],
            mode=row["mode"] or "no_reset",
            enable=bool(row["enable"]),
            start_date=row["start_date"],
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
            node_sync=json.loads(row["node_sync"] or "{}"),
        )

    def export_users(self) -> list[dict[str, Any]]:
        return [u.model_dump(mode="json") for u in self.list_users()]

    def import_users(self, users: list[dict[str, Any]]) -> int:
        count = 0
        for raw in users:
            user = UserRecord.model_validate(raw)
            self.upsert_user(user)
            count += 1
        return count
