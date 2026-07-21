from collections.abc import AsyncGenerator
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel

from app.core.config import get_settings

settings = get_settings()

_connect_args: dict = {}
if settings.is_sqlite:
    db_path = settings.database_url.split("///")[-1]
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    _connect_args = {"check_same_thread": False}

engine = create_async_engine(
    settings.database_url,
    echo=settings.sql_echo,
    connect_args=_connect_args,
    pool_pre_ping=not settings.is_sqlite,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def _ensure_sqlite_columns(conn) -> None:
    """SQLite 的 create_all 不会给已有表加列，启动时补齐必要字段。"""
    if not settings.is_sqlite:
        return
    result = await conn.execute(text("PRAGMA table_info(sys_user)"))
    columns = {row[1] for row in result.fetchall()}
    if columns and "dept_id" not in columns:
        await conn.execute(text("ALTER TABLE sys_user ADD COLUMN dept_id INTEGER"))


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
        await _ensure_sqlite_columns(conn)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
