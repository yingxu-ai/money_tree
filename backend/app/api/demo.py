"""Demo 范本接口：返回固定 JSON，供前端快速搭页；后期换成真实服务即可。"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, Request

from app.auth.deps import get_current_user
from app.core.response import ok

router = APIRouter(prefix="/demo", tags=["Demo 范本"])

_FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"


@lru_cache
def _load_fixture(name: str) -> dict:
    path = _FIXTURES_DIR / name
    with path.open(encoding="utf-8") as f:
        return json.load(f)


@router.get("/overview")
async def demo_overview(request: Request, _user=Depends(get_current_user)):
    return ok(request, _load_fixture("overview.json"))


@router.get("/query-table")
async def demo_query_table(request: Request, _user=Depends(get_current_user)):
    return ok(request, _load_fixture("query_table.json"))
