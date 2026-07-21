"""组织数据范围冒烟：admin 全量 vs plant(ORG@生产部) 可见子集。"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from httpx import ASGITransport, AsyncClient

from app.main import app
from scripts.seed import seed


def _flatten_dept_names(nodes: list) -> list[str]:
    out: list[str] = []
    for n in nodes:
        out.append(n.get("name", ""))
        out.extend(_flatten_dept_names(n.get("children") or []))
    return out


async def _login(client: AsyncClient, username: str, password: str) -> dict:
    resp = await client.post("/api/v1/auth/login", json={"username": username, "password": password})
    body = resp.json()
    assert body.get("code") == 0, body
    return body["data"]


async def main() -> None:
    await seed()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        admin_login = await _login(client, "admin", "admin123")
        assert admin_login["user"]["data_scope"] == "ALL", admin_login["user"]
        admin_headers = {"Authorization": f"Bearer {admin_login['access_token']}"}

        admin_users = await client.get("/api/v1/users", headers=admin_headers)
        au = admin_users.json()
        assert au.get("code") == 0 and au["data"]["total"] >= 2, au
        print("OK admin users", au["data"]["total"], admin_login["user"]["data_scope"])

        plant_login = await _login(client, "plant", "plant123")
        assert plant_login["user"]["data_scope"] == "ORG", plant_login["user"]
        assert plant_login["user"].get("dept_id") == 2, plant_login["user"]
        plant_headers = {"Authorization": f"Bearer {plant_login['access_token']}"}

        plant_users = await client.get("/api/v1/users", headers=plant_headers)
        pu = plant_users.json()
        assert pu.get("code") == 0, pu
        names = {u["username"] for u in pu["data"]["items"]}
        assert "plant" in names and "line1" in names, names
        assert "admin" not in names, names
        print("OK plant users", sorted(names))

        plant_depts = await client.get("/api/v1/depts", headers=plant_headers)
        pd = plant_depts.json()
        assert pd.get("code") == 0, pd
        dept_names = _flatten_dept_names(pd["data"])
        assert "生产部" in dept_names and "一车间" in dept_names, dept_names
        assert "总部" not in dept_names and "技术部" not in dept_names, dept_names
        print("OK plant depts", dept_names)

    print("Org data-scope smoke passed.")


if __name__ == "__main__":
    asyncio.run(main())
