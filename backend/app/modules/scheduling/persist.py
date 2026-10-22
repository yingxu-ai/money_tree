"""排产 Store 同步读写（SQLite / PostgreSQL 均可，跟 DATABASE_URL）。

快照按租户隔离：scheduling_snapshot.id == tenant_id。
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.scheduling import SchedulingSnapshot
from sqlmodel import SQLModel

logger = logging.getLogger(__name__)

_SYNC_ENGINE = None


def _sync_engine():
    global _SYNC_ENGINE
    if _SYNC_ENGINE is not None:
        return _SYNC_ENGINE
    settings = get_settings()
    connect_args: dict = {}
    if settings.is_sqlite:
        connect_args = {"check_same_thread": False, "timeout": 30}
    _SYNC_ENGINE = create_engine(
        settings.sync_database_url,
        connect_args=connect_args,
        pool_pre_ping=not settings.is_sqlite,
    )
    if settings.is_sqlite:
        from sqlalchemy import event

        @event.listens_for(_SYNC_ENGINE, "connect")
        def _sqlite_on_connect(dbapi_conn, _connection_record) -> None:  # noqa: ANN001
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()
    return _SYNC_ENGINE


def ensure_scheduling_schema() -> None:
    """确保快照表存在（可在 async init_db 之外单独调用）。"""
    import app.models.registry  # noqa: F401

    engine = _sync_engine()
    SQLModel.metadata.create_all(engine, tables=[SchedulingSnapshot.__table__])


def load_scheduling_payload(tenant_id: int = 1) -> dict[str, Any] | None:
    ensure_scheduling_schema()
    engine = _sync_engine()
    with Session(engine) as session:
        row = session.get(SchedulingSnapshot, tenant_id)
        if not row or not row.payload:
            return None
        try:
            data = json.loads(row.payload)
        except json.JSONDecodeError:
            logger.exception("scheduling_snapshot JSON 损坏，忽略并回退 seed")
            return None
        if not isinstance(data, dict):
            return None
        return data


def save_scheduling_payload(data: dict[str, Any], tenant_id: int = 1) -> None:
    ensure_scheduling_schema()
    engine = _sync_engine()
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with Session(engine) as session:
        row = session.get(SchedulingSnapshot, tenant_id)
        now = datetime.utcnow()
        if row is None:
            session.add(
                SchedulingSnapshot(id=tenant_id, payload=payload, updated_at=now)
            )
        else:
            row.payload = payload
            row.updated_at = now
            session.add(row)
        session.commit()
