"""接口路径归属哪个菜单页（角色配权树：目录 → 页面 → 接口权限）。"""

from __future__ import annotations


def _norm_path(path: str) -> str:
    raw = (path or "").split("?")[0].strip()
    if not raw.startswith("/"):
        raw = "/" + raw
    if len(raw) > 1 and raw.endswith("/"):
        raw = raw.rstrip("/")
    return raw


# 更长前缀优先。path_pattern 相对 /api/v1。
API_PATH_PREFIX_MENU: list[tuple[str, int]] = [
    ("/api-permissions", 25),
    ("/scheduling/gantt", 63),
    ("/scheduling/report", 64),
    ("/scheduling/master", 61),
    ("/scheduling/orders", 62),
    ("/scheduling/work-orders", 62),
    ("/scheduling/leaves", 61),
    ("/scheduling/shift", 61),
    ("/scheduling/people", 61),
    ("/scheduling/templates", 61),
    ("/scheduling", 60),
    ("/users", 2),
    ("/roles", 3),
    ("/menus", 4),
    ("/permissions", 3),
    ("/audit", 9),
    ("/depts", 10),
    ("/dicts", 11),
    ("/dashboards", 5),
    ("/files", 8),
    ("/ai", 6),
    ("/tools", 70),
    ("/configs", 7),
    ("/devices", 15),
    ("/analysis", 18),
]


def menu_id_for_api_path(path_pattern: str) -> int | None:
    path = _norm_path(path_pattern)
    best: tuple[int, int] | None = None  # (prefix_len, menu_id)
    for prefix, mid in API_PATH_PREFIX_MENU:
        p = _norm_path(prefix)
        if path == p or path.startswith(p + "/"):
            plen = len(p)
            if best is None or plen > best[0]:
                best = (plen, mid)
    return best[1] if best else None
