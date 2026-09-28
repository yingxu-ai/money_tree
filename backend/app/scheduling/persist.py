"""排产 Store 同步读写（SQLite / PostgreSQL 均可，跟 DATABASE_URL）。"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.scheduling import SchedulingSnapshot
from sqlmodel import SQLModel

logger = logging.getLogger(__name__)

_SYNC_ENGINE = None
SNAPSHOT_ID = 1


def _sync_engine():
    global _SYNC_ENGINE
    if _SYNC_ENGINE is not None:
        return _SYNC_ENGINE
    settings = get_settings()
    connect_args: dict = {}
    if settings.is_sqlite:
        connect_args = {"check_same_thread": False}
    _SYNC_ENGINE = create_engine(
        settings.sync_database_url,
        connect_args=connect_args,
        pool_pre_ping=not settings.is_sqlite,
    )
    return _SYNC_ENGINE


def ensure_scheduling_schema() -> None:
    """确保快照表存在（可在 async init_db 之外单独调用）。"""
    import app.models.registry  # noqa: F401

    engine = _sync_engine()
    SQLModel.metadata.create_all(engine, tables=[SchedulingSnapshot.__table__])


def load_scheduling_payload() -> dict[str, Any] | None:
    ensure_scheduling_schema()
    engine = _sync_engine()
    with Session(engine) as session:
        row = session.get(SchedulingSnapshot, SNAPSHOT_ID)
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


def save_scheduling_payload(data: dict[str, Any]) -> None:
    ensure_scheduling_schema()
    engine = _sync_engine()
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with Session(engine) as session:
        row = session.get(SchedulingSnapshot, SNAPSHOT_ID)
        now = datetime.utcnow()
        if row is None:
            session.add(
                SchedulingSnapshot(id=SNAPSHOT_ID, payload=payload, updated_at=now)
            )
        else:
            row.payload = payload
            row.updated_at = now
            session.add(row)
        session.commit()
