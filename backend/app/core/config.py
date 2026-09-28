from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/ 根目录（与 cwd 无关，避免 seed / uvicorn 写到不同 sqlite 文件）
_BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _resolve_sqlite_url(url: str) -> str:
    """将相对 sqlite 路径锚定到 backend 根目录。"""
    if not url.startswith("sqlite"):
        return url
    marker = ":///"
    if marker not in url:
        return url
    prefix, _, path = url.partition(marker)
    if not path:
        return url
    # 已是绝对路径：Unix `/...` 或 Windows `C:/...`
    if path.startswith("/") or (len(path) >= 2 and path[1] == ":"):
        return url
    rel = path[2:] if path.startswith("./") else path
    abs_path = (_BACKEND_ROOT / rel).resolve()
    return f"{prefix}{marker}{abs_path.as_posix()}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Industrial AI Base"
    app_env: Literal["development", "staging", "production"] = "development"
    debug: bool = True
    sql_echo: bool = False
    api_prefix: str = "/api/v1"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # 品牌展示（环境变量优先，可被 sys_config 覆盖）
    app_title: str = "工业 AI 应用基座"
    app_subtitle: str = "通用技术底座 · Base Template"
    app_sidebar_title: str = "工业 AI 基座"
    app_logo_url: str = ""
    app_theme: str = "light"

    database_url: str = "sqlite+aiosqlite:///./data/app.db"

    @field_validator("database_url", mode="after")
    @classmethod
    def _anchor_sqlite_path(cls, value: str) -> str:
        return _resolve_sqlite_url(value)

    secret_key: str = "change-me-in-production-use-env-var"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7
    algorithm: str = "HS256"

    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    default_tenant_id: int = 1
    default_admin_username: str = "admin"
    default_admin_password: str = "admin123"

    # 模式 B：逗号分隔 module_id；空 / * / all = 全开
    # 例：ENABLED_MODULES=scheduling 或 scheduling,toolbox
    enabled_modules: str = "*"

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def sync_database_url(self) -> str:
        url = self.database_url
        if url.startswith("sqlite+aiosqlite"):
            return url.replace("sqlite+aiosqlite", "sqlite", 1)
        if url.startswith("postgresql+asyncpg"):
            return url.replace("postgresql+asyncpg", "postgresql+psycopg", 1)
        return url

    def branding_defaults(self) -> dict[str, str]:
        return {
            "app.title": self.app_title,
            "app.subtitle": self.app_subtitle,
            "app.sidebar_title": self.app_sidebar_title,
            "app.logo_url": self.app_logo_url,
            "app.theme": self.app_theme,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
