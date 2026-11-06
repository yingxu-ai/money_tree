"""生产进度：工序 / 产品工艺（含件数、单位时间、生效期）— 独立快照，不改排产 Store。"""

from __future__ import annotations

import json
import logging
import threading
from copy import deepcopy
from datetime import datetime
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlmodel import Field, SQLModel

from app.core.config import get_settings
from app.core.exceptions import NotFoundException, ValidationException

logger = logging.getLogger(__name__)


class ProductionProgressCatalogSnapshot(SQLModel, table=True):
    __tablename__ = "production_progress_catalog_snapshot"

    id: int = Field(primary_key=True)  # tenant_id
    payload: str = Field(default="{}")
    updated_at: datetime = Field(default_factory=datetime.utcnow)


_SYNC_ENGINE = None
_LOCK = threading.RLock()
_CACHE: dict[int, "CatalogStore"] = {}


def _sync_engine():
    global _SYNC_ENGINE
    if _SYNC_ENGINE is not None:
        return _SYNC_ENGINE
    settings = get_settings()
    connect_args: dict = {}
    if settings.is_sqlite:
        connect_args = {"check_same_thread": False, "timeout": 30}
    _SYNC_ENGINE = create_engine(
        settings.sync_database_url,
        connect_args=connect_args,
        pool_pre_ping=not settings.is_sqlite,
    )
    return _SYNC_ENGINE


def _ensure_schema() -> None:
    engine = _sync_engine()
    SQLModel.metadata.create_all(engine, tables=[ProductionProgressCatalogSnapshot.__table__])


def _load(tenant_id: int) -> dict[str, Any] | None:
    _ensure_schema()
    with Session(_sync_engine()) as session:
        row = session.get(ProductionProgressCatalogSnapshot, tenant_id)
        if not row or not row.payload:
            return None
        try:
            data = json.loads(row.payload)
        except json.JSONDecodeError:
            logger.exception("production_progress catalog JSON 损坏")
            return None
        return data if isinstance(data, dict) else None


def _save(tenant_id: int, data: dict[str, Any]) -> None:
    _ensure_schema()
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with Session(_sync_engine()) as session:
        row = session.get(ProductionProgressCatalogSnapshot, tenant_id)
        if row is None:
            session.add(
                ProductionProgressCatalogSnapshot(
                    id=tenant_id, payload=payload, updated_at=datetime.utcnow()
                )
            )
        else:
            row.payload = payload
            row.updated_at = datetime.utcnow()
        session.commit()


def _seed() -> dict[str, Any]:
    return {
        "_seq": {"process": 6, "product": 2},
        "processes": [
            {
                "id": "pp-proc-1",
                "code": "P-WELD",
                "name": "焊接",
                "unit_minutes": 12,
                "status": "active",
                "note": "标准：分钟/件，来自工艺卡",
            },
            {
                "id": "pp-proc-2",
                "code": "P-MACH",
                "name": "机加",
                "unit_minutes": 15,
                "status": "active",
                "note": "标准：分钟/件，来自工艺卡",
            },
            {
                "id": "pp-proc-3",
                "code": "P-ASSY",
                "name": "装配",
                "unit_minutes": 10,
                "status": "active",
                "note": "标准：分钟/件，来自工艺卡",
            },
            {
                "id": "pp-proc-4",
                "code": "P-DBG",
                "name": "调试",
                "unit_minutes": 18,
                "status": "active",
                "note": "标准：分钟/件，来自工艺卡",
            },
            {
                "id": "pp-proc-5",
                "code": "P-QC",
                "name": "质检",
                "unit_minutes": 6,
                "status": "active",
                "note": "标准：分钟/件，来自工艺卡",
            },
            {
                "id": "pp-proc-6",
                "code": "P-PAINT",
                "name": "喷涂",
                "unit_minutes": 8,
                "status": "active",
                "note": "标准：分钟/件，来自工艺卡",
            },
        ],
        "products": [
            {
                "id": "pp-prod-1",
                "code": "A-001",
                "name": "产品A",
                "status": "active",
                "effective_from": "2026-01-01",
                "effective_to": None,
                "steps": [
                    {
                        "process_id": "pp-proc-1",
                        "qty": 1,
                        "qty_unit": "件",
                        "unit_minutes": 30,
                    },
                    {
                        "process_id": "pp-proc-2",
                        "qty": 1,
                        "qty_unit": "件",
                        "unit_minutes": 45,
                    },
                    {
                        "process_id": "pp-proc-3",
                        "qty": 1,
                        "qty_unit": "套",
                        "unit_minutes": 60,
                    },
                ],
            }
        ],
    }


class CatalogStore:
    def __init__(self, tenant_id: int) -> None:
        self.tenant_id = tenant_id
        loaded = _load(tenant_id)
        self._data = loaded if loaded else _seed()
        if not loaded:
            _save(tenant_id, self._data)
        else:
            self._ensure_seed_processes()

    def _ensure_seed_processes(self) -> None:
        """增量补齐演示标准工序（按 code），不覆盖已有工艺标准。"""
        rows = self._data.setdefault("processes", [])
        by_code = {(p.get("code") or "").strip().upper(): p for p in rows}
        changed = False
        for seed in _seed().get("processes") or []:
            code = (seed.get("code") or "").strip().upper()
            if not code or code in by_code:
                continue
            rows.append(deepcopy(seed))
            by_code[code] = seed
            changed = True
        if changed:
            seq = self._data.setdefault("_seq", {})
            seq["process"] = max(int(seq.get("process") or 0), len(rows))
            self._persist()

    def _persist(self) -> None:
        _save(self.tenant_id, self._data)

    def process_std_minutes_by_name(self) -> dict[str, float]:
        """工序名 → 标准单位耗时（分钟/件）；同名取启用项。"""
        out: dict[str, float] = {}
        for p in self._data.get("processes") or []:
            if (p.get("status") or "active") == "disabled":
                continue
            name = (p.get("name") or "").strip()
            if not name:
                continue
            try:
                mins = float(p.get("unit_minutes") or 0)
            except (TypeError, ValueError):
                mins = 0.0
            if mins > 0:
                out[name] = mins
        return out

    def _next_id(self, key: str, prefix: str) -> str:
        seq = self._data.setdefault("_seq", {})
        n = int(seq.get(key) or 0) + 1
        seq[key] = n
        return f"{prefix}-{n}"

    def _process_map(self) -> dict[str, dict]:
        return {p["id"]: p for p in (self._data.get("processes") or [])}

    def list_processes(self) -> dict[str, Any]:
        with _LOCK:
            self._ensure_seed_processes()
            items = deepcopy(self._data.get("processes") or [])
            items.sort(key=lambda x: x.get("code") or "")
            return {"items": items}

    def upsert_process(self, payload: dict[str, Any], process_id: str | None = None) -> dict:
        with _LOCK:
            name = (payload.get("name") or "").strip()
            code = (payload.get("code") or "").strip()
            if not name or not code:
                raise ValidationException("请填写工序编码与名称")
            rows = self._data.setdefault("processes", [])
            if process_id:
                row = next((r for r in rows if r["id"] == process_id), None)
                if not row:
                    raise NotFoundException("工序不存在")
            else:
                row = {"id": self._next_id("process", "pp-proc")}
                rows.append(row)
            row.update(
                {
                    "code": code,
                    "name": name,
                    "unit_minutes": float(payload.get("unit_minutes") or 0),
                    "status": payload.get("status") or "active",
                    "note": (payload.get("note") or "").strip(),
                }
            )
            self._persist()
            return deepcopy(row)

    def delete_process(self, process_id: str) -> dict:
        with _LOCK:
            for p in self._data.get("products") or []:
                for s in p.get("steps") or []:
                    if s.get("process_id") == process_id:
                        raise ValidationException("工序已被产品工艺引用，不能删除")
            rows = self._data.get("processes") or []
            idx = next((i for i, r in enumerate(rows) if r["id"] == process_id), None)
            if idx is None:
                raise NotFoundException("工序不存在")
            rows.pop(idx)
            self._persist()
            return {"ok": True, "deleted_id": process_id}

    def _enrich_product(self, row: dict) -> dict:
        pmap = self._process_map()
        steps = []
        for s in row.get("steps") or []:
            proc = pmap.get(s.get("process_id") or "") or {}
            steps.append(
                {
                    **s,
                    "process_code": proc.get("code"),
                    "process_name": proc.get("name"),
                }
            )
        return {**row, "steps": steps}

    def list_products(self) -> dict[str, Any]:
        with _LOCK:
            items = [self._enrich_product(p) for p in (self._data.get("products") or [])]
            items.sort(key=lambda x: x.get("code") or "")
            return {"items": items, "processes": deepcopy(self._data.get("processes") or [])}

    def last_process_by_product_name(self) -> dict[str, str]:
        """产品名/编码 → 工艺末道工序名，供匹配报工建议。"""
        with _LOCK:
            out: dict[str, str] = {}
            for row in self.product_finish_hints_unlocked():
                pname = row["last_process"]
                for key in (row.get("product") or "", row.get("code") or ""):
                    if key:
                        out[key] = pname
            return out

    def product_finish_hints_unlocked(self) -> list[dict[str, str]]:
        pmap = self._process_map()
        rows: list[dict[str, str]] = []
        for p in self._data.get("products") or []:
            if p.get("status") == "disabled":
                continue
            steps = p.get("steps") or []
            name = (p.get("name") or "").strip()
            if not name:
                continue
            last_name = ""
            if steps:
                last = steps[-1]
                proc = pmap.get(last.get("process_id") or "") or {}
                last_name = (proc.get("name") or "").strip()
            rows.append(
                {
                    "product": name,
                    "code": (p.get("code") or "").strip(),
                    "last_process": last_name,
                }
            )
        return rows

    def product_finish_hints(self) -> list[dict[str, str]]:
        """在用产品清单 + 末道工序（无工艺则为空），供成品表默认行。"""
        with _LOCK:
            return list(self.product_finish_hints_unlocked())

    def upsert_product(self, payload: dict[str, Any], product_id: str | None = None) -> dict:
        with _LOCK:
            name = (payload.get("name") or "").strip()
            code = (payload.get("code") or "").strip()
            if not name or not code:
                raise ValidationException("请填写产品编码与名称")
            steps_in = payload.get("steps") or []
            if not isinstance(steps_in, list) or not steps_in:
                raise ValidationException("请至少配置一道工序")
            pmap = self._process_map()
            steps: list[dict[str, Any]] = []
            for i, raw in enumerate(steps_in):
                if not isinstance(raw, dict):
                    raise ValidationException(f"第 {i + 1} 道工序格式无效")
                pid = (raw.get("process_id") or "").strip()
                if pid not in pmap:
                    raise ValidationException(f"第 {i + 1} 道工序不存在")
                qty = float(raw.get("qty") or 0)
                if qty <= 0:
                    raise ValidationException(f"第 {i + 1} 道件数须大于 0")
                unit_minutes = float(
                    raw.get("unit_minutes")
                    if raw.get("unit_minutes") is not None
                    else (pmap[pid].get("unit_minutes") or 0)
                )
                steps.append(
                    {
                        "process_id": pid,
                        "qty": qty,
                        "qty_unit": (raw.get("qty_unit") or "件").strip() or "件",
                        "unit_minutes": unit_minutes,
                    }
                )
            rows = self._data.setdefault("products", [])
            if product_id:
                row = next((r for r in rows if r["id"] == product_id), None)
                if not row:
                    raise NotFoundException("产品不存在")
            else:
                row = {"id": self._next_id("product", "pp-prod")}
                rows.append(row)
            row.update(
                {
                    "code": code,
                    "name": name,
                    "status": payload.get("status") or "active",
                    "effective_from": (payload.get("effective_from") or "")[:10] or None,
                    "effective_to": (payload.get("effective_to") or "")[:10] or None,
                    "steps": steps,
                }
            )
            self._persist()
            return self._enrich_product(row)

    def delete_product(self, product_id: str) -> dict:
        with _LOCK:
            rows = self._data.get("products") or []
            idx = next((i for i, r in enumerate(rows) if r["id"] == product_id), None)
            if idx is None:
                raise NotFoundException("产品不存在")
            rows.pop(idx)
            self._persist()
            return {"ok": True, "deleted_id": product_id}


def get_catalog_store(tenant_id: int) -> CatalogStore:
    with _LOCK:
        if tenant_id not in _CACHE:
            _CACHE[tenant_id] = CatalogStore(tenant_id)
        return _CACHE[tenant_id]
