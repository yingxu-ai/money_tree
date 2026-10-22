from collections.abc import AsyncGenerator
from pathlib import Path

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel

from app.core.config import get_settings

settings = get_settings()

_connect_args: dict = {}
if settings.is_sqlite:
    db_path = settings.database_url.split("///")[-1]
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    _connect_args = {"check_same_thread": False, "timeout": 30}


engine = create_async_engine(
    settings.database_url,
    echo=settings.sql_echo,
    connect_args=_connect_args,
    pool_pre_ping=not settings.is_sqlite,
)

if settings.is_sqlite:

    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_on_connect(dbapi_conn, _connection_record) -> None:  # noqa: ANN001
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


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
    if columns and "avatar_url" not in columns:
        await conn.execute(text("ALTER TABLE sys_user ADD COLUMN avatar_url VARCHAR(255)"))

    api_info = await conn.execute(text("PRAGMA table_info(sys_api_permission)"))
    api_cols = {row[1] for row in api_info.fetchall()}
    if api_cols:
        if "stable_key" not in api_cols:
            await conn.execute(
                text("ALTER TABLE sys_api_permission ADD COLUMN stable_key VARCHAR(255) DEFAULT ''")
            )
        if "menu_id" not in api_cols:
            await conn.execute(text("ALTER TABLE sys_api_permission ADD COLUMN menu_id INTEGER"))


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
