"""设备分析 API：所有接口从唯一 catalog 投影，禁止各端点自写第二套数字。"""

from __future__ import annotations

import json
import math
import random
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_session
from app.core.response import ok
from app.models.system import SysDept

router = APIRouter(prefix="/equipment-analysis", tags=["设备分析"])

_CATALOG_PATH = (
    Path(__file__).resolve().parents[3] / "fixtures" / "equipment_analysis" / "catalog.json"
)

# 售前剧本顺序：异常 → 正常调优 → 关注长寿命
DEMO_ANCHOR_IDS = ("EQ-C02", "EQ-C01", "EQ-P01")
DEMO_ANCHOR_RANK = {did: i for i, did in enumerate(DEMO_ANCHOR_IDS)}
OPTIMIZE_LABELS = {"energy": "节能", "balance": "平衡", "output": "高负荷生产", "life": "长寿命"}


_CATALOG_MTIME: float | None = None


def _load_catalog() -> dict[str, Any]:
    """读 catalog；文件变更时自动失效缓存（regen fixtures 无需重启）。"""
    global _CATALOG_MTIME
    mtime = _CATALOG_PATH.stat().st_mtime
    cached = getattr(_load_catalog, "_cache", None)
    if cached is not None and _CATALOG_MTIME == mtime:
        return cached
    with _CATALOG_PATH.open(encoding="utf-8") as f:
        data = json.load(f)
    _load_catalog._cache = data  # type: ignore[attr-defined]
    _CATALOG_MTIME = mtime
    return data


async def _fetch_depts(session: AsyncSession, tenant_id: int) -> list[dict[str, Any]]:
    """与系统部门树同源；仅当前租户，避免跨租户组织串数据。"""
    result = await session.execute(
        select(SysDept)
        .where(
            SysDept.is_deleted.is_(False),
            SysDept.tenant_id == tenant_id,
        )
        .order_by(SysDept.sort, SysDept.id)
    )
    return [
        {"id": d.id, "parent_id": d.parent_id, "name": d.name, "code": d.code}
        for d in result.scalars().all()
    ]


def _dept_name(depts: list[dict], dept_id: int, fallback: str = "") -> str:
    for d in depts:
        if d["id"] == dept_id:
            return d["name"]
    return fallback or f"部门#{dept_id}"


def _device_map(catalog: dict[str, Any]) -> dict[str, dict]:
    return {d["id"]: d for d in catalog["devices"]}


def _format_display_metrics(device: dict, catalog: dict) -> str:
    labels = catalog.get("metric_labels", {})
    units = {p["code"]: p["unit"] for p in catalog.get("points", [])}
    parts: list[str] = []
    rt = device.get("realtime") or {}
    for key in device.get("display_metrics") or []:
        if key not in rt:
            continue
        val = rt[key]
        unit = units.get(key, "")
        name = labels.get(key, key)
        if isinstance(val, float) and val == int(val):
            val = int(val)
        parts.append(f"{val}{unit}" if unit else f"{name}:{val}")
    return " / ".join(parts) if parts else "—"


def _demo_rows(devices: list[dict], catalog: dict, depts: list[dict] | None) -> list[dict[str, Any]]:
    by_id = {d["id"]: d for d in devices}
    rows: list[dict[str, Any]] = []
    for aid in DEMO_ANCHOR_IDS:
        d = by_id.get(aid)
        if d:
            rows.append(_list_row(d, catalog, depts))
    return rows


def _sort_devices_with_anchors(devices: list[dict]) -> list[dict]:
    return sorted(
        devices,
        key=lambda d: (
            0 if d.get("id") in DEMO_ANCHOR_RANK else 1,
            DEMO_ANCHOR_RANK.get(d.get("id"), 99),
            d.get("name") or "",
        ),
    )


def _list_row(device: dict, catalog: dict, depts: list[dict] | None = None) -> dict[str, Any]:
    dept_id = device["dept_id"]
    dept_name = _dept_name(depts, dept_id, device.get("dept_name")) if depts else device["dept_name"]
    rec_key, rec_reason = _recommend_opt_key(device)
    return {
        "id": device["id"],
        "code": device["code"],
        "name": device["name"],
        "type": device.get("type"),
        "dept_id": dept_id,
        "dept_name": dept_name,
        "run_status": device["run_status"],
        "analysis_status": device["analysis_status"],
        "summary": device["summary"],
        "realtime_display": _format_display_metrics(device, catalog),
        "energy_score": device.get("energy_score"),
        "output_today": device.get("output_today"),
        "power": device["realtime"].get("power"),
        "eligible_optimize": rec_key is not None,
        "is_anchor": device.get("id") in DEMO_ANCHOR_RANK,
        "rec_strategy": rec_key,
        "rec_strategy_label": OPTIMIZE_LABELS.get(rec_key) if rec_key else "暂不调参",
        "rec_reason": rec_reason,
        **_future_list_fields(device),
    }


FUTURE_ALERT_LABELS = {
    "normal": "正常",
    "warning": "预警",
    "alarm": "报警",
    "paused": "预测暂停",
}

FUTURE_CONFIDENCE_LABELS = {
    "high": "高",
    "medium": "中",
    "low": "低",
}


def _project_future_metrics(device: dict) -> dict[str, Any]:
    """未来分析四维指标 — Phase 1 投影（单一算法源）。"""
    f = device.get("future") or {}
    comm = device.get("comm_status", "online")
    last_sample = device.get("last_sample_at")
    data_valid = comm == "online" and bool(last_sample)

    risk_7d = int(f.get("risk_7d", 0))
    risk_24h = int(f.get("risk_24h", 0))
    risk_72h = int(f.get("risk_72h", 0))
    rul_days = int(f.get("rul_days", 0))
    rul_ci_raw = f.get("rul_ci") or [max(1, rul_days - 5), rul_days + 10]
    rul_ci = [int(rul_ci_raw[0]), int(rul_ci_raw[1])]

    health_index = max(0, min(100, 100 - risk_7d))
    if health_index >= 70:
        health_band = "green"
    elif health_index >= 40:
        health_band = "yellow"
    else:
        health_band = "red"

    if comm != "online":
        data_valid_reason = "采集离线"
    elif not last_sample:
        data_valid_reason = "无近期采样"
    else:
        data_valid_reason = None

    prediction_paused = not data_valid
    if prediction_paused:
        alert_level = "paused"
    elif rul_days < 7 or risk_24h >= 30:
        alert_level = "alarm"
    elif risk_7d >= 20 or health_index < 70 or rul_days <= 30:
        alert_level = "warning"
    else:
        alert_level = "normal"

    ci_width = max(0, rul_ci[1] - rul_ci[0])
    if ci_width <= 15:
        confidence = "high"
    elif ci_width <= 35:
        confidence = "medium"
    else:
        confidence = "low"

    base = date(2026, 8, 27)
    maintain_by: str | None = None
    if not prediction_paused:
        if alert_level == "alarm":
            maintain_days = min(3, max(1, rul_days))
        elif alert_level == "warning":
            maintain_days = min(14, max(3, max(1, rul_days // 2)))
        else:
            maintain_days = min(60, max(7, rul_days))
        maintain_by = (base + timedelta(days=maintain_days)).isoformat()

    model_coverage = f.get("model_coverage")
    coverage_wall = _project_fault_coverage_wall(
        device,
        model_coverage=list(model_coverage) if model_coverage else None,
    )

    payload = {
        "risk_24h": risk_24h,
        "risk_72h": risk_72h,
        "risk_7d": risk_7d,
        "rul_days": rul_days,
        "rul_ci": rul_ci,
        "rul_range_label": f"{rul_ci[0]}～{rul_ci[1]} 天",
        "health_index": health_index,
        "health_band": health_band,
        "alert_level": alert_level,
        "alert_label": FUTURE_ALERT_LABELS[alert_level],
        "confidence": confidence,
        "confidence_label": FUTURE_CONFIDENCE_LABELS[confidence],
        "data_valid": data_valid,
        "data_valid_reason": data_valid_reason,
        "prediction_paused": prediction_paused,
        "maintain_by": maintain_by,
        "model_coverage": coverage_wall["model_coverage"],
        "fault_coverage_wall": coverage_wall["fault_coverage_wall"],
        "likely_fault": f.get("likely_fault", "—"),
        "review_required": alert_level == "alarm" and confidence == "low",
        **_project_future_attribution(device),
        **_project_future_decision(device, alert_level=alert_level, confidence=confidence),
    }
    payload["decision_brief"] = _build_decision_brief(device, payload)
    return payload


def _fmt_hours(h: float) -> str:
    """预估停机时长文案（小时；满 24 小时再拆成天）。"""
    hours = max(0.0, float(h))
    whole = int(round(hours))
    if whole <= 0:
        return "不足 1 小时"
    days, rem = divmod(whole, 24)
    if days and rem:
        return f"{days} 天 {rem} 小时"
    if days:
        return f"{days} 天"
    return f"{whole} 小时"


def _project_downtime(device: dict, *, risk_7d: int) -> dict[str, Any]:
    """计划检修窗口 vs 突发停机时长。不估算金额。"""
    st = device.get("analysis_status", "normal")
    planned = {"abnormal": 8.0, "watch": 4.0, "normal": 2.0}.get(st, 4.0)
    unplanned = {"abnormal": 36.0, "watch": 16.0, "normal": 8.0}.get(st, 12.0)
    unplanned = round(unplanned * (1 + int(risk_7d) / 200), 1)
    if unplanned <= planned:
        unplanned = planned + 6
    avoidable = round(unplanned - planned, 1)
    planned_l = _fmt_hours(planned)
    unplanned_l = _fmt_hours(unplanned)
    avoidable_l = _fmt_hours(avoidable)
    return {
        "downtime_planned_h": planned,
        "downtime_unplanned_h": unplanned,
        "downtime_avoidable_h": avoidable,
        "downtime_planned_label": planned_l,
        "downtime_unplanned_label": unplanned_l,
        "downtime_avoidable_label": avoidable_l,
        "downtime_hint": (
            f"现在计划检修约 {planned_l}；若拖到突发停机约 {unplanned_l}。"
            f"可少停约 {avoidable_l}，建议占用维护窗口。"
        ),
    }


def _build_decision_brief(device: dict, projected: dict[str, Any]) -> dict[str, Any]:
    """单机未来页置顶决策卡：预测 → 原因 → 后果 → 行动（禁止前端另写算法）。"""
    alert = projected.get("alert_level") or "normal"
    risk_7d = int(projected.get("risk_7d") or 0)
    maintain_by = projected.get("maintain_by")
    attribution = projected.get("attribution_top3") or []
    causes = [str(x.get("text") or x.get("name")) for x in attribution[:3] if x]
    if not causes:
        causes = [
            str(projected.get("primary_cause") or projected.get("likely_fault") or "工况偏离基线")
        ]

    unplanned_l = projected.get("downtime_unplanned_label")
    avoidable_l = projected.get("downtime_avoidable_label")
    planned_l = projected.get("downtime_planned_label")

    if alert == "alarm":
        stance = "建议尽快安排检修窗口" + (f"，不晚于 {maintain_by}。" if maintain_by else "。")
        severity = "高"
    elif alert == "warning":
        stance = (
            f"当前无需紧急停机，建议在 {maintain_by} 前完成点检。"
            if maintain_by
            else "当前无需紧急停机，建议纳入本周点检。"
        )
        severity = "中"
    else:
        stance = "工况稳定，保持常规巡检" + (
            f"，建议 {maintain_by} 前完成例行保养。" if maintain_by else "。"
        )
        severity = "低"

    worsen = ((device.get("current") or {}).get("worsen_if_ignored") or {}).get("summary")
    if worsen:
        if_ignore = str(worsen)
        if unplanned_l:
            if_ignore = f"{if_ignore.rstrip('。')}；突发停机约 {unplanned_l}。"
    elif unplanned_l:
        if_ignore = f"若不处理，风险可能继续上升、RUL 缩短，突发停机约 {unplanned_l}。"
    else:
        if_ignore = "若不处理，风险可能继续上升。"

    if avoidable_l and planned_l:
        if_act = f"按建议点检/润滑后，计划检修约 {planned_l}，可少停约 {avoidable_l}。"
    else:
        if_act = "按建议动作处理，预计可抑制风险上升。"

    return {
        "headline": f"未来7天发生严重故障概率 {risk_7d}%",
        "stance": stance,
        "severity": severity,
        "causes": causes,
        "if_ignore": if_ignore,
        "if_act": if_act,
        "downtime_planned_h": projected.get("downtime_planned_h"),
        "downtime_unplanned_h": projected.get("downtime_unplanned_h"),
        "downtime_avoidable_h": projected.get("downtime_avoidable_h"),
        "downtime_planned_label": planned_l,
        "downtime_unplanned_label": unplanned_l,
        "downtime_avoidable_label": avoidable_l,
    }


def _project_future_decision(
    device: dict,
    *,
    alert_level: str,
    confidence: str,
) -> dict[str, Any]:
    """业务决策：预估停机时长、阈值策略、相近案例。不估算金额。"""
    f = device.get("future") or {}
    device_id = device.get("id", "unknown")
    dtype = device.get("type") or "通用设备"
    st = device.get("analysis_status", "normal")
    risk_7d = int(f.get("risk_7d", 0))
    likely = f.get("likely_fault") or "轴承异常"
    profile = f.get("threshold_profile") or "balanced"
    dt = _project_downtime(device, risk_7d=risk_7d)

    cases = [
        {
            "id": f"CASE-{device_id}-1",
            "title": f"同型{dtype} · {likely}",
            "when": "约 3 个月前",
            "action": "提前换润滑脂并降载 8%，窗口检修 4 小时",
            "outcome": "避免非计划停机，产线节拍未受影响",
            "avoided_downtime_h": dt["downtime_avoidable_h"],
            "avoided_downtime_label": dt["downtime_avoidable_label"],
        },
        {
            "id": f"CASE-{device_id}-2",
            "title": f"相近工况 · 振动温升同向",
            "when": "约 8 个月前",
            "action": "按预案备件到场后排夜班检修",
            "outcome": f"未发生突发停机，检修占用 {dt['downtime_planned_label']}",
            "avoided_downtime_h": dt["downtime_avoidable_h"],
            "avoided_downtime_label": dt["downtime_avoidable_label"],
        },
    ]
    if st == "abnormal":
        cases.append(
            {
                "id": f"CASE-{device_id}-3",
                "title": "未听模型建议 · 反例",
                "when": "约 1 年前",
                "action": "继续满负荷运行至突发停机",
                "outcome": f"非计划停机约 {dt['downtime_unplanned_label']}，影响下游工序",
                "avoided_downtime_h": 0,
                "avoided_downtime_label": None,
                "is_counterfactual": True,
            }
        )

    backtest_summary = (
        f"回溯：若上周按建议窗口干预，相对突发停机可少停约 {dt['downtime_avoidable_label']}"
        "（同型工况估计，须现场确认）。"
    )
    if alert_level == "normal":
        backtest_summary = (
            f"当前风险低，计划保养约 {dt['downtime_planned_label']}；"
            f"若拖到突发停机约 {dt['downtime_unplanned_label']}。"
        )
    if confidence == "low":
        backtest_summary += " 当前置信度偏低，建议人工复核后再排窗口。"

    return {
        **dt,
        "threshold_profile": profile,
        "threshold_options": f.get("threshold_options") or _default_threshold_options(),
        "similar_cases": cases,
        "backtest_summary": backtest_summary,
    }


def _default_threshold_options() -> list[dict[str, Any]]:
    return [
        {
            "key": "conservative",
            "label": "更保守",
            "desc": "更早预警，误报略增；适合关键产线",
            "alarm_risk_24h": 20,
            "warning_risk_7d": 15,
        },
        {
            "key": "balanced",
            "label": "平衡（默认）",
            "desc": "兼顾漏报与打扰；当前平台默认策略",
            "alarm_risk_24h": 30,
            "warning_risk_7d": 20,
        },
        {
            "key": "aggressive",
            "label": "更激进",
            "desc": "减少打扰，漏报略增；适合冗余设备",
            "alarm_risk_24h": 45,
            "warning_risk_7d": 35,
        },
    ]


# 参考施耐德 PMA：振动机理 + 工艺/电气双模型故障库（Demo 可扩展）
_FAULT_COVERAGE_CATALOG: list[dict[str, Any]] = [
    {
        "key": "mechanism",
        "label": "振动机理模型",
        "desc": "机械老化、磨损、不对中、松动等",
        "items": [
            {"key": "motor_misalign", "name": "电机不对中", "aliases": ["不对中", "电机不平衡"]},
            {"key": "motor_unbalance", "name": "电机不平衡", "aliases": ["不平衡", "基座松动"]},
            {"key": "coupling", "name": "联轴器磨损", "aliases": ["连轴器", "联轴器"]},
            {"key": "belt", "name": "皮带松紧/磨损", "aliases": ["皮带", "共振"]},
            {"key": "rotor", "name": "叶轮/转子损伤", "aliases": ["叶轮", "转子", "裂纹"]},
            {"key": "bearing_wear", "name": "轴承磨损", "aliases": ["轴承异常", "轴承损伤", "轴承"]},
            {"key": "bearing_loose", "name": "轴承松动", "aliases": ["轴承松动"]},
            {"key": "gear", "name": "齿轮磨损/点蚀", "aliases": ["齿轮", "点蚀"]},
        ],
    },
    {
        "key": "process",
        "label": "工艺 / 电气模型",
        "desc": "电气、润滑、工艺变换、部件老化等",
        "items": [
            {"key": "electrical", "name": "电气导致故障", "aliases": ["电机过热", "电气", "电流异常"]},
            {"key": "process_shift", "name": "工艺变换故障", "aliases": ["过热", "加热异常", "工艺"]},
            {"key": "lube", "name": "润滑导致故障", "aliases": ["润滑不足", "润滑异常", "润滑"]},
            {"key": "valve", "name": "阀门磨损", "aliases": ["阀门"]},
            {"key": "aging", "name": "部件老化", "aliases": ["老化"]},
            {"key": "overheat", "name": "温升过快", "aliases": ["温升", "过热"]},
        ],
    },
]


def _fault_name_hit(name: str, needle: str) -> bool:
    a = (name or "").strip()
    b = (needle or "").strip()
    if not a or not b:
        return False
    return a == b or a in b or b in a


def _project_fault_coverage_wall(
    device: dict,
    *,
    model_coverage: list[str] | None = None,
) -> dict[str, Any]:
    """故障覆盖芯片墙：双组模型库 + 本次命中高亮。"""
    f = device.get("future") or {}
    if f.get("fault_coverage_wall"):
        wall = f["fault_coverage_wall"]
        flat = model_coverage or f.get("model_coverage") or [
            it["name"]
            for g in wall.get("groups", [])
            for it in g.get("items", [])
            if it.get("status") in ("hit", "covered")
        ]
        return {"fault_coverage_wall": wall, "model_coverage": list(flat)}

    likely = str(f.get("likely_fault") or "")
    probs = f.get("fault_type_probs") or []
    st = device.get("analysis_status", "normal")
    risk_7d = int(f.get("risk_7d") or 0)
    # 正常且低风险：只展示覆盖面，不高亮命中，避免误导
    allow_hit = st in ("abnormal", "watch") or risk_7d >= 20
    prob_map: dict[str, int] = {}
    for p in probs:
        name = str(p.get("name") or "")
        raw = p.get("prob")
        if raw is None:
            continue
        pct = int(round(float(raw) * 100)) if float(raw) <= 1 else int(round(float(raw)))
        if name:
            prob_map[name] = pct

    # 显式覆盖名单：≥8 条时按名单收窄（严格模式）；否则整库默认可诊断
    explicit = list(model_coverage or f.get("model_coverage") or [])
    use_explicit = len(explicit) >= 8

    hit_names: list[str] = []
    if allow_hit:
        if likely and likely not in ("暂无明显类型", "—", "-"):
            hit_names.append(likely)
        for name, pct in prob_map.items():
            if pct >= 15 and name not in ("其他",):
                hit_names.append(name)

    groups_out: list[dict[str, Any]] = []
    hit_count = 0
    covered_count = 0

    for group in _FAULT_COVERAGE_CATALOG:
        items_out: list[dict[str, Any]] = []
        for raw in group["items"]:
            name = raw["name"]
            aliases = [name, *list(raw.get("aliases") or [])]
            matched_prob = 0
            is_hit = False
            for alias in aliases:
                if allow_hit and any(_fault_name_hit(alias, h) for h in hit_names):
                    is_hit = True
                for pn, pct in prob_map.items():
                    if _fault_name_hit(alias, pn):
                        matched_prob = max(matched_prob, pct)
                        if allow_hit and pct >= 15:
                            is_hit = True
            if use_explicit:
                in_model = any(_fault_name_hit(alias, c) for alias in aliases for c in explicit)
            else:
                in_model = True

            if is_hit and in_model:
                status = "hit"
                hit_count += 1
                covered_count += 1
            elif in_model:
                status = "covered"
                covered_count += 1
            else:
                status = "gap"

            hint = None
            if status == "hit":
                hint = f"本次倾向 {matched_prob}%" if matched_prob else "与当前预测类型匹配"
            elif status == "gap":
                hint = "本设备类型暂未启用该诊断模型"
            items_out.append(
                {
                    "key": raw["key"],
                    "name": name,
                    "status": status,
                    "prob": matched_prob or None,
                    "hint": hint,
                }
            )
        groups_out.append(
            {
                "key": group["key"],
                "label": group["label"],
                "desc": group["desc"],
                "items": items_out,
            }
        )

    ordered: list[str] = []
    seen: set[str] = set()
    for status_pref in ("hit", "covered"):
        for g in groups_out:
            for it in g["items"]:
                if it["status"] == status_pref and it["name"] not in seen:
                    seen.add(it["name"])
                    ordered.append(it["name"])

    wall = {
        "summary": f"已覆盖 {covered_count} 类 · 本次命中 {hit_count} 类",
        "hit_count": hit_count,
        "covered_count": covered_count,
        "groups": groups_out,
    }
    return {"fault_coverage_wall": wall, "model_coverage": ordered or explicit}


def _project_current_story(device: dict) -> dict[str, Any]:
    """现状诊断故事：异常区间 + ①②③ 事件时间线（API 投影，不强制改 catalog）。"""
    cur = device.get("current") or {}
    if cur.get("timeline_events"):
        return {
            "anomaly_windows": cur.get("anomaly_windows") or [],
            "timeline_events": cur["timeline_events"],
        }

    st = device.get("analysis_status", "normal")
    band = cur.get("band_trend") or {}
    points: list[dict] = list(band.get("points") or [])
    if not points:
        # 退化：取 trend_24h 第一条序列
        for series in (cur.get("trend_24h") or {}).values():
            if series:
                points = list(series)
                break
    n = len(points)
    band_high = float(band.get("band_high") or 0)
    band_low = float(band.get("band_low") or 0)
    metric_label = band.get("label") or "关键测点"
    unit = band.get("unit") or ""

    def _label_at(idx: int) -> str:
        if 0 <= idx < n:
            return str(points[idx].get("label") or f"#{idx}")
        return "—"

    # 1) 超正常带上沿 → 异常窗；否则对关注/异常设备合成「抬升关注」窗
    windows: list[dict[str, Any]] = []
    if n and band_high > 0:
        over = [i for i, p in enumerate(points) if float(p.get("value") or 0) > band_high]
        if over:
            start, end = over[0], over[-1]
            # 合并连续段：取最长一段
            best = (start, end)
            run_s = over[0]
            prev = over[0]
            for i in over[1:]:
                if i == prev + 1:
                    prev = i
                    continue
                if prev - run_s > best[1] - best[0]:
                    best = (run_s, prev)
                run_s, prev = i, i
            if prev - run_s > best[1] - best[0]:
                best = (run_s, prev)
            start, end = best
            level = "alarm" if st == "abnormal" else "warn"
            windows.append(
                {
                    "start_index": start,
                    "end_index": end,
                    "start_label": _label_at(start),
                    "end_label": _label_at(end),
                    "level": level,
                    "label": "超正常带" if level == "alarm" else "偏高关注",
                }
            )
        elif st in ("abnormal", "watch") and n >= 3:
            start = max(0, n - max(3, n // 3))
            end = n - 1
            windows.append(
                {
                    "start_index": start,
                    "end_index": end,
                    "start_label": _label_at(start),
                    "end_label": _label_at(end),
                    "level": "warn" if st == "watch" else "alarm",
                    "label": "短窗抬升" if st == "watch" else "异常抬升",
                }
            )

    # 2) ①②③ 事件
    events: list[dict[str, Any]] = []
    causes = cur.get("causes") or []
    primary_cause = causes[0]["name"] if causes else None
    actions = cur.get("action_steps") or []
    first_action = actions[0] if actions else None
    triggers = cur.get("triggers") or []
    win = windows[0] if windows else None
    mid_idx = ((win["start_index"] + win["end_index"]) // 2) if win else max(0, n - 1)
    start_idx = win["start_index"] if win else 0
    end_idx = win["end_index"] if win else max(0, n - 1)

    if st == "normal":
        events = [
            {
                "step": 1,
                "at_index": 0,
                "at_label": _label_at(0) if n else "近窗",
                "kind": "observe",
                "title": "例行采样",
                "detail": f"{metric_label}在正常带内（{band_low}～{band_high}{unit}）。",
            },
            {
                "step": 2,
                "at_index": max(0, n // 2),
                "at_label": _label_at(max(0, n // 2)) if n else "近窗",
                "kind": "observe",
                "title": "健康复核",
                "detail": cur.get("one_liner") or "未见短窗偏离，维持常规巡检。",
            },
            {
                "step": 3,
                "at_index": max(0, n - 1),
                "at_label": _label_at(max(0, n - 1)) if n else "此刻",
                "kind": "recover",
                "title": "保持观察",
                "detail": "无需升级处置；若出现多源同向偏离将自动升为关注。",
            },
        ]
    elif st == "watch":
        events = [
            {
                "step": 1,
                "at_index": start_idx,
                "at_label": _label_at(start_idx) if n else "近窗",
                "kind": "alert",
                "title": "短窗偏离升高",
                "detail": "、".join(triggers) if triggers else f"{metric_label}相对基线抬升，进入关注带。",
            },
            {
                "step": 2,
                "at_index": mid_idx,
                "at_label": _label_at(mid_idx) if n else "近窗",
                "kind": "diagnose",
                "title": "加密观察",
                "detail": cur.get("one_liner")
                or (f"疑似 {primary_cause}" if primary_cause else "尚未触发硬报警，建议本班重点看。"),
            },
            {
                "step": 3,
                "at_index": end_idx,
                "at_label": _label_at(end_idx) if n else "此刻",
                "kind": "action",
                "title": "建议动作",
                "detail": first_action
                or "若 4～8h 内继续抬升，升级为异常并预留检修窗口。",
            },
        ]
    else:  # abnormal
        events = [
            {
                "step": 1,
                "at_index": start_idx,
                "at_label": _label_at(start_idx) if n else "近窗",
                "kind": "alert",
                "title": "系统告警",
                "detail": "、".join(triggers)
                if triggers
                else f"{metric_label}超出正常带，已生成告警。",
            },
            {
                "step": 2,
                "at_index": mid_idx,
                "at_label": _label_at(mid_idx) if n else "近窗",
                "kind": "diagnose",
                "title": "诊断结论",
                "detail": (
                    f"主因倾向：{primary_cause}（{causes[0].get('prob')}%）。"
                    if primary_cause
                    else (cur.get("one_liner") or "多测点同向异常，须机旁确认。")
                ),
            },
            {
                "step": 3,
                "at_index": end_idx,
                "at_label": _label_at(end_idx) if n else "此刻",
                "kind": "action",
                "title": "建议处置",
                "detail": first_action
                or (cur.get("worsen_if_ignored") or {}).get("summary")
                or "机旁确认后安排窗口检修，避免非计划停机。",
            },
        ]

    return {"anomaly_windows": windows, "timeline_events": events}


def _project_current_diagnostics(device: dict) -> dict[str, Any]:
    """现状 · 诊断依据深度：频谱 / 特征频段 / 阶次 / 瀑布伪彩（可扩展，API 投影）。"""
    cur = device.get("current") or {}
    if cur.get("diagnostics"):
        return {"diagnostics": cur["diagnostics"]}

    st = device.get("analysis_status", "normal")
    did = str(device.get("id") or "EQ")
    rng = random.Random(f"diag-{did}")
    # 示范转速：空压机偏高速，注塑机偏低
    rpm = 2980 if "C0" in did else 1450 if "P0" in did else 1800 + rng.randint(0, 200)
    f0 = round(rpm / 60.0, 2)

    def _noise(scale: float = 1.0) -> float:
        return (rng.random() - 0.5) * 2 * scale

    def _spectrum_channel(kind: str, boost_2x: float, boost_1x: float = 1.0) -> dict[str, Any]:
        # 0～400 Hz，步进 1 Hz；峰值落在 1×/2×/3× 与轴承相关虚频
        points: list[dict[str, float]] = []
        for i in range(0, 401):
            f = float(i)
            amp = 0.08 + abs(_noise(0.04))
            # 1× 不平衡
            amp += boost_1x * 1.35 * math.exp(-((f - f0) ** 2) / (2 * 1.8**2))
            # 2× 不对中
            amp += boost_2x * 1.55 * math.exp(-((f - 2 * f0) ** 2) / (2 * 2.2**2))
            # 3× 弱谐波
            amp += 0.35 * boost_1x * math.exp(-((f - 3 * f0) ** 2) / (2 * 2.5**2))
            if st == "abnormal" and kind == "rad":
                # 轴承外圈虚频 ~3.6×
                bpfo = 3.6 * f0
                amp += 0.95 * math.exp(-((f - bpfo) ** 2) / (2 * 2.0**2))
            if st == "watch" and kind == "rad":
                amp += 0.25 * math.exp(-((f - f0) ** 2) / (2 * 3.0**2))
            points.append({"f": f, "amp": round(max(0.02, amp + _noise(0.02)), 3)})
        label = {"rad": "径向", "ax": "轴向", "tan": "切向"}.get(kind, kind)
        return {"code": kind, "label": label, "unit": "mm/s", "points": points}

    if st == "abnormal":
        boost_2x, boost_1x = 3.2, 1.15
        summary = "频谱 2× 分量显著抬升，特征频段「不对中」越限；瀑布图同频段近窗持续增强。"
    elif st == "watch":
        boost_2x, boost_1x = 1.15, 1.55
        summary = "1× 略抬、2× 未硬越限；建议对照温升/单耗短窗，尚未构成硬报警。"
    else:
        boost_2x, boost_1x = 0.55, 0.85
        summary = "频谱峰形稳定，特征频段均在限值内，可作为同型健康参考波形。"

    channels = [
        _spectrum_channel("rad", boost_2x, boost_1x),
        _spectrum_channel("ax", boost_2x * 0.72, boost_1x * 0.9),
    ]

    def _band(name: str, order: float, amp: float, limit: float, status: str, note: str) -> dict:
        return {
            "name": name,
            "order": order,
            "freq_hz": round(order * f0, 2),
            "amp": round(amp, 2),
            "limit": limit,
            "unit": "mm/s",
            "status": status,
            "note": note,
        }

    if st == "abnormal":
        bands = [
            _band("不平衡(1×)", 1, 1.6 + rng.random() * 0.3, 2.5, "normal", "1× 在限内"),
            _band("不对中(2×)", 2, 4.6 + rng.random() * 0.5, 2.5, "abnormal", "2× 越限，主诊断依据"),
            _band("松动(3×)", 3, 1.1 + rng.random() * 0.2, 2.0, "watch", "3× 偏高，次要关注"),
            _band("轴承外圈(~3.6×)", 3.6, 2.8 + rng.random() * 0.3, 2.2, "abnormal", "与磨损候选一致"),
            _band("叶片通过", 8, 0.6 + rng.random() * 0.15, 1.8, "normal", "气动相关峰正常"),
        ]
    elif st == "watch":
        bands = [
            _band("不平衡(1×)", 1, 2.1 + rng.random() * 0.2, 2.5, "watch", "1× 接近限值"),
            _band("不对中(2×)", 2, 1.4 + rng.random() * 0.2, 2.5, "normal", "2× 未越限"),
            _band("松动(3×)", 3, 0.7 + rng.random() * 0.15, 2.0, "normal", "—"),
            _band("轴承外圈(~3.6×)", 3.6, 0.9 + rng.random() * 0.1, 2.2, "normal", "—"),
            _band("过程残差", 0, 1.3 + rng.random() * 0.2, 2.0, "watch", "与温升/单耗同向"),
        ]
    else:
        bands = [
            _band("不平衡(1×)", 1, 0.9 + rng.random() * 0.2, 2.5, "normal", "健康参考"),
            _band("不对中(2×)", 2, 0.7 + rng.random() * 0.15, 2.5, "normal", "—"),
            _band("松动(3×)", 3, 0.4 + rng.random() * 0.1, 2.0, "normal", "—"),
            _band("轴承外圈(~3.6×)", 3.6, 0.5 + rng.random() * 0.1, 2.2, "normal", "—"),
            _band("叶片通过", 8, 0.45 + rng.random() * 0.1, 1.8, "normal", "—"),
        ]

    orders = []
    for o in (1, 2, 3, 4, 5):
        base = {1: 0.9, 2: 0.55, 3: 0.35, 4: 0.22, 5: 0.15}[o]
        if st == "abnormal" and o == 2:
            amp = 4.8 + rng.random() * 0.4
        elif st == "abnormal" and o == 3:
            amp = 1.2 + rng.random() * 0.2
        elif st == "watch" and o == 1:
            amp = 2.05 + rng.random() * 0.15
        else:
            amp = base * (1.1 if st != "normal" else 1.0) + abs(_noise(0.08))
        orders.append(
            {
                "order": o,
                "label": f"{o}×",
                "amp": round(amp, 2),
                "baseline": round(base, 2),
                "unit": "mm/s",
            }
        )

    # 瀑布：近 24 帧 × 频率抽稀（每 4 Hz），伪彩
    freq_step = 4
    freq_hz = list(range(0, 401, freq_step))
    time_n = 24
    time_labels = [f"-{(time_n - 1 - t) * 5}min" for t in range(time_n)]
    grid: list[list[float]] = []
    for t in range(time_n):
        # 异常机：后半窗 2× 抬升
        rise = 1.0
        if st == "abnormal":
            rise = 0.75 + 0.9 * (t / max(1, time_n - 1)) ** 1.4
        elif st == "watch":
            rise = 0.9 + 0.25 * (t / max(1, time_n - 1))
        row: list[float] = []
        for f in freq_hz:
            amp = 0.06 + abs(_noise(0.03))
            amp += boost_1x * 1.1 * rise * math.exp(-((f - f0) ** 2) / (2 * 3.5**2))
            amp += boost_2x * 1.3 * rise * math.exp(-((f - 2 * f0) ** 2) / (2 * 4.0**2))
            if st == "abnormal":
                amp += 0.7 * rise * math.exp(-((f - 3.6 * f0) ** 2) / (2 * 4.5**2))
            row.append(round(max(0.01, amp), 3))
        grid.append(row)

    # 多测点簇趋势（与对照四测点命名对齐）
    metric_trends = []
    for code, label, unit, base, sens in (
        ("vibration", "主机振动", "mm/s", 1.2 if st == "normal" else 2.0 if st == "watch" else 3.4, 0.35),
        ("temp", "轴承温度", "℃", 48 if st == "normal" else 56 if st == "watch" else 68, 0.25),
        ("current", "电机电流", "A", 82 if st == "normal" else 88 if st == "watch" else 96, 0.2),
        ("exhaust_temp", "排气温度", "℃", 70 if st == "normal" else 82 if st == "watch" else 98, 0.22),
    ):
        pts = []
        for i in range(24):
            drift = (i / 23) * sens * (1.6 if st == "abnormal" else 0.9 if st == "watch" else 0.15)
            pts.append(
                {
                    "label": f"-{(23 - i)}h" if i < 23 else "此刻",
                    "value": round(base + drift + _noise(0.08), 2),
                }
            )
        metric_trends.append({"code": code, "label": label, "unit": unit, "points": pts})

    # —— 四维诊断面板：平行坐标 / 降维聚类 / 多切片 FFT / 时频瀑布（样本级可联动）——
    feature_axes = [
        {"key": "vibration", "name": "主机振动"},
        {"key": "kurtosis", "name": "峭度"},
        {"key": "crest", "name": "峰值因子"},
        {"key": "amp_1x", "name": "1×幅值"},
        {"key": "amp_2x", "name": "2×幅值"},
        {"key": "amp_3x", "name": "3×幅值"},
        {"key": "bpfo", "name": "轴承外圈"},
        {"key": "temp", "name": "轴承温度"},
        {"key": "current", "name": "电机电流"},
        {"key": "exhaust_temp", "name": "排气温度"},
    ]

    def _feat_vec(progress: float, cluster: str) -> list[float]:
        """0～100 量纲化特征，便于平行坐标同轴对比。"""
        n = abs(_noise(4))
        if cluster == "abnormal":
            return [
                round(62 + progress * 28 + n, 1),
                round(55 + progress * 30 + n, 1),
                round(48 + progress * 22 + n, 1),
                round(35 + progress * 18 + n, 1),
                round(70 + progress * 25 + n, 1),  # 2× 高
                round(40 + progress * 20 + n, 1),
                round(58 + progress * 28 + n, 1),
                round(50 + progress * 20 + n, 1),
                round(45 + progress * 15 + n, 1),
                round(60 + progress * 22 + n, 1),
            ]
        if cluster == "drift":
            return [
                round(38 + progress * 22 + n, 1),
                round(32 + progress * 18 + n, 1),
                round(30 + progress * 14 + n, 1),
                round(42 + progress * 20 + n, 1),  # 1× 偏高
                round(28 + progress * 12 + n, 1),
                round(22 + progress * 10 + n, 1),
                round(25 + progress * 12 + n, 1),
                round(40 + progress * 18 + n, 1),
                round(38 + progress * 14 + n, 1),
                round(34 + progress * 16 + n, 1),
            ]
        return [
            round(18 + progress * 8 + n, 1),
            round(15 + progress * 6 + n, 1),
            round(16 + progress * 5 + n, 1),
            round(20 + progress * 8 + n, 1),
            round(14 + progress * 6 + n, 1),
            round(12 + progress * 5 + n, 1),
            round(13 + progress * 5 + n, 1),
            round(22 + progress * 8 + n, 1),
            round(24 + progress * 6 + n, 1),
            round(17 + progress * 7 + n, 1),
        ]

    def _pca_xy(cluster: str, progress: float) -> list[float]:
        if cluster == "abnormal":
            return [round(-2.4 + _noise(0.35) - progress * 0.2, 3), round(0.8 + _noise(0.45), 3)]
        if cluster == "drift":
            return [round(0.2 + progress * 1.1 + _noise(0.3), 3), round(-0.4 + _noise(0.35), 3)]
        return [round(2.2 + _noise(0.4), 3), round(-0.2 + _noise(0.5), 3)]

    samples: list[dict[str, Any]] = []
    sid = 0
    for t in range(time_n):
        progress = t / max(1, time_n - 1)
        # 每时间步 4 个样本：正常机几乎全 normal；异常机后半窗增多 abnormal
        for k in range(4):
            if st == "abnormal":
                if t >= 16 or (t >= 10 and k >= 2):
                    cluster = "abnormal"
                elif t >= 6 and k >= 2:
                    cluster = "drift"
                else:
                    cluster = "normal"
            elif st == "watch":
                cluster = "drift" if (t >= 12 and k >= 1) or (t >= 18) else "normal"
            else:
                cluster = "normal"
            samples.append(
                {
                    "id": sid,
                    "t_idx": t,
                    "time_label": time_labels[t],
                    "cluster": cluster,
                    "features": _feat_vec(progress, cluster),
                    "pca": _pca_xy(cluster, progress),
                }
            )
            sid += 1

    def _fft_slice(t_idx: int, label: str, sample_id: int) -> dict[str, Any]:
        rise = 1.0
        if st == "abnormal":
            rise = 0.75 + 0.9 * (t_idx / max(1, time_n - 1)) ** 1.4
        elif st == "watch":
            rise = 0.9 + 0.25 * (t_idx / max(1, time_n - 1))
        pts: list[dict[str, float]] = []
        step = 2
        for i in range(0, 401, step):
            f = float(i)
            amp = 0.06 + abs(_noise(0.03))
            amp += boost_1x * 1.2 * rise * math.exp(-((f - f0) ** 2) / (2 * 2.0**2))
            amp += boost_2x * 1.4 * rise * math.exp(-((f - 2 * f0) ** 2) / (2 * 2.4**2))
            amp += 0.4 * boost_1x * rise * math.exp(-((f - 3 * f0) ** 2) / (2 * 2.8**2))
            if st == "abnormal":
                amp += 0.85 * rise * math.exp(-((f - 3.6 * f0) ** 2) / (2 * 2.2**2))
            pts.append({"f": f, "amp": round(max(0.02, amp), 3)})
        # 标峰：取局部最大附近的特征频
        peak_fs = [f0, 2 * f0] + ([3.6 * f0] if st == "abnormal" else [])
        peaks = []
        for pf in peak_fs:
            nearest = min(pts, key=lambda p: abs(p["f"] - pf))
            peaks.append(
                {
                    "f": nearest["f"],
                    "amp": nearest["amp"],
                    "label": f"{nearest['f']:.0f}Hz · {nearest['amp']}",
                }
            )
        return {
            "sample_id": sample_id,
            "t_idx": t_idx,
            "time_label": label,
            "unit": "mm/s",
            "points": pts,
            "peaks": peaks,
        }

    # 默认三切片：早 / 中 / 晚
    slice_idxs = [2, time_n // 2, time_n - 1]
    fft_slices = []
    for ti in slice_idxs:
        # 取该时间步第一个样本 id
        sample_id = next(s["id"] for s in samples if s["t_idx"] == ti)
        fft_slices.append(_fft_slice(ti, time_labels[ti], sample_id))

    cluster_counts = {"normal": 0, "drift": 0, "abnormal": 0}
    for s in samples:
        cluster_counts[s["cluster"]] = cluster_counts.get(s["cluster"], 0) + 1

    multidim_panel = {
        "title": "高维特征与时频联动",
        "overview": (
            "平行坐标锁定同步异动特征，PCA 看样本相对基线的簇漂移，"
            "FFT / 瀑布交叉验证异常频段是否随时间抬升；框选与刷选可反查同源样本。"
        ),
        "method_note": "PCA 为示意降维，无物理单位；点距表示特征向量相似度，可作后期模型样本索引。",
        "feature_axes": feature_axes,
        "samples": samples,
        "cluster_legend": [
            {"key": "normal", "label": "正常基线", "color": "#1677ff"},
            {"key": "drift", "label": "早期漂移", "color": "#52c41a"},
            {"key": "abnormal", "label": "故障/劣化", "color": "#cf1322"},
        ],
        "cluster_counts": cluster_counts,
        "fft_slices": fft_slices,
        "waterfall": {
            "freq_hz": freq_hz,
            "time_labels": time_labels,
            "grid": grid,
            "unit": "mm/s",
            "highlight_freq_hz": round(2 * f0, 2) if st == "abnormal" else f0,
        },
        "f0_hz": f0,
        "rpm": rpm,
    }

    diagnostics = {
        "summary": summary,
        "rpm": rpm,
        "f0_hz": f0,
        "channels": channels,
        "markers": [
            {"f": f0, "label": "1×", "kind": "order"},
            {"f": round(2 * f0, 2), "label": "2×", "kind": "order"},
            {"f": round(3 * f0, 2), "label": "3×", "kind": "order"},
        ],
        "characteristic_bands": bands,
        "order_spectrum": orders,
        "waterfall": {
            "freq_hz": freq_hz,
            "time_labels": time_labels,
            "grid": grid,
            "unit": "mm/s",
            "highlight_freq_hz": round(2 * f0, 2) if st == "abnormal" else f0,
            "caption": "频率 × 时间 · 幅值伪彩（近 2h，每 5min）",
        },
        "metric_trends": metric_trends,
        "multidim_panel": multidim_panel,
    }
    return {"diagnostics": diagnostics}


def _project_metric_forecasts(device: dict) -> dict[str, Any]:
    """分析 Tab：四参数多周期。实测窗=所选周期；轴再后延 1/3，延长期实测为空、预测有值。"""
    cur = device.get("current") or {}
    if cur.get("metric_forecasts_by_period"):
        return {
            "metric_forecasts_by_period": cur["metric_forecasts_by_period"],
            "metric_forecasts": cur.get("metric_forecasts")
            or (cur["metric_forecasts_by_period"].get("month") or []),
            "metric_chart": cur.get("metric_chart")
            or {
                "title": "关键参数 · 实测 vs 预测",
                "period_options": [
                    {"value": "week", "label": "周"},
                    {"value": "month", "label": "月"},
                    {"value": "quarter", "label": "季"},
                    {"value": "year", "label": "年"},
                ],
                "default_period": "month",
                "note": "实线=实测，虚线=预测；图例按参数合并。预测轴=所选周期×4/3（后 1/3 仅预测）。",
            },
        }

    st = device.get("analysis_status", "normal")
    did = str(device.get("id") or "EQ")
    rng = random.Random(f"mf-{did}")
    rt = device.get("realtime") or {}
    fut = device.get("future") or {}

    # 周期：实测点数 + 后延 1/3（向上取整）
    period_defs = {
        "week": {"actual_n": 7, "step": "日", "label_fmt": lambda i, n: f"D{i + 1}"},
        "month": {"actual_n": 30, "step": "日", "label_fmt": lambda i, n: f"D{i + 1}"},
        "quarter": {"actual_n": 13, "step": "周", "label_fmt": lambda i, n: f"W{i + 1}"},
        "year": {"actual_n": 12, "step": "月", "label_fmt": lambda i, n: f"M{i + 1}"},
    }

    base_v = float(rt.get("vibration") or rt.get("V") or rt.get("vib") or rt.get("vib_rms") or 2.2)
    base_bt = float(rt.get("temp") or rt.get("T") or rt.get("bearing_temp") or 55)
    base_i = float(rt.get("current") or rt.get("I") or rt.get("motor_i") or 86)
    base_et = float(rt.get("exhaust_temp") or rt.get("T_out") or (base_bt + 18))

    if st == "abnormal":
        drifts = {"vibration": 0.35, "temp": 0.18, "current": 0.12, "exhaust_temp": 0.16}
        bias = {"vibration": 0.12, "temp": 0.08, "current": 0.05, "exhaust_temp": 0.07}
        status_map = {
            "vibration": "abnormal",
            "temp": "abnormal",
            "current": "watch",
            "exhaust_temp": "watch",
        }
        judgments = {
            "vibration": "主机振动实测偏高；同窗预测同步抬升，与不对中/轴承证据同向。",
            "temp": "轴承温度实测偏高；预测同向逼近关注带。",
            "current": "电机电流偏高；预测缓升，建议对照负荷。",
            "exhaust_temp": "排气温度偏高；与轴承温升同向，关注冷却与负荷。",
        }
    elif st == "watch":
        drifts = {"vibration": 0.12, "temp": 0.1, "current": 0.06, "exhaust_temp": 0.08}
        bias = {"vibration": 0.05, "temp": 0.04, "current": 0.03, "exhaust_temp": 0.04}
        status_map = {
            "vibration": "watch",
            "temp": "watch",
            "current": "watch",
            "exhaust_temp": "normal",
        }
        judgments = {
            "vibration": "主机振动轻抬；预测同窗缓升，尚未硬越限。",
            "temp": "轴承温升关注；与单耗同向。",
            "current": "电机电流接近基线上限；预测缓升。",
            "exhaust_temp": "排气温度基本平稳。",
        }
    else:
        drifts = {"vibration": 0.04, "temp": 0.03, "current": 0.02, "exhaust_temp": 0.03}
        bias = {"vibration": 0.02, "temp": 0.015, "current": 0.01, "exhaust_temp": 0.015}
        status_map = {
            "vibration": "normal",
            "temp": "normal",
            "current": "normal",
            "exhaust_temp": "normal",
        }
        judgments = {
            "vibration": "主机振动平稳；预测与实测吻合，可作健康参考。",
            "temp": "轴承温度稳定。",
            "current": "电机电流平稳。",
            "exhaust_temp": "排气温度稳定。",
        }

    specs = [
        ("vibration", "主机振动", "mm/s", base_v),
        ("temp", "轴承温度", "℃", base_bt),
        ("current", "电机电流", "A", base_i),
        ("exhaust_temp", "排气温度", "℃", base_et),
    ]

    def _build_period(period_key: str) -> list[dict[str, Any]]:
        cfg = period_defs[period_key]
        actual_n = int(cfg["actual_n"])
        extend_n = max(1, (actual_n + 2) // 3)  # 后延约 1/3
        total_n = actual_n + extend_n
        time_labels = [cfg["label_fmt"](i, total_n) for i in range(total_n)]
        out: list[dict[str, Any]] = []
        for code, label, unit, base in specs:
            drift = drifts[code] * base
            pred_bias = bias[code] * base
            actual: list[dict[str, Any]] = []
            forecast: list[dict[str, Any]] = []
            last_a = base
            for i, lab in enumerate(time_labels):
                t = i / max(1, total_n - 1)
                noise_a = (rng.random() - 0.5) * 0.06 * base
                noise_f = (rng.random() - 0.5) * 0.05 * base
                a_val = base * (0.96 if st == "normal" else 0.9) + drift * t + noise_a
                if st == "abnormal":
                    f_val = a_val + pred_bias + drift * 0.35 * t + noise_f
                else:
                    f_val = a_val * (1.0 + pred_bias / max(base, 1e-6)) + drift * 0.2 * t + noise_f
                # 后延段：实测无数据；预测继续外推
                if i >= actual_n:
                    actual.append({"label": lab, "value": None, "kind": "actual"})
                    # 从实测末点外推
                    t_ext = (i - actual_n + 1) / max(1, extend_n)
                    f_val = last_a + pred_bias + drift * (0.5 + 0.5 * t_ext) + noise_f
                    if st == "abnormal":
                        f_val = last_a + pred_bias * (1.2 + t_ext) + drift * 0.4 * t_ext + noise_f
                else:
                    last_a = a_val
                    actual.append({"label": lab, "value": round(max(0.01, a_val), 2), "kind": "actual"})
                forecast.append({"label": lab, "value": round(max(0.01, f_val), 2), "kind": "forecast"})
            valid_actual = [p["value"] for p in actual if p["value"] is not None]
            last_valid = valid_actual[-1] if valid_actual else base
            out.append(
                {
                    "code": code,
                    "label": label,
                    "unit": unit,
                    "status": status_map[code],
                    "actual": actual,
                    "forecast_7d": forecast,
                    "forecast_long": forecast,
                    "band_low": round(float(last_valid) * 0.85, 2),
                    "band_high": round(float(last_valid) * (1.15 if st == "abnormal" else 1.1), 2),
                    "judgment": judgments[code],
                    "horizon_note": (
                        f"周期={period_key}：实测 {actual_n}{cfg['step']}；"
                        f"预测轴共 {total_n}{cfg['step']}（后延 {extend_n}{cfg['step']} 无实测）。"
                    ),
                    "risk_hint": fut.get("alert_label") or fut.get("likely_fault"),
                    "actual_n": actual_n,
                    "extend_n": extend_n,
                    "total_n": total_n,
                }
            )
        return out

    by_period = {k: _build_period(k) for k in period_defs}
    return {
        "metric_forecasts": by_period["month"],
        "metric_forecasts_by_period": by_period,
        "metric_chart": {
            "title": "关键参数 · 实测 vs 预测",
            "period_options": [
                {"value": "week", "label": "周"},
                {"value": "month", "label": "月"},
                {"value": "quarter", "label": "季"},
                {"value": "year", "label": "年"},
            ],
            "default_period": "month",
            "note": (
                "图例按参数合并（实线=实测，虚线=预测）。"
                "所选周期为实测窗；预测自动后延约 1/3（如年→再加 4 个月），延长期实测为空。"
            ),
        },
    }


def _project_future_attribution(device: dict) -> dict[str, Any]:
    """Phase 2：故障归因投影（规则版，可替换为 SHAP）。"""
    f = device.get("future") or {}
    if f.get("attribution_top3") and f.get("degradation_ratio") is not None:
        top3 = f["attribution_top3"]
        primary = top3[0].get("text") or top3[0].get("name", "—") if top3 else "—"
        return {
            "attribution_top3": top3,
            "degradation_ratio": f["degradation_ratio"],
            "degradation_week": f.get("degradation_week") or [],
            "degradation_label": f.get("degradation_label")
            or f"较上周 ×{f['degradation_ratio']}",
            "residual_score": int(f.get("residual_score", 0)),
            "residual_label": f.get("residual_label") or "—",
            "primary_cause": f.get("primary_cause") or primary,
        }

    rt = device.get("realtime") or {}
    current = device.get("current") or {}
    st = device.get("analysis_status", "normal")
    device_id = device.get("id", "unknown")

    metric_rules: list[tuple[str, str, Any]] = [
        ("vibration", "主机振动", lambda v: max(0.0, (float(v) - 2.5) * 15)),
        ("temp", "轴承温度", lambda v: max(0.0, (float(v) - 70) * 2.5)),
        ("current", "电机电流", lambda v: max(0.0, (float(v) - 80) * 1.2)),
        ("exhaust_temp", "排气温度", lambda v: max(0.0, (float(v) - 100) * 1.5)),
    ]
    raw_scores: list[dict[str, Any]] = []
    for code, label, scorer in metric_rules:
        if code not in rt:
            continue
        val = float(rt[code])
        score = scorer(val)
        if score > 5:
            unit = (
                " mm/s"
                if code == "vibration"
                else "℃"
                if code in ("temp", "exhaust_temp")
                else " A"
                if code == "current"
                else ""
            )
            raw_scores.append(
                {
                    "metric": code,
                    "name": label,
                    "score": score,
                    "text": f"{label}偏高（当前 {val:g}{unit}）",
                }
            )

    if not raw_scores:
        raw_scores = [
            {
                "metric": "baseline",
                "name": "基线波动",
                "score": 15.0 if st != "normal" else 8.0,
                "text": "多参数轻微偏离基线",
            }
        ]
    raw_scores.sort(key=lambda x: x["score"], reverse=True)
    top = raw_scores[:3]
    total = sum(x["score"] for x in top) or 1.0
    attribution_top3 = [
        {
            "metric": x["metric"],
            "name": x["name"],
            "contribution_pct": round(x["score"] / total * 100, 1),
            "text": x["text"],
        }
        for x in top
    ]

    rng = _trend_rng("future", f"degrad:{device_id}")
    if st == "abnormal":
        degradation_ratio = round(rng.uniform(2.2, 4.8), 1)
    elif st == "watch":
        degradation_ratio = round(rng.uniform(1.3, 2.2), 1)
    else:
        degradation_ratio = round(rng.uniform(0.8, 1.2), 1)

    week_n = 7
    degradation_week: list[float] = []
    for i in range(week_n):
        t = i / max(week_n - 1, 1)
        base = 1.0 + (degradation_ratio - 1.0) * t
        jitter = rng.uniform(-0.06, 0.06)
        degradation_week.append(round(max(0.5, base + jitter), 2))
    degradation_week[-1] = degradation_ratio

    deviation = int(current.get("deviation_score") or (88 if st == "abnormal" else 52 if st == "watch" else 12))
    residual_score = min(100, deviation)
    if residual_score >= 60:
        residual_label = "偏高"
    elif residual_score >= 35:
        residual_label = "关注"
    else:
        residual_label = "正常"

    accel_hint = "（劣化加速）" if degradation_ratio >= 1.8 else ""
    primary_cause = attribution_top3[0]["text"] if attribution_top3 else f.get("likely_fault", "—")

    return {
        "attribution_top3": attribution_top3,
        "degradation_ratio": degradation_ratio,
        "degradation_week": degradation_week,
        "degradation_label": f"较上周 ×{degradation_ratio}{accel_hint}",
        "residual_score": residual_score,
        "residual_label": residual_label,
        "primary_cause": primary_cause,
    }


def _future_list_fields(device: dict) -> dict[str, Any]:
    if not device.get("future"):
        return {}
    projected = _project_future_metrics(device)
    f = device["future"]
    # 列表只带摘要字段，避免把 similar_cases 打满表格载荷
    return {
        "risk_24h": projected["risk_24h"],
        "risk_72h": projected["risk_72h"],
        "risk_7d": projected["risk_7d"],
        "rul_days": projected["rul_days"],
        "rul_ci": projected["rul_ci"],
        "rul_range_label": projected["rul_range_label"],
        "health_index": projected["health_index"],
        "health_band": projected["health_band"],
        "alert_level": projected["alert_level"],
        "alert_label": projected["alert_label"],
        "confidence": projected["confidence"],
        "confidence_label": projected["confidence_label"],
        "data_valid": projected["data_valid"],
        "data_valid_reason": projected["data_valid_reason"],
        "prediction_paused": projected["prediction_paused"],
        "maintain_by": projected["maintain_by"],
        "likely_fault": projected["likely_fault"],
        "review_required": projected["review_required"],
        "primary_cause": projected.get("primary_cause"),
        "degradation_ratio": projected.get("degradation_ratio"),
        "degradation_label": projected.get("degradation_label"),
        "residual_score": projected.get("residual_score"),
        "downtime_planned_h": projected.get("downtime_planned_h"),
        "downtime_unplanned_h": projected.get("downtime_unplanned_h"),
        "downtime_avoidable_h": projected.get("downtime_avoidable_h"),
        "downtime_planned_label": projected.get("downtime_planned_label"),
        "downtime_unplanned_label": projected.get("downtime_unplanned_label"),
        "downtime_avoidable_label": projected.get("downtime_avoidable_label"),
        "avoid_preview": f["avoid"][0] if f.get("avoid") else "",
    }


def _kpi_counts(devices: list[dict]) -> list[dict]:
    total = len(devices)
    abnormal = sum(1 for d in devices if d["analysis_status"] == "abnormal")
    watch = sum(1 for d in devices if d["analysis_status"] == "watch")
    normal_or_stop = total - abnormal - watch
    return [
        {"title": "设备总数", "value": total, "unit": "台"},
        {"title": "异常", "value": abnormal, "unit": "台"},
        {"title": "关注", "value": watch, "unit": "台"},
        {"title": "正常/其他", "value": normal_or_stop, "unit": "台"},
    ]


def _dept_descendant_ids(depts: list[dict], root_id: int) -> set[int]:
    """选中部门及其所有下级（与系统部门树一致）。"""
    ids = {root_id}
    changed = True
    while changed:
        changed = False
        for d in depts:
            pid = d.get("parent_id")
            if pid in ids and d["id"] not in ids:
                ids.add(d["id"])
                changed = True
    return ids


def _dept_label(depts: list[dict], dept_id: int | None) -> str:
    if dept_id is None:
        return "全部"
    for d in depts:
        if d["id"] == dept_id:
            return d["name"]
    return _dept_name(depts, dept_id, f"部门#{dept_id}")


def _scope_meta(depts: list[dict], dept_id: int | None) -> dict[str, Any]:
    return {
        "scope_dept_id": dept_id,
        "scope_label": _dept_label(depts, dept_id),
    }


def _filter_devices_by_dept(
    devices: list[dict], depts: list[dict], dept_id: int | None
) -> list[dict]:
    if dept_id is None:
        return devices
    allowed = _dept_descendant_ids(depts, dept_id)
    return [d for d in devices if d["dept_id"] in allowed]


def _dept_by_id(depts: list[dict]) -> dict[int, dict]:
    return {d["id"]: d for d in depts}


def _dept_chain(depts: list[dict], dept_id: int) -> list[int]:
    """从设备所属部门到根的路径（当前在前，根在后）。"""
    by_id = _dept_by_id(depts)
    chain: list[int] = []
    cur: int | None = dept_id
    while cur is not None and cur in by_id:
        chain.append(cur)
        cur = by_id[cur].get("parent_id")
    return chain


def _dept_depth(depts: list[dict], dept_id: int) -> int:
    return len(_dept_chain(depts, dept_id))


def _tree_max_depth(depts: list[dict]) -> int:
    return max(_dept_depth(depts, d["id"]) for d in depts) if depts else 1


def _is_leaf_dept(depts: list[dict], dept_id: int) -> bool:
    return not any(d.get("parent_id") == dept_id for d in depts)


def _root_dept_id(depts: list[dict]) -> int | None:
    for d in depts:
        if d.get("parent_id") is None:
            return d["id"]
    return None


def _ancestor_at_level(depts: list[dict], dept_id: int, level: int) -> int:
    chain = _dept_chain(depts, dept_id)
    if level < 1 or not chain:
        return dept_id
    if level > len(chain):
        return chain[0]
    return chain[len(chain) - level]


def _scope_subtree_max_depth(depts: list[dict], scope_dept_id: int | None) -> int:
    if scope_dept_id is None:
        return _tree_max_depth(depts)
    allowed = _dept_descendant_ids(depts, scope_dept_id)
    return max(_dept_depth(depts, d) for d in allowed)


def _scope_anchor_id(depts: list[dict], scope_dept_id: int | None) -> int | None:
    if scope_dept_id is None:
        return _root_dept_id(depts)
    return scope_dept_id


def _scoped_leaf_ids(depts: list[dict], scope_dept_id: int | None) -> list[int]:
    if scope_dept_id is None:
        allowed = {d["id"] for d in depts}
    else:
        allowed = _dept_descendant_ids(depts, scope_dept_id)
    return sorted(
        [did for did in allowed if _is_leaf_dept(depts, did)],
        key=lambda i: _dept_label(depts, i),
    )


def _resolve_group_by(depts: list[dict], scope_dept_id: int | None, group_by: str | None) -> str:
    mode = (group_by or "auto").strip()
    if mode not in {"auto", "leaves", "children", "self"}:
        mode = "auto"
    if mode != "auto":
        return mode
    root_id = _root_dept_id(depts)
    if scope_dept_id is None or scope_dept_id == root_id:
        return "leaves"
    if _is_leaf_dept(depts, scope_dept_id):
        return "self"
    return "children"


def _device_group_dept_id(
    depts: list[dict],
    device_dept_id: int,
    scope_dept_id: int | None,
    group_by: str,
) -> int:
    """设备按组织架构归组：默认挂在所属组织单元上。"""
    mode = _resolve_group_by(depts, scope_dept_id, group_by)
    anchor = _scope_anchor_id(depts, scope_dept_id)
    chain = _dept_chain(depts, device_dept_id)

    if mode == "leaves":
        return device_dept_id
    if mode == "self":
        return anchor if anchor is not None else device_dept_id
    if mode == "children":
        if anchor is None or anchor not in chain:
            return device_dept_id
        idx = chain.index(anchor)
        return chain[idx - 1] if idx > 0 else chain[0]
    return device_dept_id


GROUP_BY_LABELS: dict[str, str] = {
    "auto": "自动",
    "leaves": "按组织单元",
    "children": "按下级部门",
    "self": "本级汇总",
}


def _group_by_display_label(
    mode: str, depts: list[dict], scope_dept_id: int | None
) -> str:
    label = GROUP_BY_LABELS.get(mode, mode)
    if mode == "self" and scope_dept_id:
        return f"{label}（{_dept_label(depts, scope_dept_id)}）"
    return label


def _group_by_options(depts: list[dict], scope_dept_id: int | None) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = [{"value": "auto", "label": "自动"}]
    leaves = _scoped_leaf_ids(depts, scope_dept_id)
    if len(leaves) > 1:
        options.append({"value": "leaves", "label": "按组织单元"})
    if scope_dept_id is None or not _is_leaf_dept(depts, scope_dept_id):
        options.append({"value": "children", "label": "按下级部门"})
    if scope_dept_id is not None:
        options.append(
            {
                "value": "self",
                "label": f"本级汇总（{_dept_label(depts, scope_dept_id)}）",
            }
        )
    return options


def _group_by_meta(
    depts: list[dict],
    scope_dept_id: int | None,
    group_by_param: str | None,
) -> dict[str, Any]:
    resolved = _resolve_group_by(depts, scope_dept_id, group_by_param)
    display = _group_by_display_label(resolved, depts, scope_dept_id)
    options = _group_by_options(depts, scope_dept_id)
    return {
        "group_by": group_by_param or "auto",
        "group_by_resolved": resolved,
        "group_by_label": display,
        "group_by_options": options,
        # 兼容旧字段名
        "group_level": group_by_param or "auto",
        "group_level_label": display,
        "group_level_options": options,
    }


def _run_bucket(device: dict) -> str:
    """运行状态桶：与通信状态分离。"""
    rs = device.get("run_status", "stopped")
    if rs == "alarm":
        return "fault"
    if rs in {"running", "idle", "stopped"}:
        return rs
    return "stopped"


def _filter_devices(
    devices: list[dict],
    depts: list[dict],
    dept_id: int | None,
    device_type: str | None,
) -> list[dict]:
    out = _filter_devices_by_dept(devices, depts, dept_id)
    if device_type:
        out = [d for d in out if d.get("type") == device_type]
    return out


def _trend_points(
    catalog: dict, allowed_dept_ids: set[int] | None
) -> list[dict[str, Any]]:
    raw = catalog.get("fleet_abnormal_trend_7d") or []
    points: list[dict[str, Any]] = []
    for row in raw:
        by_dept = row.get("by_dept") or {}
        if allowed_dept_ids is None:
            value = sum(by_dept.values())
        else:
            value = sum(by_dept.get(d, 0) for d in allowed_dept_ids)
        points.append({"label": row["label"], "value": value})
    return points


STATUS_TREND_PERIODS: dict[str, dict[str, Any]] = {
    "week": {
        "labels": ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
        "days": 7,
        "tick_indices": [0, 1, 2, 3, 4, 5, 6],
    },
    "month": {
        "labels": ["第1周", "第2周", "第3周", "第4周"],
        "days": 30,
        "tick_indices": [0, 7, 14, 21, 29],
    },
    "quarter": {
        "labels": ["第1月", "第2月", "第3月"],
        "days": 90,
        "tick_indices": [0, 44, 89],
    },
    "year": {
        "labels": [f"{m}月" for m in range(1, 13)],
        "days": 365,
        "tick_indices": [int(364 * i / 11) for i in range(12)],
    },
}

# 指标波动幅度（设备总数 flat，其余更大起伏）
TREND_VOLATILITY: dict[str, float] = {
    "total": 0.0,
    "online": 0.06,
    "running": 0.12,
    "abnormal": 0.35,
    "watch": 0.32,
    "fault": 0.35,
    "type": 0.28,
    "dept_issue": 0.35,
}


def _trend_rng(period_key: str, series_key: str) -> random.Random:
    seed = hash((period_key, series_key)) & 0xFFFFFFFF
    return random.Random(seed)


def _day_labels(day_count: int) -> list[str]:
    """按天生成 X 轴刻度（最后一天对齐 Demo 快照日）。"""
    end = date(2026, 8, 27)
    return [
        (end - timedelta(days=day_count - 1 - i)).strftime("%m-%d") for i in range(day_count)
    ]


def _period_axis(period_key: str) -> dict[str, Any]:
    cfg = STATUS_TREND_PERIODS[period_key]
    days = int(cfg["days"])
    labels: list[str] = cfg["labels"]
    tick_indices: list[int] = cfg["tick_indices"]
    # month 配置 5 个 tick 位置对应 4 个周标签：取前 4 个位置
    if period_key == "month" and len(tick_indices) > len(labels):
        tick_indices = tick_indices[: len(labels)]
    return {
        "labels": labels,
        "day_labels": _day_labels(days),
        "tick_indices": tick_indices,
    }


def _trend_payload(
    period_key: str,
    series: list[dict[str, Any]],
    summary: str | None = None,
) -> dict[str, Any]:
    payload = {**_period_axis(period_key), "series": series}
    if summary:
        payload["summary"] = summary
    return payload


def _jitter_multipliers(period_key: str, series_key: str, n: int, volatility: float) -> list[float]:
    """生成有界波动系数；末点为 1.0（对齐当前快照）。"""
    if n <= 0:
        return []
    if volatility <= 0:
        return [1.0] * n
    rng = _trend_rng(period_key, series_key)
    if n == 1:
        return [1.0]

    low = max(0.0, 1.0 - volatility)
    high = 1.0 + volatility
    step = volatility * 0.15
    level = rng.uniform(low, high)
    mults: list[float] = []
    for _ in range(n - 1):
        level += rng.uniform(-step, step)
        level = max(low, min(high, level))
        mults.append(level)

    # 末点对齐 1.0，整体缩放并再次钳制，避免除以小数爆炸
    end = mults[-1] if mults else 1.0
    if abs(end) < 1e-6:
        end = 1.0
    mults = [max(low, min(high, m / end)) for m in mults]
    mults.append(1.0)
    return mults


def _volatile_series(
    base: int,
    period_key: str,
    series_key: str,
    *,
    volatility: float | None = None,
    flat: bool = False,
    cap: int | None = None,
) -> list[int]:
    n = int(STATUS_TREND_PERIODS[period_key]["days"])
    if base <= 0:
        return [0] * n
    if flat or series_key == "total" or (volatility is not None and volatility <= 0):
        return [base] * n
    vol = volatility if volatility is not None else TREND_VOLATILITY.get(series_key, 0.3)
    mults = _jitter_multipliers(period_key, series_key, n, vol)
    upper = cap if cap is not None else max(base * 2, base + 1)
    values = [max(0, min(upper, int(round(base * m)))) for m in mults]
    values[-1] = min(base, upper)
    return values

STATUS_TREND_METRICS = [
    ("total", "设备总数"),
    ("online", "采集在线"),
    ("running", "运行中"),
    ("abnormal", "异常"),
    ("watch", "关注"),
    ("fault", "故障"),
]


def _device_metric_counts(devices: list[dict]) -> dict[str, int]:
    return {
        "total": len(devices),
        "online": sum(1 for d in devices if d.get("comm_status", "online") == "online"),
        "running": sum(1 for d in devices if _run_bucket(d) == "running"),
        "abnormal": sum(1 for d in devices if d["analysis_status"] == "abnormal"),
        "watch": sum(1 for d in devices if d["analysis_status"] == "watch"),
        "fault": sum(1 for d in devices if _run_bucket(d) == "fault"),
    }


_STATUS_TREND_CAPS: dict[str, str | None] = {
    "total": None,
    "online": "total",
    "running": "online",
    "abnormal": "total",
    "watch": "total",
    "fault": "total",
}


def _build_period_status_trend(counts: dict[str, int], period_key: str) -> dict[str, Any]:
    series: list[dict[str, Any]] = []
    for key, name in STATUS_TREND_METRICS:
        base = counts[key]
        flat = key == "total"
        cap_key = _STATUS_TREND_CAPS.get(key)
        cap = counts[cap_key] if cap_key else None
        values = _volatile_series(base, period_key, key, flat=flat, cap=cap)
        series.append({"key": key, "name": name, "values": values})
    return _trend_payload(period_key, series)


def _fleet_status_trends(devices: list[dict]) -> dict[str, Any]:
    counts = _device_metric_counts(devices)
    return {
        period: _build_period_status_trend(counts, period)
        for period in STATUS_TREND_PERIODS
    }


# 设备列表：组织归属旭日 / 桑基（与健康状态无关）
ORG_CHART_COLORS = [
    "#FFAE57",
    "#FF7853",
    "#EA5151",
    "#CC3F57",
    "#9A2555",
    "#5470c6",
    "#91cc75",
    "#73c0de",
]


def _fleet_org_sunburst(
    devices: list[dict], depts: list[dict], scope_dept_id: int | None
) -> list[dict[str, Any]]:
    """旭日：顶级/范围内根 → 下级部门 → … → 末级 → 设备类型（叶子 value=台数）。"""
    if not devices or not depts:
        return []

    by_id = _dept_by_id(depts)
    children_map: dict[int | None, list[int]] = {}
    for d in depts:
        children_map.setdefault(d.get("parent_id"), []).append(d["id"])

    # 末级部门 → 设备类型 → 台数
    leaf_types: dict[int, dict[str, int]] = {}
    for d in devices:
        did = d["dept_id"]
        typ = d.get("type") or "其他"
        leaf_types.setdefault(did, {})
        leaf_types[did][typ] = leaf_types[did].get(typ, 0) + 1

    # 子树是否含设备
    has_devices: dict[int, bool] = {}

    def subtree_has(dept_id: int) -> bool:
        if dept_id in has_devices:
            return has_devices[dept_id]
        if leaf_types.get(dept_id):
            has_devices[dept_id] = True
            return True
        ok = any(subtree_has(cid) for cid in children_map.get(dept_id, []))
        has_devices[dept_id] = ok
        return ok

    def build(dept_id: int, color: str, depth: int) -> dict[str, Any] | None:
        if not subtree_has(dept_id):
            return None
        name = by_id.get(dept_id, {}).get("name") or f"部门#{dept_id}"
        kids: list[dict[str, Any]] = []
        child_ids = sorted(
            children_map.get(dept_id, []),
            key=lambda cid: by_id.get(cid, {}).get("name") or "",
        )
        for i, cid in enumerate(child_ids):
            child_color = ORG_CHART_COLORS[(depth + i) % len(ORG_CHART_COLORS)] if depth == 0 else color
            node = build(cid, child_color, depth + 1)
            if node:
                kids.append(node)
        # 本级挂载的设备类型
        for typ, cnt in sorted(leaf_types.get(dept_id, {}).items(), key=lambda x: -x[1]):
            kids.append(
                {
                    "name": typ,
                    "value": cnt,
                    "itemStyle": {"color": color, "opacity": 0.85},
                }
            )
        if not kids:
            return None
        return {
            "name": name,
            "itemStyle": {"color": color},
            "children": kids,
        }

    roots: list[int]
    if scope_dept_id is not None and scope_dept_id in by_id:
        roots = [scope_dept_id]
    else:
        roots = [d["id"] for d in depts if d.get("parent_id") is None]

    out: list[dict[str, Any]] = []
    for i, rid in enumerate(roots):
        node = build(rid, ORG_CHART_COLORS[i % len(ORG_CHART_COLORS)], 0)
        if node:
            # 单根时展开一层，避免中心只显示一个「总部」占满
            if len(roots) == 1 and node.get("children"):
                return node["children"]
            out.append(node)
    return out


def _fleet_org_sankey(
    devices: list[dict], depts: list[dict], scope_dept_id: int | None = None
) -> dict[str, Any]:
    """桑基：设备类型 → 直属部门 → 上级 → … → 顶级（边权=台数）。"""
    del scope_dept_id  # 过滤已在调用方完成；链路仍走到真实顶级
    if not devices:
        return {"nodes": [], "links": []}

    by_id = _dept_by_id(depts)
    link_acc: dict[tuple[str, str], int] = {}
    node_names: set[str] = set()

    for d in devices:
        typ = d.get("type") or "其他"
        chain_ids = _dept_chain(depts, d["dept_id"])  # 直属 → … → 根
        if not chain_ids:
            continue
        chain_names = [by_id.get(i, {}).get("name") or f"部门#{i}" for i in chain_ids]
        path = [typ, *chain_names]
        for a, b in zip(path, path[1:]):
            if a == b:
                continue
            node_names.add(a)
            node_names.add(b)
            link_acc[(a, b)] = link_acc.get((a, b), 0) + 1

    nodes = [{"name": n} for n in sorted(node_names)]
    links = [
        {"source": s, "target": t, "value": v}
        for (s, t), v in sorted(link_acc.items(), key=lambda x: -x[1])
    ]
    return {"nodes": nodes, "links": links}


TYPE_TREND_COLORS = ["#1677ff", "#36cfc9", "#9254de", "#fa8c16", "#eb2f96", "#52c41a", "#8c8c8c"]


def _type_counts(devices: list[dict]) -> dict[str, int]:
    buckets: dict[str, int] = {}
    for d in devices:
        t = d.get("type") or "其他"
        buckets[t] = buckets.get(t, 0) + 1
    return buckets


def _build_period_type_trend(type_counts: dict[str, int], period_key: str) -> dict[str, Any]:
    sorted_types = sorted(type_counts.items(), key=lambda x: -x[1])
    series: list[dict[str, Any]] = []
    for type_name, base in sorted_types:
        values = _volatile_series(
            base, period_key, f"type:{type_name}", volatility=TREND_VOLATILITY["type"]
        )
        series.append({"key": type_name, "name": type_name, "values": values})
    # 按最新一天（末点）台数从大到小，供前端分页
    series.sort(key=lambda s: s["values"][-1] if s["values"] else 0, reverse=True)
    total = sum(type_counts.values())
    type_n = len(sorted_types)
    if sorted_types and total:
        top_name, top_n = sorted_types[0]
        top_pct = round(top_n / total * 100, 1)
        summary = f"共 {type_n} 类设备；当前 {top_name} 最多（{top_n} 台，占 {top_pct}%）"
    else:
        summary = "当前范围内无设备"
    return _trend_payload(period_key, series, summary)


def _fleet_type_trends(devices: list[dict]) -> dict[str, Any]:
    counts = _type_counts(devices)
    return {
        period: _build_period_type_trend(counts, period)
        for period in STATUS_TREND_PERIODS
    }


def _device_in_issue_tab(device: dict, tab: str) -> bool:
    if tab == "abnormal":
        return device["analysis_status"] == "abnormal"
    if tab == "watch":
        return device["analysis_status"] == "watch"
    if tab == "fault":
        return _run_bucket(device) == "fault"
    if tab == "all":
        return (
            device["analysis_status"] in {"abnormal", "watch"}
            or _run_bucket(device) == "fault"
        )
    return False


ISSUE_TAB_LABELS: dict[str, str] = {
    "abnormal": "异常",
    "watch": "关注",
    "fault": "故障",
    "all": "合计",
}


def _dept_counts_for_issue_tab(
    devices: list[dict],
    depts: list[dict],
    scope_dept_id: int | None,
    group_by: str,
    tab: str,
) -> dict[str, int]:
    buckets: dict[str, int] = {}
    by_id = _dept_by_id(depts)
    for d in devices:
        if not _device_in_issue_tab(d, tab):
            continue
        gid = _device_group_dept_id(depts, d["dept_id"], scope_dept_id, group_by)
        name = by_id.get(gid, {}).get("name") or d["dept_name"]
        buckets[name] = buckets.get(name, 0) + 1
    return buckets


MAX_DEVICE_ISSUE_SERIES = 40
MAX_COMPARE_DEVICES = 8

COMPARE_STATUS_ORDER = ["normal", "watch", "abnormal", "fault"]


def _device_composite_status(device: dict) -> str:
    if _run_bucket(device) == "fault":
        return "fault"
    st = device.get("analysis_status", "normal")
    if st in {"abnormal", "watch"}:
        return st
    return "normal"


def _segment_payload(
    period_start: date, status: str, start_idx: int, end_idx: int
) -> dict[str, Any]:
    return {
        "status": status,
        "start_index": start_idx,
        "end_index": end_idx,
        "start_date": (period_start + timedelta(days=start_idx)).isoformat(),
        "end_date": (period_start + timedelta(days=end_idx)).isoformat(),
        "days": end_idx - start_idx + 1,
    }


def _generate_device_status_segments(device: dict, period_key: str) -> list[dict[str, Any]]:
    n = int(STATUS_TREND_PERIODS[period_key]["days"])
    period_start = date(2026, 8, 27) - timedelta(days=n - 1)
    rng = _trend_rng(period_key, f"segments:{device['id']}")
    pool = COMPARE_STATUS_ORDER
    weights = [0.55, 0.2, 0.15, 0.1]
    final = _device_composite_status(device)
    flip = {"week": 0.15, "month": 0.1, "quarter": 0.06, "year": 0.03}.get(period_key, 0.08)

    daily: list[str] = []
    cur = rng.choices(pool, weights=weights, k=1)[0]
    for _ in range(n - 1):
        daily.append(cur)
        if rng.random() < flip:
            cur = rng.choices(pool, weights=weights, k=1)[0]
    daily.append(final)

    segments: list[dict[str, Any]] = []
    seg_start = 0
    for i in range(1, n):
        if daily[i] != daily[seg_start]:
            segments.append(_segment_payload(period_start, daily[seg_start], seg_start, i - 1))
            seg_start = i
    segments.append(_segment_payload(period_start, daily[seg_start], seg_start, n - 1))
    return segments


def _build_compare_device_tree(
    depts: list[dict], devices: list[dict], scope_dept_id: int | None
) -> list[dict[str, Any]]:
    scoped = _filter_devices_by_dept(devices, depts, scope_dept_id)
    devices_by_dept: dict[int, list[dict]] = {}
    for d in scoped:
        devices_by_dept.setdefault(d["dept_id"], []).append(d)
    by_id = _dept_by_id(depts)

    def dept_has_content(dept_id: int) -> bool:
        if devices_by_dept.get(dept_id):
            return True
        return any(
            dept_has_content(c["id"]) for c in depts if c.get("parent_id") == dept_id
        )

    def build_node(dept_id: int) -> dict[str, Any] | None:
        if not dept_has_content(dept_id):
            return None
        dept = by_id.get(dept_id)
        if not dept:
            return None
        children: list[dict[str, Any]] = []
        for child in sorted(
            [d for d in depts if d.get("parent_id") == dept_id], key=lambda x: x["name"]
        ):
            node = build_node(child["id"])
            if node:
                children.append(node)
        for dev in sorted(devices_by_dept.get(dept_id, []), key=lambda x: x["name"]):
            children.append(
                {
                    "key": f"device:{dev['id']}",
                    "title": dev["name"],
                    "type": "device",
                    "device_id": dev["id"],
                    "code": dev.get("code"),
                    "device_type": dev.get("type"),
                    "analysis_status": dev["analysis_status"],
                    "run_status": dev["run_status"],
                    "isLeaf": True,
                }
            )
        return {
            "key": f"dept:{dept_id}",
            "title": dept["name"],
            "type": "dept",
            "dept_id": dept_id,
            "children": children,
        }

    if scope_dept_id is not None:
        root = build_node(scope_dept_id)
        return [root] if root else []

    roots: list[dict[str, Any]] = []
    for d in sorted(depts, key=lambda x: x["name"]):
        if d.get("parent_id") is None:
            node = build_node(d["id"])
            if node:
                roots.append(node)
    return roots


def _compare_axis_meta(period_key: str) -> dict[str, Any]:
    cfg = STATUS_TREND_PERIODS[period_key]
    days = int(cfg["days"])
    end = date(2026, 8, 27)
    start = end - timedelta(days=days - 1)
    axis = _period_axis(period_key)
    return {
        **axis,
        "period": period_key,
        "day_count": days,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
    }


def _status_legend(catalog: dict[str, Any]) -> list[dict[str, str]]:
    labels = catalog.get("status_label", {})
    colors = catalog.get("status_color", {})
    return [
        {
            "key": key,
            "label": labels.get(key, key),
            "color": colors.get(key, "#8c8c8c"),
        }
        for key in COMPARE_STATUS_ORDER
    ]

def _device_issue_state_series(device_id: str, period_key: str, tab: str) -> list[int]:
    """单台设备在周期内是否处于当前 Tab 问题态（0/1），末点对齐当前快照。"""
    n = int(STATUS_TREND_PERIODS[period_key]["days"])
    if n <= 0:
        return []
    rng = _trend_rng(period_key, f"dev:{device_id}:{tab}")
    flip_prob = {"week": 0.12, "month": 0.08, "quarter": 0.05, "year": 0.03}.get(
        period_key, 0.08
    )
    values: list[int] = []
    state = 1 if rng.random() < 0.35 else 0
    for _ in range(n - 1):
        values.append(state)
        if rng.random() < flip_prob:
            state = 1 - state
    values.append(1)
    return values


def _build_period_device_issue_trend(
    devices: list[dict], period_key: str, tab: str
) -> dict[str, Any]:
    label = ISSUE_TAB_LABELS[tab]
    matching = [d for d in devices if _device_in_issue_tab(d, tab)]
    series: list[dict[str, Any]] = []
    for d in matching:
        values = _device_issue_state_series(d["id"], period_key, tab)
        series.append({"key": d["id"], "name": d["name"], "values": values})
    series.sort(
        key=lambda s: (sum(s["values"]), s["values"][-1], s["name"]),
        reverse=True,
    )
    total = len(series)
    if total > MAX_DEVICE_ISSUE_SERIES:
        series = series[:MAX_DEVICE_ISSUE_SERIES]
    device_n = total
    if device_n:
        top_name = series[0]["name"]
        top_days = sum(series[0]["values"])
        extra = (
            f"；展示前 {MAX_DEVICE_ISSUE_SERIES} 台"
            if total > MAX_DEVICE_ISSUE_SERIES
            else ""
        )
        summary = (
            f"共 {device_n} 台{label}设备{extra}；{top_name} 持续最久（{top_days} 天）"
        )
        if tab == "all":
            summary += "（异常∪关注∪故障，设备去重）"
    else:
        summary = f"当前范围内无{label}设备"
    return _trend_payload(period_key, series, summary)


def _build_period_dept_issue_trend(
    dept_issues: dict[str, int], period_key: str, tab: str = "all"
) -> dict[str, Any]:
    label = ISSUE_TAB_LABELS.get(tab, "问题")
    sorted_depts = sorted(dept_issues.items(), key=lambda x: (-x[1], x[0]))
    series: list[dict[str, Any]] = []
    for dept_name, base in sorted_depts:
        values = _volatile_series(
            base,
            period_key,
            f"dept:{tab}:{dept_name}",
            volatility=TREND_VOLATILITY["dept_issue"],
        )
        series.append({"key": dept_name, "name": dept_name, "values": values})
    series.sort(key=lambda s: s["values"][-1] if s["values"] else 0, reverse=True)
    dept_n = len(series)
    if series and series[0]["values"][-1] > 0:
        top_name = series[0]["name"]
        top_n = series[0]["values"][-1]
        summary = f"共 {dept_n} 个部门；当前 {top_name} {label}最多（{top_n} 台）"
    else:
        summary = f"当前范围内各部门无{label}设备"
    return _trend_payload(period_key, series, summary)


def _fleet_issue_views(
    devices: list[dict],
    depts: list[dict],
    scope_dept_id: int | None,
    group_by: str,
) -> dict[str, Any]:
    views: dict[str, Any] = {}
    for tab in ISSUE_TAB_LABELS:
        dept_counts = _dept_counts_for_issue_tab(
            devices, depts, scope_dept_id, group_by, tab
        )
        views[tab] = {
            "device": {
                period: _build_period_device_issue_trend(devices, period, tab)
                for period in STATUS_TREND_PERIODS
            },
            "dept": {
                period: _build_period_dept_issue_trend(dept_counts, period, tab)
                for period in STATUS_TREND_PERIODS
            },
        }
    return views


def _dept_ranking(
    devices: list[dict], depts: list[dict], scope_dept_id: int | None, group_by: str
) -> list[dict[str, Any]]:
    buckets: dict[int, dict[str, Any]] = {}
    by_id = _dept_by_id(depts)
    for d in devices:
        gid = _device_group_dept_id(depts, d["dept_id"], scope_dept_id, group_by)
        if gid not in buckets:
            buckets[gid] = {
                "dept_id": gid,
                "dept_name": by_id.get(gid, {}).get("name") or d["dept_name"],
                "device_count": 0,
                "online_count": 0,
                "running_count": 0,
                "watch_count": 0,
                "abnormal_count": 0,
                "fault_count": 0,
            }
        row = buckets[gid]
        row["device_count"] += 1
        if d.get("comm_status", "online") == "online":
            row["online_count"] += 1
        if _run_bucket(d) == "running":
            row["running_count"] += 1
        if d["analysis_status"] == "watch":
            row["watch_count"] += 1
        if d["analysis_status"] == "abnormal":
            row["abnormal_count"] += 1
        if _run_bucket(d) == "fault":
            row["fault_count"] += 1
    ranking = list(buckets.values())
    for row in ranking:
        total = row["device_count"] or 1
        row["online_rate"] = round(row["online_count"] / total * 100, 1)
        row["issue_count"] = row["watch_count"] + row["abnormal_count"]
    ranking.sort(key=lambda r: (-r["issue_count"], -r["device_count"]))
    return ranking


def _type_stats(devices: list[dict]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, int]] = {}
    for d in devices:
        t = d.get("type") or "其他"
        if t not in buckets:
            buckets[t] = {"type": t, "total": 0, "issue": 0}
        buckets[t]["total"] += 1
        if d["analysis_status"] in {"watch", "abnormal"}:
            buckets[t]["issue"] += 1
    stats = list(buckets.values())
    for row in stats:
        row["issue_rate"] = round(row["issue"] / row["total"] * 100, 1) if row["total"] else 0
    stats.sort(key=lambda r: -r["total"])
    return stats


def _format_duration_hours(hours: float) -> str:
    if hours <= 0:
        return "—"
    h = int(hours)
    m = int(round((hours - h) * 60))
    if h > 0:
        return f"{h}小时{m}分" if m else f"{h}小时"
    return f"{m}分钟"


def _ratio_pct(n: int, d: int) -> str:
    if d <= 0:
        return "—"
    return f"{round(n / d * 100, 1)}%"


def _ratio_line(parts: list[tuple[str, int, int]]) -> str:
    return " · ".join(f"{label} {_ratio_pct(n, d)}" for label, n, d in parts)


def _build_current_kpis(
    *,
    total: int,
    online_n: int,
    running_n: int,
    abnormal_n: int,
    watch_n: int,
    fault_n: int,
) -> list[dict[str, Any]]:
    def issue_ratio(n: int) -> str:
        parts: list[tuple[str, int, int]] = [
            ("总比", n, total),
            ("在线比", n, online_n),
        ]
        if running_n > 0:
            parts.append(("运行比", n, running_n))
        return _ratio_line(parts)

    return [
        {"title": "设备总数", "value": total, "unit": "台"},
        {
            "title": "采集在线",
            "value": online_n,
            "unit": "台",
            "ratio": _ratio_line([("总比", online_n, total)]),
        },
        {
            "title": "运行中",
            "value": running_n,
            "unit": "台",
            "ratio": _ratio_line([("总比", running_n, total), ("在线比", running_n, online_n)]),
        },
        {"title": "异常", "value": abnormal_n, "unit": "台", "ratio": issue_ratio(abnormal_n)},
        {"title": "关注", "value": watch_n, "unit": "台", "ratio": issue_ratio(watch_n)},
        {"title": "故障", "value": fault_n, "unit": "台", "ratio": issue_ratio(fault_n)},
    ]


@router.get("/collect")
async def collect_page(request: Request, _user=Depends(get_current_user)):
    catalog = _load_catalog()
    devices = catalog["devices"]
    bindings = [
        {
            "id": d["id"],
            "name": d["name"],
            "code": d["code"],
            "dept_id": d["dept_id"],
            "dept_name": d["dept_name"],
            "source_id": d["source_id"],
            "point_count": len(d.get("point_ids") or []),
            "point_ids": d.get("point_ids") or [],
            "last_sample_at": d.get("last_sample_at"),
        }
        for d in devices
    ]
    return ok(
        request,
        {
            "title": "采集配置",
            "subtitle": "采集源与测点绑定（不替代现场数采）",
            "note": "本系统消费已接入测点；此处维护采集源与测点绑定。设备挂在系统部门树上，与账号数据范围打通。",
            "sources": catalog["sources"],
            "points": catalog["points"],
            "point_categories": catalog["point_categories"],
            "bindings": bindings,
            "status_label": catalog["status_label"],
        },
    )


@router.get("/devices")
async def devices_page(
    request: Request,
    dept_id: int | None = Query(None, description="部门范围，含下级；默认全量"),
    session: AsyncSession = Depends(get_session),
    _user=Depends(get_current_user),
):
    catalog = _load_catalog()
    depts = await _fetch_depts(session, _user.tenant_id)
    devices = _sort_devices_with_anchors(_filter_devices_by_dept(catalog["devices"], depts, dept_id))
    return ok(
        request,
        {
            "title": "设备列表",
            "subtitle": "按部门查看运行与风险摘要",
            **_scope_meta(depts, dept_id),
            "kpis": _kpi_counts(devices),
            "demo_items": _demo_rows(devices, catalog, depts),
            "fleet_status_trends": _fleet_status_trends(devices),
            "fleet_type_trends": _fleet_type_trends(devices),
            "fleet_sunburst": _fleet_org_sunburst(devices, depts, dept_id),
            "fleet_sankey": _fleet_org_sankey(devices, depts, dept_id),
            "items": [_list_row(d, catalog, depts) for d in devices],
            "status_label": catalog["status_label"],
            "status_color": catalog["status_color"],
        },
    )


OPTIMIZE_STRATEGY_SCORE = {
    "energy": {"output_pct": -3.0, "energy_pct": -12.0, "wear_pct": -2.0, "risk": "低"},
    "balance": {"output_pct": -0.6, "energy_pct": -5.0, "wear_pct": -1.0, "risk": "低"},
    "output": {"output_pct": 8.0, "energy_pct": 10.0, "wear_pct": 8.0, "risk": "中"},
    "life": {"output_pct": -5.0, "energy_pct": 3.0, "wear_pct": -18.0, "risk": "最低"},
}

OPTIMIZE_STRATEGY_COPY = {
    "energy": {
        "why": "单耗偏高，功率有下降空间；小幅让产量可换来更明显的电耗下降。",
        "steps": [
            "确认排气压力、转速仍在硬约束内",
            "将转速落到建议区间，压力靠工艺下限",
            "观察产量与排气温度约 30 分钟",
            "工艺确认后在现场 HMI 固化（本系统不下发）",
        ],
        "tradeoff": "产量小幅让步，换电耗下降与磨损略减",
    },
    "balance": {
        "why": "工况整体稳定，用平衡策略保住产量，同时挤出一点能效。",
        "steps": [
            "维持现有工艺窗口，避免尖峰负载",
            "转速微调到建议区间中值",
            "班次结束复核产量与功率",
        ],
        "tradeoff": "产量基本持平，能耗略降",
    },
    "output": {
        "why": "需要冲产量时选用；须接受电耗和温升/磨损上升。",
        "steps": [
            "确认设备分析状态非异常、硬约束未越限",
            "转速维持高负荷区间且不越上限",
            "加密巡检温升与振动，准备随时退回平衡",
        ],
        "tradeoff": "产量上升，电耗与寿命损耗同步上升",
    },
    "life": {
        "why": "关注或温振趋势抬头时，优先控磨损，可略牺牲产量。",
        "steps": [
            "避免尖峰负载，转速落到长寿命区间",
            "核对润滑与轴承温度",
            "与「未来」页点检窗口对齐，不在高风险窗口冲产",
        ],
        "tradeoff": "产量下降，换寿命损耗明显下降、风险最低",
    },
}

OPTIMIZE_GOAL_OPTIONS = [
    {"key": "energy", "label": "节能", "desc": "优先降功率/单耗"},
    {"key": "balance", "label": "平衡", "desc": "产量基本保住，适度降耗"},
    {"key": "output", "label": "高负荷生产", "desc": "优先产量，接受能耗上升"},
    {"key": "life", "label": "长寿命", "desc": "优先控温升与磨损"},
]


def _fmt_signed_pct(v: float) -> str:
    if v > 0:
        return f"↑{abs(v):g}%"
    if v < 0:
        return f"↓{abs(v):g}%"
    return "持平"


def _recommend_opt_key(device: dict) -> tuple[str | None, str]:
    """舰队/单机共用：推荐策略键。不读 catalog.eligible（关注机曾被误标为不可调）。"""
    st = device.get("analysis_status", "normal")
    comm = device.get("comm_status", "online")
    run = device.get("run_status")
    es = device.get("energy_score")
    es_n = 100 if es is None else int(es)
    output = float(device.get("output_today") or 0)
    block = str((device.get("optimize") or {}).get("block_reason") or "")

    if comm != "online":
        return None, "采集离线，暂不调参"
    if st == "abnormal" or run == "alarm" or device.get("alarm_code"):
        return None, block or "异常或报警未关闭，先看现状与未来风险再调参"
    if st == "watch":
        return "life", "关注中，优先长寿命控磨损，可略降产"
    if es_n < 82:
        return "energy", "单耗偏高，优先节能"
    if st == "normal" and run == "running" and output >= 360 and es_n >= 86:
        return "output", "产量窗口偏高且工况稳定，可短时高负荷"
    return "balance", "工况稳定，维持平衡"


def _optimize_goal_options(opt: dict) -> list[dict[str, Any]]:
    by_key = {g.get("key"): g for g in (opt.get("goal_options") or []) if g.get("key")}
    rows: list[dict[str, Any]] = []
    for base in OPTIMIZE_GOAL_OPTIONS:
        extra = by_key.get(base["key"]) or {}
        rows.append({**base, **{k: v for k, v in extra.items() if v not in (None, "")}})
    return rows


def _project_optimize(device: dict) -> dict[str, Any]:
    """调优对照表 + 当前运行快照 + 决策句；数字由策略键投影，建议文案沿用 fixture。"""
    opt = dict(device.get("optimize") or {})
    if not opt:
        return {
            "eligible": False,
            "block_reason": "暂无调优策略",
            "goal_options": [],
            "constraints": [],
            "goal_scenarios": {},
            "strategy_table": [],
            "current_run": {},
            "recommended_key": None,
            "recommended_reason": "暂无调优策略",
            "decision_line": None,
        }

    future = _project_future_metrics(device)
    rt = device.get("realtime") or {}
    energy_score = device.get("energy_score")
    rec_key, rec_reason = _recommend_opt_key(device)
    eligible = rec_key is not None
    goals = _optimize_goal_options(opt)
    opt["goal_options"] = goals
    opt["eligible"] = eligible
    if not eligible:
        opt["block_reason"] = rec_reason
        mode_label = "安全受限"
    elif rec_key == "life":
        mode_label = "关注降载"
    elif rec_key == "energy":
        mode_label = "单耗偏高"
    elif rec_key == "output":
        mode_label = "高负荷运行"
    else:
        mode_label = "平衡运行"

    power = float(rt.get("power") or 0)
    output = float(device.get("output_today") or 0)
    rpm = rt.get("rpm")
    scenarios = opt.get("goal_scenarios") or {}
    rows: list[dict[str, Any]] = []
    rec_row: dict[str, Any] | None = None
    for g in goals:
        key = g.get("key") or ""
        sc = scenarios.get(key) or {}
        score = OPTIMIZE_STRATEGY_SCORE.get(key) or {
            "output_pct": 0.0,
            "energy_pct": 0.0,
            "wear_pct": 0.0,
            "risk": "低",
        }
        copy = OPTIMIZE_STRATEGY_COPY.get(key) or {}
        delta = sc.get("delta") or {}
        est_power = round(power * (1 + float(score["energy_pct"]) / 100), 1) if power else None
        est_output = round(output * (1 + float(score["output_pct"]) / 100), 1) if output else None
        advice = sc.get("param_advice") or ""
        row = {
            "key": key,
            "label": g.get("label") or key,
            "desc": g.get("desc") or "",
            "output_pct": score["output_pct"],
            "energy_pct": score["energy_pct"],
            "wear_pct": score["wear_pct"],
            "output_label": _fmt_signed_pct(score["output_pct"]),
            "energy_label": _fmt_signed_pct(score["energy_pct"]),
            "wear_label": _fmt_signed_pct(score["wear_pct"]),
            "risk": score["risk"],
            "param_advice": advice,
            "delta": delta,
            "why": copy.get("why") or "",
            "steps": copy.get("steps") or [],
            "tradeoff": copy.get("tradeoff") or "",
            "est_power": est_power,
            "est_output": est_output,
            "recommended": key == rec_key,
        }
        rows.append(row)
        if key == rec_key:
            rec_row = row

    decision_line = None
    if rec_row and eligible:
        bits = [f"建议切换到「{rec_row['label']}」"]
        if rec_row.get("param_advice"):
            bits.append(str(rec_row["param_advice"]))
        bits.append(f"产量 {rec_row['output_label']}，能耗 {rec_row['energy_label']}")
        if rec_row.get("est_power") is not None:
            bits.append(f"预计功率 {rec_row['est_power']} kW")
        decision_line = "。".join(bits) + "。"
    elif rec_reason:
        decision_line = rec_reason

    opt["strategy_table"] = rows if eligible else []
    opt["recommended_key"] = rec_key
    opt["recommended_reason"] = rec_reason
    opt["decision_line"] = decision_line
    opt["current_run"] = {
        "mode_label": mode_label,
        "rpm": rpm,
        "power": rt.get("power"),
        "pressure": rt.get("pressure"),
        "temp": rt.get("temp"),
        "vibration": rt.get("vibration"),
        "output_today": device.get("output_today"),
        "energy_score": energy_score,
        "health_index": future.get("health_index"),
        "health_band": future.get("health_band"),
    }
    return opt


def _project_compare_advice(device: dict) -> dict[str, Any]:
    """对比页运行建议：优先运行 / 正常 / 备用关注 / 建议检修。"""
    future = _project_future_metrics(device)
    st = device.get("analysis_status", "normal")
    alert = future.get("alert_level") or "normal"
    hi = int(future.get("health_index") or 0)
    risk_7d = int(future.get("risk_7d") or 0)
    if future.get("prediction_paused") or alert == "alarm" or st == "abnormal":
        advice = "建议检修"
        advice_rank = 4
        reason = future.get("primary_cause") or future.get("likely_fault") or "存在明确异常，不宜优先带载"
    elif alert == "warning" or st == "watch":
        advice = "备用关注"
        advice_rank = 3
        reason = future.get("primary_cause") or "风险偏高，建议降载或作备用"
    elif hi >= 88 and risk_7d < 12 and alert == "normal":
        advice = "优先运行"
        advice_rank = 1
        reason = "健康度高、近窗风险低，适合优先带载"
    else:
        advice = "正常运行"
        advice_rank = 2
        reason = "可维持当前负荷，按计划点检"

    return {
        "health_index": hi,
        "risk_7d": risk_7d,
        "energy_score": device.get("energy_score"),
        "alert_level": alert,
        "alert_label": future.get("alert_label"),
        "advice": advice,
        "advice_rank": advice_rank,
        "advice_reason": reason,
    }


@router.get("/devices/{device_id}")
async def device_detail(device_id: str, request: Request, _user=Depends(get_current_user)):
    catalog = _load_catalog()
    device = _device_map(catalog).get(device_id)
    if not device:
        return ok(request, {"title": "设备不存在", "id": device_id, "error": "not_found"})

    points = []
    by_id = {p["id"]: p for p in catalog["points"]}
    sources_by_id = {s["id"]: s for s in catalog.get("sources") or []}
    for pid in device.get("point_ids") or []:
        p = by_id.get(pid)
        if not p:
            continue
        code = p["code"]
        points.append(
            {
                **p,
                "value": device["realtime"].get(code),
            }
        )

    source = sources_by_id.get(device.get("source_id") or "")
    return ok(
        request,
        {
            "title": device["name"],
            "subtitle": f"{device['code']} · {device['dept_name']}",
            "id": device["id"],
            "code": device["code"],
            "name": device["name"],
            "type": device.get("type"),
            "dept_id": device["dept_id"],
            "dept_name": device["dept_name"],
            "run_status": device["run_status"],
            "analysis_status": device["analysis_status"],
            "comm_status": device.get("comm_status", "online"),
            "summary": device["summary"],
            "realtime": device["realtime"],
            "realtime_display": _format_display_metrics(device, catalog),
            "points": points,
            "point_count": len(points),
            "source_id": device.get("source_id"),
            "source_name": (source or {}).get("name"),
            "source_kind": (source or {}).get("kind"),
            "source_interval_sec": (source or {}).get("interval_sec"),
            "last_sample_at": device.get("last_sample_at"),
            "output_today": device.get("output_today"),
            "energy_score": device.get("energy_score"),
            "alarm_code": device.get("alarm_code"),
            "current": {
                **device["current"],
                **_project_current_story(device),
                **_project_current_diagnostics(device),
                **_project_metric_forecasts(device),
            },
            "future": {**device["future"], **_project_future_metrics(device)},
            "optimize": _project_optimize(device),
            "status_label": catalog["status_label"],
            "status_color": catalog["status_color"],
            "metric_labels": catalog["metric_labels"],
        },
    )


@router.get("/analysis/current")
async def analysis_current(
    request: Request,
    dept_id: int | None = Query(None, description="部门范围，含下级；默认全量"),
    device_type: str | None = Query(None, description="设备类型筛选"),
    group_by: str | None = Query("auto", description="部门汇总方式：auto/leaves/children/self"),
    session: AsyncSession = Depends(get_session),
    _user=Depends(get_current_user),
):
    catalog = _load_catalog()
    depts = await _fetch_depts(session, _user.tenant_id)
    devices = _filter_devices(catalog["devices"], depts, dept_id, device_type)
    scope = _scope_meta(depts, dept_id)
    group_meta = _group_by_meta(depts, dept_id, group_by)
    resolved_group_by = str(group_meta["group_by_resolved"])
    total = len(devices)
    online_n = sum(1 for d in devices if d.get("comm_status", "online") == "online")
    offline_n = total - online_n
    running_n = sum(1 for d in devices if _run_bucket(d) == "running")
    idle_n = sum(1 for d in devices if _run_bucket(d) == "idle")
    stopped_n = sum(1 for d in devices if _run_bucket(d) == "stopped")
    fault_n = sum(1 for d in devices if _run_bucket(d) == "fault")
    abnormal_n = sum(1 for d in devices if d["analysis_status"] == "abnormal")
    watch_n = sum(1 for d in devices if d["analysis_status"] == "watch")
    normal_n = total - abnormal_n - watch_n
    online_rate = round(online_n / total * 100, 1) if total else 0
    running_rate = round(running_n / total * 100, 1) if total else 0
    health_rate = round(normal_n / total * 100, 1) if total else 0
    issue_rate = round((abnormal_n + watch_n) / total * 100, 1) if total else 0

    pending = [d for d in devices if d["analysis_status"] in {"abnormal", "watch"}]
    pending.sort(
        key=lambda d: (
            0 if d["analysis_status"] == "abnormal" else 1,
            -d["current"].get("deviation_score", 0),
            -d["current"].get("duration_hours", 0),
        )
    )
    pending_by_id = {d["id"]: d for d in pending}
    focus_src: list[dict] = []
    for aid in DEMO_ANCHOR_IDS:
        hit = pending_by_id.get(aid)
        if hit:
            focus_src.append(hit)
    seen = {d["id"] for d in focus_src}
    for d in pending:
        if d["id"] in seen:
            continue
        focus_src.append(d)
        if len(focus_src) >= 5:
            break
    focus_src = focus_src[:5]

    priority_names = "、".join(d["name"] for d in focus_src[:3]) or "无"
    scope_prefix = f"【{scope['scope_label']}】" if scope["scope_label"] != "全部" else ""
    type_prefix = f"【{device_type}】" if device_type else ""
    situation = (
        f"{scope_prefix}{type_prefix}"
        f"共 {total} 台，采集在线 {online_n} 台（{online_rate}%），运行 {running_n} 台。"
        f"异常 {abnormal_n} 台、关注 {watch_n} 台。"
        f"建议优先：{priority_names}。"
        "基于采集与模型估计，须现场确认。"
    )

    updated_at = max((d.get("last_sample_at") or "" for d in devices), default="")

    focus_items = [
        {
            **_list_row(d, catalog, depts),
            "comm_status": d.get("comm_status", "online"),
            "run_bucket": _run_bucket(d),
            "one_liner": d["current"]["one_liner"],
            "duration_hours": d["current"].get("duration_hours", 0),
            "duration_text": _format_duration_hours(d["current"].get("duration_hours", 0)),
            "triggers": d["current"].get("triggers", []),
            "action_preview": (d["current"].get("action_steps") or [None])[0],
            "deviation_score": d["current"].get("deviation_score", 0),
        }
        for d in focus_src
    ]

    dept_ranking = _dept_ranking(devices, depts, dept_id, resolved_group_by)
    type_stats = _type_stats(devices)
    type_options = sorted({d.get("type") or "其他" for d in catalog["devices"]})

    return ok(
        request,
        {
            "title": "全局现状",
            "subtitle": "先看哪台异常/故障，再点进单机看此刻怎么回事",
            **scope,
            **group_meta,
            "scope_device_type": device_type,
            "updated_at": updated_at,
            "type_options": type_options,
            "note": "通信状态（采集在线）与运行状态、健康状态分维统计；数字与设备列表/单机页同源。",
            "situation": situation,
            "kpis": _build_current_kpis(
                total=total,
                online_n=online_n,
                running_n=running_n,
                abnormal_n=abnormal_n,
                watch_n=watch_n,
                fault_n=fault_n,
            ),
            "summary_rates": {
                "online_rate": online_rate,
                "running_rate": running_rate,
                "health_rate": health_rate,
                "issue_rate": issue_rate,
            },
            "run_distribution": [
                {"label": "运行", "value": running_n},
                {"label": "空闲", "value": idle_n},
                {"label": "停止", "value": stopped_n},
                {"label": "故障", "value": fault_n},
            ],
            "health_distribution": [
                {"label": "正常", "value": normal_n},
                {"label": "关注", "value": watch_n},
                {"label": "异常", "value": abnormal_n},
            ],
            "dept_ranking": dept_ranking,
            "type_stats": type_stats,
            "focus_items": focus_items,
            "demo_items": _demo_rows(devices, catalog, depts),
            "items": focus_items,
            "fleet_status_trends": _fleet_status_trends(devices),
            "fleet_type_trends": _fleet_type_trends(devices),
            "fleet_issue_views": _fleet_issue_views(
                devices, depts, dept_id, resolved_group_by
            ),
            "status_label": catalog["status_label"],
            "status_color": catalog["status_color"],
        },
    )


def _build_future_narrative(
    devices: list[dict], depts: list[dict], scope_label: str
) -> dict[str, Any]:
    total = len(devices)
    if not total:
        return {
            "situation": "当前范围内无设备，无法开展预测分析。",
            "paragraphs": ["当前范围内无设备，请调整部门筛选后重试。"],
            "action_hints": [],
            "priority_devices": [],
        }

    high = [d for d in devices if d["future"]["risk_7d"] >= 50]
    mid = [d for d in devices if 20 <= d["future"]["risk_7d"] < 50]
    low_n = sum(1 for d in devices if d["future"]["risk_7d"] < 20)
    min_rul_dev = min(devices, key=lambda d: d["future"]["rul_days"])
    min_rul = min_rul_dev["future"]["rul_days"]
    rul_ci = min_rul_dev["future"]["rul_ci"]
    scope_prefix = f"【{scope_label}】" if scope_label != "全部" else "全厂"

    fault_counter = Counter(d["future"]["likely_fault"] for d in high) if high else Counter()
    top_fault = fault_counter.most_common(1)[0][0] if fault_counter else ""

    p1 = (
        f"{scope_prefix}共纳入 {total} 台设备预测评估。模型综合近期振动、温度、载荷与历史故障样本，"
        f"输出 24h / 72h / 7 日故障概率及剩余可用天数（RUL）估计；"
        f"数值为模型估计，排产与检修须现场确认。"
    )
    p2 = (
        f"风险分层：{len(high)} 台 7 日风险 ≥50%（建议 72h 内排窗口核查），"
        f"{len(mid)} 台处于 20%～50% 关注带（加强巡点检），"
        f"{low_n} 台低于 20%。"
        f"最短 RUL 为「{min_rul_dev['name']}」约 {min_rul} 天"
        f"（置信区间 {rul_ci[0]}～{rul_ci[1]} 天）。"
    )
    priority = sorted(devices, key=lambda d: -d["future"]["risk_7d"])[:3]
    priority_bits = "、".join(
        f"{d['name']}（7日 {d['future']['risk_7d']}%，RUL {d['future']['rul_days']} 天）"
        for d in priority
    )
    p3 = f"当前优先关注：{priority_bits}。"
    if high and top_fault:
        p3 += f" 高风险设备中以「{top_fault}」类征兆最为集中，建议按类型批量准备点检项与备件。"

    hints: list[str] = []
    if high:
        hints.append(
            f"对 {len(high)} 台高风险设备：72h 内安排机旁检查（润滑、轴承、温升），"
            "核对单机「未来」Tab 中的避免措施并预留备件。"
        )
    if mid:
        hints.append(
            f"对 {len(mid)} 台关注带设备：纳入下周点检计划，关注载荷波动与趋势劣化，"
            "必要时提前降载运行。"
        )
    if min_rul <= 7:
        hints.append(
            f"RUL ≤7 天的设备（如 {min_rul_dev['name']}）建议优先排产检修窗口，"
            "避免被动停机影响产线节拍。"
        )
    hints.append(
        "点击列表「查看」进入单机未来 Tab，可查阅归因、预估停机时长、相近工况案例与处置预案。"
    )

    # 舰队级回溯：合计可少停时长（优先 3 台）
    projected_priority = [_project_future_metrics(d) for d in priority]
    fleet_avoid_h = sum(float(p.get("downtime_avoidable_h") or 0) for p in projected_priority)
    fleet_avoid_label = _fmt_hours(fleet_avoid_h)
    backtest_stories = [
        {
            "id": "STORY-01",
            "title": "若上周听了模型建议",
            "summary": (
                f"对当前优先关注的 {len(priority)} 台设备做回溯："
                f"若上周按建议窗口干预，相对突发停机合计可少停约 {fleet_avoid_label}"
                "（工况估计，须现场确认）。"
            ),
        },
        {
            "id": "STORY-02",
            "title": "预警 vs 报警触达",
            "summary": (
                "预警（邮件/站内）对应关注带与 RUL>7 天；"
                "报警（短信/电话）对应 RUL<7 天或 24h 高风险。"
                "低置信度报警仅标记「建议人工复核」，不自动开单。"
            ),
        },
        {
            "id": "STORY-03",
            "title": "计划检修优于突发停机",
            "summary": (
                "单机页对比计划检修时长与突发停机时长；"
                "建议用「建议检修日」直接排窗口，而非只看裸 RUL 点数。"
            ),
        },
    ]
    if fleet_avoid_h > 0:
        hints.append(
            f"回溯提示：优先关注设备若上周按建议干预，合计可少停约 {fleet_avoid_label}。"
        )

    situation = f"{scope_prefix}范围内 {total} 台设备；{len(high)} 台 7 日高风险，最短 RUL {min_rul} 天。"

    return {
        "situation": situation,
        "paragraphs": [p1, p2, p3],
        "action_hints": hints,
        "priority_devices": [
            {
                "id": d["id"],
                "name": d["name"],
                "dept_name": _dept_name(depts, d["dept_id"], d.get("dept_name", "")),
                "risk_7d": d["future"]["risk_7d"],
                "likely_fault": d["future"]["likely_fault"],
                "rul_days": d["future"]["rul_days"],
            }
            for d in priority
        ],
        "backtest_stories": backtest_stories,
        "fleet_downtime_avoidable_h": fleet_avoid_h,
        "fleet_downtime_avoidable_label": fleet_avoid_label,
    }


@router.get("/analysis/future")
async def analysis_future(
    request: Request,
    dept_id: int | None = Query(None, description="部门范围，含下级；默认全量"),
    session: AsyncSession = Depends(get_session),
    _user=Depends(get_current_user),
):
    catalog = _load_catalog()
    depts = await _fetch_depts(session, _user.tenant_id)
    devices = _filter_devices_by_dept(catalog["devices"], depts, dept_id)
    scope = _scope_meta(depts, dept_id)
    devices = sorted(devices, key=lambda d: -d["future"]["risk_7d"])
    projected = [_project_future_metrics(d) for d in devices]
    high = sum(1 for p in projected if p["alert_level"] == "alarm")
    warning = sum(1 for p in projected if p["alert_level"] == "warning")
    paused = sum(1 for p in projected if p["prediction_paused"])
    risk_24h_high = sum(1 for p in projected if not p["prediction_paused"] and p["risk_24h"] >= 30)
    min_rul_dev = min(devices, key=lambda d: d["future"]["rul_days"])
    min_proj = _project_future_metrics(min_rul_dev)
    narrative = _build_future_narrative(devices, depts, scope["scope_label"])
    chart_top = devices[:15]
    return ok(
        request,
        {
            "title": "全局风险",
            "subtitle": "先看谁该管、何时点检；点进单机看完整决策",
            **scope,
            "situation": narrative["situation"],
            "future_narrative": narrative,
            "note": (
                "7 日风险分层：≥50% 为高风险，20%～50% 为关注带；"
                "RUL 为剩余可用天数估计（含置信区间）。"
                "与单机「未来」Tab、设备列表 risk/RUL 列同源。"
            ),
            "kpis": [
                {"title": "24h高风险", "value": risk_24h_high, "unit": "台"},
                {"title": "报警", "value": high, "unit": "台"},
                {"title": "预警", "value": warning, "unit": "台"},
                {"title": "预测暂停", "value": paused, "unit": "台"},
                {
                    "title": "最短RUL",
                    "value": min_proj["rul_range_label"],
                    "unit": "",
                },
            ],
            "items": [_list_row(d, catalog, depts) for d in devices],
            "demo_items": _demo_rows(devices, catalog, depts),
            "charts": [
                {
                    "id": "risk_top",
                    "title": "7 日故障风险 Top",
                    "type": "bar",
                    "unit": "%",
                    "span": 12,
                    "points": [
                        {"label": d["name"], "value": d["future"]["risk_7d"]} for d in chart_top
                    ],
                },
                {
                    "id": "rul_top",
                    "title": "预估剩余可用天数（RUL）Top",
                    "type": "bar",
                    "unit": "天",
                    "span": 12,
                    "points": [
                        {"label": d["name"], "value": d["future"]["rul_days"]}
                        for d in sorted(chart_top, key=lambda x: x["future"]["rul_days"])
                    ],
                },
            ],
            "status_label": catalog["status_label"],
            "status_color": catalog["status_color"],
        },
    )


@router.get("/analysis/optimize")
async def analysis_optimize(
    request: Request,
    dept_id: int | None = Query(None, description="部门范围，含下级；默认全量"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=5, le=50),
    session: AsyncSession = Depends(get_session),
    _user=Depends(get_current_user),
):
    catalog = _load_catalog()
    depts = await _fetch_depts(session, _user.tenant_id)
    devices = _filter_devices_by_dept(catalog["devices"], depts, dept_id)
    label_of = OPTIMIZE_LABELS

    opportunities: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    mix_counts: dict[str, int] = {k: 0 for k in label_of}
    power_drop = 0.0
    for d in devices:
        key, reason = _recommend_opt_key(d)
        score = OPTIMIZE_STRATEGY_SCORE.get(key or "") or {}
        row = {
            **_list_row(d, catalog, depts),
            "eligible": key is not None,
            "block_reason": None if key else reason,
            "rec_strategy": key,
            "rec_strategy_label": label_of.get(key) if key else "暂不调参",
            "rec_reason": reason,
            "rec_energy_label": _fmt_signed_pct(float(score["energy_pct"])) if score else "—",
            "opt_summary": reason
            if key is None
            else f"建议{label_of.get(key, key)} · {reason}",
        }
        if key:
            opportunities.append(row)
            mix_counts[key] = mix_counts.get(key, 0) + 1
            if key == "energy":
                power_drop += float((d.get("realtime") or {}).get("power") or 0) * 0.12
        else:
            blocked.append(row)

    def _opp_sort(r: dict[str, Any]) -> tuple:
        k = r.get("rec_strategy") or ""
        name = r.get("name") or ""
        if k == "energy":
            return (0, r.get("energy_score") or 100, name)
        if k == "life":
            return (1, 0, name)
        if k == "output":
            return (2, -(r.get("output_today") or 0), name)
        return (3, 0, name)

    opportunities.sort(key=_opp_sort)
    blocked.sort(
        key=lambda r: (
            0 if r.get("id") in DEMO_ANCHOR_RANK else 1,
            r.get("name") or "",
        )
    )

    by_id = {r["id"]: r for r in opportunities}
    focus: list[dict[str, Any]] = []
    for aid in DEMO_ANCHOR_IDS:
        if aid in by_id:
            focus.append(by_id[aid])
    seen = {x["id"] for x in focus}
    for r in opportunities:
        if r["id"] in seen:
            continue
        focus.append(r)
        seen.add(r["id"])
        if len(focus) >= 8:
            break

    mix = [
        {"key": k, "label": label_of[k], "count": mix_counts.get(k, 0)}
        for k in ("energy", "life", "output", "balance")
        if mix_counts.get(k, 0)
    ]
    power_drop_kw = int(round(power_drop))
    scope = _scope_meta(depts, dept_id)
    scope_prefix = f"【{scope['scope_label']}】" if scope["scope_label"] != "全部" else ""
    mix_text = "、".join(f"{m['label']} {m['count']} 台" for m in mix) or "暂无"
    headline = f"可优化 {len(opportunities)} 台，建议按策略分流"
    stance = (
        f"{scope_prefix}在运设备中，{mix_text}。"
        f"若节能建议全部落地，合计功率约可降 {power_drop_kw} kW（测算值，不下发 PLC）。"
    )

    total = len(opportunities)
    start = (page - 1) * page_size
    page_items = opportunities[start : start + page_size]
    energy_chart = [r for r in opportunities if r.get("rec_strategy") == "energy"][:12]
    if len(energy_chart) < 8:
        energy_chart = opportunities[:12]
    charts = [
        {
            "id": "opt_mix",
            "title": "建议策略配比",
            "type": "pie",
            "span": 12,
            "points": [{"label": m["label"], "value": m["count"]} for m in mix],
        },
        {
            "id": "opt_energy_gap",
            "title": "优化机会 · 能耗分越低越优先",
            "type": "bar",
            "unit": "分",
            "span": 12,
            "points": [
                {"label": r["name"], "value": r.get("energy_score") or 0} for r in energy_chart
            ],
        },
    ]

    demo_opt = []
    all_by_id = {r["id"]: r for r in opportunities + blocked}
    for aid in DEMO_ANCHOR_IDS:
        if aid in all_by_id:
            demo_opt.append(all_by_id[aid])

    return ok(
        request,
        {
            "title": "运行调优",
            "subtitle": "先看谁该改运行策略，再进单机看参数区间（建议不下发 PLC）",
            **scope,
            "note": "与单机调优 Tab 同源：关注→长寿命，单耗低→节能，产量窗口→高负荷，其余平衡。本页只做分流，不改 PLC。",
            "situation": stance,
            "optimize_brief": {
                "headline": headline,
                "stance": stance,
                "mix": mix,
                "power_drop_kw": power_drop_kw,
                "if_act": f"优先处理 Top 机会设备；预计功率可降约 {power_drop_kw} kW。",
            },
            "kpis": [
                {"title": "可优化候选", "value": len(opportunities), "unit": "台"},
                {"title": "建议节能", "value": mix_counts.get("energy", 0), "unit": "台"},
                {"title": "建议长寿命", "value": mix_counts.get("life", 0), "unit": "台"},
                {"title": "建议高负荷", "value": mix_counts.get("output", 0), "unit": "台"},
            ],
            "charts": charts if mix else [],
            "demo_items": demo_opt,
            "focus_items": focus,
            "items": page_items,
            "item_total": total,
            "page": page,
            "page_size": page_size,
            "blocked_items": blocked[:20],
            "status_label": catalog["status_label"],
            "status_color": catalog["status_color"],
        },
    )


def _overview_device_row(device: dict, catalog: dict, depts: list[dict] | None) -> dict[str, Any]:
    """总览设备行：现状 + 未来摘要字段。"""
    row = _list_row(device, catalog, depts)
    cur = device.get("current") or {}
    fut = _project_future_metrics(device)
    st = device.get("analysis_status", "normal")
    current_issue_n = 0
    if st == "abnormal":
        current_issue_n = max(1, len(cur.get("triggers") or []) or 1)
    elif st == "watch":
        current_issue_n = 1
    future_risk_n = 0
    if not fut.get("prediction_paused"):
        if fut.get("alert_level") == "alarm":
            future_risk_n = 2
        elif fut.get("alert_level") == "warning":
            future_risk_n = 1
        elif int(fut.get("risk_24h") or 0) >= 30:
            future_risk_n = 1
    return {
        **row,
        "run_bucket": _run_bucket(device),
        "comm_status": device.get("comm_status", "online"),
        "current_issue_count": current_issue_n,
        "future_risk_count": future_risk_n,
        "health_index": fut.get("health_index"),
        "load_label": (
            f"能耗 {device.get('energy_score', '—')} · "
            f"功率 {device.get('realtime', {}).get('power', '—')}"
        ),
        "current_one_liner": cur.get("one_liner") or device.get("summary"),
        "future_one_liner": fut.get("alert_label")
        or (f"7日风险 {fut.get('risk_7d')}%" if fut.get("risk_7d") is not None else "—"),
    }


def _overview_events(devices: list[dict], catalog: dict, depts: list[dict] | None) -> list[dict[str, Any]]:
    """异常与风险事件：现状实测 + 未来预测分类型。"""
    events: list[dict[str, Any]] = []
    eid = 0
    for d in devices:
        cur = d.get("current") or {}
        fut = _project_future_metrics(d)
        dept_name = _dept_name(depts, d["dept_id"], d.get("dept_name")) if depts else d.get("dept_name")
        part = (fut.get("primary_cause") or fut.get("likely_fault") or "整机")[:20]
        point = "主机振动/轴承温度"
        if cur.get("band_trend", {}).get("label"):
            point = cur["band_trend"]["label"]
        actions = cur.get("action_steps") or []
        advice = actions[0] if actions else (fut.get("avoid_preview") or "点进详情核对证据与窗口")

        st = d.get("analysis_status", "normal")
        if st in {"abnormal", "watch"}:
            eid += 1
            events.append(
                {
                    "id": f"EV-C-{eid}",
                    "kind": "current",
                    "kind_label": "现状异常",
                    "device_id": d["id"],
                    "device_name": d["name"],
                    "dept_name": dept_name,
                    "component": part,
                    "point": point,
                    "level": "alarm" if st == "abnormal" else "warning",
                    "level_label": "异常" if st == "abnormal" else "关注",
                    "description": cur.get("one_liner") or d.get("summary") or "实测偏离",
                    "advice": advice,
                    "handle_status": "pending",
                    "handle_status_label": "待处理",
                }
            )

        if not fut.get("prediction_paused") and fut.get("alert_level") in {"alarm", "warning"}:
            eid += 1
            events.append(
                {
                    "id": f"EV-F-{eid}",
                    "kind": "future",
                    "kind_label": "未来风险",
                    "device_id": d["id"],
                    "device_name": d["name"],
                    "dept_name": dept_name,
                    "component": part,
                    "point": "预测窗口",
                    "level": fut["alert_level"],
                    "level_label": fut.get("alert_label") or fut["alert_level"],
                    "description": (
                        f"24h风险 {fut.get('risk_24h')}% · 7日 {fut.get('risk_7d')}%"
                        + (f" · RUL {fut.get('rul_range_label')}" if fut.get("rul_range_label") else "")
                    ),
                    "advice": (d.get("future") or {}).get("avoid", [None])[0]
                    or advice
                    or "安排窗口复核",
                    "handle_status": "pending",
                    "handle_status_label": "待处理",
                }
            )

    # 异常优先，其次未来报警
    rank = {"alarm": 0, "warning": 1, "abnormal": 0}
    events.sort(
        key=lambda e: (
            0 if e["kind"] == "current" else 1,
            rank.get(e["level"], 9),
            e["device_name"],
        )
    )
    return events


@router.get("/analysis/diagnosis")
async def analysis_diagnosis_overview(
    request: Request,
    dept_id: int | None = Query(None, description="厂区/车间（部门含子树）"),
    device_type: str | None = Query(None, description="设备类型"),
    run_status: str | None = Query(
        None, description="运行状态桶：running/idle/stopped/fault；或 online/offline"
    ),
    period: str | None = Query("shift", description="时间范围：shift/24h/7d"),
    session: AsyncSession = Depends(get_session),
    _user=Depends(get_current_user),
):
    """分析诊断 · 总览：筛选 + KPI + 健康分布 + 设备表 + 事件。"""
    catalog = _load_catalog()
    depts = await _fetch_depts(session, _user.tenant_id)
    devices = _filter_devices(catalog["devices"], depts, dept_id, device_type)

    if run_status == "online":
        devices = [d for d in devices if d.get("comm_status", "online") == "online"]
    elif run_status == "offline":
        devices = [d for d in devices if d.get("comm_status", "online") != "online"]
    elif run_status in {"running", "idle", "stopped", "fault"}:
        devices = [d for d in devices if _run_bucket(d) == run_status]

    devices = _sort_devices_with_anchors(devices)
    scope = _scope_meta(depts, dept_id)

    total = len(devices)
    online_n = sum(1 for d in devices if d.get("comm_status", "online") == "online")
    offline_n = total - online_n
    running_n = sum(1 for d in devices if _run_bucket(d) == "running")
    abnormal_n = sum(1 for d in devices if d.get("analysis_status") == "abnormal")
    watch_n = sum(1 for d in devices if d.get("analysis_status") == "watch")
    normal_n = sum(1 for d in devices if d.get("analysis_status") == "normal")

    rows = [_overview_device_row(d, catalog, depts) for d in devices]
    future_risk_n = sum(1 for r in rows if (r.get("future_risk_count") or 0) > 0)
    events = _overview_events(devices, catalog, depts)
    pending_n = sum(1 for e in events if e.get("handle_status") == "pending")

    period_label = {"shift": "本班", "24h": "近24小时", "7d": "近7日"}.get(period or "shift", "本班")

    type_options = sorted({d.get("type") for d in catalog["devices"] if d.get("type")})

    return ok(
        request,
        {
            "title": "分析诊断 · 总览",
            "subtitle": f"时间口径：{period_label} · 实测异常与预测风险同屏",
            "note": "统计与列表随顶部筛选变化；点设备进入详情看实测与预测对照。原深度看板仍在其它 Tab。",
            **scope,
            "period": period or "shift",
            "period_label": period_label,
            "period_options": [
                {"value": "shift", "label": "本班"},
                {"value": "24h", "label": "近24小时"},
                {"value": "7d", "label": "近7日"},
            ],
            "run_status_options": [
                {"value": "running", "label": "运行中"},
                {"value": "idle", "label": "空闲"},
                {"value": "stopped", "label": "停机"},
                {"value": "fault", "label": "故障"},
                {"value": "online", "label": "采集在线"},
                {"value": "offline", "label": "采集离线"},
            ],
            "type_options": type_options,
            "kpis": [
                {"title": "设备总数", "value": total, "unit": "台"},
                {
                    "title": "在线设备",
                    "value": online_n,
                    "unit": "台",
                    "ratio": f"离线 {offline_n} 台",
                },
                {
                    "title": "正常运行",
                    "value": running_n,
                    "unit": "台",
                    "ratio": f"占总 {_ratio_pct(running_n, total)}",
                },
                {
                    "title": "当前异常",
                    "value": abnormal_n,
                    "unit": "台",
                    "ratio": f"关注 {watch_n} 台",
                },
                {
                    "title": "未来风险",
                    "value": future_risk_n,
                    "unit": "台",
                    "ratio": "预测预警/报警",
                },
                {
                    "title": "待处理事件",
                    "value": pending_n,
                    "unit": "条",
                    "ratio": f"事件共 {len(events)} 条",
                },
            ],
            "health_distribution": [
                {"key": "normal", "label": "健康", "count": normal_n, "color": "green"},
                {"key": "watch", "label": "关注", "count": watch_n, "color": "gold"},
                {"key": "abnormal", "label": "异常", "count": abnormal_n, "color": "red"},
                {"key": "offline", "label": "离线", "count": offline_n, "color": "default"},
            ],
            "devices": rows,
            "events": events,
            "demo_items": _demo_rows(devices, catalog, depts),
            "updated_at": catalog["devices"][0].get("last_sample_at") if catalog["devices"] else None,
            "status_label": catalog["status_label"],
            "status_color": catalog["status_color"],
        },
    )


@router.get("/analysis/devices/tree")
async def analysis_devices_tree(
    request: Request,
    dept_id: int | None = Query(None, description="部门范围，含下级"),
    session: AsyncSession = Depends(get_session),
    _user=Depends(get_current_user),
):
    catalog = _load_catalog()
    depts = await _fetch_depts(session, _user.tenant_id)
    tree = _build_compare_device_tree(depts, catalog["devices"], dept_id)
    scope = _scope_meta(depts, dept_id)
    return ok(
        request,
        {
            "title": "设备选择",
            **scope,
            "tree": tree,
            "max_select": MAX_COMPARE_DEVICES,
        },
    )


@router.get("/analysis/devices/compare")
async def analysis_devices_compare(
    request: Request,
    device_ids: str = Query(..., description="逗号分隔的设备 ID，最多 8 台"),
    period: str = Query("year", description="week|month|quarter|year"),
    session: AsyncSession = Depends(get_session),
    _user=Depends(get_current_user),
):
    if period not in STATUS_TREND_PERIODS:
        period = "year"
    ids = [x.strip() for x in device_ids.split(",") if x.strip()]
    if not ids:
        return ok(request, {"error": "empty", "message": "请至少选择一台设备"})
    if len(ids) > MAX_COMPARE_DEVICES:
        ids = ids[:MAX_COMPARE_DEVICES]

    catalog = _load_catalog()
    depts = await _fetch_depts(session, _user.tenant_id)
    device_map = _device_map(catalog)
    missing = [i for i in ids if i not in device_map]
    if missing:
        return ok(
            request,
            {"error": "not_found", "message": f"设备不存在: {', '.join(missing)}"},
        )

    period_labels = {"week": "周", "month": "月", "quarter": "季", "year": "年"}
    rows: list[dict[str, Any]] = []
    for did in ids:
        dev = device_map[did]
        current = _device_composite_status(dev)
        advice = _project_compare_advice(dev)
        rows.append(
            {
                "id": dev["id"],
                "code": dev["code"],
                "name": dev["name"],
                "type": dev.get("type"),
                "dept_id": dev["dept_id"],
                "dept_name": _dept_name(depts, dev["dept_id"], dev.get("dept_name", "")),
                "current_status": current,
                "segments": _generate_device_status_segments(dev, period),
                **advice,
            }
        )
    ranked = sorted(
        rows,
        key=lambda r: (r["advice_rank"], -(r.get("health_index") or 0), r.get("risk_7d") or 0),
    )
    for i, r in enumerate(ranked, start=1):
        r["run_order"] = i
    order_by_id = {r["id"]: r["run_order"] for r in ranked}
    for r in rows:
        r["run_order"] = order_by_id[r["id"]]

    return ok(
        request,
        {
            "title": "设备状态对比",
            "subtitle": "先看推荐运行顺序，再对照状态时间轴",
            "period": period,
            "period_label": period_labels.get(period, period),
            "axis": _compare_axis_meta(period),
            "devices": rows,
            "run_order": [
                {
                    "run_order": r["run_order"],
                    "id": r["id"],
                    "name": r["name"],
                    "advice": r["advice"],
                    "advice_reason": r["advice_reason"],
                    "health_index": r["health_index"],
                    "risk_7d": r["risk_7d"],
                }
                for r in ranked
            ],
            "status_legend": _status_legend(catalog),
            "max_devices": MAX_COMPARE_DEVICES,
            "status_label": catalog["status_label"],
            "status_color": catalog["status_color"],
        },
    )


@router.post("/collect/tick")
async def collect_tick(request: Request, _user=Depends(get_current_user)):
    """演示：手动触发一轮采集（Demo 不改数，返回同源快照时间说明）。"""
    catalog = _load_catalog()
    sample_at = catalog["devices"][0].get("last_sample_at")
    return ok(
        request,
        {
            "ok": True,
            "message": "已触发采集一轮，数据已刷新",
            "last_sample_at": sample_at,
            "device_count": len(catalog["devices"]),
        },
    )
