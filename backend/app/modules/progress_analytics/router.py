"""多维生产分析 API（SKU：progress-analytics）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.auth.context import CurrentUser
from app.auth.deps import get_current_user, require_permission
from app.core.response import ok
from app.modules.production_progress.catalog_store import CatalogStore, get_catalog_store
from app.modules.progress_analytics.engine import (
    ALL_METRICS,
    DIMENSIONS,
    build_facts,
    default_date_range,
    meta_payload,
    run_query,
)
from app.modules.scheduling.store import SchedulingStore, get_store

router = APIRouter(prefix="/progress-analytics", tags=["多维生产分析"])


def _store(current: CurrentUser = Depends(get_current_user)) -> SchedulingStore:
    return get_store(current.effective_tenant_id)


def _catalog(current: CurrentUser = Depends(get_current_user)) -> CatalogStore:
    return get_catalog_store(current.effective_tenant_id)


class AnalyticsFilters(BaseModel):
    team_ids: list[str] = Field(default_factory=list)
    person_ids: list[str] = Field(default_factory=list)
    equipment_ids: list[str] = Field(default_factory=list)
    process_names: list[str] = Field(default_factory=list)
    work_order_ids: list[str] = Field(default_factory=list)
    products: list[str] = Field(default_factory=list)
    order_ids: list[str] = Field(default_factory=list)
    shift_family_ids: list[str] = Field(default_factory=list)


class AnalyticsSort(BaseModel):
    field: str | None = None
    order: str = "desc"


class AnalyticsQueryBody(BaseModel):
    date_from: str | None = None
    date_to: str | None = None
    filters: AnalyticsFilters | None = None
    group_by: list[str] = Field(default_factory=lambda: ["team"])
    metrics: list[str] = Field(
        default_factory=lambda: [
            "output_qty",
            "production_hours",
            "hourly_output",
            "unit_minutes",
            "achieve_pct",
        ]
    )
    sort: AnalyticsSort | None = None
    limit: int = 200


def _collect_facts(store: SchedulingStore) -> list[dict[str, Any]]:
    with store._lock:
        store._ensure_shop_floor_reports_unlocked()
        reports = list(store._data.get("shop_floor_reports") or [])
        person_map = {p["id"]: p for p in (store._data.get("persons") or [])}
        resource_map = {r["id"]: r for r in (store._data.get("resources") or [])}
        wo_map = store._wo_map()
        order_map = store._order_map()
        fam_names: dict[str, str] = {}
        for s in store._data.get("shifts") or []:
            fid = s.get("family_id")
            if fid and (s.get("status") == "active" or fid not in fam_names):
                fam_names[str(fid)] = s.get("name") or str(fid)

        def roster_shift(pid: str, day: str) -> str | None:
            return store._person_roster_family_on_day_unlocked(pid, day)

        def shift_name(fam: str | None) -> str | None:
            if not fam:
                return None
            return fam_names.get(str(fam))

        return build_facts(
            reports=reports,
            person_map=person_map,
            resource_map=resource_map,
            wo_map=wo_map,
            order_map=order_map,
            roster_shift_fn=roster_shift,
            shift_name_fn=shift_name,
        )


def _filter_options(facts: list[dict[str, Any]], store: SchedulingStore) -> dict[str, list]:
    teams: dict[str, str] = {}
    persons: dict[str, str] = {}
    equipments: dict[str, str] = {}
    processes: set[str] = set()
    products: set[str] = set()
    shifts: dict[str, str] = {}
    work_orders: dict[str, str] = {}
    orders: dict[str, str] = {}

    for f in facts:
        if f.get("team_id"):
            teams[str(f["team_id"])] = f.get("team_name") or f["team_id"]
        if f.get("person_id"):
            persons[str(f["person_id"])] = f.get("person_name") or f["person_id"]
        ek = f.get("equipment_key")
        if ek and ek != "__none__":
            equipments[str(ek)] = f.get("equipment_name") or str(ek)
        if f.get("process_name"):
            processes.add(f["process_name"])
        if f.get("product"):
            products.add(f["product"])
        if f.get("shift_family_id"):
            shifts[str(f["shift_family_id"])] = f.get("shift_name") or f["shift_family_id"]
        wk = f.get("work_order_key")
        if wk and wk != "__none__":
            work_orders[str(wk)] = f.get("work_order_label") or str(wk)
        if f.get("order_id"):
            orders[str(f["order_id"])] = f.get("order_code") or f["order_id"]

    # 补主数据里尚未报工的选项
    with store._lock:
        for r in store._data.get("resources") or []:
            if r.get("status") == "disabled":
                continue
            teams.setdefault(r["id"], r.get("name") or r["id"])
        for p in store._data.get("persons") or []:
            if p.get("status") == "disabled":
                continue
            persons.setdefault(p["id"], p.get("name") or p["id"])
        for e in store._data.get("equipments") or []:
            if e.get("status") == "disabled":
                continue
            equipments.setdefault(e["id"], e.get("name") or e["id"])
        for s in store._data.get("shifts") or []:
            if s.get("status") != "active":
                continue
            fid = s.get("family_id")
            if fid:
                shifts.setdefault(str(fid), s.get("name") or str(fid))

    def opts(m: dict[str, str]) -> list[dict[str, str]]:
        return [{"value": k, "label": v} for k, v in sorted(m.items(), key=lambda x: x[1])]

    return {
        "teams": opts(teams),
        "persons": opts(persons),
        "equipments": opts(equipments),
        "processes": [{"value": p, "label": p} for p in sorted(processes)],
        "products": [{"value": p, "label": p} for p in sorted(products)],
        "shifts": opts(shifts),
        "work_orders": opts(work_orders),
        "orders": opts(orders),
    }


@router.get("/meta")
async def analytics_meta(
    request: Request,
    _user=Depends(require_permission("progress_analytics:view")),
    store: SchedulingStore = Depends(_store),
    catalog: CatalogStore = Depends(_catalog),
):
    """维度/指标字典 + 筛选项。"""
    facts = _collect_facts(store)
    # 触发工序标准补齐
    _ = catalog.list_processes()
    return ok(
        request,
        {
            **meta_payload(facts_sample_filters=_filter_options(facts, store)),
            "std_process_count": len(catalog.process_std_minutes_by_name()),
        },
    )


@router.post("/query")
async def analytics_query(
    payload: AnalyticsQueryBody,
    request: Request,
    _user=Depends(require_permission("progress_analytics:view")),
    store: SchedulingStore = Depends(_store),
    catalog: CatalogStore = Depends(_catalog),
):
    """通用交叉分析查询。"""
    d0, d1 = default_date_range()
    date_from = (payload.date_from or d0)[:10]
    date_to = (payload.date_to or d1)[:10]
    facts = _collect_facts(store)
    std_map = catalog.process_std_minutes_by_name()
    sort = payload.sort or AnalyticsSort()
    result = run_query(
        facts=facts,
        date_from=date_from,
        date_to=date_to,
        filters=(payload.filters.model_dump() if payload.filters else {}),
        group_by=payload.group_by,
        metrics=payload.metrics,
        sort_field=sort.field,
        sort_order=sort.order,
        limit=payload.limit,
        std_minutes_by_process=std_map,
    )
    result["dimensions_meta"] = {k: v["label"] for k, v in DIMENSIONS.items()}
    result["metrics_meta"] = {
        k: {"label": v["label"], "unit": v["unit"]} for k, v in ALL_METRICS.items()
    }
    return ok(request, result)
