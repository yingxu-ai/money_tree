"""PostgreSQL 切换冒烟：seed → 登录 → 部门/菜单/驾驶舱可读。"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.main import app


async def main() -> None:
    settings = get_settings()
    if settings.is_sqlite:
        print("FAIL: DATABASE_URL 仍是 SQLite，请先切换到 postgresql+asyncpg://...")
        sys.exit(1)

    print(f"DATABASE_URL dialect ok ({'postgresql' if 'postgresql' in settings.database_url else '?'})")

    # seed 含 init_db
    from scripts.seed import seed

    await seed()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        health = await client.get("/health")
        assert health.status_code == 200, health.text
        print("OK health", health.json().get("code", health.status_code))

        login = await client.post(
            "/api/v1/auth/login",
            json={
                "username": settings.default_admin_username,
                "password": settings.default_admin_password,
            },
        )
        body = login.json()
        assert body.get("code") == 0, body
        token = body["data"]["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        print("OK login")

        menus = await client.get("/api/v1/auth/me/menus", headers=headers)
        assert menus.json().get("code") == 0, menus.text
        names = _flatten_menu_names(menus.json()["data"])
        assert any("账号" in n or "用户" in n for n in names), names
        print("OK menus", [n for n in names if "账号" in n or "用户" in n or "部门" in n])

        depts = await client.get("/api/v1/depts", headers=headers)
        assert depts.json().get("code") == 0 and depts.json()["data"], depts.text
        print("OK depts", len(depts.json()["data"]))

        users = await client.get("/api/v1/users", headers=headers)
        u = users.json()
        assert u.get("code") == 0 and u["data"]["total"] >= 1, u
        item = u["data"]["items"][0]
        assert "dept_id" in item and "role_names" in item, item
        print("OK users dept_id/role_names", item.get("dept_id"), item.get("role_names"))

        dashboards = await client.get("/api/v1/dashboards", headers=headers)
        assert dashboards.json().get("code") == 0, dashboards.text
        print("OK dashboards", dashboards.json()["data"]["total"])

    print("PostgreSQL smoke passed.")


def _flatten_menu_names(nodes: list) -> list[str]:
    out: list[str] = []
    for n in nodes:
        out.append(n.get("name", ""))
        out.extend(_flatten_menu_names(n.get("children") or []))
    return out


if __name__ == "__main__":
    asyncio.run(main())
