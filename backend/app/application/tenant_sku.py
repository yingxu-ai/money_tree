"""租户 SKU：解析某租户已开通的业务模块。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.system import SysTenant


def parse_enabled_modules(raw: str | None) -> set[str] | None:
    """None = 全开；否则为 module_id 集合。"""
    if raw is None:
        return None
    text = raw.strip()
    if not text or text.lower() in {"*", "all"}:
        return None
    return {x.strip() for x in text.split(",") if x.strip()}


# 菜单 path → module（与前端 filter 对齐）
MENU_PATH_MODULE_PREFIXES: list[tuple[str, str]] = [
    ("/scheduling", "scheduling"),
    ("/devices", "equipment-analysis"),
    ("/analysis", "equipment-analysis"),
    ("/tools", "toolbox"),
    ("/demo", "demo"),
    ("/system", "system"),
    ("/dashboards", "dashboard"),
    ("/ai-assistant", "dashboard"),
    ("/configs", "dashboard"),
    ("/files", "dashboard"),
]


def module_for_menu_path(path: str | None) -> str | None:
    if not path:
        return None
    for prefix, module_id in MENU_PATH_MODULE_PREFIXES:
        if path == prefix or path.startswith(prefix + "/"):
            return module_id
    return None


async def get_tenant_enabled_modules(
    session: AsyncSession,
    tenant_id: int | None,
) -> set[str] | None:
    """
    返回租户开通的 module_id 集合。
    None = 全开（不限制）。
    优先读 sys_tenant.enabled_modules；无租户记录时回退全局 ENABLED_MODULES。
    """
    if tenant_id is not None:
        row = (
            await session.execute(
                select(SysTenant).where(
                    SysTenant.id == tenant_id,
                    SysTenant.is_deleted.is_(False),
                )
            )
        ).scalar_one_or_none()
        if row is not None and row.status == "active":
            return parse_enabled_modules(row.enabled_modules)

    return parse_enabled_modules(get_settings().enabled_modules)


def enabled_modules_as_list(enabled: set[str] | None) -> list[str] | None:
    """API 对外：None 表示全开，否则返回排序列表。"""
    if enabled is None:
        return None
    return sorted(enabled)
