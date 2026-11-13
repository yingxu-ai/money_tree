"""多维分析：逻辑事实 + 指标引擎 + 分组聚合。

事实来源：已确认 shop_floor_reports；标准耗时来自工序主数据 unit_minutes。
比值指标必须先 SUM 再除，禁止对各组比值求平均。
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from app.core.exceptions import ValidationException

# 维度白名单：请求 group_by / filters 只能用这些 key
DIMENSIONS: dict[str, dict[str, str]] = {
    "work_date": {"label": "归属日", "field": "work_date"},
    "shift": {"label": "班次", "field": "shift_family_id"},
    "team": {"label": "班组", "field": "team_id"},
    "person": {"label": "人员", "field": "person_id"},
    "equipment": {"label": "设备", "field": "equipment_key"},
    "process": {"label": "工序", "field": "process_name"},
    "work_order": {"label": "工单", "field": "work_order_key"},
    "product": {"label": "产品", "field": "product"},
    "order": {"label": "订单", "field": "order_id"},
}

# 可 SUM 的基础量；比值在聚合后计算
BASE_SUM_METRICS = ("output_qty", "production_hours")
RATIO_METRICS = ("hourly_output", "unit_time", "unit_minutes", "achieve_pct")
ALL_METRICS: dict[str, dict[str, Any]] = {
    "output_qty": {
        "label": "总产量",
        "unit": "件",
        "kind": "sum",
        "rankable": True,
        "cross_process_ok": True,
    },
    "production_hours": {
        "label": "生产工时",
        "unit": "小时",
        "kind": "sum",
        "rankable": True,
        "cross_process_ok": True,
    },
    "hourly_output": {
        "label": "小时产量",
        "unit": "件/小时",
        "kind": "ratio",
        "rankable": True,
        "cross_process_ok": True,
    },
    "unit_time": {
        "label": "单位耗时",
        "unit": "小时/件",
        "kind": "ratio",
        "rankable": True,
        "cross_process_ok": False,
    },
    "unit_minutes": {
        "label": "单位耗时",
        "unit": "分钟/件",
        "kind": "ratio",
        "rankable": True,
        "cross_process_ok": False,
    },
    "achieve_pct": {
        "label": "效率达成率",
        "unit": "%",
        "kind": "ratio",
        "rankable": True,
        "cross_process_ok": False,
        "needs_std": True,
    },
}


def _round3(n: float) -> float:
    return round(n * 1000) / 1000


def _hours_from_range(start_time: str | None, end_time: str | None) -> float:
    if not start_time or not end_time:
        return 0.0
    try:
        sh, sm = [int(x) for x in start_time[:5].split(":")]
        eh, em = [int(x) for x in end_time[:5].split(":")]
    except (TypeError, ValueError):
        return 0.0
    start_m = sh * 60 + sm
    end_m = eh * 60 + em
    if end_m <= start_m:
        end_m += 24 * 60
    return _round3((end_m - start_m) / 60.0)


def _fact_hours(row: dict[str, Any]) -> float:
    h = float(row.get("hours") or 0)
    if h > 0:
        return h
    return _hours_from_range(row.get("start_time"), row.get("end_time"))


def build_facts(
    *,
    reports: list[dict[str, Any]],
    person_map: dict[str, dict[str, Any]],
    resource_map: dict[str, dict[str, Any]],
    wo_map: dict[str, dict[str, Any]],
    order_map: dict[str, dict[str, Any]],
    roster_shift_fn,
    shift_name_fn,
) -> list[dict[str, Any]]:
    """将已确认报工 enrich 为分析事实行。"""
    facts: list[dict[str, Any]] = []
    for r in reports:
        if (r.get("status") or "") != "confirmed":
            continue
        work_date = (r.get("work_date") or "")[:10]
        if not work_date:
            continue
        person_id = (r.get("person_id") or "").strip()
        person = person_map.get(person_id) or {}
        team_id = (person.get("resource_id") or "").strip() or None
        team = resource_map.get(team_id or "") or {}
        fam = (r.get("shift_family_id") or "").strip() or None
        if not fam and person_id and work_date:
            fam = roster_shift_fn(person_id, work_date)
        shift_name = (r.get("shift_name") or "").strip() or (
            shift_name_fn(fam) if fam else None
        )
        wo_id = (r.get("work_order_id") or "").strip() or None
        wo = wo_map.get(wo_id or "") or {}
        order_id = (r.get("order_id") or wo.get("order_id") or "").strip() or None
        order = order_map.get(order_id or "") or {}
        product = (
            (r.get("product") or "").strip()
            or (wo.get("product") or "").strip()
            or (order.get("product") or "").strip()
            or None
        )
        eq_id = (r.get("equipment_id") or "").strip() or None
        eq_name = (r.get("equipment_name") or "").strip() or None
        equipment_key = eq_id or eq_name or "__none__"
        process_name = (r.get("process_name") or "").strip() or "未命名工序"
        wo_label = (
            (r.get("work_order_label") or "").strip()
            or (
                f"{wo.get('code') or ''} · {wo.get('name') or ''}".strip(" ·")
                if wo
                else ""
            )
            or None
        )
        work_order_key = wo_id or wo_label or "__none__"
        qty = float(r.get("qty") or 0)
        hours = _fact_hours(r)
        if qty <= 0 and hours <= 0:
            continue
        facts.append(
            {
                "id": r.get("id"),
                "work_date": work_date,
                "shift_family_id": fam,
                "shift_name": shift_name or "未排班",
                "person_id": person_id or None,
                "person_name": person.get("name") or person_id or "未知",
                "team_id": team_id,
                "team_name": team.get("name") or ("未分班组" if not team_id else team_id),
                "equipment_id": eq_id,
                "equipment_name": eq_name or "未挂设备",
                "equipment_key": equipment_key,
                "process_name": process_name,
                "work_order_id": wo_id,
                "work_order_label": wo_label,
                "work_order_key": work_order_key,
                "order_id": order_id,
                "order_code": order.get("code"),
                "product": product or "未填产品",
                "output_qty": qty,
                "production_hours": hours,
            }
        )
    return facts


def _dim_key_and_label(fact: dict[str, Any], dim: str) -> tuple[str, str]:
    if dim == "work_date":
        v = fact.get("work_date") or ""
        return v, v
    if dim == "shift":
        k = fact.get("shift_family_id") or "__none__"
        return str(k), fact.get("shift_name") or "未排班"
    if dim == "team":
        k = fact.get("team_id") or "__none__"
        return str(k), fact.get("team_name") or "未分班组"
    if dim == "person":
        k = fact.get("person_id") or "__none__"
        return str(k), fact.get("person_name") or "未知"
    if dim == "equipment":
        k = fact.get("equipment_key") or "__none__"
        return str(k), fact.get("equipment_name") or "未挂设备"
    if dim == "process":
        v = fact.get("process_name") or "未命名工序"
        return v, v
    if dim == "work_order":
        k = fact.get("work_order_key") or "__none__"
        label = fact.get("work_order_label") or fact.get("work_order_id") or "未挂工单"
        return str(k), str(label)
    if dim == "product":
        v = fact.get("product") or "未填产品"
        return v, v
    if dim == "order":
        k = fact.get("order_id") or "__none__"
        label = fact.get("order_code") or k
        return str(k), str(label)
    raise ValidationException(f"不支持的维度：{dim}")


def _match_filters(fact: dict[str, Any], filters: dict[str, Any]) -> bool:
    def _in(key: str, val: Any) -> bool:
        arr = filters.get(key)
        if not arr:
            return True
        vals = {str(x) for x in arr if x is not None and str(x) != ""}
        if not vals:
            return True
        return str(val if val is not None else "") in vals or (
            val is None and "__none__" in vals
        )

    if not _in("team_ids", fact.get("team_id")):
        return False
    if not _in("person_ids", fact.get("person_id")):
        return False
    if not _in("equipment_ids", fact.get("equipment_id") or fact.get("equipment_key")):
        # 兼容按名称筛
        eq_ids = {str(x) for x in (filters.get("equipment_ids") or [])}
        if eq_ids and str(fact.get("equipment_name") or "") not in eq_ids:
            if str(fact.get("equipment_key") or "") not in eq_ids:
                return False
    if not _in("process_names", fact.get("process_name")):
        return False
    if not _in("work_order_ids", fact.get("work_order_id") or fact.get("work_order_key")):
        wo_ids = {str(x) for x in (filters.get("work_order_ids") or [])}
        if wo_ids:
            if str(fact.get("work_order_id") or "") not in wo_ids and str(
                fact.get("work_order_key") or ""
            ) not in wo_ids:
                return False
    if not _in("products", fact.get("product")):
        return False
    if not _in("order_ids", fact.get("order_id")):
        return False
    if not _in("shift_family_ids", fact.get("shift_family_id")):
        return False
    return True


def _compute_metrics(
    qty: float,
    hours: float,
    *,
    metrics: list[str],
    std_minutes: float | None,
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for m in metrics:
        if m == "output_qty":
            out[m] = _round3(qty)
        elif m == "production_hours":
            out[m] = _round3(hours)
        elif m == "hourly_output":
            out[m] = _round3(qty / hours) if hours > 0 else None
        elif m == "unit_time":
            out[m] = _round3(hours / qty) if qty > 0 else None
        elif m == "unit_minutes":
            out[m] = _round3((hours * 60) / qty) if qty > 0 else None
        elif m == "achieve_pct":
            if std_minutes and std_minutes > 0 and qty > 0 and hours > 0:
                actual_m = (hours * 60) / qty
                out[m] = _round3((std_minutes / actual_m) * 100) if actual_m > 0 else None
            else:
                out[m] = None
        else:
            raise ValidationException(f"不支持的指标：{m}")
    return out


def run_query(
    *,
    facts: list[dict[str, Any]],
    date_from: str,
    date_to: str,
    filters: dict[str, Any] | None,
    group_by: list[str],
    metrics: list[str],
    sort_field: str | None = None,
    sort_order: str = "desc",
    limit: int = 200,
    std_minutes_by_process: dict[str, float] | None = None,
) -> dict[str, Any]:
    filters = filters or {}
    std_map = std_minutes_by_process or {}

    d0 = (date_from or "")[:10]
    d1 = (date_to or d0)[:10]
    if not d0 or not d1:
        raise ValidationException("请指定 date_from / date_to")
    try:
        date.fromisoformat(d0)
        date.fromisoformat(d1)
    except ValueError as exc:
        raise ValidationException("日期格式无效") from exc
    if d1 < d0:
        d0, d1 = d1, d0

    if not group_by:
        raise ValidationException("请至少选择一个分组维度")
    if len(group_by) > 3:
        raise ValidationException("分组维度最多 3 个")
    for g in group_by:
        if g not in DIMENSIONS:
            raise ValidationException(f"不支持的维度：{g}")

    if not metrics:
        metrics = ["output_qty", "production_hours", "hourly_output", "unit_minutes"]
    for m in metrics:
        if m not in ALL_METRICS:
            raise ValidationException(f"不支持的指标：{m}")

    limit = max(1, min(int(limit or 200), 500))

    scoped = [
        f
        for f in facts
        if d0 <= (f.get("work_date") or "")[:10] <= d1 and _match_filters(f, filters)
    ]

    # key = tuple of dim keys → accum
    Acc = dict[str, Any]
    buckets: dict[tuple[str, ...], Acc] = {}
    labels: dict[tuple[str, ...], dict[str, str]] = {}

    for fact in scoped:
        keys: list[str] = []
        label_map: dict[str, str] = {}
        for dim in group_by:
            k, lab = _dim_key_and_label(fact, dim)
            keys.append(k)
            label_map[dim] = lab
            label_map[f"{dim}_id"] = k
        tk = tuple(keys)
        acc = buckets.get(tk)
        if not acc:
            acc = {"output_qty": 0.0, "production_hours": 0.0, "processes": set()}
            buckets[tk] = acc
            labels[tk] = label_map
        acc["output_qty"] += float(fact.get("output_qty") or 0)
        acc["production_hours"] += float(fact.get("production_hours") or 0)
        acc["processes"].add(fact.get("process_name") or "")

    rows: list[dict[str, Any]] = []
    for tk, acc in buckets.items():
        qty = float(acc["output_qty"])
        hours = float(acc["production_hours"])
        # 达成率：单工序组用该工序标准；多工序混合则不给达成率
        procs = {p for p in (acc.get("processes") or set()) if p}
        std_minutes = None
        if len(procs) == 1:
            only = next(iter(procs))
            std_minutes = std_map.get(only)
        metrics_out = _compute_metrics(
            qty, hours, metrics=metrics, std_minutes=std_minutes
        )
        row: dict[str, Any] = {**labels[tk], **metrics_out}
        # 便于下钻：每个维度的 filter 值
        drill: dict[str, Any] = {}
        for i, dim in enumerate(group_by):
            dim_id = tk[i]
            if dim == "team":
                drill["team_ids"] = [dim_id] if dim_id != "__none__" else []
            elif dim == "person":
                drill["person_ids"] = [dim_id] if dim_id != "__none__" else []
            elif dim == "equipment":
                drill["equipment_ids"] = [dim_id] if dim_id != "__none__" else []
            elif dim == "process":
                drill["process_names"] = [dim_id]
            elif dim == "work_order":
                drill["work_order_ids"] = [dim_id] if dim_id != "__none__" else []
            elif dim == "product":
                drill["products"] = [dim_id]
            elif dim == "order":
                drill["order_ids"] = [dim_id] if dim_id != "__none__" else []
            elif dim == "shift":
                drill["shift_family_ids"] = [dim_id] if dim_id != "__none__" else []
            elif dim == "work_date":
                drill["date_from"] = dim_id
                drill["date_to"] = dim_id
        row["_drill_filters"] = drill
        rows.append(row)

    # 合计（先 SUM 再比值）
    total_qty = sum(float(a["output_qty"]) for a in buckets.values())
    total_hours = sum(float(a["production_hours"]) for a in buckets.values())
    totals = _compute_metrics(total_qty, total_hours, metrics=metrics, std_minutes=None)

    sf = sort_field or (metrics[0] if metrics else "output_qty")
    reverse = (sort_order or "desc").lower() != "asc"

    def _sort_key(row: dict[str, Any]) -> tuple:
        v = row.get(sf)
        if v is None:
            return (1, 0.0)
        try:
            return (0, float(v))
        except (TypeError, ValueError):
            return (0, 0.0)

    rows.sort(key=_sort_key, reverse=reverse)
    truncated = len(rows) > limit
    rows = rows[:limit]

    return {
        "date_from": d0,
        "date_to": d1,
        "group_by": group_by,
        "metrics": metrics,
        "columns": [
            *[{"key": d, "label": DIMENSIONS[d]["label"], "role": "dimension"} for d in group_by],
            *[
                {
                    "key": m,
                    "label": ALL_METRICS[m]["label"],
                    "unit": ALL_METRICS[m]["unit"],
                    "role": "metric",
                }
                for m in metrics
            ],
        ],
        "rows": rows,
        "totals": totals,
        "row_count": len(rows),
        "truncated": truncated,
        "fact_count": len(scoped),
    }


def default_date_range() -> tuple[str, str]:
    today = date.today()
    start = today - timedelta(days=29)
    return start.isoformat(), today.isoformat()


def meta_payload(
    *,
    facts_sample_filters: dict[str, list[dict[str, str]]],
) -> dict[str, Any]:
    d0, d1 = default_date_range()
    return {
        "dimensions": [
            {"key": k, "label": v["label"]} for k, v in DIMENSIONS.items()
        ],
        "metrics": [
            {
                "key": k,
                "label": v["label"],
                "unit": v["unit"],
                "kind": v["kind"],
                "rankable": v.get("rankable", True),
                "needs_std": v.get("needs_std", False),
            }
            for k, v in ALL_METRICS.items()
        ],
        "default_date_from": d0,
        "default_date_to": d1,
        "max_group_by": 3,
        "max_limit": 500,
        "filters": facts_sample_filters,
        "note": "仅统计已确认报工；产量/工时先汇总再算比值；达成率需工序标准耗时。",
    }
