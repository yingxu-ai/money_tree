"""按 SKU / ENABLED_MODULES 限制业务 API（模式 B）。

平台与认证类前缀始终放行；未登记前缀默认放行（兼容过渡）。
已登记且不属于 enabled_modules 的前缀 → 403。
"""

from __future__ import annotations

from fastapi import HTTPException, Request

from app.core.config import get_settings

# path 相对 api_prefix 之后，例如 /scheduling/...
# module_id 与 editions / MANIFEST 对齐
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
    # toolbox 目前多为纯前端
}

# 始终放行（壳能力）
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
    """返回该 API 所属 module_id；不属于任何业务模块则 None（放行）。"""
    path = _normalize_path(api_path)
    for module_id, prefixes in MODULE_API_PREFIXES.items():
        for prefix in prefixes:
            p = _normalize_path(prefix)
            if path == p or path.startswith(p + "/"):
                return module_id
    return None


def parse_enabled_modules(raw: str | None) -> set[str] | None:
    """None = 不限制（全开）；空串也视为全开。"""
    if raw is None:
        return None
    text = raw.strip()
    if not text or text.lower() in {"*", "all"}:
        return None
    return {x.strip() for x in text.split(",") if x.strip()}


def assert_module_allowed(request: Request) -> None:
    settings = get_settings()
    enabled = parse_enabled_modules(settings.enabled_modules)
    if enabled is None:
        return

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
            detail=f"模块未开通: {module_id}",
        )
