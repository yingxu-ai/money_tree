"""按租户 / 全局 SKU 限制业务 API（模式 B）。"""

from __future__ import annotations

from fastapi import HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import decode_token

# path 相对 api_prefix 之后
MODULE_API_PREFIXES: dict[str, list[str]] = {
    "scheduling": ["/scheduling"],
    "equipment-analysis": ["/equipment-analysis"],
    "demo": ["/demo"],
    "system": [
        "/users",
        "/roles",
        "/menus",
        "/permissions",
        "/api-permissions",
        "/depts",
        "/dicts",
        "/audit",
    ],
    "dashboard": ["/dashboards", "/metrics", "/configs", "/files"],
}

ALWAYS_ALLOW_PREFIXES = (
    "/public",
    "/auth",
    "/health",
    "/runtime",
)


def _normalize_path(path: str) -> str:
    if not path.startswith("/"):
        path = "/" + path
    return path.rstrip("/") or "/"


def resolve_module_for_api_path(api_path: str) -> str | None:
    path = _normalize_path(api_path)
    for module_id, prefixes in MODULE_API_PREFIXES.items():
        for prefix in prefixes:
            p = _normalize_path(prefix)
            if path == p or path.startswith(p + "/"):
                return module_id
    return None


def parse_enabled_modules(raw: str | None) -> set[str] | None:
    """兼容旧引用；实现见 tenant_sku。"""
    from app.application.tenant_sku import parse_enabled_modules as _parse

    return _parse(raw)


def _tenant_id_from_credentials(
    credentials: HTTPAuthorizationCredentials | None,
) -> int | None:
    if credentials is None or not credentials.credentials:
        return None
    try:
        payload = decode_token(credentials.credentials)
    except ValueError:
        return None
    if payload.get("type") != "access":
        return None
    tid = payload.get("tenant_id")
    if tid is None:
        return None
    try:
        return int(tid)
    except (TypeError, ValueError):
        return None


async def assert_module_allowed(
    request: Request,
    session: AsyncSession,
    credentials: HTTPAuthorizationCredentials | None = None,
) -> None:
    # 延迟导入，避免与 tenant_sku 循环依赖
    from app.application.tenant_sku import get_tenant_enabled_modules

    tenant_id = _tenant_id_from_credentials(credentials)
    enabled = await get_tenant_enabled_modules(session, tenant_id)
    if enabled is None:
        return

    settings = get_settings()
    path = request.url.path
    prefix = settings.api_prefix.rstrip("/")
    if path.startswith(prefix):
        rel = path[len(prefix) :] or "/"
    else:
        rel = path

    rel_n = _normalize_path(rel)
    for allow in ALWAYS_ALLOW_PREFIXES:
        a = _normalize_path(allow)
        if rel_n == a or rel_n.startswith(a + "/"):
            return

    module_id = resolve_module_for_api_path(rel_n)
    if module_id is None:
        return
    if module_id not in enabled:
        raise HTTPException(
            status_code=403,
            detail=f"模块未开通: {module_id}（租户 {tenant_id or '-'}）",
        )
