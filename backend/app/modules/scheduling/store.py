"""生产排产 Store：内存运算 + DATABASE_URL 快照落库（SQLite/PG）。"""

from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta
from threading import Lock
from typing import Any

from app.core.exceptions import NotFoundException, ValidationException
from app.modules.scheduling.persist import load_scheduling_payload, save_scheduling_payload

# 旧写死锚点已废弃；种子日期一律相对「今天」（见 _d）
ANCHOR = date(2026, 9, 18)

WO_KIND_LABELS = {
    "normal": "正常生产",
    "rework": "返工",
    "add_ops": "增补工序",
    "repair": "返修",
}

# 排产快照：最多保留最近 N 步可回退
HISTORY_LIMIT = 10

PRIORITY_RANK = {"rush": 0, "high": 1, "normal": 2}
SLOT_LABEL = {"full": "全天", "am": "上午", "pm": "下午"}
PRIORITY_LABEL_CN = {"rush": "加急", "high": "高优", "normal": "普通"}

# 报工可提前拉活的天数：今天干完后，最多提前开「明天」的计划（试运行变量）
REPORT_EARLY_PULL_DAYS = 1

# 一键重排策略：字典序档位，产品可解释
REPLAN_STRATEGIES: dict[str, dict[str, Any]] = {
    "priority": {
        "label": "级别优先",
        "description": "加急 > 高优 > 普通，同级再比交期；插队优先。今天以前已排工序冻结。",
    },
    "due_date": {
        "label": "交期优先",
        "description": "交期早的先占资源，同交期再比级别；插队优先。今天以前已排工序冻结。",
    },
    "protect_due": {
        "label": "保交期",
        "description": "距交期 ≤3 天抬为「临近交期」档，再按级别+交期；插队优先。今天以前已排工序冻结。",
    },
}
NEAR_DUE_DAYS = 3


def _planning_today() -> date:
    """排产「今天」：真实日历，用于冻结历史日与甘特视窗。"""
    return date.today()


# 甘特日期轴：左端最多约一个月；右端跟最远未完工计划日（不加空白缓冲）
GANTT_LOOKBACK_DAYS = 30


REPLAN_SCOPES: dict[str, dict[str, str]] = {
    "gantt": {
        "label": "仅甘特当前",
        "description": "只重排已排上甘特的工序；未排产的工单工序不动。",
    },
    "all": {
        "label": "全部未完成",
        "description": "所有未完工工序一起重排（含尚未排上甘特的）。",
    },
}


def _parse_hhmm(s: str) -> int:
    """'08:00' -> minutes from midnight."""
    parts = (s or "00:00").split(":")
    h = int(parts[0]) if parts else 0
    m = int(parts[1]) if len(parts) > 1 else 0
    return h * 60 + m


def _shift_start_end_dt(work_date: str, shift: dict | None) -> tuple[datetime, datetime]:
    """班次归属日 work_date 上的起止时刻；跨午夜则结束落在次日。"""
    d = date.fromisoformat((work_date or _planning_today().isoformat())[:10])
    start_m = _parse_hhmm((shift or {}).get("start_time") or "08:00")
    end_m = _parse_hhmm((shift or {}).get("end_time") or "16:00")
    start_dt = datetime.combine(d, datetime.min.time()) + timedelta(minutes=start_m)
    overnight = bool((shift or {}).get("crosses_midnight")) or end_m <= start_m
    if overnight:
        end_dt = datetime.combine(d + timedelta(days=1), datetime.min.time()) + timedelta(
            minutes=end_m
        )
    else:
        end_dt = datetime.combine(d, datetime.min.time()) + timedelta(minutes=end_m)
    return start_dt, end_dt


def _shift_intervals(shift: dict | None) -> list[tuple[int, int]]:
    """班次在一天内的占用区间（分钟）；跨午夜拆成两段。"""
    if not shift:
        return [(0, 24 * 60)]
    start = _parse_hhmm(shift.get("start_time") or "00:00")
    end = _parse_hhmm(shift.get("end_time") or "23:59")
    if shift.get("crosses_midnight") or end <= start:
        return [(start, 24 * 60), (0, end)]
    return [(start, end)]


def _intervals_overlap(a: list[tuple[int, int]], b: list[tuple[int, int]]) -> bool:
    for a0, a1 in a:
        for b0, b1 in b:
            if a0 < b1 and b0 < a1:
                return True
    return False


def _slots_overlap(a: str, b: str) -> bool:
    a = a or "full"
    b = b or "full"
    if a == "full" or b == "full":
        return True
    return a == b


def _assignee_ids_of(op: dict) -> list[str]:
    ids = op.get("assignee_ids")
    if isinstance(ids, list) and ids:
        return [str(x) for x in ids]
    single = op.get("assignee_id")
    return [str(single)] if single else []


def _normalize_op_fields(op: dict) -> None:
    ids = _assignee_ids_of(op)
    op["assignee_ids"] = ids
    op["assignee_id"] = ids[0] if ids else None
    op["slot"] = op.get("slot") or "full"
    # 每天所需人数：默认 1；已有多人则至少等于当前人数
    raw_hc = op.get("required_headcount")
    if raw_hc is None:
        op["required_headcount"] = max(1, len(ids) or 1)
    else:
        op["required_headcount"] = max(1, int(raw_hc))
    need = int(op["required_headcount"])
    # 无班次时统一默认白班（演示只保留一个班）
    if not op.get("shift_id") and not op.get("shift_family_id"):
        op["shift_family_id"] = "sh-day"
    _sync_plan_from_segments(op)
    segs = _normalize_plan_segments(op)
    seg_gaps = [int(s.get("staffing_gap") or 0) for s in segs]
    if segs and any(g > 0 for g in seg_gaps):
        op["staffing_gap"] = max(seg_gaps)
    elif op.get("plan_start"):
        # 有段且段级 gap 都为 0：以段为准；无段再用去重人数估算
        if segs:
            op["staffing_gap"] = 0
        else:
            op["staffing_gap"] = max(0, need - len(ids))
    else:
        op["staffing_gap"] = max(0, int(op.get("staffing_gap") or 0))


def _hours_per_day_of(op: dict) -> float:
    try:
        v = float(op.get("hours_per_day") if op.get("hours_per_day") is not None else 8)
    except (TypeError, ValueError):
        v = 8.0
    return v if v > 0 else 8.0


def _shift_available_hours(shift: dict | None) -> float:
    """班次可用工时（小时）；缺省 8。跨午夜按跨日时长计算。"""
    if not shift:
        return 8.0
    try:
        start = _parse_hhmm(shift.get("start_time") or "08:00")
        end = _parse_hhmm(shift.get("end_time") or "16:00")
    except Exception:
        return 8.0
    crosses = bool(shift.get("crosses_midnight"))
    if crosses or end <= start:
        mins = (24 * 60 - start) + end
    else:
        mins = end - start
    hours = mins / 60.0
    return hours if hours > 0 else 8.0


def _assignee_sets_disjoint(a: dict, b: dict) -> bool:
    sa, sb = set(_assignee_ids_of(a)), set(_assignee_ids_of(b))
    if not sa or not sb:
        return True
    return sa.isdisjoint(sb)


def _normalize_plan_segments(op: dict) -> list[dict]:
    raw = op.get("plan_segments")
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for i, s in enumerate(raw):
        if not isinstance(s, dict):
            continue
        start = (s.get("start") or "")[:10]
        end = (s.get("end") or start)[:10]
        if not start:
            continue
        if _parse(end) < _parse(start):
            end = start
        raw_pids = s.get("person_ids")
        if isinstance(raw_pids, list) and raw_pids:
            pids = [str(x) for x in raw_pids if x]
        else:
            pid = s.get("person_id")
            pids = [str(pid)] if pid else []
        raw_eids = s.get("equipment_ids")
        if isinstance(raw_eids, list) and raw_eids:
            eids = [str(x) for x in raw_eids if x]
        else:
            eids = []
        hc = s.get("required_headcount")
        try:
            hc_n = max(1, min(20, int(hc))) if hc is not None else None
        except (TypeError, ValueError):
            hc_n = None
        req_eq = s.get("required_equipment")
        try:
            eq_n = max(1, min(20, int(req_eq))) if req_eq is not None else None
        except (TypeError, ValueError):
            eq_n = None
        try:
            seg_gap = max(0, int(s.get("staffing_gap") or 0))
        except (TypeError, ValueError):
            seg_gap = 0
        try:
            eq_gap = max(0, int(s.get("equipment_gap") or 0))
        except (TypeError, ValueError):
            eq_gap = 0
        out.append(
            {
                "id": str(s.get("id") or f"seg-{i + 1}"),
                "person_id": pids[0] if pids else None,
                "person_ids": pids,
                "equipment_ids": eids,
                "required_headcount": hc_n,
                "required_equipment": eq_n,
                "staffing_gap": seg_gap,
                "equipment_gap": eq_gap,
                "start": start,
                "end": end,
            }
        )
    out.sort(key=lambda x: (x["start"], x["end"], x.get("person_id") or ""))
    return out


def _sync_plan_from_segments(op: dict) -> None:
    """时间段（可选）→ 信封 plan_start/end、合计天数、责任人。

    hours_per_day 应由班次时段写入；缺省按 8。计划工时 = 段合计天 × 班次工时。
    甘特色块按段绘制，段间隙不连成实心条。
    """
    segs = _normalize_plan_segments(op)
    op["plan_segments"] = segs
    hpd = _hours_per_day_of(op)
    op["hours_per_day"] = hpd
    if not segs:
        day_sum = int(op.get("duration_days") or 0) or (
            _duration_days(op["plan_start"], op["plan_end"])
            if op.get("plan_start") and op.get("plan_end")
            else 0
        )
        op["segment_day_sum"] = day_sum
        op["planned_hours"] = round(day_sum * hpd, 1) if day_sum else 0
        return
    day_sum = sum(_duration_days(s["start"], s["end"]) for s in segs)
    op["segment_day_sum"] = day_sum
    op["planned_hours"] = round(day_sum * hpd, 1)
    # 用户口径：总天数可由「合计工时 / 日工时」反推；有段时占用天=段日历合计
    op["duration_days"] = max(1, day_sum)
    op["plan_start"] = min(s["start"] for s in segs)
    op["plan_end"] = max(s["end"] for s in segs)
    pids: list[str] = []
    eids: list[str] = []
    for s in segs:
        for pid in s.get("person_ids") or ([] if not s.get("person_id") else [s["person_id"]]):
            if pid and pid not in pids:
                pids.append(pid)
        for eid in s.get("equipment_ids") or []:
            if eid and eid not in eids:
                eids.append(eid)
    if pids:
        op["assignee_ids"] = pids
        op["assignee_id"] = pids[0]
    if eids and not op.get("equipment_id"):
        op["equipment_id"] = eids[0]
    if eids:
        op["equipment_ids"] = eids


def _plan_runs(op: dict) -> list[tuple[str, str]]:
    segs = _normalize_plan_segments(op)
    if segs:
        return [(s["start"], s["end"]) for s in segs]
    ps = (op.get("plan_start") or "")[:10]
    pe = ((op.get("plan_end") or ps) or "")[:10]
    if ps:
        return [(ps, pe)]
    return []


def _merge_day_runs(days: list[str]) -> list[tuple[str, str]]:
    """签字日合并连续 run；中间无签字日则断开。"""
    if not days:
        return []
    ordered = sorted({d[:10] for d in days if d})
    if not ordered:
        return []
    runs: list[tuple[str, str]] = []
    run_start = ordered[0]
    prev = ordered[0]
    for d in ordered[1:]:
        if _parse(d) == _parse(prev) + timedelta(days=1):
            prev = d
        else:
            runs.append((run_start, prev))
            run_start = d
            prev = d
    runs.append((run_start, prev))
    return runs


def _d(offset: int) -> str:
    """相对今天的演示日期：Reset / 构建种子时读取真实日历。"""
    return (date.today() + timedelta(days=offset)).isoformat()


def _parse(d: str) -> date:
    return date.fromisoformat(d[:10])


def _add_days(d: str, days: int) -> str:
    return (_parse(d) + timedelta(days=days)).isoformat()


BELONG_DAY_RULES = ("start_day", "previous_day")
BELONG_DAY_LABELS = {
    "start_day": "归属开班日",
    "previous_day": "归属前一日",
}


def _normalize_belong_day_rule(raw: Any) -> str:
    """班次归属日：start_day=开班日；previous_day=前一日（凌晨接续班跟首班生产日）。"""
    key = str(raw or "start_day").strip().lower()
    if key in ("previous_day", "prev_day", "prior_day", "previous"):
        return "previous_day"
    return "start_day"


def _calendar_start_for_belong(belong_day: str, shift: dict | None) -> str:
    """归属日 → 该班开始钟点所在的日历日。"""
    day = (belong_day or "")[:10]
    if not day:
        return day
    if _normalize_belong_day_rule((shift or {}).get("belong_day_rule")) == "previous_day":
        return _add_days(day, 1)
    return day


def _belong_day_for_calendar_start(calendar_start: str, shift: dict | None) -> str:
    """班次开始钟点的日历日 → 归属日（甘特/排产/统计挂牌日）。"""
    day = (calendar_start or "")[:10]
    if not day:
        return day
    if _normalize_belong_day_rule((shift or {}).get("belong_day_rule")) == "previous_day":
        return _add_days(day, -1)
    return day


def _duration_days(start: str, end: str) -> int:
    """闭区间天数：09-18~09-19 = 2 天。"""
    return (_parse(end) - _parse(start)).days + 1


def _end_from_start(start: str, days: int) -> str:
    return _add_days(start, max(days, 1) - 1)


def _build_seed() -> dict[str, Any]:
    skills = [
        {"id": "sk-assembly", "code": "ASM", "name": "装配", "status": "active", "sort": 10},
        {"id": "sk-weld", "code": "WELD", "name": "焊接", "status": "active", "sort": 20},
        {"id": "sk-debug", "code": "DBG", "name": "调试", "status": "active", "sort": 30},
        {"id": "sk-qc", "code": "QC", "name": "质检", "status": "active", "sort": 40},
        {"id": "sk-pack", "code": "PACK", "name": "包装", "status": "active", "sort": 50},
        {"id": "sk-cnc", "code": "CNC", "name": "机加", "status": "active", "sort": 60},
        {"id": "sk-paint", "code": "PAINT", "name": "喷涂", "status": "active", "sort": 70},
        {"id": "sk-elec", "code": "ELEC", "name": "电装", "status": "active", "sort": 80},
    ]
    resources = [
        {"id": "res-assembly", "code": "ASM1", "name": "装配一组", "status": "active", "sort": 10},
        {"id": "res-weld", "code": "WLD2", "name": "焊接二组", "status": "active", "sort": 20},
        {"id": "res-debug", "code": "DBG", "name": "调试组", "status": "active", "sort": 30},
        {"id": "res-qc", "code": "QC", "name": "质检组", "status": "active", "sort": 40},
    ]
    # 设备台账：各班共用；挂班组或公共（resource_id 空）
    equipments = [
        {
            "id": "eq-weld-1",
            "code": "WELD-01",
            "name": "焊机1",
            "resource_id": "res-weld",
            "status": "active",
            "sort": 10,
        },
        {
            "id": "eq-weld-2",
            "code": "WELD-02",
            "name": "焊机2",
            "resource_id": "res-weld",
            "status": "active",
            "sort": 20,
        },
        {
            "id": "eq-weld-3",
            "code": "WELD-03",
            "name": "焊机3",
            "resource_id": "res-weld",
            "status": "active",
            "sort": 30,
        },
        {
            "id": "eq-asm-1",
            "code": "ASM-01",
            "name": "装配台1",
            "resource_id": "res-assembly",
            "status": "active",
            "sort": 40,
        },
        {
            "id": "eq-asm-2",
            "code": "ASM-02",
            "name": "装配台2",
            "resource_id": "res-assembly",
            "status": "active",
            "sort": 50,
        },
        {
            "id": "eq-debug-1",
            "code": "DBG-01",
            "name": "调试台1",
            "resource_id": "res-debug",
            "status": "active",
            "sort": 60,
        },
        {
            "id": "eq-qc-1",
            "code": "QC-01",
            "name": "检测台1",
            "resource_id": "res-qc",
            "status": "active",
            "sort": 70,
        },
        {
            "id": "eq-shared-1",
            "code": "PUB-01",
            "name": "公用工装台",
            "resource_id": None,
            "status": "active",
            "sort": 80,
        },
    ]
    # 班次：三班倒（白/中/夜）；白班保留版本历史演示；sort_order 决定甘特段序与轮换链
    _all_shifts = ["sh-day", "sh-mid", "sh-night"]
    shifts = [
        {
            "id": "shv-day-1",
            "family_id": "sh-day",
            "code": "DAY",
            "name": "白班",
            "version": 1,
            "start_time": "08:00",
            "end_time": "16:00",
            "crosses_midnight": False,
            "belong_day_rule": "start_day",
            "sort_order": 10,
            "status": "superseded",
            "effective_from": "2026-01-01",
            "effective_to": "2026-09-01",
            "superseded_by": "shv-day-2",
            "note": "旧制：8 点到 16 点",
        },
        {
            "id": "shv-day-2",
            "family_id": "sh-day",
            "code": "DAY",
            "name": "白班",
            "version": 2,
            "start_time": "08:00",
            "end_time": "16:00",
            "crosses_midnight": False,
            "belong_day_rule": "start_day",
            "sort_order": 10,
            "status": "active",
            "effective_from": "2026-09-01",
            "effective_to": None,
            "superseded_by": None,
            "note": "演示班次 · 白班（时长可改）",
        },
        {
            "id": "shv-mid-1",
            "family_id": "sh-mid",
            "code": "MID",
            "name": "中班",
            "version": 1,
            "start_time": "16:00",
            "end_time": "00:00",
            "crosses_midnight": True,
            "belong_day_rule": "start_day",
            "sort_order": 20,
            "status": "active",
            "effective_from": "2026-09-01",
            "effective_to": None,
            "superseded_by": None,
            "note": "演示班次 · 中班（忙时可开）",
        },
        {
            "id": "shv-night-1",
            "family_id": "sh-night",
            "code": "NIGHT",
            "name": "夜班",
            "version": 1,
            "start_time": "00:00",
            "end_time": "08:00",
            "crosses_midnight": False,
            # 凌晨班：挂牌跟首班生产日（前一日），与跨午夜中班同一轮
            "belong_day_rule": "previous_day",
            "sort_order": 30,
            "status": "active",
            "effective_from": "2026-09-01",
            "effective_to": None,
            "superseded_by": None,
            "note": "演示班次 · 夜班（归属前一日 / 跟白班生产日）",
        },
    ]
    persons = [
        {
            "id": "p1",
            "name": "张伟",
            "code": "EMP-001",
            "skill_ids": ["sk-assembly", "sk-debug"],
            "status": "active",
            "resource_id": "res-assembly",
            "shift_family_ids": list(_all_shifts),
        },
        {
            "id": "p2",
            "name": "李强",
            "code": "EMP-002",
            "skill_ids": ["sk-weld"],
            "status": "active",
            "resource_id": "res-weld",
            "shift_family_ids": list(_all_shifts),
        },
        {
            "id": "p3",
            "name": "王敏",
            "code": "EMP-003",
            "skill_ids": ["sk-qc"],
            "status": "active",
            "resource_id": "res-qc",
            "shift_family_ids": list(_all_shifts),
        },
        {
            "id": "p4",
            "name": "赵磊",
            "code": "EMP-004",
            "skill_ids": ["sk-debug"],
            "status": "active",
            "resource_id": "res-debug",
            "shift_family_ids": list(_all_shifts),
        },
        {
            "id": "p5",
            "name": "陈芳",
            "code": "EMP-005",
            "skill_ids": ["sk-assembly", "sk-pack"],
            "status": "active",
            "resource_id": "res-assembly",
            "shift_family_ids": list(_all_shifts),
        },
    ]
    templates = [
        {
            "id": "tpl-1",
            "name": "零件装配",
            "std_hours": 2.0,
            "skill_id": "sk-assembly",
            "equipment_ids": ["eq-asm-1", "eq-asm-2"],
            "prev_template_id": None,
            "status": "active",
            "actual_samples": [
                {"days": 2, "at": "2026-09-10"},
                {"days": 3, "at": "2026-09-12"},
                {"days": 2, "at": "2026-09-15"},
            ],
            "suggested_days": 2.3,
            "suggested_hours": 18.4,
        },
        {
            "id": "tpl-2",
            "name": "焊接加工",
            "std_hours": 3.0,
            "skill_id": "sk-weld",
            "equipment_ids": ["eq-weld-1", "eq-weld-2", "eq-weld-3"],
            "prev_template_id": "tpl-1",
            "status": "active",
            "actual_samples": [],
            "suggested_days": None,
            "suggested_hours": None,
        },
        {
            "id": "tpl-3",
            "name": "功能调试",
            "std_hours": 1.5,
            "skill_id": "sk-debug",
            "equipment_ids": ["eq-debug-1"],
            "prev_template_id": "tpl-2",
            "status": "active",
            "actual_samples": [],
            "suggested_days": None,
            "suggested_hours": None,
        },
        {
            "id": "tpl-4",
            "name": "最终质检",
            "std_hours": 1.0,
            "skill_id": "sk-qc",
            "equipment_ids": ["eq-qc-1", "eq-shared-1"],
            "prev_template_id": "tpl-3",
            "status": "incomplete",
            "actual_samples": [],
            "suggested_days": None,
            "suggested_hours": None,
        },
    ]

    # —— 小厂演示主线（固定单号；日期相对今天）——
    # 5 条故事：进行中 / 今日待开工 / 未到计划日 / 已完工对照 / 未排产待释放
    orders = [
        {
            "id": "ord-1",
            "code": "SO-202609-001",
            "name": "底座总成供货",
            "source_type": "customer",
            "customer_name": "华东装备厂",
            "product": "底座总成 A",
            "due_date": _d(6),
            "plan_qty": 100,
            "status": "producing",
        },
        {
            "id": "ord-3",
            "code": "INT-202609-001",
            "name": "空压机计划检修",
            "source_type": "internal",
            "customer_name": None,
            "product": "空压机 C",
            "due_date": _d(5),
            "plan_qty": 1,
            "status": "open",
        },
        {
            "id": "ord-8",
            "code": "INT-202609-004",
            "name": "样件试制",
            "source_type": "internal",
            "customer_name": None,
            "product": "样件 G",
            "due_date": _d(-1),
            "plan_qty": 20,
            "status": "done",
        },
    ]

    work_orders = [
        {
            "id": "wo-1",
            "order_id": "ord-1",
            "code": "WO-202609-001",
            "name": "设备底座加工",
            "product": "底座总成 A",
            "due_date": _d(6),
            "priority": "normal",
            "wo_kind": "normal",
            "status": "producing",
        },
        {
            "id": "wo-3",
            "order_id": "ord-3",
            "code": "WO-202609-003",
            "name": "空压机检修",
            "product": "空压机 C",
            "due_date": _d(5),
            "priority": "rush",
            "wo_kind": "repair",
            "status": "pending",
        },
        {
            "id": "wo-8",
            "order_id": "ord-8",
            "code": "WO-202609-008",
            "name": "已完成样件",
            "product": "样件 G",
            "due_date": _d(-1),
            "priority": "normal",
            "wo_kind": "normal",
            "status": "done",
        },
    ]

    operations = [
        # ① 今日进行中：昨开工、计划盖住今天 → 报工/签字
        {
            "id": "op-s1",
            "work_order_id": "wo-1",
            "name": "工序A·装配",
            "seq": 1,
            "skill_id": "sk-assembly",
            "resource_id": "res-assembly",
            "equipment_id": "eq-asm-1",
            "assignee_id": "p1",
            "assignee_ids": ["p1"],
            "slot": "full",
            "shift_family_id": "sh-day",
            "shift_id": "shv-day-2",
            "duration_days": 2,
            "plan_start": _d(-1),
            "plan_end": _d(0),
            "actual_start": _d(-1) + "T08:30:00",
            "actual_end": None,
            "progress": 40,
            "status": "running",
            "is_insert": False,
            "prev_op_ids": [],
            "plan_drift": None,
        },
        # ② 今日待开工：计划从今天起
        {
            "id": "op-s2",
            "work_order_id": "wo-1",
            "name": "工序B·焊接",
            "seq": 2,
            "skill_id": "sk-weld",
            "resource_id": "res-weld",
            "equipment_id": "eq-weld-1",
            "assignee_id": "p2",
            "assignee_ids": ["p2"],
            "slot": "full",
            "shift_family_id": "sh-day",
            "shift_id": "shv-day-2",
            "hours_per_day": 8,
            "plan_segments": [
                {"id": "seg-s2a", "person_id": "p2", "start": _d(0), "end": _d(0)},
                {"id": "seg-s2b", "person_id": "p2", "start": _d(2), "end": _d(2)},
            ],
            "duration_days": 2,
            "plan_start": _d(0),
            "plan_end": _d(2),
            "actual_start": None,
            "actual_end": None,
            "progress": 0,
            "status": "pending",
            "is_insert": False,
            "prev_op_ids": ["op-s1"],
            "plan_drift": None,
        },
        # ③ 未到计划日：后天开始（今日任务里不能开工）
        {
            "id": "op-s3",
            "work_order_id": "wo-1",
            "name": "工序C·质检",
            "seq": 3,
            "skill_id": "sk-qc",
            "resource_id": "res-qc",
            "equipment_id": "eq-qc-1",
            "assignee_id": "p3",
            "assignee_ids": ["p3"],
            "slot": "full",
            "shift_family_id": "sh-day",
            "shift_id": "shv-day-2",
            "duration_days": 2,
            "plan_start": _d(2),
            "plan_end": _d(3),
            "actual_start": None,
            "actual_end": None,
            "progress": 0,
            "status": "pending",
            "is_insert": False,
            "prev_op_ids": ["op-s2"],
            "plan_drift": None,
        },
        # ④ 已完工对照：不进「未完成工序」KPI
        {
            "id": "op-done",
            "work_order_id": "wo-8",
            "name": "功能调试",
            "seq": 1,
            "skill_id": "sk-debug",
            "resource_id": "res-debug",
            "equipment_id": "eq-debug-1",
            "assignee_id": "p4",
            "assignee_ids": ["p4"],
            "slot": "full",
            "shift_family_id": "sh-day",
            "shift_id": "shv-day-2",
            "duration_days": 1,
            "plan_start": _d(-1),
            "plan_end": _d(-1),
            "actual_start": _d(-1) + "T13:00:00",
            "actual_end": _d(-1) + "T15:00:00",
            "progress": 100,
            "status": "done",
            "is_insert": False,
            "prev_op_ids": [],
            "plan_drift": None,
        },
        # ⑤ 未排产待释放：甘特「从工单排产」
        {
            "id": "op-u1",
            "work_order_id": "wo-3",
            "name": "拆检",
            "seq": 1,
            "skill_id": "sk-assembly",
            "resource_id": "res-assembly",
            "assignee_id": None,
            "assignee_ids": [],
            "slot": "full",
            "shift_family_id": "sh-day",
            "duration_days": 2,
            "plan_start": None,
            "plan_end": None,
            "actual_start": None,
            "actual_end": None,
            "progress": 0,
            "status": "pending",
            "is_insert": False,
            "prev_op_ids": [],
            "plan_drift": None,
        },
    ]

    events = [
        {
            "id": "ev-1",
            "at": _d(0) + "T09:15:00",
            "person_name": "张伟",
            "op_name": "工序A·装配",
            "message": "进行中",
        },
        {
            "id": "ev-2",
            "at": _d(-1) + "T15:00:00",
            "person_name": "赵磊",
            "op_name": "功能调试",
            "message": "已完工",
        },
    ]

    return {
        "skills": skills,
        "resources": resources,
        "equipments": equipments,
        "shifts": shifts,
        "persons": persons,
        "templates": templates,
        "orders": orders,
        "work_orders": work_orders,
        "operations": operations,
        "events": events,
        "leaves": [
            # 王敏后天请假，撞上工序C 计划日 → 甘特冲突可讲
            {
                "id": "leave-1",
                "person_id": "p3",
                "start_date": _d(2),
                "end_date": _d(2),
                "reason": "事假",
                "status": "open",
            }
        ],
        "substitutions": [],
        "shift_assignments": [
            {
                "id": f"psa-{i}",
                "person_id": f"p{i}",
                "shift_family_id": "sh-day",
                "start_date": _d(-30),
                "end_date": None,
                "kind": "roster",
                "status": "open",
                "note": "白班" if i == 1 else None,
            }
            for i in range(1, 6)
        ],
        "daily_logs": [
            # 已完工样件：签字后进甘特「实绩」行
            {
                "id": "dlog-1",
                "op_id": "op-done",
                "person_id": "p4",
                "work_date": _d(-1),
                "hours": 2,
                "progress": 100,
                "note": "完工确认",
                "confirmed": True,
                "signature_data": (
                    "data:image/png;base64,"
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
                ),
                "created_at": _d(-1) + "T15:05:00",
            },
            # 进行中工序：昨日已签字报工 → 实绩行可见
            {
                "id": "dlog-2",
                "op_id": "op-s1",
                "person_id": "p1",
                "work_date": _d(-1),
                "hours": 8,
                "progress": 40,
                "note": "日结签字",
                "confirmed": True,
                "signature_data": (
                    "data:image/png;base64,"
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
                ),
                "created_at": _d(-1) + "T17:00:00",
            },
        ],
        "busy_acks": [],
        # 免排产「生产日报」：员工提交 → 主任确认（与工序报工 daily_logs 分离）
        "shop_floor_reports": [
            {
                "id": "sfr-1",
                "work_date": _d(-1),
                "status": "confirmed",
                "link_type": "order",
                "work_order_id": None,
                "order_id": "ord-1",
                "product": "",
                "process_name": "焊接",
                "template_id": None,
                "qty": 80,
                "hours": 8,
                "person_id": "p1",
                "equipment_id": None,
                "note": "样例：昨日已确认",
                "submitted_at": _d(-1) + "T17:10:00",
                "reviewed_at": _d(-1) + "T17:40:00",
                "reviewed_by": "车间主任",
                "review_note": "",
            },
            {
                "id": "sfr-2",
                "work_date": _d(0),
                "status": "pending",
                "link_type": "order",
                "work_order_id": None,
                "order_id": "ord-1",
                "product": "",
                "process_name": "焊接",
                "template_id": None,
                "qty": 40,
                "hours": 4,
                "person_id": "p2",
                "equipment_id": None,
                "note": "样例：待主任确认",
                "submitted_at": _d(0) + "T16:50:00",
                "reviewed_at": None,
                "reviewed_by": None,
                "review_note": "",
            },
        ],
        "_seq": {
            "person": 5,
            "template": 4,
            "order": 8,
            "work_order": 9,
            "operation": 100,
            "event": 3,
            "leave": 1,
            "substitution": 0,
            "shift_version": 4,
            "shift_family": 3,
            "shift_assignment": 5,
            "daily_log": 2,
            "busy_ack": 0,
            "equipment": 8,
            "resource": 4,
            "skill": 8,
            "shop_floor_report": 2,
        },
        "_demo_meta": {
            "anchor": _d(0),
            "scenarios": [
                "今日进行中（op-s1）",
                "今日待开工（op-s2）",
                "未到计划日（op-s3）",
                "已完工对照（op-done）",
                "未排产待释放（op-u1）",
            ],
        },
    }


def _build_progress_bulk_seed(*, person_count: int = 150, days: int = 21) -> dict[str, Any]:
    """生产进度演示大数据：约 N 人三班倒 + 多日多工序报工，便于效率分析看效果。"""
    import random

    rng = random.Random(20261105)
    base = _build_seed()
    n = max(30, min(int(person_count or 150), 300))
    day_n = max(7, min(int(days or 21), 45))

    surnames = list("赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻")
    given = [
        "伟", "强", "芳", "敏", "静", "丽", "勇", "军", "磊", "洋",
        "艳", "杰", "涛", "超", "秀英", "霞", "平", "刚", "桂英", "建华",
        "文", "辉", "鹏", "飞", "娜", "婷", "浩", "凯", "鑫", "宇",
    ]
    shifts_fam = ["sh-day", "sh-mid", "sh-night"]
    shift_label = {"sh-day": "白班", "sh-mid": "中班", "sh-night": "夜班"}
    shift_window = {
        "sh-day": ("08:00", "16:00"),
        "sh-mid": ("16:00", "00:00"),
        "sh-night": ("00:00", "08:00"),
    }
    resources = [
        {"id": "res-assembly", "code": "ASM1", "name": "装配一组", "status": "active", "sort": 10},
        {"id": "res-weld", "code": "WLD2", "name": "焊接二组", "status": "active", "sort": 20},
        {"id": "res-debug", "code": "DBG", "name": "调试组", "status": "active", "sort": 30},
        {"id": "res-qc", "code": "QC", "name": "质检组", "status": "active", "sort": 40},
        {"id": "res-cnc", "code": "CNC1", "name": "机加一组", "status": "active", "sort": 50},
        {"id": "res-paint", "code": "PT1", "name": "喷涂组", "status": "active", "sort": 60},
    ]
    res_ids = [r["id"] for r in resources]
    skill_by_res = {
        "res-assembly": ["sk-assembly", "sk-pack"],
        "res-weld": ["sk-weld"],
        "res-debug": ["sk-debug", "sk-elec"],
        "res-qc": ["sk-qc"],
        "res-cnc": ["sk-cnc"],
        "res-paint": ["sk-paint"],
    }
    process_by_res = {
        "res-assembly": "装配",
        "res-weld": "焊接",
        "res-debug": "调试",
        "res-qc": "质检",
        "res-cnc": "机加",
        "res-paint": "喷涂",
    }

    equipments: list[dict[str, Any]] = []
    eq_by_res: dict[str, list[str]] = {rid: [] for rid in res_ids}
    eq_seq = 0
    for rid in res_ids:
        prefix = {
            "res-assembly": "装配台",
            "res-weld": "焊机",
            "res-debug": "调试台",
            "res-qc": "检测台",
            "res-cnc": "数控机床",
            "res-paint": "喷涂线",
        }[rid]
        code_prefix = {
            "res-assembly": "ASM",
            "res-weld": "WELD",
            "res-debug": "DBG",
            "res-qc": "QC",
            "res-cnc": "CNC",
            "res-paint": "PT",
        }[rid]
        for i in range(1, 5):
            eq_seq += 1
            eid = f"eq-bulk-{eq_seq}"
            equipments.append(
                {
                    "id": eid,
                    "code": f"{code_prefix}-{i:02d}",
                    "name": f"{prefix}{i}",
                    "resource_id": rid,
                    "status": "active",
                    "sort": eq_seq * 10,
                }
            )
            eq_by_res[rid].append(eid)

    persons: list[dict[str, Any]] = []
    assignments: list[dict[str, Any]] = []
    per_shift = n // 3
    rem = n - per_shift * 3
    shift_quota = [
        ("sh-day", per_shift + (1 if rem > 0 else 0)),
        ("sh-mid", per_shift + (1 if rem > 1 else 0)),
        ("sh-night", per_shift),
    ]
    pid = 0
    for fam, count in shift_quota:
        for _ in range(count):
            pid += 1
            rid = res_ids[(pid - 1) % len(res_ids)]
            name = surnames[(pid * 7) % len(surnames)] + given[(pid * 13) % len(given)]
            if pid % 11 == 0:
                name = surnames[(pid * 3) % len(surnames)] + given[(pid * 5) % len(given)] + given[(pid * 9) % len(given)]
            persons.append(
                {
                    "id": f"p{pid}",
                    "name": name,
                    "code": f"EMP-{pid:03d}",
                    "skill_ids": list(skill_by_res[rid]),
                    "status": "active",
                    "resource_id": rid,
                    "shift_family_ids": list(shifts_fam),
                    "_shift_family_id": fam,
                    "_tier": pid % 5,  # 0高效 … 4偏低
                }
            )
            assignments.append(
                {
                    "id": f"psa-bulk-{pid}",
                    "person_id": f"p{pid}",
                    "shift_family_id": fam,
                    "start_date": _d(-40),
                    "end_date": None,
                    "kind": "roster",
                    "status": "open",
                    "note": shift_label[fam],
                }
            )

    # 主分析订单：大计划量，长周期
    orders = [
        {
            "id": "ord-1",
            "code": "SO-BULK-001",
            "name": "底座总成批量供货",
            "source_type": "customer",
            "customer_name": "华东装备厂",
            "product": "底座总成 A",
            "due_date": _d(14),
            "plan_qty": 50000,
            "status": "producing",
        },
        {
            "id": "ord-bulk-2",
            "code": "SO-BULK-002",
            "name": "机架焊接配套",
            "source_type": "customer",
            "customer_name": "甬江机电",
            "product": "机架组件 B",
            "due_date": _d(10),
            "plan_qty": 8000,
            "status": "producing",
        },
    ]
    work_orders = [
        {
            "id": "wo-1",
            "order_id": "ord-1",
            "code": "WO-BULK-001",
            "name": "底座总成主线",
            "product": "底座总成 A",
            "due_date": _d(14),
            "priority": "high",
            "wo_kind": "normal",
            "status": "producing",
        },
        {
            "id": "wo-bulk-1b",
            "order_id": "ord-1",
            "code": "WO-BULK-001B",
            "name": "底座总成辅线",
            "product": "底座总成 A",
            "due_date": _d(14),
            "priority": "normal",
            "wo_kind": "normal",
            "status": "producing",
        },
        {
            "id": "wo-bulk-2",
            "order_id": "ord-bulk-2",
            "code": "WO-BULK-002",
            "name": "机架焊接",
            "product": "机架组件 B",
            "due_date": _d(10),
            "priority": "rush",
            "wo_kind": "normal",
            "status": "producing",
        },
    ]
    operations = [
        {
            "id": "op-bulk-1",
            "work_order_id": "wo-1",
            "name": "焊接",
            "seq": 1,
            "skill_id": "sk-weld",
            "resource_id": "res-weld",
            "equipment_id": eq_by_res["res-weld"][0],
            "assignee_id": "p1",
            "assignee_ids": ["p1"],
            "slot": "full",
            "shift_family_id": "sh-day",
            "shift_id": "shv-day-2",
            "plan_start": _d(-(day_n - 1)),
            "plan_end": _d(14),
            "status": "running",
            "progress": 45,
        },
        {
            "id": "op-bulk-2",
            "work_order_id": "wo-1",
            "name": "装配",
            "seq": 2,
            "skill_id": "sk-assembly",
            "resource_id": "res-assembly",
            "equipment_id": eq_by_res["res-assembly"][0],
            "assignee_id": "p2",
            "assignee_ids": ["p2"],
            "slot": "full",
            "shift_family_id": "sh-day",
            "shift_id": "shv-day-2",
            "plan_start": _d(-(day_n - 1)),
            "plan_end": _d(14),
            "status": "running",
            "progress": 35,
        },
    ]

    reports: list[dict[str, Any]] = []
    finished: list[dict[str, Any]] = []
    sfr = 0
    # 每人按班每天约 55%~75% 出勤报工，效率分层
    for day_offset in range(-(day_n - 1), 1):
        work_date = _d(day_offset)
        day_persons = [p for p in persons if rng.random() < (0.62 + (p["_tier"] % 3) * 0.04)]
        for p in day_persons:
            fam = p["_shift_family_id"]
            rid = p["resource_id"]
            proc = process_by_res[rid]
            eqs = eq_by_res[rid]
            eid = eqs[(int(p["id"][1:]) + day_offset) % len(eqs)]
            tier = p["_tier"]
            # 高效：产量高工时略少；低效相反
            base_qty = {0: 48, 1: 40, 2: 32, 3: 26, 4: 18}[tier]
            qty = max(8, int(base_qty + rng.randint(-6, 8) + (2 if fam == "sh-day" else 0)))
            hours = round(7.2 + tier * 0.25 + rng.uniform(-0.4, 0.5), 1)
            hours = max(4.0, min(8.5, hours))
            st, et = shift_window[fam]
            wo_id = "wo-1" if rid != "res-weld" or rng.random() < 0.7 else "wo-bulk-1b"
            if rid == "res-weld" and rng.random() < 0.25:
                wo_id = "wo-bulk-2"
            order_id = "ord-bulk-2" if wo_id == "wo-bulk-2" else "ord-1"
            product = "机架组件 B" if order_id == "ord-bulk-2" else "底座总成 A"
            status = "confirmed"
            if day_offset == 0 and rng.random() < 0.08:
                status = "pending"
            elif rng.random() < 0.03:
                status = "rejected"
            sfr += 1
            reports.append(
                {
                    "id": f"sfr-bulk-{sfr}",
                    "work_date": work_date,
                    "status": status,
                    "link_type": "work_order",
                    "work_order_id": wo_id,
                    "work_order_label": None,
                    "order_id": order_id,
                    "product": product,
                    "process_name": proc,
                    "template_id": None,
                    "qty": float(qty),
                    "hours": float(hours),
                    "start_time": st,
                    "end_time": et,
                    "person_id": p["id"],
                    "equipment_id": eid,
                    "equipment_name": next(e["name"] for e in equipments if e["id"] == eid),
                    "note": "" if status == "confirmed" else ("待确认" if status == "pending" else "数量不符驳回"),
                    "submitted_at": f"{work_date}T{st[:2]}:50:00",
                    "reviewed_at": f"{work_date}T{et[:2] if et != '00:00' else '23'}:10:00" if status != "pending" else None,
                    "reviewed_by": "车间主任" if status != "pending" else None,
                    "review_note": "请重报" if status == "rejected" else "",
                }
            )
        # 成品确认（主产品）
        if day_offset % 2 == 0:
            finished.append(
                {
                    "id": f"sff-bulk-{work_date}",
                    "work_date": work_date,
                    "product": "底座总成 A",
                    "suggested_qty": 800,
                    "confirmed_qty": 780 + rng.randint(-40, 60),
                    "status": "confirmed",
                    "confirmed_by": "车间主任",
                    "confirmed_at": f"{work_date}T18:00:00",
                    "note": "批量演示成品确认",
                }
            )

    # 去掉临时字段
    clean_persons = []
    for p in persons:
        q = {k: v for k, v in p.items() if not k.startswith("_")}
        clean_persons.append(q)

    out = deepcopy(base)
    out["resources"] = resources
    out["equipments"] = equipments
    out["persons"] = clean_persons
    out["shift_assignments"] = assignments
    out["orders"] = orders
    out["work_orders"] = work_orders
    out["operations"] = operations
    out["leaves"] = []
    out["shop_floor_reports"] = reports
    out["shop_floor_finished"] = finished
    out["daily_logs"] = []
    out["events"] = [
        {
            "id": "evt-bulk-1",
            "person_name": "系统",
            "op_name": "生产进度",
            "message": f"已载入批量演示：{n} 人三班倒 · {day_n} 日报工",
            "created_at": _d(0) + "T08:00:00",
        }
    ]
    seq = out.setdefault("_seq", {})
    seq.update(
        {
            "person": n,
            "equipment": len(equipments),
            "resource": len(resources),
            "shift_assignment": len(assignments),
            "shop_floor_report": sfr,
            "shop_floor_finished": len(finished),
            "order": 20,
            "work_order": 20,
            "operation": 120,
        }
    )
    out["_demo_meta"] = {
        "anchor": _d(0),
        "kind": "progress_bulk",
        "person_count": n,
        "days": day_n,
        "report_count": sfr,
        "scenarios": [
            f"{n}人三班倒（白/中/夜约各1/3）",
            f"近{day_n}日多工序报工",
            "人员/班组/设备效率分层可对比",
        ],
    }
    return out


class _PersistLock:
    """外层锁退出时若非试排态则写入快照（读多写少场景可接受）。"""

    def __init__(self, store: "SchedulingStore") -> None:
        self._store = store
        self._lock = Lock()
        self._depth = 0

    def __enter__(self) -> "_PersistLock":
        self._lock.acquire()
        self._depth += 1
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            if self._depth == 1 and exc_type is None and self._store._sandbox_base is None:
                self._store._persist_unlocked()
        finally:
            self._depth -= 1
            self._lock.release()


class SchedulingStore:
    def __init__(self, tenant_id: int = 1) -> None:
        self.tenant_id = tenant_id
        self._lock = _PersistLock(self)
        self._data = _build_seed()
        self._undo_stack: list[dict[str, Any]] = []
        self._redo_stack: list[dict[str, Any]] = []
        # 试排：进入时冻结正式快照；None 表示当前即正式计划
        self._sandbox_base: dict[str, Any] | None = None
        self._last_saved_payload: str | None = None
        # 启动时尝试从库加载（表可能尚未 create，失败则保持 seed）
        self.reload_from_db(quiet=True)

    def reload_from_db(self, *, quiet: bool = False) -> bool:
        """从 scheduling_snapshot 加载；无数据则把当前 seed 写入库。"""
        try:
            loaded = load_scheduling_payload(self.tenant_id)
        except Exception:
            if not quiet:
                raise
            return False
        with self._lock._lock:
            if loaded and isinstance(loaded.get("work_orders"), list):
                self._data = loaded
                self._undo_stack.clear()
                self._redo_stack.clear()
                self._sandbox_base = None
                self._last_saved_payload = None
                self._ensure_three_shift_regime_unlocked()
                self._ensure_shift_sort_orders_unlocked()
                self._ensure_resources_shape_unlocked()
                self._ensure_shop_floor_reports_unlocked()
                self._sync_person_leave_status_unlocked()
                self._persist_unlocked()
                return True
            # 库空：落一份 seed
            self._ensure_three_shift_regime_unlocked()
            self._ensure_shift_sort_orders_unlocked()
            self._ensure_resources_shape_unlocked()
            self._ensure_shop_floor_reports_unlocked()
            self._persist_unlocked()
            return False

    def _persist_unlocked(self) -> None:
        if self._sandbox_base is not None:
            return
        try:
            import json

            payload = json.dumps(self._data, ensure_ascii=False, separators=(",", ":"), default=str)
            if payload == self._last_saved_payload:
                return
            save_scheduling_payload(self._data, self.tenant_id)
            self._last_saved_payload = payload
        except Exception:
            # 落库失败不阻断演示接口；下次写入再试
            import logging

            logging.getLogger(__name__).exception("排产快照落库失败")

    def reset(self) -> dict[str, Any]:
        """全量恢复排产测试种子：人员/班制/工序/订单等全部作废重铺，不保留任何本地修改。"""
        with self._lock:
            fresh = _build_seed()
            self._data = fresh
            self._undo_stack.clear()
            self._redo_stack.clear()
            self._sandbox_base = None
            self._last_saved_payload = None
            self._ensure_three_shift_regime_unlocked()
            self._ensure_shift_sort_orders_unlocked()
            self._sync_person_leave_status_unlocked()
            self._persist_unlocked()
            snap = self.snapshot_unlocked()
            meta = snap.get("_demo_meta") or {}
            anchor = meta.get("anchor") or _d(0)
            return {
                "ok": True,
                "anchor": anchor,
                "scenarios": meta.get("scenarios") or [],
                "message": (
                    f"已将排产全部恢复为测试数据（锚点 {anchor}）。"
                    "人员、班制、排班、工单与工序等本地修改均已作废。"
                ),
            }

    def seed_progress_bulk_demo(
        self, *, person_count: int = 150, days: int = 21
    ) -> dict[str, Any]:
        """覆盖写入生产进度批量演示数据（约 N 人三班倒 + 多日报工）。"""
        with self._lock:
            fresh = _build_progress_bulk_seed(person_count=person_count, days=days)
            self._data = fresh
            self._undo_stack.clear()
            self._redo_stack.clear()
            self._sandbox_base = None
            self._last_saved_payload = None
            self._ensure_shop_floor_reports_unlocked()
            self._ensure_shop_floor_finished_unlocked()
            self._ensure_three_shift_regime_unlocked()
            self._ensure_shift_sort_orders_unlocked()
            self._ensure_equipments_shape_unlocked()
            self._persist_unlocked()
            meta = (self._data.get("_demo_meta") or {})
            return {
                "ok": True,
                "tenant_id": self.tenant_id,
                "person_count": meta.get("person_count"),
                "days": meta.get("days"),
                "report_count": meta.get("report_count"),
                "equipment_count": len(self._data.get("equipments") or []),
                "scenarios": meta.get("scenarios") or [],
                "message": (
                    f"已载入生产进度批量演示：{meta.get('person_count')} 人三班倒，"
                    f"近 {meta.get('days')} 日共 {meta.get('report_count')} 条报工。"
                    "请打开「进度分析」订单详情查看效率页。"
                ),
            }

    def snapshot_unlocked(self) -> dict[str, Any]:
        return deepcopy(self._data)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return self.snapshot_unlocked()

    def _checkpoint(self) -> None:
        """变更前写入快照；新操作会清空「前进」栈。"""
        self._undo_stack.append(deepcopy(self._data))
        if len(self._undo_stack) > HISTORY_LIMIT:
            self._undo_stack.pop(0)
        self._redo_stack.clear()

    def _history_meta(self) -> dict[str, Any]:
        return {
            "can_undo": len(self._undo_stack) > 0,
            "can_redo": len(self._redo_stack) > 0,
            "undo_steps": len(self._undo_stack),
            "redo_steps": len(self._redo_stack),
            "limit": HISTORY_LIMIT,
        }

    def undo(self) -> dict[str, Any]:
        with self._lock:
            if not self._undo_stack:
                raise ValidationException("没有可回退的排产快照")
            self._redo_stack.append(deepcopy(self._data))
            if len(self._redo_stack) > HISTORY_LIMIT:
                self._redo_stack.pop(0)
            self._data = self._undo_stack.pop()
            overview = self.gantt_overview_unlocked()
            overview["history"] = self._history_meta()
            return overview

    def redo(self) -> dict[str, Any]:
        with self._lock:
            if not self._redo_stack:
                raise ValidationException("没有可前进的排产快照")
            self._undo_stack.append(deepcopy(self._data))
            if len(self._undo_stack) > HISTORY_LIMIT:
                self._undo_stack.pop(0)
            self._data = self._redo_stack.pop()
            overview = self.gantt_overview_unlocked()
            overview["history"] = self._history_meta()
            return overview

    def _next_id(self, kind: str, prefix: str) -> str:
        self._data["_seq"][kind] = self._data["_seq"].get(kind, 0) + 1
        return f"{prefix}-{self._data['_seq'][kind]}"

    def _ensure_three_shift_regime_unlocked(self) -> None:
        """至少保证有一个可用班次（默认白班）。中/夜不强制补齐——闲时一班、忙时二/三班由用户自建。"""
        shifts = self._data.setdefault("shifts", [])
        has_active = any(s.get("status") == "active" for s in shifts)
        if has_active:
            return
        seq = self._data.setdefault("_seq", {})
        seq["shift_version"] = seq.get("shift_version", 0) + 1
        seq["shift_family"] = max(seq.get("shift_family", 0), 1)
        shifts.append(
            {
                "id": "shv-day-auto",
                "family_id": "sh-day",
                "code": "DAY",
                "name": "白班",
                "version": 1,
                "start_time": "08:00",
                "end_time": "16:00",
                "crosses_midnight": False,
                "belong_day_rule": "start_day",
                "sort_order": 10,
                "status": "active",
                "effective_from": "2026-01-01",
                "effective_to": None,
                "superseded_by": None,
                "note": "默认班次（时长可改）",
            }
        )

    def _ensure_shift_belong_rules_unlocked(self) -> None:
        """补齐缺失的归属日规则；演示夜班默认 previous_day。"""
        for s in self._data.get("shifts") or []:
            if s.get("belong_day_rule"):
                s["belong_day_rule"] = _normalize_belong_day_rule(s.get("belong_day_rule"))
                continue
            # 兼容旧数据：已知夜班族默认归属前一日
            if s.get("family_id") == "sh-night":
                s["belong_day_rule"] = "previous_day"
            else:
                s["belong_day_rule"] = "start_day"

    def _ensure_shift_sort_orders_unlocked(self) -> None:
        """为缺少 sort_order 的班次族补齐顺序（同族各版本共享）。"""
        self._ensure_shift_belong_rules_unlocked()
        defaults = {"sh-day": 10, "sh-mid": 20, "sh-night": 30}
        by_fam: dict[str, list[dict]] = {}
        for s in self._data.get("shifts") or []:
            fid = s.get("family_id")
            if fid:
                by_fam.setdefault(fid, []).append(s)
        # 已有顺序：取同族最小正数
        fam_order: dict[str, int] = {}
        for fid, rows in by_fam.items():
            existing = [
                int(r.get("sort_order"))
                for r in rows
                if r.get("sort_order") is not None and int(r.get("sort_order") or 0) > 0
            ]
            if existing:
                fam_order[fid] = min(existing)
            elif fid in defaults:
                fam_order[fid] = defaults[fid]
        # 其余按当前启用版开始时间接在后面
        pending = [fid for fid in by_fam if fid not in fam_order]
        if pending:
            def _start_key(fid: str) -> str:
                active = self._active_shift_for_family(fid) or max(
                    by_fam[fid], key=lambda x: int(x.get("version") or 0)
                )
                return (active or {}).get("start_time") or "99:99"

            pending.sort(key=_start_key)
            next_ord = (max(fam_order.values()) if fam_order else 0) + 10
            for fid in pending:
                fam_order[fid] = next_ord
                next_ord += 10
        for fid, rows in by_fam.items():
            order = fam_order.get(fid, 999)
            for r in rows:
                if r.get("sort_order") != order:
                    r["sort_order"] = order

    def _active_family_ids_ordered_unlocked(self) -> list[str]:
        """当前启用班次族，按 sort_order（班序）再按开始时间。"""
        self._ensure_shift_sort_orders_unlocked()
        best: dict[str, dict] = {}
        for s in self._data.get("shifts") or []:
            if s.get("status") != "active":
                continue
            fid = s.get("family_id")
            if not fid:
                continue
            prev = best.get(fid)
            if not prev or (s.get("version") or 0) > (prev.get("version") or 0):
                best[fid] = s
        rows = list(best.values())
        rows.sort(
            key=lambda s: (
                int(s.get("sort_order") or 999),
                s.get("start_time") or "99:99",
                s.get("name") or "",
            )
        )
        return [s["family_id"] for s in rows]

    def _day_segments_unlocked(self) -> list[dict]:
        """甘特/排产共用的「一天 N 段」：当前启用班 + 班序；跨午夜归属开班日。"""
        segs: list[dict] = []
        for fid in self._active_family_ids_ordered_unlocked():
            s = self._active_shift_for_family(fid)
            if not s:
                continue
            rule = _normalize_belong_day_rule(s.get("belong_day_rule"))
            segs.append(
                {
                    "family_id": fid,
                    "shift_id": s["id"],
                    "name": s.get("name") or fid,
                    "code": s.get("code"),
                    "start_time": s.get("start_time"),
                    "end_time": s.get("end_time"),
                    "crosses_midnight": bool(s.get("crosses_midnight")),
                    "sort_order": int(s.get("sort_order") or 0),
                    "belong_day_rule": rule,
                    "belong_day_label": BELONG_DAY_LABELS.get(rule, rule),
                    "time_label": (
                        f"{s.get('start_time')}–{s.get('end_time')}"
                        + ("（跨日）" if s.get("crosses_midnight") else "")
                    ),
                }
            )
        return segs

    def _ordered_active_shifts_unlocked(self) -> list[dict]:
        """启用中的班次版本，按班序排列（与 day_segments / 排产选项一致）。"""
        out: list[dict] = []
        for fid in self._active_family_ids_ordered_unlocked():
            s = self._active_shift_for_family(fid)
            if s:
                out.append(s)
        return out

    def _sync_person_leave_status_unlocked(self) -> None:
        """人员 status=leave 仅表示「今天在假」；未来/过去的未关闭请假不把人标成全局请假。

        派工是否可排某日，看 `_person_on_leave_unlocked` / `_leave_covering_day_unlocked`，
        不要用 status=leave 一刀切挡住非请假日。
        """
        today = _planning_today().isoformat()
        on_leave_today = {
            lv.get("person_id")
            for lv in (self._data.get("leaves") or [])
            if lv.get("status") != "closed"
            and lv.get("person_id")
            and (lv.get("start_date") or "")[:10]
            and (lv.get("end_date") or "")[:10]
            and (lv.get("start_date") or "")[:10] <= today <= (lv.get("end_date") or "")[:10]
        }
        for p in self._data.get("persons") or []:
            if p.get("status") == "disabled":
                continue
            if p["id"] in on_leave_today:
                p["status"] = "leave"
            elif p.get("status") == "leave":
                p["status"] = "active"

    def _person_map(self) -> dict[str, dict]:
        return {p["id"]: p for p in self._data["persons"]}

    def _skill_map(self) -> dict[str, dict]:
        self._ensure_skills_shape_unlocked()
        return {s["id"]: s for s in self._data.get("skills") or []}

    def _ensure_skills_shape_unlocked(self) -> None:
        """补齐技能字段，兼容旧快照只有 id/name。"""
        rows = self._data.setdefault("skills", [])
        for i, s in enumerate(rows):
            if not isinstance(s, dict):
                continue
            if not (s.get("code") or "").strip():
                sid = str(s.get("id") or "")
                s["code"] = sid.replace("sk-", "").upper() or f"SK{i + 1}"
            if not (s.get("status") or "").strip():
                s["status"] = "active"
            if s.get("sort") is None:
                s["sort"] = (i + 1) * 10

    def _list_skills_unlocked(self) -> list[dict[str, Any]]:
        self._ensure_skills_shape_unlocked()
        rows = sorted(
            self._data.get("skills") or [],
            key=lambda s: (int(s.get("sort") or 0), str(s.get("name") or "")),
        )
        out: list[dict[str, Any]] = []
        for s in rows:
            sid = s.get("id")
            person_count = sum(
                1
                for p in (self._data.get("persons") or [])
                if sid in (p.get("skill_ids") or []) and p.get("status") != "disabled"
            )
            template_count = sum(
                1
                for t in (self._data.get("templates") or [])
                if t.get("skill_id") == sid and t.get("status") != "disabled"
            )
            out.append(
                {
                    **deepcopy(s),
                    "person_count": person_count,
                    "template_count": template_count,
                    "status_label": "启用" if s.get("status") == "active" else "停用",
                }
            )
        return out

    def _resource_map(self) -> dict[str, dict]:
        return {r["id"]: r for r in self._data.get("resources") or []}

    def _equipment_map(self) -> dict[str, dict]:
        self._ensure_equipments_shape_unlocked()
        return {e["id"]: e for e in self._data.get("equipments") or []}

    def _ensure_resources_shape_unlocked(self) -> None:
        """补齐班组字段，兼容旧快照只有 id/name 的写法。"""
        rows = self._data.setdefault("resources", [])
        for i, r in enumerate(rows):
            if not isinstance(r, dict):
                continue
            if not (r.get("code") or "").strip():
                rid = str(r.get("id") or "")
                r["code"] = rid.replace("res-", "").upper() or f"R{i + 1}"
            if not (r.get("status") or "").strip():
                r["status"] = "active"
            if r.get("sort") is None:
                r["sort"] = (i + 1) * 10

    def _ensure_equipments_shape_unlocked(self) -> None:
        """补齐设备字段；旧快照无 equipments 时置空列表。"""
        rows = self._data.setdefault("equipments", [])
        for i, e in enumerate(rows):
            if not isinstance(e, dict):
                continue
            if not (e.get("code") or "").strip():
                eid = str(e.get("id") or "")
                e["code"] = eid.replace("eq-", "").upper() or f"EQ{i + 1}"
            if not (e.get("status") or "").strip():
                e["status"] = "active"
            if e.get("sort") is None:
                e["sort"] = (i + 1) * 10
            if "resource_id" not in e:
                e["resource_id"] = None
        for t in self._data.get("templates") or []:
            if not isinstance(t, dict):
                continue
            ids = t.get("equipment_ids")
            if not isinstance(ids, list):
                t["equipment_ids"] = []
            else:
                t["equipment_ids"] = [str(x) for x in ids if x]
        for op in self._data.get("operations") or []:
            if not isinstance(op, dict):
                continue
            if "equipment_id" not in op:
                op["equipment_id"] = None

    def _shift_map(self) -> dict[str, dict]:
        return {s["id"]: s for s in (self._data.get("shifts") or [])}

    def _active_shift_for_family(self, family_id: str | None) -> dict | None:
        if not family_id:
            return None
        candidates = [
            s
            for s in (self._data.get("shifts") or [])
            if s.get("family_id") == family_id and s.get("status") == "active"
        ]
        if not candidates:
            return None
        # 优先当前生效中，其次未生效；已过期的 active 不用于新排
        live = [s for s in candidates if self._shift_lifecycle(s)[0] == "active"]
        if live:
            return max(live, key=lambda s: int(s.get("version") or 0))
        upcoming = [s for s in candidates if self._shift_lifecycle(s)[0] == "upcoming"]
        if upcoming:
            return max(upcoming, key=lambda s: int(s.get("version") or 0))
        return max(candidates, key=lambda s: int(s.get("version") or 0))

    def _resolve_op_shift(self, op: dict) -> dict | None:
        """工序绑定的班次版本：优先 shift_id；否则取 family 当前生效版。"""
        smap = self._shift_map()
        sid = op.get("shift_id")
        if sid and sid in smap:
            return smap[sid]
        fam = op.get("shift_family_id")
        if not fam:
            _normalize_op_fields(op)
            fam = op.get("shift_family_id")
        return self._active_shift_for_family(fam)

    def _sync_op_hours_from_shift_unlocked(self, op: dict) -> None:
        """日工时一律取自班次 start/end，不接受前端手填。"""
        shift = self._resolve_op_shift(op)
        if shift:
            op["shift_id"] = shift.get("id") or op.get("shift_id")
            op["shift_family_id"] = shift.get("family_id") or op.get("shift_family_id")
        op["hours_per_day"] = _shift_available_hours(shift)
        _sync_plan_from_segments(op)

    def _ops_shift_overlap(self, a: dict, b: dict) -> bool:
        sa, sb = self._resolve_op_shift(a), self._resolve_op_shift(b)
        if sa or sb:
            return _intervals_overlap(_shift_intervals(sa), _shift_intervals(sb))
        return _slots_overlap(a.get("slot") or "full", b.get("slot") or "full")

    def _shift_lifecycle(self, shift: dict, *, today: str | None = None) -> tuple[str, str]:
        """返回 (lifecycle, label)：active/upcoming/expired/superseded/disabled。"""
        today = today or date.today().isoformat()
        raw = shift.get("status") or "active"
        if raw == "disabled":
            return "disabled", "停用"
        if raw == "superseded":
            return "superseded", "已归档"
        ef = (shift.get("effective_from") or "")[:10]
        et_raw = shift.get("effective_to")
        et = (et_raw or "")[:10] if et_raw else None
        if ef and ef > today:
            return "upcoming", "未生效"
        # effective_to 为开区间：到当天起失效
        if et and et <= today:
            return "expired", "已过期"
        return "active", "生效中"

    def _enrich_shift(self, shift: dict) -> dict:
        life, label = self._shift_lifecycle(shift)
        et = shift.get("effective_to")
        rule = _normalize_belong_day_rule(shift.get("belong_day_rule"))
        return {
            **deepcopy(shift),
            "sort_order": int(shift.get("sort_order") or 999),
            "belong_day_rule": rule,
            "belong_day_label": BELONG_DAY_LABELS.get(rule, rule),
            "time_label": (
                f"{shift.get('start_time')}–{shift.get('end_time')}"
                + ("（跨日）" if shift.get("crosses_midnight") else "")
            ),
            "lifecycle": life,
            "status_label": label,
            "effective_to_label": ((et or "")[:10] if et else None) or "至今",
        }

    def _enrich_shift_assignment(self, row: dict) -> dict:
        person = self._person_map().get(row.get("person_id") or "", {})
        fam = row.get("shift_family_id")
        shift_name = next(
            (
                s.get("name")
                for s in (self._data.get("shifts") or [])
                if s.get("family_id") == fam and s.get("status") == "active"
            ),
            next(
                (
                    s.get("name")
                    for s in (self._data.get("shifts") or [])
                    if s.get("family_id") == fam
                ),
                fam,
            ),
        )
        today = date.today().isoformat()
        start = (row.get("start_date") or "")[:10]
        end_raw = row.get("end_date")
        end = (end_raw or "")[:10] if end_raw else None
        status = row.get("status") or "open"
        if status == "closed":
            life, label = "closed", "已结束"
        elif start and start > today:
            life, label = "upcoming", "未开始"
        elif end and end < today:
            life, label = "expired", "已过期"
        else:
            life, label = "active", "任职中"
        return {
            **deepcopy(row),
            "person_name": person.get("name"),
            "person_code": person.get("code"),
            "shift_name": shift_name,
            "lifecycle": life,
            "status_label": label,
            "end_date_label": end or "至今",
        }

    def _person_has_assignments_unlocked(self, person_id: str) -> bool:
        return any(
            a.get("person_id") == person_id and (a.get("status") or "open") != "closed"
            for a in (self._data.get("shift_assignments") or [])
        )

    def _person_roster_family_on_day_unlocked(self, person_id: str, day: str) -> str | None:
        """某人在指定归属日的任职班次族；无任职返回 None。日期按归属日（挂牌日）解释。"""
        day = (day or "")[:10]
        best = None
        for a in self._data.get("shift_assignments") or []:
            if a.get("person_id") != person_id:
                continue
            if (a.get("status") or "open") == "closed":
                continue
            start = (a.get("start_date") or "")[:10]
            end_raw = a.get("end_date")
            end = (end_raw or "")[:10] if end_raw else None
            if start and start > day:
                continue
            if end and end < day:
                continue
            best = a.get("shift_family_id")
        return best

    def _leave_day_for_roster_unlocked(self, belong_day: str, family_id: str | None) -> str:
        """排班格子看请假时用的日历日：归属前一日的班，假看次日（实际开工日）。"""
        day = (belong_day or "")[:10]
        if not family_id:
            return day
        shift = self._active_shift_for_family(family_id)
        return _calendar_start_for_belong(day, shift) or day

    def _roster_cell_for_day_unlocked(
        self, person_id: str, day: str, fam_names: dict[str, str] | None = None
    ) -> dict:
        """人 × 归属日格子：班/假/空；请假按班次实际开工日历日判断。"""
        fam_names = fam_names or {}
        fam = self._person_roster_family_on_day_unlocked(person_id, day)
        leave_day = self._leave_day_for_roster_unlocked(day, fam)
        leave = self._leave_covering_day_unlocked(person_id, leave_day)
        if not leave and leave_day != day:
            # 无班或未命中开工日请假时，归属日当天请假仍显示假
            leave = self._leave_covering_day_unlocked(person_id, day)
        if leave:
            return {
                "kind": "leave",
                "label": "假",
                "shift_family_id": None,
                "shift_name": None,
                "leave_id": leave.get("id"),
                "leave_reason": leave.get("reason"),
            }
        if fam:
            display = fam_names.get(fam) or self._family_display_name(fam)
            return {
                "kind": "shift",
                "label": self._shift_short_name(fam),
                "shift_family_id": fam,
                "shift_name": display,
                "leave_id": None,
                "leave_reason": None,
            }
        return {
            "kind": "empty",
            "label": "—",
            "shift_family_id": None,
            "shift_name": None,
            "leave_id": None,
            "leave_reason": None,
        }

    def _person_matches_shift_on_op_unlocked(self, person: dict, op: dict, fam: str | None) -> bool:
        """
        能力 + 任职校验：
        - 可上班次（能力）仍要满足；
        - 若该人有任职记录，则工序每一天都必须任职到目标班次族。
        """
        pid = person["id"]
        allowed = person.get("shift_family_ids")
        if fam and allowed is not None and len(allowed) > 0 and fam not in allowed:
            return False
        if not fam or not self._person_has_assignments_unlocked(pid):
            return True
        ps, pe = op.get("plan_start") or "", op.get("plan_end") or ""
        if not ps or not pe:
            return False
        for i in range(_duration_days(ps, pe)):
            day = _add_days(ps, i)
            if self._person_roster_family_on_day_unlocked(pid, day) != fam:
                return False
        return True

    def _order_map(self) -> dict[str, dict]:
        return {o["id"]: o for o in self._data["orders"]}

    def _wo_map(self) -> dict[str, dict]:
        return {w["id"]: w for w in self._data["work_orders"]}

    def _op_map(self) -> dict[str, dict]:
        return {o["id"]: o for o in self._data["operations"]}

    def _enrich_order(self, order: dict) -> dict:
        wos = [w for w in self._data["work_orders"] if w.get("order_id") == order["id"]]
        return {
            **order,
            "work_order_count": len(wos),
            "source_type_label": "客户订单" if order.get("source_type") == "customer" else "内部生产",
        }

    def _enrich_work_order(self, wo: dict) -> dict:
        order = self._order_map().get(wo.get("order_id") or "", {})
        kind = wo.get("wo_kind") or "normal"
        return {
            **wo,
            "wo_kind": kind,
            "wo_kind_label": WO_KIND_LABELS.get(kind, kind),
            "order_code": order.get("code"),
            "order_name": order.get("name"),
            "source_type": order.get("source_type") or "internal",
            "source_type_label": (
                "客户订单" if order.get("source_type") == "customer" else "内部生产"
            ),
            "customer_name": order.get("customer_name"),
        }

    def _enrich_op(self, op: dict) -> dict:
        _normalize_op_fields(op)
        self._sync_op_hours_from_shift_unlocked(op)
        self._ensure_equipments_shape_unlocked()
        persons = self._person_map()
        skills = self._skill_map()
        resources = self._resource_map()
        equipments = self._equipment_map()
        wos = self._wo_map()
        wo = wos.get(op["work_order_id"], {})
        order = self._order_map().get(wo.get("order_id") or "", {})
        ids = _assignee_ids_of(op)
        names = [persons[i]["name"] for i in ids if i in persons]
        kind = wo.get("wo_kind") or "normal"
        shift = self._resolve_op_shift(op)
        eid = op.get("equipment_id") or None
        eq = equipments.get(eid or "", {})
        tpl = next(
            (t for t in (self._data.get("templates") or []) if t.get("id") == op.get("template_id")),
            None,
        )
        pool_ids = list((tpl or {}).get("equipment_ids") or [])
        return {
            **op,
            "work_order_code": wo.get("code"),
            "work_order_name": wo.get("name"),
            "wo_kind": kind,
            "wo_kind_label": WO_KIND_LABELS.get(kind, kind),
            "order_id": wo.get("order_id"),
            "order_code": order.get("code"),
            "order_name": order.get("name"),
            "source_type": order.get("source_type") or "internal",
            "source_type_label": (
                "客户订单" if order.get("source_type") == "customer" else "内部生产"
            ),
            "due_date": self._effective_due(wo, order),
            "priority": wo.get("priority", "normal"),
            "skill_name": skills.get(op.get("skill_id") or "", {}).get("name"),
            "resource_name": resources.get(op.get("resource_id") or "", {}).get("name"),
            "equipment_id": eid,
            "equipment_ids": list(op.get("equipment_ids") or ([eid] if eid else [])),
            "equipment_name": eq.get("name"),
            "equipment_names": [
                equipments[i]["name"]
                for i in (op.get("equipment_ids") or ([eid] if eid else []))
                if i in equipments
            ],
            "equipment_code": eq.get("code"),
            "equipment_pool_ids": pool_ids,
            "equipment_gap": int(op.get("equipment_gap") or 0),
            "assignee_ids": ids,
            "assignee_names": names,
            "assignee_name": "、".join(names) if names else None,
            "required_headcount": int(op.get("required_headcount") or 1),
            "staffing_gap": int(op.get("staffing_gap") or 0),
            "staffing_label": (
                (
                    f"缺{int(op.get('staffing_gap') or 0)}人"
                    if int(op.get("staffing_gap") or 0) > 0
                    else (f"{len(ids)}人" if ids else "未派人")
                )
                if op.get("plan_start")
                else f"需{int(op.get('required_headcount') or 1)}人/天"
            ),
            "slot": op.get("slot") or "full",
            "slot_label": SLOT_LABEL.get(op.get("slot") or "full", "全天"),
            "shift_id": (shift or {}).get("id") or op.get("shift_id"),
            "shift_family_id": (shift or {}).get("family_id") or op.get("shift_family_id"),
            "shift_name": (shift or {}).get("name"),
            "shift_code": (shift or {}).get("code"),
            "shift_version": (shift or {}).get("version"),
            "shift_time_label": (
                f"{shift.get('start_time')}–{shift.get('end_time')}"
                + ("（跨日）" if shift.get("crosses_midnight") else "")
                if shift
                else SLOT_LABEL.get(op.get("slot") or "full", "全天")
            ),
            # plan_start = 归属日（挂牌日）；跨午夜/凌晨班不按自然日拆段统计
            "belong_day": (op.get("plan_start") or "")[:10] or None,
            "belong_day_rule": _normalize_belong_day_rule(
                (shift or {}).get("belong_day_rule")
            ),
            "belong_day_label": BELONG_DAY_LABELS.get(
                _normalize_belong_day_rule((shift or {}).get("belong_day_rule")),
                "归属开班日",
            ),
            "work_calendar_start": (
                _calendar_start_for_belong((op.get("plan_start") or "")[:10], shift)
                if op.get("plan_start")
                else None
            ),
            # 加急工单工序一律视为插队（避免历史种子 / 手改标志与优先级不一致）
            "is_insert": bool(op.get("is_insert")) or (wo.get("priority") == "rush"),
            "delay_days": self._delay_days(op, wo, order),
            "plan_drift": op.get("plan_drift"),
            "plan_drift_label": {
                "late_start": "延期开工",
                "early_start": "提前开工",
            }.get(op.get("plan_drift") or "", None),
            "plan_vs_actual": self._plan_vs_actual(op),
            "plan_segments": self._enrich_plan_segments_unlocked(op, persons, equipments),
            "hours_per_day": _hours_per_day_of(op),
            "segment_day_sum": int(op.get("segment_day_sum") or 0),
            "planned_hours": float(op.get("planned_hours") or 0),
        }

    def _enrich_plan_segments_unlocked(
        self,
        op: dict,
        persons: dict | None = None,
        equipments: dict | None = None,
    ) -> list[dict]:
        persons = persons or self._person_map()
        equipments = equipments or self._equipment_map()
        rows: list[dict] = []
        for s in _normalize_plan_segments(op):
            pids = list(s.get("person_ids") or [])
            eids = list(s.get("equipment_ids") or [])
            rows.append(
                {
                    **s,
                    "person_names": [persons[i]["name"] for i in pids if i in persons],
                    "equipment_names": [
                        equipments[i]["name"] for i in eids if i in equipments
                    ],
                }
            )
        return rows

    def _effective_actual_window(self, op: dict) -> tuple[str | None, str | None]:
        """实绩日历窗：完工用实际起止；进行中则止于今天（便于甘特叠线）。"""
        a0 = (op.get("actual_start") or "")[:10] or None
        a1 = (op.get("actual_end") or "")[:10] or None
        if a0 and not a1 and op.get("status") in ("running", "paused"):
            a1 = _planning_today().isoformat()
        if a0 and a1 and a1 < a0:
            a1 = a0
        return a0, a1

    def _variance_fingerprint(self, op: dict) -> str:
        a0, a1 = self._effective_actual_window(op)
        return "|".join(
            [
                (op.get("plan_start") or "")[:10],
                (op.get("plan_end") or "")[:10],
                a0 or "",
                a1 or "",
                op.get("status") or "",
                op.get("plan_drift") or "",
            ]
        )

    def _plan_vs_actual(self, op: dict) -> dict[str, Any]:
        """计划 vs 实绩摘要：甘特叠线与偏差处置入口共用。"""
        ps = (op.get("plan_start") or "")[:10] or None
        pe = (op.get("plan_end") or "")[:10] or None
        a0, a1 = self._effective_actual_window(op)
        has_actual = bool(a0)
        start_delta = None
        end_delta = None
        if ps and a0:
            start_delta = (_parse(a0) - _parse(ps)).days
        if pe and a1:
            end_delta = (_parse(a1) - _parse(pe)).days
        today = _planning_today().isoformat()
        overrun = bool(
            op.get("status") in ("running", "paused")
            and pe
            and today > pe
        )
        has_variance = bool(
            op.get("plan_drift")
            or overrun
            or (start_delta is not None and start_delta != 0)
            or (end_delta is not None and end_delta != 0)
        )
        fp = self._variance_fingerprint(op)
        ack = op.get("variance_ack") or {}
        variance_ack = bool(
            has_variance and ack.get("fingerprint") == fp and ack.get("action")
        )
        bits: list[str] = []
        if op.get("plan_drift") == "late_start":
            bits.append("延期开工")
        elif op.get("plan_drift") == "early_start":
            bits.append("提前开工")
        if start_delta and start_delta > 0:
            bits.append(f"实绩晚开 {start_delta} 天")
        elif start_delta and start_delta < 0:
            bits.append(f"实绩早开 {abs(start_delta)} 天")
        if end_delta and end_delta > 0:
            bits.append(f"结束晚于计划 {end_delta} 天")
        elif end_delta and end_delta < 0:
            bits.append(f"结束早于计划 {abs(end_delta)} 天")
        if overrun and not (end_delta and end_delta > 0):
            bits.append("已过计划结束日仍未完工")
        if variance_ack:
            action_label = {
                "keep": "已确认保持计划",
                "adopt_actual": "已跟实现",
                "cascade_successors": "已顺延后置",
            }.get(str(ack.get("action")), "已确认")
            bits.append(action_label)
        return {
            "has_actual": has_actual,
            "has_variance": has_variance,
            "variance_ack": variance_ack,
            "needs_action": bool(has_variance and not variance_ack),
            "plan_start": ps,
            "plan_end": pe,
            "actual_start": a0,
            "actual_end": a1,
            "start_delta_days": start_delta,
            "end_delta_days": end_delta,
            "original_plan_start": (op.get("original_plan_start") or "")[:10] or None,
            "summary": "；".join(bits) if bits else None,
        }

    def _cascade_successors_unlocked(self, op_id: str) -> list[str]:
        """按当前工序 plan_end 顺延未完工后置；返回被改动的工序 id。"""
        changed: set[str] = {op_id}
        queue = [op_id]
        touched: list[str] = []
        while queue:
            cur = queue.pop(0)
            cur_op = self._op_map().get(cur)
            if not cur_op or not cur_op.get("plan_end"):
                continue
            for nxt in self._data["operations"]:
                if cur not in (nxt.get("prev_op_ids") or []) or nxt["id"] in changed:
                    continue
                if nxt.get("status") in ("done", "cancelled"):
                    continue
                # 已有实绩开工的后置：不改开始日，只继续传给更深后置
                if nxt.get("actual_start") and nxt.get("status") in ("running", "paused"):
                    changed.add(nxt["id"])
                    queue.append(nxt["id"])
                    continue
                new_start = _add_days(cur_op["plan_end"], 1)
                ndays = int(nxt.get("duration_days") or 0) or (
                    _duration_days(nxt["plan_start"], nxt["plan_end"])
                    if nxt.get("plan_start") and nxt.get("plan_end")
                    else 2
                )
                ndays = max(ndays, 1)
                nxt["plan_start"] = new_start
                nxt["plan_end"] = _end_from_start(new_start, ndays)
                nxt["duration_days"] = ndays
                # 后置计划变了，旧偏差确认作废
                nxt.pop("variance_ack", None)
                changed.add(nxt["id"])
                touched.append(nxt["id"])
                queue.append(nxt["id"])
        return touched

    def resolve_plan_variance(
        self,
        op_id: str,
        *,
        action: str,
        note: str | None = None,
        cascade: bool = True,
    ) -> dict:
        """计划/实绩偏差处置：keep | adopt_actual | cascade_successors。"""
        action = (action or "").strip()
        if action not in ("keep", "adopt_actual", "cascade_successors"):
            raise ValidationException("action 仅支持 keep / adopt_actual / cascade_successors")
        with self._lock:
            self._checkpoint()
            op = self._op_map().get(op_id)
            if not op:
                raise NotFoundException("工序不存在")
            if not op.get("plan_start"):
                raise ValidationException("工序尚未排产")
            pva = self._plan_vs_actual(op)
            if action != "cascade_successors" and not pva.get("has_variance") and not pva.get("has_actual"):
                raise ValidationException("当前没有可处置的计划/实绩偏差")

            touched: list[str] = []
            now = datetime.now().isoformat(timespec="seconds")
            msg = ""

            if action == "keep":
                if not pva.get("has_variance"):
                    raise ValidationException("当前没有需要确认的偏差")
                op["variance_ack"] = {
                    "action": "keep",
                    "at": now,
                    "note": (note or "保持计划，仅记录偏差").strip(),
                    "fingerprint": self._variance_fingerprint(op),
                }
                msg = "已确认保持计划，偏差仅作记录"

            elif action == "adopt_actual":
                if not pva.get("has_actual"):
                    raise ValidationException("尚无实绩，无法跟实现")
                a0, a1 = pva.get("actual_start"), pva.get("actual_end")
                if not a0:
                    raise ValidationException("尚无实绩开始日")
                if not op.get("original_plan_start"):
                    op["original_plan_start"] = (op.get("plan_start") or "")[:10]
                old_days = int(op.get("duration_days") or 0) or (
                    _duration_days(op["plan_start"], op["plan_end"])
                    if op.get("plan_start") and op.get("plan_end")
                    else 2
                )
                # 跟实现：计划窗对齐实绩；进行中用实绩起 + 原时长（必要时延到今天）
                op["plan_start"] = a0
                if op.get("status") == "done" and a1:
                    days = max(1, _duration_days(a0, a1))
                    op["plan_end"] = a1
                    op["duration_days"] = days
                else:
                    days = max(1, old_days)
                    plan_end = _end_from_start(a0, days)
                    if a1 and a1 > plan_end:
                        plan_end = a1
                        days = max(1, _duration_days(a0, plan_end))
                    today_iso = _planning_today().isoformat()
                    if op.get("status") in ("running", "paused") and today_iso > plan_end:
                        plan_end = today_iso
                        days = max(1, _duration_days(a0, plan_end))
                    op["plan_end"] = plan_end
                    op["duration_days"] = days
                op["plan_drift"] = None
                if cascade:
                    touched = self._cascade_successors_unlocked(op_id)
                op["variance_ack"] = {
                    "action": "adopt_actual",
                    "at": now,
                    "note": (note or "计划已跟实现").strip(),
                    "fingerprint": self._variance_fingerprint(op),
                }
                msg = "计划已跟实现"
                if touched:
                    msg += f"，并顺延后置 {len(touched)} 道"

            else:  # cascade_successors
                # 若已完工且实绩结束晚于计划，先把本工序 plan_end 锚到实绩结束，再顺延
                a0, a1 = self._effective_actual_window(op)
                if op.get("status") == "done" and a1:
                    pe = (op.get("plan_end") or "")[:10]
                    if pe and a1 > pe:
                        if not op.get("original_plan_start"):
                            op["original_plan_start"] = (op.get("plan_start") or "")[:10]
                        ps = (op.get("plan_start") or a0 or a1)[:10]
                        op["plan_end"] = a1
                        op["duration_days"] = max(1, _duration_days(ps, a1))
                touched = self._cascade_successors_unlocked(op_id)
                op["variance_ack"] = {
                    "action": "cascade_successors",
                    "at": now,
                    "note": (note or "已顺延未开工后置").strip(),
                    "fingerprint": self._variance_fingerprint(op),
                }
                if not touched:
                    msg = "后置工序无需调整（无未排后置或已对齐）"
                else:
                    msg = f"已顺延未开工后置 {len(touched)} 道（本工序实绩未改写为涂抹历史）"

            enriched = self._enrich_op(op)
            if op.get("plan_start"):
                enriched["busy_hints"] = self._person_busy_hints(op, op["plan_start"][:10])
            return {
                "operation": enriched,
                "action": action,
                "touched_op_ids": touched,
                "message": msg,
            }

    def _busy_fingerprint(self, op: dict, other: dict, person_id: str) -> str:
        """计划窗/班次/派人一变，指纹变 → 旧「确认并行」作废。"""
        a, b = (op, other) if op["id"] <= other["id"] else (other, op)

        def part(x: dict) -> str:
            return "|".join(
                [
                    x["id"],
                    (x.get("plan_start") or "")[:10],
                    (x.get("plan_end") or x.get("plan_start") or "")[:10],
                    x.get("slot") or "full",
                    ",".join(sorted(_assignee_ids_of(x))),
                ]
            )

        return f"{person_id}#{part(a)}#{part(b)}"

    def _find_busy_ack(self, op_id: str, other_op_id: str, person_id: str, fingerprint: str) -> dict | None:
        pair = tuple(sorted([op_id, other_op_id]))
        for ack in self._data.get("busy_acks") or []:
            if ack.get("person_id") != person_id:
                continue
            ap = tuple(sorted([ack.get("op_id") or "", ack.get("other_op_id") or ""]))
            if ap != pair:
                continue
            if ack.get("fingerprint") == fingerprint:
                return ack
        return None

    def _person_busy_hints(self, op: dict, day: str) -> list[dict]:
        """同一人在同日时段若还有别的订单任务，给出提示；已确认并行的降级标记。"""
        _normalize_op_fields(op)
        hints: list[dict] = []
        persons = self._person_map()
        wos = self._wo_map()
        orders = self._order_map()
        my_order = wos.get(op["work_order_id"], {}).get("order_id")
        for pid in _assignee_ids_of(op):
            for other in self._data["operations"]:
                if other["id"] == op["id"] or other["status"] == "done":
                    continue
                if not other.get("plan_start") or not other.get("plan_end"):
                    continue
                if day < other["plan_start"][:10] or day > other["plan_end"][:10]:
                    continue
                if not self._ops_shift_overlap(op, other):
                    continue
                if pid not in _assignee_ids_of(other):
                    continue
                owo = wos.get(other["work_order_id"], {})
                oord = orders.get(owo.get("order_id") or "", {})
                if owo.get("order_id") == my_order:
                    continue
                fp = self._busy_fingerprint(op, other, pid)
                ack = self._find_busy_ack(op["id"], other["id"], pid, fp)
                acknowledged = bool(ack)
                base_msg = (
                    f"{persons.get(pid, {}).get('name') or pid} 当天已有"
                    f"{oord.get('code') or ''}·{other['name']}"
                    f"（{SLOT_LABEL.get(other.get('slot') or 'full', '全天')}）"
                )
                hints.append(
                    {
                        "person_id": pid,
                        "person_name": persons.get(pid, {}).get("name") or pid,
                        "other_op_id": other["id"],
                        "other_op": other["name"],
                        "other_order_code": oord.get("code"),
                        "other_slot": other.get("slot") or "full",
                        "acknowledged": acknowledged,
                        "acknowledged_at": (ack or {}).get("acknowledged_at"),
                        "message": (
                            f"{base_msg} · 已确认并行"
                            if acknowledged
                            else base_msg
                        ),
                    }
                )
        return hints

    def acknowledge_busy(
        self,
        op_id: str,
        *,
        other_op_id: str | None = None,
        person_id: str | None = None,
        note: str | None = None,
    ) -> dict:
        """排产员确认「同人多单」合理：降级提示并留痕；计划一变自动作废。"""
        with self._lock:
            op = self._op_map().get(op_id)
            if not op:
                raise NotFoundException("工序不存在")
            if not op.get("plan_start"):
                raise ValidationException("工序尚未排产")
            # 汇总计划窗内各天的 busy 对，去重后写入 ack
            start = _parse(op["plan_start"][:10])
            end = _parse((op.get("plan_end") or op["plan_start"])[:10])
            pairs: dict[tuple[str, str, str], tuple[dict, dict]] = {}
            cur = start
            while cur <= end:
                day = cur.isoformat()
                for h in self._person_busy_hints(op, day):
                    oid = h.get("other_op_id") or ""
                    pid = h.get("person_id") or ""
                    if not oid or not pid:
                        continue
                    if other_op_id and oid != other_op_id:
                        continue
                    if person_id and pid != person_id:
                        continue
                    if h.get("acknowledged"):
                        continue
                    other = self._op_map().get(oid)
                    if not other:
                        continue
                    key = (op_id, oid, pid)
                    pairs[key] = (op, other)
                cur += timedelta(days=1)

            if not pairs:
                raise ValidationException("没有待确认的并行提示（可能已确认或计划已变）")

            now = datetime.now().isoformat(timespec="seconds")
            self._data.setdefault("busy_acks", [])
            created = 0
            for (oid, ooid, pid), (a, b) in pairs.items():
                fp = self._busy_fingerprint(a, b, pid)
                # 去掉同 pair 的旧 ack（指纹过期的）
                self._data["busy_acks"] = [
                    x
                    for x in self._data["busy_acks"]
                    if not (
                        x.get("person_id") == pid
                        and tuple(sorted([x.get("op_id") or "", x.get("other_op_id") or ""]))
                        == tuple(sorted([oid, ooid]))
                    )
                ]
                self._data["busy_acks"].append(
                    {
                        "id": self._next_id("busy_ack", "ba"),
                        "op_id": oid,
                        "other_op_id": ooid,
                        "person_id": pid,
                        "fingerprint": fp,
                        "acknowledged_at": now,
                        "note": (note or "确认并行").strip() or "确认并行",
                    }
                )
                created += 1

            enriched = self._enrich_op(op)
            enriched["busy_hints"] = self._person_busy_hints(op, op["plan_start"][:10])
            return {
                "operation": enriched,
                "acked": created,
                "message": f"已确认 {created} 条并行安排，提示已降级",
            }

    def _effective_due(self, wo: dict, order: dict | None = None) -> str | None:
        """甘特交期以订单为准（与交期竖线一致），无订单交期再回落工单。"""
        if order is None:
            order = self._order_map().get(wo.get("order_id") or "", {})
        due = (order.get("due_date") or wo.get("due_date") or "")[:10]
        return due or None

    def _delay_days(self, op: dict, wo: dict, order: dict | None = None) -> int:
        due = self._effective_due(wo, order)
        if not due or not op.get("plan_end"):
            return 0
        delta = (_parse(op["plan_end"][:10]) - _parse(due)).days
        return max(delta, 0)

    def _sync_order_status(self, order_id: str | None) -> None:
        if not order_id:
            return
        order = self._order_map().get(order_id)
        if not order:
            return
        wos = [w for w in self._data["work_orders"] if w.get("order_id") == order_id]
        if not wos:
            order["status"] = "open"
            return
        if all(w["status"] == "done" for w in wos):
            order["status"] = "done"
        elif any(w["status"] == "producing" for w in wos):
            order["status"] = "producing"
        else:
            order["status"] = "open"

    def _sync_work_order_status(self, wo_id: str) -> None:
        ops = [o for o in self._data["operations"] if o["work_order_id"] == wo_id]
        wo = self._wo_map().get(wo_id)
        if not wo or not ops:
            return
        # 已作废不随工序回写
        if wo.get("status") == "cancelled":
            self._sync_order_status(wo.get("order_id"))
            return
        # 忽略已作废工序
        ops = [o for o in ops if o.get("status") != "cancelled"]
        if not ops:
            return
        if all(o["status"] == "done" for o in ops):
            wo["status"] = "done"
        elif any(o["status"] in ("running", "paused", "done") for o in ops):
            wo["status"] = "producing"
        else:
            wo["status"] = "pending"
        self._sync_order_status(wo.get("order_id"))

    def _cancelled_work_order_ids(self) -> set[str]:
        return {
            w["id"]
            for w in (self._data.get("work_orders") or [])
            if w.get("status") == "cancelled"
        }

    def _ensure_order_for_work_order(self, payload: dict[str, Any]) -> str:
        """创建工单时：挂已有订单，或自动生成客户订单/内部生产任务。"""
        order_id = payload.get("order_id")
        if order_id:
            if order_id not in self._order_map():
                raise NotFoundException("订单不存在")
            return order_id

        source_type = payload.get("source_type") or "internal"
        if source_type not in ("customer", "internal"):
            source_type = "internal"
        seq = self._data["_seq"].get("order", 0) + 1
        self._data["_seq"]["order"] = seq
        prefix = "SO" if source_type == "customer" else "INT"
        order = {
            "id": f"ord-{seq}",
            "code": f"{prefix}-202609-{seq:03d}",
            "name": payload.get("order_name") or payload["name"],
            "source_type": source_type,
            "customer_name": payload.get("customer_name") if source_type == "customer" else None,
            "product": payload.get("product") or "",
            "due_date": payload["due_date"],
            "status": "open",
        }
        self._data["orders"].append(order)
        return order["id"]

    def _append_event(self, person_name: str, op_name: str, message: str) -> None:
        now = datetime.now().strftime("%H:%M")
        self._data["events"].insert(
            0,
            {
                "id": self._next_id("event", "ev"),
                "at": now,
                "person_name": person_name,
                "op_name": op_name,
                "message": message,
            },
        )
        self._data["events"] = self._data["events"][:30]

    # ----- master data -----

    def master_overview(self) -> dict[str, Any]:
        with self._lock:
            self._ensure_three_shift_regime_unlocked()
            self._ensure_shift_sort_orders_unlocked()
            persons = self._data["persons"]
            active = sum(1 for p in persons if p["status"] == "active")
            templates = self._data["templates"]
            open_leaves = [
                lv for lv in (self._data.get("leaves") or []) if lv.get("status") != "closed"
            ]
            shift_assignments = [
                self._enrich_shift_assignment(a)
                for a in (self._data.get("shift_assignments") or [])
            ]
            today = date.today().isoformat()
            week_start = (date.today() - timedelta(days=date.today().weekday())).isoformat()
            week_dates = [
                (date.fromisoformat(week_start) + timedelta(days=i)).isoformat() for i in range(7)
            ]
            fam_names: dict[str, str] = {}
            for s in self._data.get("shifts") or []:
                if s.get("status") == "active":
                    fam_names.setdefault(s["family_id"], s.get("name") or s["family_id"])

            def _day_roster_cell(person_id: str, day: str) -> dict:
                return self._roster_cell_for_day_unlocked(person_id, day, fam_names)

            self._ensure_resources_shape_unlocked()
            self._ensure_equipments_shape_unlocked()
            resources = self._data.get("resources") or []
            active_resources = sum(1 for r in resources if r.get("status") != "disabled")
            equipments = self._data.get("equipments") or []
            active_equipments = sum(1 for e in equipments if e.get("status") == "active")
            shared_equipments = sum(
                1 for e in equipments if e.get("status") == "active" and not e.get("resource_id")
            )
            leave_persons = len(
                {
                    lv.get("person_id")
                    for lv in open_leaves
                    if lv.get("person_id")
                }
            )
            person_ratio = f"在岗 {active} 人"
            if leave_persons:
                person_ratio += f"，请假 {leave_persons} 人"
            eq_ratio = f"启用 {active_equipments} 台"
            if shared_equipments:
                eq_ratio += f"，公共 {shared_equipments} 台"
            self._ensure_skills_shape_unlocked()
            skills = self._data.get("skills") or []
            active_skills = sum(1 for s in skills if s.get("status") == "active")
            return {
                "kpis": [
                    {"title": "人员总数", "value": len(persons), "ratio": person_ratio},
                    {
                        "title": "班组",
                        "value": len(resources),
                        "ratio": f"启用 {active_resources} 个",
                    },
                    {
                        "title": "技能",
                        "value": len(skills),
                        "ratio": f"启用 {active_skills} 种",
                    },
                    {
                        "title": "设备",
                        "value": len(equipments),
                        "ratio": eq_ratio,
                    },
                    {
                        "title": "工序模板",
                        "value": len(templates),
                        "ratio": f"启用 {sum(1 for t in templates if t['status'] == 'active')} 个",
                    },
                ],
                "skills": self._list_skills_unlocked(),
                "resources": self._list_resources_unlocked(),
                "equipments": self._list_equipments_unlocked(),
                "shifts": [self._enrich_shift(s) for s in (self._data.get("shifts") or [])],
                "shift_options": [
                    self._enrich_shift(s) for s in self._ordered_active_shifts_unlocked()
                    if self._shift_lifecycle(s)[0] in ("active", "upcoming")
                ],
                "day_segments": self._day_segments_unlocked(),
                "persons": [
                    {
                        **p,
                        "skill_names": [
                            self._skill_map()[sid]["name"]
                            for sid in p.get("skill_ids", [])
                            if sid in self._skill_map()
                        ],
                        "resource_name": self._resource_map()
                        .get(p.get("resource_id") or "", {})
                        .get("name"),
                        "shift_family_ids": list(p.get("shift_family_ids") or []),
                        "shift_names": [
                            next(
                                (
                                    s["name"]
                                    for s in (self._data.get("shifts") or [])
                                    if s.get("family_id") == fid and s.get("status") == "active"
                                ),
                                fid,
                            )
                            for fid in (p.get("shift_family_ids") or [])
                        ],
                        # 今日当班：从排班/请假推导，不是长期任职
                        "today_roster": {
                            "day": today,
                            **_day_roster_cell(p["id"], today),
                        },
                        # 本周缩略：白/中/夜/假/—
                        "week_roster_labels": [
                            _day_roster_cell(p["id"], d)["label"] for d in week_dates
                        ],
                        "week_start": week_start,
                    }
                    for p in persons
                ],
                "templates": [
                    {
                        **t,
                        "skill_name": self._skill_map().get(t["skill_id"], {}).get("name"),
                        "equipment_ids": list(t.get("equipment_ids") or []),
                        "equipment_names": [
                            self._equipment_map()[eid]["name"]
                            for eid in (t.get("equipment_ids") or [])
                            if eid in self._equipment_map()
                        ],
                        "prev_template_name": next(
                            (
                                x["name"]
                                for x in templates
                                if x["id"] == t.get("prev_template_id")
                            ),
                            None,
                        ),
                        "sample_count": len(t.get("actual_samples") or []),
                        "suggested_days": t.get("suggested_days"),
                        "suggested_hours": t.get("suggested_hours"),
                    }
                    for t in templates
                ],
                "leaves": [self._enrich_leave(lv) for lv in (self._data.get("leaves") or [])],
                "substitutions": [
                    self._enrich_substitution(s) for s in (self._data.get("substitutions") or [])
                ],
                "shift_assignments": shift_assignments,
            }

    def _date_ranges_overlap(self, a0: str, a1: str, b0: str, b1: str) -> bool:
        return not (_parse(a1) < _parse(b0) or _parse(b1) < _parse(a0))

    def _ops_hit_by_leave_unlocked(self, leave: dict) -> list[dict]:
        pid = leave.get("person_id") or ""
        ls, le = leave.get("start_date") or "", leave.get("end_date") or ""
        if not pid or not ls or not le:
            return []
        hit: list[dict] = []
        for op in self._data["operations"]:
            if op.get("status") == "done":
                continue
            if pid not in _assignee_ids_of(op):
                continue
            ps, pe = op.get("plan_start") or "", op.get("plan_end") or ""
            if not ps or not pe:
                continue
            if self._date_ranges_overlap(ps, pe, ls, le):
                hit.append(op)
        return hit

    def _enrich_leave(self, leave: dict) -> dict:
        person = self._person_map().get(leave.get("person_id") or "", {})
        affected = [self._enrich_op(o) for o in self._ops_hit_by_leave_unlocked(leave)]
        return {
            **deepcopy(leave),
            "person_name": person.get("name"),
            "person_code": person.get("code"),
            "affected_ops": affected,
            "affected_count": len(affected),
        }

    def _enrich_substitution(self, sub: dict) -> dict:
        persons = self._person_map()
        op = self._op_map().get(sub.get("op_id") or "")
        wo = self._wo_map().get((op or {}).get("work_order_id") or "", {})
        order = self._order_map().get(wo.get("order_id") or "", {}) if wo else {}

        def names(ids: list[str] | None) -> str:
            return "、".join(
                persons.get(pid, {}).get("name") or pid for pid in (ids or [])
            )

        return {
            **deepcopy(sub),
            "from_names": names(sub.get("from_person_ids")),
            "to_names": names(sub.get("to_person_ids")),
            "op_name": (op or {}).get("name"),
            "order_code": order.get("code"),
            "order_name": order.get("name"),
            "leave_reason": next(
                (
                    lv.get("reason")
                    for lv in (self._data.get("leaves") or [])
                    if lv.get("id") == sub.get("leave_id")
                ),
                None,
            ),
        }

    def create_leave(self, payload: dict[str, Any]) -> dict:
        with self._lock:
            pid = payload.get("person_id") or ""
            person = self._person_map().get(pid)
            if not person:
                raise NotFoundException("人员不存在")
            start = (payload.get("start_date") or "")[:10]
            end = (payload.get("end_date") or start)[:10]
            if not start:
                raise ValidationException("请填写请假开始日")
            if _parse(end) < _parse(start):
                raise ValidationException("结束日不能早于开始日")
            leave = {
                "id": self._next_id("leave", "leave"),
                "person_id": pid,
                "start_date": start,
                "end_date": end,
                "reason": (payload.get("reason") or "").strip() or "事假",
                "status": "open",
            }
            self._data.setdefault("leaves", []).append(leave)
            # 仅当请假覆盖「今天」才标 status=leave；派工按日判断请假台账
            self._sync_person_leave_status_unlocked()
            return self._enrich_leave(leave)

    def close_leave(self, leave_id: str) -> dict:
        with self._lock:
            leave = next(
                (lv for lv in (self._data.get("leaves") or []) if lv["id"] == leave_id),
                None,
            )
            if not leave:
                raise NotFoundException("请假记录不存在")
            leave["status"] = "closed"
            self._sync_person_leave_status_unlocked()
            return self._enrich_leave(leave)

    def reassign_for_leave(self, payload: dict[str, Any]) -> dict:
        """请假场景改派：更新工序责任人，并写入替班台账。"""
        with self._lock:
            op_id = payload.get("op_id") or ""
            leave_id = payload.get("leave_id")
            new_ids = [str(x) for x in (payload.get("assignee_ids") or []) if x]
            if not op_id:
                raise ValidationException("缺少工序 id")
            if not new_ids:
                raise ValidationException("请指定替班人员")
            op = self._op_map().get(op_id)
            if not op:
                raise NotFoundException("工序不存在")
            if op.get("status") == "done":
                raise ValidationException("已完工工序不可改派")
            for pid in new_ids:
                if pid not in self._person_map():
                    raise ValidationException(f"人员不存在：{pid}")
            if leave_id:
                leave = next(
                    (lv for lv in (self._data.get("leaves") or []) if lv["id"] == leave_id),
                    None,
                )
                if not leave:
                    raise NotFoundException("请假记录不存在")
            else:
                leave = None

            self._checkpoint()
            from_ids = list(_assignee_ids_of(op))
            # 若绑定请假：用替班人替换请假人，保留其他责任人
            if leave and leave["person_id"] in from_ids:
                kept = [x for x in from_ids if x != leave["person_id"]]
                merged = kept + [pid for pid in new_ids if pid not in kept]
                final_ids = merged or new_ids
            else:
                final_ids = new_ids
            op["assignee_ids"] = final_ids
            op["assignee_id"] = final_ids[0]
            _normalize_op_fields(op)

            sub = {
                "id": self._next_id("substitution", "sub"),
                "leave_id": leave_id,
                "op_id": op_id,
                "from_person_ids": from_ids,
                "to_person_ids": final_ids,
                "at": datetime.now().strftime("%Y-%m-%d %H:%M"),
                "note": (payload.get("note") or "").strip() or None,
            }
            self._data.setdefault("substitutions", []).append(sub)

            # 若该请假下已无受影响工序，自动关闭
            if leave and not self._ops_hit_by_leave_unlocked(leave):
                leave["status"] = "closed"

            return {
                "operation": self._enrich_op(op),
                "substitution": self._enrich_substitution(sub),
                "leave": self._enrich_leave(leave) if leave else None,
                "gantt": self.gantt_overview_unlocked(),
            }

    def _list_resources_unlocked(self) -> list[dict[str, Any]]:
        self._ensure_resources_shape_unlocked()
        rows = sorted(
            self._data.get("resources") or [],
            key=lambda r: (int(r.get("sort") or 0), str(r.get("name") or "")),
        )
        out: list[dict[str, Any]] = []
        for r in rows:
            rid = r.get("id")
            member_count = sum(
                1
                for p in (self._data.get("persons") or [])
                if p.get("resource_id") == rid and p.get("status") != "disabled"
            )
            out.append(
                {
                    **deepcopy(r),
                    "member_count": member_count,
                    "status_label": "启用" if r.get("status") == "active" else "停用",
                }
            )
        return out

    def upsert_resource(self, payload: dict[str, Any], resource_id: str | None = None) -> dict:
        """新增或更新班组。"""
        with self._lock:
            self._ensure_resources_shape_unlocked()
            name = (payload.get("name") or "").strip()
            code = (payload.get("code") or "").strip().upper()
            if not name:
                raise ValidationException("班组名称必填")
            if not code:
                raise ValidationException("班组编码必填")
            status = (payload.get("status") or "active").strip() or "active"
            if status not in ("active", "disabled"):
                raise ValidationException("班组状态无效")
            sort = int(payload["sort"]) if payload.get("sort") is not None else None

            if resource_id:
                row = next((r for r in self._data["resources"] if r["id"] == resource_id), None)
                if not row:
                    raise NotFoundException("班组不存在")
                dup = next(
                    (
                        r
                        for r in self._data["resources"]
                        if r["id"] != resource_id and (r.get("code") or "").upper() == code
                    ),
                    None,
                )
                if dup:
                    raise ValidationException("班组编码已存在")
                row["name"] = name
                row["code"] = code
                row["status"] = status
                if sort is not None:
                    row["sort"] = sort
                return deepcopy(row)

            dup = next(
                (r for r in self._data["resources"] if (r.get("code") or "").upper() == code),
                None,
            )
            if dup:
                raise ValidationException("班组编码已存在")
            if sort is None:
                sorts = [int(r.get("sort") or 0) for r in self._data["resources"]]
                sort = (max(sorts) if sorts else 0) + 10
            row = {
                "id": self._next_id("resource", "res"),
                "code": code,
                "name": name,
                "status": status,
                "sort": sort,
            }
            self._data["resources"].append(row)
            return deepcopy(row)

    def delete_resource(self, resource_id: str, *, migrate_to: str | None = None) -> dict:
        """删除班组；有人员时须指定 migrate_to 迁出，或禁止删除。"""
        with self._lock:
            self._ensure_resources_shape_unlocked()
            row = next((r for r in self._data["resources"] if r["id"] == resource_id), None)
            if not row:
                raise NotFoundException("班组不存在")
            members = [p for p in self._data["persons"] if p.get("resource_id") == resource_id]
            if members:
                if not migrate_to:
                    raise ValidationException(
                        f"班组下仍有 {len(members)} 名人员，请先迁移到其他班组再删除"
                    )
                if migrate_to == resource_id:
                    raise ValidationException("迁移目标不能是当前班组")
                target = next((r for r in self._data["resources"] if r["id"] == migrate_to), None)
                if not target:
                    raise NotFoundException("迁移目标班组不存在")
                if target.get("status") == "disabled":
                    raise ValidationException("不能迁移到已停用班组")
                for p in members:
                    p["resource_id"] = migrate_to
            # 工序上的班组引用：清空为 None 或改到目标
            for op in self._data.get("operations") or []:
                if op.get("resource_id") == resource_id:
                    op["resource_id"] = migrate_to
            self._data["resources"] = [r for r in self._data["resources"] if r["id"] != resource_id]
            return {
                "ok": True,
                "deleted_id": resource_id,
                "migrated_persons": len(members),
                "migrate_to": migrate_to,
            }

    def upsert_skill(self, payload: dict[str, Any], skill_id: str | None = None) -> dict:
        """新增或更新技能。"""
        with self._lock:
            self._ensure_skills_shape_unlocked()
            name = (payload.get("name") or "").strip()
            code = (payload.get("code") or "").strip().upper()
            if not name:
                raise ValidationException("技能名称必填")
            if not code:
                raise ValidationException("技能编码必填")
            status = (payload.get("status") or "active").strip() or "active"
            if status not in ("active", "disabled"):
                raise ValidationException("技能状态无效")
            sort = int(payload["sort"]) if payload.get("sort") is not None else None

            if skill_id:
                row = next((s for s in self._data["skills"] if s["id"] == skill_id), None)
                if not row:
                    raise NotFoundException("技能不存在")
                dup = next(
                    (
                        s
                        for s in self._data["skills"]
                        if s["id"] != skill_id and (s.get("code") or "").upper() == code
                    ),
                    None,
                )
                if dup:
                    raise ValidationException("技能编码已存在")
                row["name"] = name
                row["code"] = code
                row["status"] = status
                if sort is not None:
                    row["sort"] = sort
                return deepcopy(row)

            dup = next(
                (s for s in self._data["skills"] if (s.get("code") or "").upper() == code),
                None,
            )
            if dup:
                raise ValidationException("技能编码已存在")
            if sort is None:
                sorts = [int(s.get("sort") or 0) for s in self._data["skills"]]
                sort = (max(sorts) if sorts else 0) + 10
            row = {
                "id": self._next_id("skill", "sk"),
                "code": code,
                "name": name,
                "status": status,
                "sort": sort,
            }
            self._data["skills"].append(row)
            return deepcopy(row)

    def delete_skill(self, skill_id: str, *, migrate_to: str | None = None) -> dict:
        """删除技能；人员或模板仍引用时须 migrate_to。"""
        with self._lock:
            self._ensure_skills_shape_unlocked()
            row = next((s for s in self._data["skills"] if s["id"] == skill_id), None)
            if not row:
                raise NotFoundException("技能不存在")
            persons = [
                p
                for p in self._data.get("persons") or []
                if skill_id in (p.get("skill_ids") or [])
            ]
            templates = [
                t
                for t in self._data.get("templates") or []
                if t.get("skill_id") == skill_id
            ]
            ops = [
                o
                for o in self._data.get("operations") or []
                if o.get("skill_id") == skill_id
            ]
            need_migrate = bool(persons or templates or ops)
            if need_migrate:
                if not migrate_to:
                    raise ValidationException(
                        f"仍有 {len(persons)} 名人员、{len(templates)} 个模板、"
                        f"{len(ops)} 道工序引用该技能，请先迁移到其他技能再删除"
                    )
                if migrate_to == skill_id:
                    raise ValidationException("迁移目标不能是当前技能")
                target = next(
                    (s for s in self._data["skills"] if s["id"] == migrate_to), None
                )
                if not target:
                    raise NotFoundException("迁移目标技能不存在")
                if target.get("status") == "disabled":
                    raise ValidationException("不能迁移到已停用技能")
                for p in persons:
                    ids = [migrate_to if x == skill_id else x for x in (p.get("skill_ids") or [])]
                    # 去重保序
                    seen: set[str] = set()
                    cleaned: list[str] = []
                    for x in ids:
                        if not x or x in seen:
                            continue
                        seen.add(x)
                        cleaned.append(x)
                    p["skill_ids"] = cleaned
                for t in templates:
                    t["skill_id"] = migrate_to
                for o in ops:
                    o["skill_id"] = migrate_to
            self._data["skills"] = [s for s in self._data["skills"] if s["id"] != skill_id]
            return {
                "ok": True,
                "deleted_id": skill_id,
                "migrated_persons": len(persons),
                "migrated_templates": len(templates),
                "migrated_ops": len(ops),
                "migrate_to": migrate_to,
            }

    def _list_equipments_unlocked(self) -> list[dict[str, Any]]:
        self._ensure_equipments_shape_unlocked()
        resources = self._resource_map()
        rows = sorted(
            self._data.get("equipments") or [],
            key=lambda e: (int(e.get("sort") or 0), str(e.get("name") or "")),
        )
        out: list[dict[str, Any]] = []
        for e in rows:
            rid = e.get("resource_id")
            op_count = sum(
                1
                for op in (self._data.get("operations") or [])
                if op.get("equipment_id") == e.get("id") and op.get("status") != "cancelled"
            )
            out.append(
                {
                    **deepcopy(e),
                    "resource_name": resources.get(rid or "", {}).get("name") if rid else None,
                    "is_shared": not rid,
                    "op_count": op_count,
                    "status_label": "启用" if e.get("status") == "active" else "停用",
                }
            )
        return out

    def upsert_equipment(self, payload: dict[str, Any], equipment_id: str | None = None) -> dict:
        """新增或更新设备。"""
        with self._lock:
            self._ensure_equipments_shape_unlocked()
            self._ensure_resources_shape_unlocked()
            name = (payload.get("name") or "").strip()
            code = (payload.get("code") or "").strip().upper()
            if not name:
                raise ValidationException("设备名称必填")
            if not code:
                raise ValidationException("设备编码必填")
            status = (payload.get("status") or "active").strip() or "active"
            if status not in ("active", "disabled"):
                raise ValidationException("设备状态无效")
            rid = payload.get("resource_id") or None
            if rid:
                res = self._resource_map().get(rid)
                if not res:
                    raise ValidationException("所属班组不存在")
            sort = int(payload["sort"]) if payload.get("sort") is not None else None

            if equipment_id:
                row = next(
                    (e for e in self._data["equipments"] if e["id"] == equipment_id), None
                )
                if not row:
                    raise NotFoundException("设备不存在")
                dup = next(
                    (
                        e
                        for e in self._data["equipments"]
                        if e["id"] != equipment_id and (e.get("code") or "").upper() == code
                    ),
                    None,
                )
                if dup:
                    raise ValidationException("设备编码已存在")
                row["name"] = name
                row["code"] = code
                row["status"] = status
                row["resource_id"] = rid
                if sort is not None:
                    row["sort"] = sort
                return deepcopy(row)

            dup = next(
                (e for e in self._data["equipments"] if (e.get("code") or "").upper() == code),
                None,
            )
            if dup:
                raise ValidationException("设备编码已存在")
            if sort is None:
                sorts = [int(e.get("sort") or 0) for e in self._data["equipments"]]
                sort = (max(sorts) if sorts else 0) + 10
            row = {
                "id": self._next_id("equipment", "eq"),
                "code": code,
                "name": name,
                "status": status,
                "resource_id": rid,
                "sort": sort,
            }
            self._data["equipments"].append(row)
            return deepcopy(row)

    def delete_equipment(self, equipment_id: str, *, migrate_to: str | None = None) -> dict:
        """删除设备；有工序占用时须 migrate_to 或先清空。"""
        with self._lock:
            self._ensure_equipments_shape_unlocked()
            row = next(
                (e for e in self._data["equipments"] if e["id"] == equipment_id), None
            )
            if not row:
                raise NotFoundException("设备不存在")
            users = [
                op
                for op in self._data.get("operations") or []
                if op.get("equipment_id") == equipment_id
            ]
            if users:
                if not migrate_to:
                    raise ValidationException(
                        f"仍有 {len(users)} 道工序占用该设备，请先迁移或清空后再删除"
                    )
                if migrate_to == equipment_id:
                    raise ValidationException("迁移目标不能是当前设备")
                target = next(
                    (e for e in self._data["equipments"] if e["id"] == migrate_to), None
                )
                if not target:
                    raise NotFoundException("迁移目标设备不存在")
                if target.get("status") == "disabled":
                    raise ValidationException("不能迁移到已停用设备")
                for op in users:
                    op["equipment_id"] = migrate_to
            for t in self._data.get("templates") or []:
                ids = list(t.get("equipment_ids") or [])
                if equipment_id in ids:
                    t["equipment_ids"] = [
                        migrate_to if x == equipment_id else x
                        for x in ids
                        if x != equipment_id or migrate_to
                    ]
                    # 去重保序
                    seen: set[str] = set()
                    cleaned: list[str] = []
                    for x in t["equipment_ids"]:
                        if not x or x in seen:
                            continue
                        seen.add(x)
                        cleaned.append(x)
                    t["equipment_ids"] = cleaned
            self._data["equipments"] = [
                e for e in self._data["equipments"] if e["id"] != equipment_id
            ]
            return {
                "ok": True,
                "deleted_id": equipment_id,
                "migrated_ops": len(users),
                "migrate_to": migrate_to,
            }

    def upsert_person(self, payload: dict[str, Any], person_id: str | None = None) -> dict:
        with self._lock:
            self._ensure_resources_shape_unlocked()
            rid = payload.get("resource_id")
            if rid:
                res = self._resource_map().get(rid)
                if not res:
                    raise ValidationException("所属班组不存在")
                if res.get("status") == "disabled":
                    raise ValidationException("不能挂到已停用班组")
            if person_id:
                person = next((p for p in self._data["persons"] if p["id"] == person_id), None)
                if not person:
                    raise NotFoundException("人员不存在")
                person.update(
                    {
                        "name": payload["name"],
                        "code": payload["code"],
                        "skill_ids": list(payload.get("skill_ids") or []),
                        "status": payload.get("status") or person["status"],
                        "shift_family_ids": list(
                            payload["shift_family_ids"]
                            if "shift_family_ids" in payload
                            else person.get("shift_family_ids") or []
                        ),
                    }
                )
                if "resource_id" in payload:
                    person["resource_id"] = rid or None
                return deepcopy(person)
            person = {
                "id": self._next_id("person", "p"),
                "name": payload["name"],
                "code": payload["code"],
                "skill_ids": list(payload.get("skill_ids") or []),
                "status": payload.get("status") or "active",
                "resource_id": rid or None,
                "shift_family_ids": list(payload.get("shift_family_ids") or ["sh-day", "sh-mid", "sh-night"]),
            }
            self._data["persons"].append(person)
            return deepcopy(person)

    def upsert_template(self, payload: dict[str, Any], template_id: str | None = None) -> dict:
        with self._lock:
            self._ensure_equipments_shape_unlocked()
            eq_ids = payload.get("equipment_ids")
            if eq_ids is not None:
                eq_map = self._equipment_map()
                cleaned: list[str] = []
                for eid in eq_ids or []:
                    eid = str(eid)
                    if eid not in eq_map:
                        raise ValidationException(f"设备不存在：{eid}")
                    if eid not in cleaned:
                        cleaned.append(eid)
                eq_ids = cleaned
            if template_id:
                tpl = next((t for t in self._data["templates"] if t["id"] == template_id), None)
                if not tpl:
                    raise NotFoundException("工序模板不存在")
                tpl.update(
                    {
                        "name": payload["name"],
                        "std_hours": float(payload["std_hours"]),
                        "skill_id": payload["skill_id"],
                        "prev_template_id": payload.get("prev_template_id"),
                        "status": payload.get("status") or tpl["status"],
                    }
                )
                if eq_ids is not None:
                    tpl["equipment_ids"] = eq_ids
                return deepcopy(tpl)
            tpl = {
                "id": self._next_id("template", "tpl"),
                "name": payload["name"],
                "std_hours": float(payload["std_hours"]),
                "skill_id": payload["skill_id"],
                "prev_template_id": payload.get("prev_template_id"),
                "status": payload.get("status") or "active",
                "equipment_ids": list(eq_ids or []),
            }
            self._data["templates"].append(tpl)
            return deepcopy(tpl)

    def create_shift(self, payload: dict[str, Any]) -> dict:
        """新建班次族（version=1，立即生效）。"""
        with self._lock:
            code = (payload.get("code") or "").strip().upper()
            name = (payload.get("name") or "").strip()
            if not code or not name:
                raise ValidationException("班次编码与名称必填")
            start = payload.get("start_time") or "08:00"
            end = payload.get("end_time") or "16:00"
            crosses = bool(payload.get("crosses_midnight"))
            if _parse_hhmm(end) <= _parse_hhmm(start):
                crosses = True
            belong_rule = _normalize_belong_day_rule(payload.get("belong_day_rule"))
            # family_id 用稳定前缀
            family_id = self._next_id("shift_family", "sh")
            # 修正 seq key - use shift_family in _seq
            ver_id = self._next_id("shift_version", "shv")
            self._ensure_shift_sort_orders_unlocked()
            existing_orders = [
                int(s.get("sort_order") or 0)
                for s in (self._data.get("shifts") or [])
                if s.get("sort_order") is not None
            ]
            sort_order = (max(existing_orders) if existing_orders else 0) + 10
            if payload.get("sort_order") is not None:
                try:
                    sort_order = int(payload["sort_order"])
                except (TypeError, ValueError):
                    pass
            shift = {
                "id": ver_id,
                "family_id": family_id,
                "code": code,
                "name": name,
                "version": 1,
                "start_time": start,
                "end_time": end,
                "crosses_midnight": crosses,
                "belong_day_rule": belong_rule,
                "sort_order": sort_order,
                "status": "active",
                "effective_from": (payload.get("effective_from") or date.today().isoformat())[:10],
                "effective_to": (
                    (payload.get("effective_to") or "")[:10] if payload.get("effective_to") else None
                ),
                "superseded_by": None,
                "note": (payload.get("note") or "").strip() or None,
            }
            self._data.setdefault("shifts", []).append(shift)
            return self._enrich_shift(shift)

    def publish_shift_version(self, family_id: str, payload: dict[str, Any]) -> dict:
        """
        发布班次新版本：旧版归档保留，新版生效。
        已排工序若绑定旧 shift_id，仍按旧版时间解释。
        """
        with self._lock:
            family = [
                s for s in (self._data.get("shifts") or []) if s.get("family_id") == family_id
            ]
            if not family:
                raise NotFoundException("班次不存在")
            current = max(
                (s for s in family if s.get("status") == "active"),
                key=lambda s: int(s.get("version") or 0),
                default=max(family, key=lambda s: int(s.get("version") or 0)),
            )
            today = (payload.get("effective_from") or date.today().isoformat())[:10]
            start = payload.get("start_time") or current.get("start_time") or "08:00"
            end = payload.get("end_time") or current.get("end_time") or "16:00"
            crosses = payload.get("crosses_midnight")
            if crosses is None:
                crosses = bool(current.get("crosses_midnight"))
            if _parse_hhmm(end) <= _parse_hhmm(start):
                crosses = True
            if "belong_day_rule" in payload and payload.get("belong_day_rule") is not None:
                belong_rule = _normalize_belong_day_rule(payload.get("belong_day_rule"))
            else:
                belong_rule = _normalize_belong_day_rule(current.get("belong_day_rule"))
            new_id = self._next_id("shift_version", "shv")
            new_ver = int(current.get("version") or 0) + 1
            new_shift = {
                "id": new_id,
                "family_id": family_id,
                "code": (payload.get("code") or current.get("code") or "").strip().upper(),
                "name": (payload.get("name") or current.get("name") or "").strip(),
                "version": new_ver,
                "start_time": start,
                "end_time": end,
                "crosses_midnight": bool(crosses),
                "belong_day_rule": belong_rule,
                "sort_order": int(current.get("sort_order") or 999),
                "status": "active",
                "effective_from": today,
                "effective_to": (
                    (payload.get("effective_to") or "")[:10] if payload.get("effective_to") else None
                ),
                "superseded_by": None,
                "note": (payload.get("note") if payload.get("note") is not None else current.get("note")),
            }
            # 归档所有仍生效的同族版本
            for s in family:
                if s.get("status") == "active":
                    s["status"] = "superseded"
                    s["effective_to"] = today
                    s["superseded_by"] = new_id
            self._data.setdefault("shifts", []).append(new_shift)
            return {
                "current": self._enrich_shift(new_shift),
                "archived": self._enrich_shift(current),
                "history": [
                    self._enrich_shift(s)
                    for s in sorted(
                        [x for x in (self._data.get("shifts") or []) if x.get("family_id") == family_id],
                        key=lambda x: int(x.get("version") or 0),
                        reverse=True,
                    )
                ],
            }

    def reorder_shift_families(self, family_ids: list[str]) -> dict:
        """按传入顺序重排班序；同族所有版本同步 sort_order。影响甘特段序与轮换链。"""
        with self._lock:
            ids = [str(x) for x in (family_ids or []) if x]
            if not ids:
                raise ValidationException("请传入班次族顺序")
            known = {s.get("family_id") for s in (self._data.get("shifts") or []) if s.get("family_id")}
            missing = [fid for fid in ids if fid not in known]
            if missing:
                raise ValidationException(f"班次不存在：{', '.join(missing)}")
            for i, fid in enumerate(ids):
                order = (i + 1) * 10
                for s in self._data.get("shifts") or []:
                    if s.get("family_id") == fid:
                        s["sort_order"] = order
            # 未出现在列表里的族接在后面
            rest = sorted(
                (fid for fid in known if fid not in set(ids)),
                key=lambda fid: (
                    int((self._active_shift_for_family(fid) or {}).get("sort_order") or 999),
                    fid,
                ),
            )
            base = len(ids) * 10
            for j, fid in enumerate(rest):
                order = base + (j + 1) * 10
                for s in self._data.get("shifts") or []:
                    if s.get("family_id") == fid:
                        s["sort_order"] = order
            return {
                "family_ids": self._active_family_ids_ordered_unlocked(),
                "day_segments": self._day_segments_unlocked(),
                "shift_options": [
                    self._enrich_shift(s) for s in self._ordered_active_shifts_unlocked()
                ],
            }

    def list_shift_history(self, family_id: str) -> dict:
        with self._lock:
            rows = [
                self._enrich_shift(s)
                for s in (self._data.get("shifts") or [])
                if s.get("family_id") == family_id
            ]
            if not rows:
                raise NotFoundException("班次不存在")
            rows.sort(key=lambda s: int(s.get("version") or 0), reverse=True)
            return {"family_id": family_id, "items": rows}

    def _family_version_ids(self, family_id: str) -> set[str]:
        return {
            s["id"]
            for s in (self._data.get("shifts") or [])
            if s.get("family_id") == family_id
        }

    def _active_shift_row_of_family(self, family_id: str) -> dict | None:
        rows = [
            s
            for s in (self._data.get("shifts") or [])
            if s.get("family_id") == family_id and s.get("status") == "active"
        ]
        if not rows:
            return None
        rows.sort(key=lambda s: s.get("version") or 0, reverse=True)
        return rows[0]

    def _open_ops_using_family_unlocked(self, family_id: str) -> list[dict]:
        version_ids = self._family_version_ids(family_id)
        hit: list[dict] = []
        for op in self._data.get("operations") or []:
            if op.get("status") == "done":
                continue
            if op.get("shift_family_id") == family_id:
                hit.append(op)
                continue
            sid = op.get("shift_id")
            if sid and sid in version_ids:
                hit.append(op)
        return hit

    def _remap_disabled_shift_refs_unlocked(self) -> dict[str, Any]:
        """把指向已停用/不存在班次的工序与任职，改挂到当前第一个启用班。"""
        active = self._active_family_ids_ordered_unlocked()
        if not active:
            return {"op_count": 0, "assignment_count": 0, "to_family_id": None}
        to_fid = active[0]
        target = self._active_shift_for_family(to_fid)
        op_n = 0
        for op in self._data.get("operations") or []:
            if op.get("status") in ("done", "cancelled"):
                continue
            fam = op.get("shift_family_id")
            if not fam:
                continue
            if self._active_shift_for_family(fam):
                continue
            op["shift_family_id"] = to_fid
            if target:
                op["shift_id"] = target["id"]
            op_n += 1
        asg_n = 0
        for a in self._data.get("shift_assignments") or []:
            if (a.get("status") or "open") == "closed":
                continue
            fam = a.get("shift_family_id")
            if not fam:
                continue
            if self._active_shift_for_family(fam):
                continue
            a["shift_family_id"] = to_fid
            asg_n += 1
        # 人员能力里的停用班去掉，补上目标班
        for p in self._data.get("persons") or []:
            ids = list(p.get("shift_family_ids") or [])
            if not ids:
                continue
            kept = [x for x in ids if self._active_shift_for_family(x)]
            if to_fid not in kept:
                kept.append(to_fid)
            p["shift_family_ids"] = kept
        return {
            "op_count": op_n,
            "assignment_count": asg_n,
            "to_family_id": to_fid,
            "to_name": (target or {}).get("name") or to_fid,
        }

    def shift_family_usage(self, family_id: str) -> dict:
        """停用前占用诊断。"""
        with self._lock:
            family = [
                s for s in (self._data.get("shifts") or []) if s.get("family_id") == family_id
            ]
            if not family:
                raise NotFoundException("班次不存在")
            open_ops = self._open_ops_using_family_unlocked(family_id)
            open_assigns = [
                a
                for a in (self._data.get("shift_assignments") or [])
                if a.get("shift_family_id") == family_id
                and (a.get("status") or "open") != "closed"
            ]
            wos = self._wo_map()
            by_fam: dict[str, dict] = {}
            for s in self._data.get("shifts") or []:
                if s.get("status") != "active" or s.get("family_id") == family_id:
                    continue
                if self._shift_lifecycle(s)[0] not in ("active", "upcoming"):
                    continue
                fid = s["family_id"]
                prev = by_fam.get(fid)
                if not prev or (s.get("version") or 0) > (prev.get("version") or 0):
                    by_fam[fid] = self._enrich_shift(s)
            # 有工序或任职占用时都建议切换；工序占用强制切换
            return {
                "family_id": family_id,
                "family_name": family[-1].get("name") or family_id,
                "open_op_count": len(open_ops),
                "open_assignment_count": len(open_assigns),
                "requires_migrate": len(open_ops) > 0,
                "suggest_migrate": len(open_ops) > 0 or len(open_assigns) > 0,
                "ops": [
                    {
                        "id": o["id"],
                        "name": o.get("name"),
                        "plan_start": o.get("plan_start"),
                        "plan_end": o.get("plan_end"),
                        "work_order_code": (wos.get(o.get("work_order_id") or "") or {}).get(
                            "code"
                        ),
                    }
                    for o in open_ops[:12]
                ],
                "migrate_targets": list(by_fam.values()),
            }

    def delete_shift_family(
        self, family_id: str, migrate_to_family_id: str | None = None
    ) -> dict:
        """停用班次族。有未完成工序时须指定 migrate_to，把旧占用一键切到新班。"""
        with self._lock:
            self._checkpoint()
            family = [
                s for s in (self._data.get("shifts") or []) if s.get("family_id") == family_id
            ]
            if not family:
                raise NotFoundException("班次不存在")
            today = date.today().isoformat()
            open_ops = self._open_ops_using_family_unlocked(family_id)
            open_assigns = [
                a
                for a in (self._data.get("shift_assignments") or [])
                if a.get("shift_family_id") == family_id
                and (a.get("status") or "open") != "closed"
            ]
            migrate_to_family_id = (migrate_to_family_id or "").strip() or None
            target_shift: dict | None = None
            if open_ops:
                if not migrate_to_family_id:
                    raise ValidationException(
                        f"仍有 {len(open_ops)} 道未完成工序使用该班次。"
                        "请先新建目标班次，停用时一键切换过去。"
                    )
            if migrate_to_family_id:
                if migrate_to_family_id == family_id:
                    raise ValidationException("切换目标不能是自身")
                target_shift = self._active_shift_row_of_family(migrate_to_family_id)
                if not target_shift:
                    raise ValidationException("目标班次无效或已停用，请先新建并启用")
                for op in open_ops:
                    op["shift_family_id"] = migrate_to_family_id
                    op["shift_id"] = target_shift["id"]

            migrated_assigns = 0
            closed_assigns = 0
            for a in self._data.get("shift_assignments") or []:
                if a.get("shift_family_id") != family_id:
                    continue
                if (a.get("status") or "open") == "closed":
                    continue
                if migrate_to_family_id and target_shift:
                    a["shift_family_id"] = migrate_to_family_id
                    migrated_assigns += 1
                else:
                    a["status"] = "closed"
                    if not a.get("end_date"):
                        a["end_date"] = today
                    closed_assigns += 1

            for p in self._data.get("persons") or []:
                ids = list(p.get("shift_family_ids") or [])
                if family_id not in ids:
                    continue
                ids = [x for x in ids if x != family_id]
                if migrate_to_family_id and migrate_to_family_id not in ids:
                    ids.append(migrate_to_family_id)
                p["shift_family_ids"] = ids

            for s in family:
                s["status"] = "disabled"
                if not s.get("effective_to"):
                    s["effective_to"] = today

            return {
                "family_id": family_id,
                "migrated_op_count": len(open_ops) if migrate_to_family_id else 0,
                "migrated_assignment_count": migrated_assigns,
                "closed_assignment_count": closed_assigns,
                "open_assignment_count_before": len(open_assigns),
                "migrate_to_family_id": migrate_to_family_id,
                "items": [self._enrich_shift(s) for s in family],
            }

    def create_shift_assignment(self, payload: dict[str, Any]) -> dict:
        with self._lock:
            person_id = payload.get("person_id")
            fam = payload.get("shift_family_id")
            if not person_id or person_id not in self._person_map():
                raise ValidationException("人员无效")
            person = self._person_map()[person_id]
            if not fam or not any(
                s.get("family_id") == fam and s.get("status") != "disabled"
                for s in (self._data.get("shifts") or [])
            ):
                raise ValidationException("班次无效或已停用")
            allowed = person.get("shift_family_ids")
            if allowed is not None and len(allowed) > 0 and fam not in allowed:
                raise ValidationException("该人员不具备此班次能力，请先在人员上勾选可上班次")
            start = (payload.get("start_date") or date.today().isoformat())[:10]
            end = (payload.get("end_date") or "")[:10] or None
            if end and end < start:
                raise ValidationException("结束日期不能早于开始日期")
            # 截断同人重叠的开放任职
            for a in self._data.get("shift_assignments") or []:
                if a.get("person_id") != person_id or (a.get("status") or "open") == "closed":
                    continue
                a_start = (a.get("start_date") or "")[:10]
                a_end_raw = a.get("end_date")
                a_end = (a_end_raw or "")[:10] if a_end_raw else None
                # overlap with [start, end]
                if a_end and a_end < start:
                    continue
                if end and a_start and a_start > end:
                    continue
                # truncate previous: end day before new start
                prev_end = (date.fromisoformat(start) - timedelta(days=1)).isoformat()
                if a_start and a_start > prev_end:
                    a["status"] = "closed"
                    a["end_date"] = a_start
                else:
                    a["end_date"] = prev_end
                    if a.get("end_date") and a["end_date"] < a_start:
                        a["status"] = "closed"
            row = {
                "id": self._next_id("shift_assignment", "psa"),
                "person_id": person_id,
                "shift_family_id": fam,
                "start_date": start,
                "end_date": end,
                "kind": payload.get("kind") or "roster",
                "status": "open",
                "note": (payload.get("note") or "").strip() or None,
            }
            self._data.setdefault("shift_assignments", []).append(row)
            return self._enrich_shift_assignment(row)

    def close_shift_assignment(self, assignment_id: str, end_date: str | None = None) -> dict:
        with self._lock:
            row = next(
                (
                    a
                    for a in (self._data.get("shift_assignments") or [])
                    if a["id"] == assignment_id
                ),
                None,
            )
            if not row:
                raise NotFoundException("任职记录不存在")
            end = (end_date or date.today().isoformat())[:10]
            start = (row.get("start_date") or "")[:10]
            if end < start:
                raise ValidationException("结束日期不能早于开始日期")
            row["end_date"] = end
            row["status"] = "closed"
            return self._enrich_shift_assignment(row)

    def delete_shift_assignment(self, assignment_id: str) -> dict:
        with self._lock:
            rows = self._data.setdefault("shift_assignments", [])
            idx = next((i for i, a in enumerate(rows) if a["id"] == assignment_id), None)
            if idx is None:
                raise NotFoundException("任职记录不存在")
            removed = rows.pop(idx)
            return self._enrich_shift_assignment(removed)

    def _leave_covering_day_unlocked(self, person_id: str, day: str) -> dict | None:
        day = (day or "")[:10]
        for lv in self._data.get("leaves") or []:
            if lv.get("person_id") != person_id:
                continue
            if (lv.get("status") or "open") == "closed":
                continue
            start = (lv.get("start_date") or "")[:10]
            end = (lv.get("end_date") or "")[:10]
            if start and end and start <= day <= end:
                return lv
        return None

    def _family_display_name(self, family_id: str | None) -> str:
        """班次族显示名：优先启用版，否则任意历史版；避免界面露出 sh-xxx。"""
        if not family_id:
            return ""
        active = self._active_shift_for_family(family_id)
        if active and active.get("name"):
            return str(active["name"])
        best = None
        for s in self._data.get("shifts") or []:
            if s.get("family_id") != family_id:
                continue
            if best is None or int(s.get("version") or 0) > int(best.get("version") or 0):
                best = s
        if best and best.get("name"):
            return str(best["name"])
        return str(family_id)

    def _shift_short_name(self, family_id: str | None) -> str:
        if not family_id:
            return ""
        name = self._family_display_name(family_id)
        if name == family_id:
            return name
        if "白" in name or "早" in name:
            return name if len(name) <= 2 else "早"
        if "中" in name:
            return name if len(name) <= 2 else "中"
        if "夜" in name or "晚" in name:
            return name if len(name) <= 2 else "晚"
        return name[:2] if len(name) > 2 else name

    def _carve_person_assignments_for_range_unlocked(
        self, person_id: str, range_start: str, range_end: str
    ) -> None:
        """从任职区间挖空 [range_start, range_end]，便于周历重排。"""
        rs = date.fromisoformat(range_start[:10])
        re = date.fromisoformat(range_end[:10])
        before_end = (rs - timedelta(days=1)).isoformat()
        after_start = (re + timedelta(days=1)).isoformat()
        rows = self._data.setdefault("shift_assignments", [])
        extras: list[dict] = []
        for a in list(rows):
            if a.get("person_id") != person_id or (a.get("status") or "open") == "closed":
                continue
            a_start_s = (a.get("start_date") or "")[:10]
            if not a_start_s:
                continue
            a_start = date.fromisoformat(a_start_s)
            a_end_raw = a.get("end_date")
            a_end = date.fromisoformat(a_end_raw[:10]) if a_end_raw else None
            # 无交集
            if a_end and a_end < rs:
                continue
            if a_start > re:
                continue
            # 完全被周覆盖
            if a_start >= rs and (a_end is None or a_end <= re):
                a["status"] = "closed"
                a["end_date"] = before_end if before_end >= a_start_s else a_start_s
                continue
            # 跨周左段
            if a_start < rs:
                old_end = a_end
                a["end_date"] = before_end
                if a["end_date"] < a_start_s:
                    a["status"] = "closed"
                # 右段：周后仍有
                if old_end is None or old_end > re:
                    extras.append(
                        {
                            "id": self._next_id("shift_assignment", "psa"),
                            "person_id": person_id,
                            "shift_family_id": a.get("shift_family_id"),
                            "start_date": after_start,
                            "end_date": old_end.isoformat() if old_end else None,
                            "kind": a.get("kind") or "roster",
                            "status": "open",
                            "note": a.get("note"),
                        }
                    )
                continue
            # 仅右段伸出（a_start 在周内）
            if a_end is None or a_end > re:
                a["start_date"] = after_start
                if a_end and a["start_date"] > a_end.isoformat()[:10]:
                    a["status"] = "closed"
        rows.extend(extras)

    def _create_assignment_unlocked(self, payload: dict[str, Any]) -> dict:
        """内部创建任职（调用方已持锁、已挖空冲突区间）。"""
        person_id = payload["person_id"]
        fam = payload["shift_family_id"]
        start = payload["start_date"][:10]
        end = (payload.get("end_date") or start)[:10]
        row = {
            "id": self._next_id("shift_assignment", "psa"),
            "person_id": person_id,
            "shift_family_id": fam,
            "start_date": start,
            "end_date": end,
            "kind": payload.get("kind") or "roster",
            "status": "open",
            "note": (payload.get("note") or "").strip() or None,
        }
        self._data.setdefault("shift_assignments", []).append(row)
        return row

    def roster_week(self, week_start: str | None = None) -> dict[str, Any]:
        """周历：人 × 日，格子含班/假/空。"""
        with self._lock:
            return self.roster_week_unlocked(week_start)

    def roster_week_unlocked(self, week_start: str | None = None) -> dict[str, Any]:
        self._ensure_three_shift_regime_unlocked()
        if week_start:
            start = date.fromisoformat(week_start[:10])
        else:
            start = date.today()
        start = start - timedelta(days=start.weekday())  # 对齐周一
        dates = [(start + timedelta(days=i)).isoformat() for i in range(7)]
        week_end = dates[-1]
        persons = [
            p
            for p in (self._data.get("persons") or [])
            if p.get("status") != "disabled"
        ]
        fam_names: dict[str, str] = {}
        for s in self._data.get("shifts") or []:
            fid = s.get("family_id")
            if not fid:
                continue
            # 启用版优先；否则保留已见过的名称
            if s.get("status") == "active" or fid not in fam_names:
                fam_names[fid] = s.get("name") or self._family_display_name(fid) or fid
        rows = []
        for p in persons:
            cells = {
                d: self._roster_cell_for_day_unlocked(p["id"], d, fam_names) for d in dates
            }
            rows.append(
                {
                    "person_id": p["id"],
                    "person_name": p.get("name"),
                    "person_code": p.get("code"),
                    "resource_id": p.get("resource_id"),
                    "shift_family_ids": list(p.get("shift_family_ids") or []),
                    "cells": cells,
                }
            )
        # 班次颜色（按开始时间排序稳定着色）
        ordered_fams = self._active_family_ids_ordered_unlocked()
        palette = ["#90cdf4", "#9ae6b4", "#faf089", "#d6bcfa", "#feb2b2", "#81e6d9", "#fbd38d"]
        color_by_fam = {
            fid: palette[i % len(palette)] for i, fid in enumerate(ordered_fams)
        }
        # 周内仍挂着的旧班（已停用）一并进选项，避免格子露出 sh-xxx
        used_fams: set[str] = set()
        for r in rows:
            for c in (r.get("cells") or {}).values():
                fid = c.get("shift_family_id")
                if fid:
                    used_fams.add(str(fid))
        orphan_fams = [fid for fid in used_fams if fid not in set(ordered_fams)]
        shift_options = [
            {
                "family_id": fid,
                "name": fam_names.get(fid) or self._family_display_name(fid),
                "short": self._shift_short_name(fid),
                "color": color_by_fam.get(fid, "#edf2f7"),
            }
            for fid in ordered_fams
        ]
        for i, fid in enumerate(orphan_fams):
            shift_options.append(
                {
                    "family_id": fid,
                    "name": (fam_names.get(fid) or self._family_display_name(fid))
                    + "（已停用）",
                    "short": self._shift_short_name(fid),
                    "color": "#e2e8f0",
                    "disabled": True,
                }
            )
            color_by_fam[fid] = "#e2e8f0"
        return {
            "week_start": dates[0],
            "week_end": week_end,
            "dates": dates,
            "shift_options": shift_options,
            "rotate_chain": " → ".join(
                fam_names.get(fid, fid) for fid in ordered_fams
            )
            + (f" → {fam_names.get(ordered_fams[0], ordered_fams[0])}" if ordered_fams else ""),
            "rows": rows,
        }

    def _resolve_roster_family_order(self, requested: list[str] | None) -> list[str]:
        active_ordered = self._active_family_ids_ordered_unlocked()
        if requested:
            allowed_set = set(active_ordered)
            family_order = [f for f in requested if f in allowed_set]
        else:
            family_order = list(active_ordered)
        if len(family_order) < 1:
            raise ValidationException("请先在班制中启用至少一个班次")
        return family_order

    def _lookup_roster_family_before_unlocked(
        self, person_id: str, before_day: str, lookback_days: int = 45
    ) -> str | None:
        """切换日前最近一天的当班班次族。"""
        d0 = date.fromisoformat(before_day[:10])
        for i in range(1, lookback_days + 1):
            day = (d0 - timedelta(days=i)).isoformat()
            fam = self._person_roster_family_on_day_unlocked(person_id, day)
            if fam:
                return fam
        return None

    def _assign_fixed_shift_range_unlocked(
        self,
        person_id: str,
        fam: str,
        range_start: str,
        range_end: str,
        *,
        note: str,
    ) -> tuple[int, int]:
        """某人 [start,end] 固定一班；请假日跳过。返回 (段数, 跳过请假天数)。"""
        created = 0
        skipped_leave = 0
        self._carve_person_assignments_for_range_unlocked(person_id, range_start, range_end)
        d0 = date.fromisoformat(range_start[:10])
        d1 = date.fromisoformat(range_end[:10])
        run_start: str | None = None
        run_end: str | None = None
        cur = d0
        while cur <= d1:
            day = cur.isoformat()  # 归属日
            leave_day = self._leave_day_for_roster_unlocked(day, fam)
            on_leave = self._leave_covering_day_unlocked(
                person_id, leave_day
            ) or (
                leave_day != day
                and self._leave_covering_day_unlocked(person_id, day)
            )
            if on_leave:
                if run_start and run_end:
                    self._create_assignment_unlocked(
                        {
                            "person_id": person_id,
                            "shift_family_id": fam,
                            "start_date": run_start,
                            "end_date": run_end,
                            "kind": "roster",
                            "note": note,
                        }
                    )
                    created += 1
                    run_start = run_end = None
                skipped_leave += 1
            else:
                if not run_start:
                    run_start = day
                run_end = day
            cur += timedelta(days=1)
        if run_start and run_end:
            self._create_assignment_unlocked(
                {
                    "person_id": person_id,
                    "shift_family_id": fam,
                    "start_date": run_start,
                    "end_date": run_end,
                    "kind": "roster",
                    "note": note,
                }
            )
            created += 1
        return created, skipped_leave

    def roster_headcount_analysis(
        self, start_date: str | None = None, end_date: str | None = None
    ) -> dict[str, Any]:
        """排班人数分析：按日统计各班人数（堆叠柱）+ 当日总人数（折线）。"""
        with self._lock:
            self._ensure_three_shift_regime_unlocked()
            today = date.today()
            if start_date:
                d0 = date.fromisoformat(start_date[:10])
            else:
                d0 = today - timedelta(days=today.weekday())  # 本周一
            if end_date:
                d1 = date.fromisoformat(end_date[:10])
            else:
                d1 = d0 + timedelta(days=27)
            if d1 < d0:
                raise ValidationException("结束日期不能早于开始日期")
            # 防止一次拉太长
            if (d1 - d0).days > 92:
                raise ValidationException("分析区间最长 93 天")

            dates = [(d0 + timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]
            family_order = self._active_family_ids_ordered_unlocked()
            fam_names: dict[str, str] = {}
            for s in self._data.get("shifts") or []:
                if s.get("status") == "active":
                    fam_names.setdefault(s["family_id"], s.get("name") or s["family_id"])
            palette = ["#69b1ff", "#95de64", "#ffd666", "#b37feb", "#ff7875", "#5cdbd3", "#ffc069"]
            colors = {fid: palette[i % len(palette)] for i, fid in enumerate(family_order)}

            persons = [
                p
                for p in (self._data.get("persons") or [])
                if p.get("status") != "disabled"
            ]
            # series[fam][day_idx] = count
            counts: dict[str, list[int]] = {
                fid: [0] * len(dates) for fid in family_order
            }
            leave_counts = [0] * len(dates)
            unassigned = [0] * len(dates)
            totals = [0] * len(dates)

            # 横轴日期 = 归属日（挂牌日）；凌晨班（previous_day）与首班同一天汇总
            for di, day in enumerate(dates):
                for p in persons:
                    cell = self._roster_cell_for_day_unlocked(p["id"], day, fam_names)
                    if cell.get("kind") == "leave":
                        leave_counts[di] += 1
                        continue
                    fam = cell.get("shift_family_id")
                    if fam and fam in counts:
                        counts[fam][di] += 1
                        totals[di] += 1
                    elif fam:
                        # 已停用班次仍占用，并入未分班
                        unassigned[di] += 1
                        totals[di] += 1
                    else:
                        unassigned[di] += 1

            series = [
                {
                    "key": fid,
                    "name": fam_names.get(fid, fid),
                    "color": colors.get(fid, "#69b1ff"),
                    "values": counts[fid],
                }
                for fid in family_order
            ]
            if any(unassigned):
                series.append(
                    {
                        "key": "_empty",
                        "name": "未排班",
                        "color": "#d9d9d9",
                        "values": unassigned,
                    }
                )
            if any(leave_counts):
                series.append(
                    {
                        "key": "_leave",
                        "name": "请假",
                        "color": "#ffbb96",
                        "values": leave_counts,
                    }
                )

            return {
                "start_date": dates[0],
                "end_date": dates[-1],
                "dates": dates,
                "day_labels": [d[5:] for d in dates],  # MM-DD
                "series": series,
                "totals": totals,
                "person_total": len(persons),
                "day_segments": self._day_segments_unlocked(),
                "axis_note": "横轴为归属日（生产挂牌日）；「归属前一日」的班与首班同一天统计",
            }

    def assign_roster_batch(self, payload: dict[str, Any]) -> dict[str, Any]:
        """简单排班：时间段 + 一个班 + 一批人。"""
        with self._lock:
            self._checkpoint()
            self._ensure_three_shift_regime_unlocked()
            start = (payload.get("start_date") or "")[:10]
            end = (payload.get("end_date") or "")[:10]
            fam = payload.get("shift_family_id")
            person_ids = list(payload.get("person_ids") or [])
            if not start or not end:
                raise ValidationException("请填写排班起止日期")
            if end < start:
                raise ValidationException("结束日期不能早于开始日期")
            if not fam:
                raise ValidationException("请选择班次")
            if not any(
                s.get("family_id") == fam and s.get("status") == "active"
                for s in (self._data.get("shifts") or [])
            ):
                raise ValidationException("班次无效或已停用")
            if not person_ids:
                raise ValidationException("请勾选人员")

            created = 0
            skipped_leave = 0
            assigned = 0
            for pid in person_ids:
                person = self._person_map().get(pid)
                if not person or person.get("status") == "disabled":
                    continue
                allowed = list(person.get("shift_family_ids") or [])
                if allowed and fam not in allowed:
                    person["shift_family_ids"] = [*allowed, fam]
                c, s = self._assign_fixed_shift_range_unlocked(
                    pid,
                    fam,
                    start,
                    end,
                    note=payload.get("note") or "批量排班",
                )
                created += c
                skipped_leave += s
                assigned += 1

            if assigned < 1:
                raise ValidationException("没有可排班的人员")

            # 周历对齐到开始日所在周
            d0 = date.fromisoformat(start)
            week0 = (d0 - timedelta(days=d0.weekday())).isoformat()
            overview = self.roster_week_unlocked(week0)
            fam_name = next(
                (
                    s.get("name")
                    for s in (self._data.get("shifts") or [])
                    if s.get("family_id") == fam and s.get("status") == "active"
                ),
                fam,
            )
            overview["generated"] = {
                "mode": "assign",
                "mode_label": "批量排班",
                "assignment_segments": created,
                "skipped_leave_days": skipped_leave,
                "person_count": assigned,
                "shift_family_id": fam,
                "shift_name": fam_name,
                "effective_from": start,
                "end_date": end,
            }
            return overview

    def generate_three_shift_roster(self, payload: dict[str, Any]) -> dict[str, Any]:
        """兼容旧接口：改走批量排班需显式班次；无班次时拒用。"""
        raise ValidationException(
            "请使用「排班」：选时间段 + 选一个班 + 勾人。旧的一键铺班已停用。"
        )

    def rotate_roster(self, payload: dict[str, Any]) -> dict[str, Any]:
        """换班：两班倒自动对换；三班倒用 mapping{旧→新}；覆盖 [effective_from, end_date]。"""
        with self._lock:
            self._checkpoint()
            self._ensure_three_shift_regime_unlocked()
            week_start_raw = (payload.get("week_start") or date.today().isoformat())[:10]
            week0 = date.fromisoformat(week_start_raw[:10])
            week0 = week0 - timedelta(days=week0.weekday())
            week_end = (week0 + timedelta(days=6)).isoformat()

            effective_from = (payload.get("effective_from") or date.today().isoformat())[:10]
            if not payload.get("end_date"):
                raise ValidationException("请填写换班结束日期")
            end_date = payload["end_date"][:10]
            if end_date < effective_from:
                raise ValidationException("结束日期不能早于开始日期")

            family_order = self._resolve_roster_family_order(payload.get("family_ids"))
            n_fam = len(family_order)
            if n_fam < 2:
                raise ValidationException("至少启用 2 个班次才能换班")

            raw_map = payload.get("mapping") or {}
            if isinstance(raw_map, dict) and raw_map:
                next_map: dict[str, str] = {
                    str(k): str(v) for k, v in raw_map.items() if k and v and str(k) != str(v)
                }
                if not next_map:
                    raise ValidationException("换班规则无效：请指定旧班→新班（不能相同）")
                # 目标班必须是启用班
                active_set = set(family_order)
                for src, dst in next_map.items():
                    if src not in active_set:
                        raise ValidationException(f"旧班无效或未启用：{src}")
                    if dst not in active_set:
                        raise ValidationException(f"新班无效或未启用：{dst}")
                mode_label = "自定义规则"
            elif n_fam == 2:
                # 两班倒：直接对换
                a, b = family_order[0], family_order[1]
                next_map = {a: b, b: a}
                mode_label = "两班对换"
            else:
                raise ValidationException(
                    "三班及以上请自行设计换班规则（旧班→新班），并填写起止日期"
                )

            person_ids = payload.get("person_ids")
            persons = [
                p
                for p in (self._data.get("persons") or [])
                if p.get("status") == "active"
                and (not person_ids or p["id"] in person_ids)
            ]
            if not persons:
                raise ValidationException("没有可排班的在岗人员")

            created = 0
            skipped_leave = 0
            rotated = 0
            skipped_no_prev = 0
            capability_opened = 0
            for person in persons:
                pid = person["id"]
                prev = self._lookup_roster_family_before_unlocked(pid, effective_from)
                if not prev or prev not in next_map:
                    skipped_no_prev += 1
                    continue
                new_fam = next_map[prev]
                if new_fam == prev:
                    skipped_no_prev += 1
                    continue
                allowed = list(person.get("shift_family_ids") or [])
                if allowed and new_fam not in allowed:
                    person["shift_family_ids"] = [*allowed, new_fam]
                    capability_opened += 1
                c, s = self._assign_fixed_shift_range_unlocked(
                    pid,
                    new_fam,
                    effective_from,
                    end_date,
                    note=f"换班 {prev}→{new_fam}",
                )
                created += c
                skipped_leave += s
                rotated += 1

            overview = self.roster_week_unlocked(week0.isoformat())
            names = {
                s.get("family_id"): s.get("name")
                for s in (self._data.get("shifts") or [])
                if s.get("status") == "active"
            }
            chain_parts = [
                f"{names.get(src, src)}→{names.get(dst, dst)}"
                for src, dst in next_map.items()
            ]
            chain = "；".join(chain_parts)
            overview["generated"] = {
                "mode": "rotate",
                "mode_label": mode_label,
                "assignment_segments": created,
                "skipped_leave_days": skipped_leave,
                "person_count": rotated,
                "skipped_no_prev": skipped_no_prev,
                "capability_opened": capability_opened,
                "family_count": n_fam,
                "family_ids": family_order,
                "effective_from": effective_from,
                "end_date": end_date,
                "mapping": next_map,
                "rotate_chain": chain,
            }
            overview["week_end_hint"] = week_end
            return overview

    def set_roster_day(self, payload: dict[str, Any]) -> dict[str, Any]:
        """改某一天的班（例外调整）；shift_family_id 为空表示清空当天。"""
        with self._lock:
            self._checkpoint()
            person_id = payload.get("person_id")
            day = (payload.get("day") or "")[:10]
            fam = payload.get("shift_family_id") or None
            if not person_id or person_id not in self._person_map():
                raise ValidationException("人员无效")
            if not day:
                raise ValidationException("日期无效")
            if self._leave_covering_day_unlocked(person_id, day):
                raise ValidationException("该日已请假，请先处理请假或改派")
            person = self._person_map()[person_id]
            if fam:
                allowed = person.get("shift_family_ids")
                if allowed is not None and len(allowed) > 0 and fam not in allowed:
                    raise ValidationException("该人员不具备此班次能力")
                if not any(
                    s.get("family_id") == fam and s.get("status") == "active"
                    for s in (self._data.get("shifts") or [])
                ):
                    raise ValidationException("班次无效或已停用")
            self._carve_person_assignments_for_range_unlocked(person_id, day, day)
            if fam:
                self._create_assignment_unlocked(
                    {
                        "person_id": person_id,
                        "shift_family_id": fam,
                        "start_date": day,
                        "end_date": day,
                        "kind": "roster",
                        "note": payload.get("note") or "周历调整",
                    }
                )
            d0 = date.fromisoformat(day)
            week_start = (d0 - timedelta(days=d0.weekday())).isoformat()
            return self.roster_week_unlocked(week_start)

    # ----- work orders -----

    def work_orders_overview(self) -> dict[str, Any]:
        with self._lock:
            wos = self._data["work_orders"]
            ops = self._data["operations"]
            orders = [self._enrich_order(o) for o in self._data["orders"]]
            items = []
            for wo in wos:
                wo_ops = [o for o in ops if o["work_order_id"] == wo["id"]]
                items.append(
                    {
                        **self._enrich_work_order(wo),
                        "op_count": len(wo_ops),
                        "operations": [
                            self._enrich_op(o) for o in sorted(wo_ops, key=lambda x: x["seq"])
                        ],
                    }
                )
            customer_n = sum(1 for o in self._data["orders"] if o.get("source_type") == "customer")
            internal_n = len(self._data["orders"]) - customer_n
            cancelled_n = sum(1 for w in wos if w.get("status") == "cancelled")
            active_wos = [w for w in wos if w.get("status") != "cancelled"]
            pending_n = sum(1 for w in active_wos if w["status"] == "pending")
            producing_n = sum(1 for w in active_wos if w["status"] == "producing")
            done_n = sum(1 for w in active_wos if w["status"] == "done")
            return {
                "kpis": [
                    {
                        "title": "工单总览",
                        "value": len(wos),
                        "ratio": (
                            f"有效 {len(active_wos)} · 作废 {cancelled_n}；"
                            f"待排产 {pending_n} · 生产中 {producing_n} · 已完成 {done_n}"
                        ),
                    },
                    {
                        "title": "订单 / 任务",
                        "value": len(self._data["orders"]),
                        "ratio": f"客户 {customer_n} · 内部 {internal_n}",
                    },
                    {
                        "title": "待排产",
                        "value": pending_n,
                    },
                    {
                        "title": "生产中",
                        "value": producing_n,
                    },
                    {
                        "title": "已完成",
                        "value": done_n,
                    },
                ],
                "orders": orders,
                "templates": deepcopy(self._data["templates"]),
                "items": items,
            }

    def create_work_order(self, payload: dict[str, Any]) -> dict:
        with self._lock:
            order_id = self._ensure_order_for_work_order(payload)
            order = self._order_map()[order_id]
            seq = self._data["_seq"]["work_order"] + 1
            self._data["_seq"]["work_order"] = seq
            wo = {
                "id": f"wo-{seq}",
                "order_id": order_id,
                "code": f"WO-202609-{seq:03d}",
                "name": payload["name"],
                "product": payload.get("product") or order.get("product") or "",
                "due_date": payload.get("due_date") or order.get("due_date"),
                "priority": payload.get("priority") or "normal",
                "wo_kind": payload.get("wo_kind")
                if payload.get("wo_kind") in WO_KIND_LABELS
                else "normal",
                "status": "pending",
            }
            self._data["work_orders"].append(wo)
            self._sync_order_status(order_id)

            template_ids = payload.get("template_ids") or []
            op_specs = payload.get("op_specs") or []
            # op_specs 优先；否则用 template_ids；都空则默认模板链
            specs: list[dict[str, Any]] = []
            if op_specs:
                for spec in op_specs:
                    tid = spec.get("template_id")
                    if not tid:
                        continue
                    specs.append(
                        {
                            "template_id": tid,
                            "duration_days": spec.get("duration_days"),
                            "required_headcount": spec.get("required_headcount"),
                        }
                    )
            elif template_ids:
                specs = [{"template_id": tid} for tid in template_ids]
            else:
                specs = [
                    {"template_id": tid} for tid in ["tpl-1", "tpl-2", "tpl-3", "tpl-4"]
                ]

            tpl_map = {t["id"]: t for t in self._data["templates"]}
            skill_to_res = {
                "sk-assembly": "res-assembly",
                "sk-weld": "res-weld",
                "sk-debug": "res-debug",
                "sk-qc": "res-qc",
                "sk-pack": "res-assembly",
            }
            created_ops: list[dict] = []
            prev_id: str | None = None
            for i, spec in enumerate(specs, start=1):
                tpl = tpl_map.get(spec["template_id"])
                if not tpl:
                    continue
                hours = float(tpl.get("std_hours") or 1)
                default_days = max(1, int(round(hours / 2)) or 1)
                days = max(1, int(spec.get("duration_days") or default_days))
                headcount = max(1, int(spec.get("required_headcount") or 1))
                day_shift = self._active_shift_for_family("sh-day")
                pool = [str(x) for x in (tpl.get("equipment_ids") or []) if x]
                op = {
                    "id": self._next_id("operation", "op"),
                    "work_order_id": wo["id"],
                    "name": tpl["name"],
                    "seq": i,
                    "skill_id": tpl["skill_id"],
                    "resource_id": skill_to_res.get(tpl["skill_id"], "res-assembly"),
                    "equipment_id": pool[0] if len(pool) == 1 else None,
                    "assignee_id": None,
                    "assignee_ids": [],
                    "slot": "full",
                    "shift_id": (day_shift or {}).get("id"),
                    "shift_family_id": "sh-day",
                    "duration_days": days,
                    "required_headcount": headcount,
                    "staffing_gap": 0,
                    "template_id": tpl["id"],
                    "plan_start": None,
                    "plan_end": None,
                    "actual_start": None,
                    "actual_end": None,
                    "progress": 0,
                    "status": "pending",
                    "is_insert": wo["priority"] == "rush",
                    "prev_op_ids": [prev_id] if prev_id else [],
                }
                self._data["operations"].append(op)
                created_ops.append(op)
                prev_id = op["id"]

            enriched = self._enrich_work_order(wo)
            return {
                **enriched,
                "op_count": len(created_ops),
                "operations": [self._enrich_op(o) for o in created_ops],
            }

    def update_work_order(self, wo_id: str, payload: dict[str, Any]) -> dict:
        with self._lock:
            wo = self._wo_map().get(wo_id)
            if not wo:
                raise NotFoundException("工单不存在")
            if wo.get("status") == "cancelled":
                raise ValidationException("已作废工单不可修改")
            if wo.get("status") == "done":
                raise ValidationException("已完成工单不可修改")
            for key in ("name", "product", "due_date", "priority"):
                if key in payload and payload[key] is not None:
                    wo[key] = payload[key]
            if "wo_kind" in payload and payload["wo_kind"] is not None:
                kind = payload["wo_kind"]
                if kind not in WO_KIND_LABELS:
                    raise ValidationException("工单类型无效")
                wo["wo_kind"] = kind
            if "status" in payload and payload["status"] is not None:
                # 状态变更请走作废等专用接口；此处仅允许 pending/producing 微调
                st = payload["status"]
                if st not in ("pending", "producing"):
                    raise ValidationException("状态请通过作废等操作变更")
                wo["status"] = st
            pri = wo.get("priority") or "normal"
            for op in self._data["operations"]:
                if op["work_order_id"] != wo_id:
                    continue
                if op.get("status") in ("done", "cancelled"):
                    continue
                op["is_insert"] = pri == "rush"
            wo_ops = [o for o in self._data["operations"] if o["work_order_id"] == wo_id]
            return {
                **self._enrich_work_order(wo),
                "op_count": len(wo_ops),
                "operations": [
                    self._enrich_op(o) for o in sorted(wo_ops, key=lambda x: x.get("seq") or 0)
                ],
            }

    def cancel_work_order(self, wo_id: str) -> dict:
        """作废工单：保留台账，工序撤出排产并标记 cancelled。"""
        with self._lock:
            wo = self._wo_map().get(wo_id)
            if not wo:
                raise NotFoundException("工单不存在")
            if wo.get("status") == "cancelled":
                raise ValidationException("工单已作废")
            if wo.get("status") == "done":
                raise ValidationException("已完成工单不可作废")
            wo["status"] = "cancelled"
            for op in self._data["operations"]:
                if op.get("work_order_id") != wo_id:
                    continue
                if op.get("status") == "done":
                    # 已完工工序保留实绩，仅撤计划占用不再参与冲突（已完成本就不占）
                    continue
                op["status"] = "cancelled"
                op["plan_start"] = None
                op["plan_end"] = None
                op["assignee_id"] = None
                op["assignee_ids"] = []
                op["staffing_gap"] = 0
                op["progress"] = 0
                _normalize_op_fields(op)
            self._sync_order_status(wo.get("order_id"))
            self._data.setdefault("events", []).append(
                {
                    "id": self._next_id("event", "ev"),
                    "type": "wo_cancelled",
                    "title": f"工单作废 · {wo.get('code') or wo_id}",
                    "at": date.today().isoformat() + "T12:00:00",
                    "work_order_id": wo_id,
                    "order_id": wo.get("order_id"),
                }
            )
            wo_ops = [o for o in self._data["operations"] if o["work_order_id"] == wo_id]
            return {
                **self._enrich_work_order(wo),
                "op_count": len(wo_ops),
                "operations": [self._enrich_op(o) for o in sorted(wo_ops, key=lambda x: x["seq"])],
            }

    def delete_work_order(self, wo_id: str) -> dict:
        """物理删除：待排产（含已排期未开工）或已作废；有完工/进行中则不可删。"""
        with self._lock:
            wo = self._wo_map().get(wo_id)
            if not wo:
                raise NotFoundException("工单不存在")
            if wo.get("status") not in ("pending", "cancelled"):
                raise ValidationException("仅待排产或已作废工单可删除；生产中请先作废")
            ops = [o for o in self._data["operations"] if o.get("work_order_id") == wo_id]
            if any(o.get("status") == "done" for o in ops):
                raise ValidationException("存在已完工工序，不能删除，请保留作废记录")
            if any(o.get("status") in ("running", "paused") for o in ops):
                raise ValidationException("存在进行中工序，请先作废再处理")
            # 待排产但已排上甘特：删除时一并撤掉计划占用（误录场景）
            order_id = wo.get("order_id")
            self._data["operations"] = [
                o for o in self._data["operations"] if o.get("work_order_id") != wo_id
            ]
            self._data["work_orders"] = [
                w for w in self._data["work_orders"] if w["id"] != wo_id
            ]
            if order_id:
                self._sync_order_status(order_id)
            return {"ok": True, "deleted_id": wo_id}

    def remove_order(self, order_id: str) -> dict:
        """
        甘特误录清理：
        - 无完工/进行中：物理删除订单 + 下属工单 + 工序（含已排期未开工）
        - 有完工或进行中：订单与工单作废，未完工工序撤出甘特（保留实绩）
        """
        with self._lock:
            order = self._order_map().get(order_id)
            if not order:
                raise NotFoundException("订单不存在")
            if order.get("status") == "cancelled":
                raise ValidationException("订单已作废")
            wos = [w for w in self._data["work_orders"] if w.get("order_id") == order_id]
            wo_ids = {w["id"] for w in wos}
            ops = [o for o in self._data["operations"] if o.get("work_order_id") in wo_ids]
            has_done = any(o.get("status") == "done" for o in ops)
            has_running = any(o.get("status") in ("running", "paused") for o in ops)

            if has_done or has_running:
                order["status"] = "cancelled"
                for wo in wos:
                    if wo.get("status") == "done":
                        continue
                    wo["status"] = "cancelled"
                for op in ops:
                    if op.get("status") == "done":
                        continue
                    op["status"] = "cancelled"
                    op["plan_start"] = None
                    op["plan_end"] = None
                    op["assignee_id"] = None
                    op["assignee_ids"] = []
                    op["staffing_gap"] = 0
                    op["progress"] = 0
                    _normalize_op_fields(op)
                self._data.setdefault("events", []).append(
                    {
                        "id": self._next_id("event", "ev"),
                        "type": "order_cancelled",
                        "title": f"订单作废 · {order.get('code') or order_id}",
                        "at": date.today().isoformat() + "T12:00:00",
                        "order_id": order_id,
                    }
                )
                return {
                    "ok": True,
                    "mode": "cancelled",
                    "order_id": order_id,
                    "order_code": order.get("code"),
                    "message": "订单已作废：未完工工序已撤出甘特，已完工实绩保留",
                }

            # 纯误录：整单删除
            op_ids = {o["id"] for o in ops}
            self._data["operations"] = [
                o for o in self._data["operations"] if o.get("work_order_id") not in wo_ids
            ]
            self._data["work_orders"] = [
                w for w in self._data["work_orders"] if w.get("order_id") != order_id
            ]
            self._data["orders"] = [o for o in self._data["orders"] if o["id"] != order_id]
            if op_ids:
                self._data["daily_logs"] = [
                    lg
                    for lg in (self._data.get("daily_logs") or [])
                    if lg.get("op_id") not in op_ids
                ]
            self._data.setdefault("events", []).append(
                {
                    "id": self._next_id("event", "ev"),
                    "type": "order_deleted",
                    "title": f"订单删除 · {order.get('code') or order_id}",
                    "at": date.today().isoformat() + "T12:00:00",
                    "order_id": order_id,
                }
            )
            return {
                "ok": True,
                "mode": "deleted",
                "order_id": order_id,
                "order_code": order.get("code"),
                "message": "订单及下属工单、工序已删除",
            }

    # ----- gantt / replan -----

    def _detect_conflicts(self) -> list[dict]:
        """人/机/班组冲突与班次负荷。规则见 .cursor/rules/scheduling-equipment-capacity.mdc"""
        self._ensure_equipments_shape_unlocked()
        ops = [o for o in self._data["operations"] if o.get("plan_start") and o["status"] != "done"]
        conflicts: list[dict] = []
        persons = self._person_map()
        skills = self._skill_map()
        resources = self._resource_map()
        equipments = self._equipment_map()
        orders = self._order_map()
        wos = self._wo_map()

        def base_row(op: dict) -> dict:
            _normalize_op_fields(op)
            wo = wos.get(op["work_order_id"], {})
            order = orders.get(wo.get("order_id") or "", {})
            ids = _assignee_ids_of(op)
            names = [persons[i]["name"] for i in ids if i in persons]
            eid = op.get("equipment_id")
            return {
                "task": op["name"],
                "op_id": op["id"],
                "order_code": order.get("code"),
                "order_name": order.get("name"),
                "work_order_code": wo.get("code"),
                "work_order_name": wo.get("name"),
                "resource_name": resources.get(op.get("resource_id") or "", {}).get("name"),
                "equipment_id": eid,
                "equipment_name": equipments.get(eid or "", {}).get("name"),
                "assignee_name": "、".join(names) if names else None,
                "plan_window": (
                    f"{op['plan_start'][5:]} ~ {op['plan_end'][5:]}"
                    f" · {SLOT_LABEL.get(op.get('slot') or 'full', '全天')}"
                ),
                "due_date": (self._effective_due(wo, order) or "")[5:] or None,
            }

        def _pair_priority_move(a: dict, b: dict) -> tuple[dict, dict]:
            wa = wos.get(a["work_order_id"], {})
            wb = wos.get(b["work_order_id"], {})
            pa = PRIORITY_RANK.get(wa.get("priority", "normal"), 9)
            pb = PRIORITY_RANK.get(wb.get("priority", "normal"), 9)
            if pa < pb:
                return a, b
            if pb < pa:
                return b, a
            return (a, b) if a.get("is_insert") else (b, a)

        # 1) 设备硬冲突：同机 + 日期班次重叠 +（责任人不相交 或 均无人）
        by_eq: dict[str, list[dict]] = {}
        for op in ops:
            eids: list[str] = []
            for eid in list(op.get("equipment_ids") or []):
                if eid and eid not in eids:
                    eids.append(str(eid))
            if op.get("equipment_id") and str(op["equipment_id"]) not in eids:
                eids.append(str(op["equipment_id"]))
            for s in _normalize_plan_segments(op):
                for eid in s.get("equipment_ids") or []:
                    if eid and str(eid) not in eids:
                        eids.append(str(eid))
            for eid in eids:
                bucket = by_eq.setdefault(eid, [])
                if not any(x.get("id") == op.get("id") for x in bucket):
                    bucket.append(op)
        for eid, group in by_eq.items():
            group = sorted(group, key=lambda o: o["plan_start"])
            eq_name = equipments.get(eid, {}).get("name", eid)
            for i, a in enumerate(group):
                for b in group[i + 1 :]:
                    a_start, a_end = _parse(a["plan_start"]), _parse(a["plan_end"])
                    b_start, b_end = _parse(b["plan_start"]), _parse(b["plan_end"])
                    if a_end < b_start or b_end < a_start:
                        continue
                    if not self._ops_shift_overlap(a, b):
                        continue
                    sa, sb = set(_assignee_ids_of(a)), set(_assignee_ids_of(b))
                    # 同人（有交集）→ 视为串行，不报硬冲突
                    if sa and sb and not sa.isdisjoint(sb):
                        continue
                    # 两边都有人且不相交，或任一侧无人且同机重叠 → 硬冲突
                    if not ((sa and sb and sa.isdisjoint(sb)) or (not sa or not sb)):
                        continue
                    overlap_start = max(a_start, b_start)
                    overlap_end = min(a_end, b_end)
                    overlap_days = (overlap_end - overlap_start).days + 1
                    keep, move = _pair_priority_move(a, b)
                    wb = wos.get(b["work_order_id"], {})
                    suggest_start = max(
                        _parse(keep["plan_end"]) + timedelta(days=1),
                        _planning_today(),
                    ).isoformat()
                    conflicts.append(
                        {
                            **base_row(a),
                            "conflict_with": b["name"],
                            "conflict_with_order": wb.get("code"),
                            "conflict_with_window": f"{b['plan_start'][5:]} ~ {b['plan_end'][5:]}",
                            "overlap_days": overlap_days,
                            "overlap_window": (
                                f"{overlap_start.isoformat()[5:]} ~ {overlap_end.isoformat()[5:]}"
                            ),
                            "reason": (
                                f"设备「{eq_name}」在 {overlap_start.isoformat()[5:]}~"
                                f"{overlap_end.isoformat()[5:]} 被「{a['name']}」与「{b['name']}」"
                                f"同时占用（重叠 {overlap_days} 天）"
                            ),
                            "impact": "一台设备默认产能=1，无法并行；请换机或错开班次/日期",
                            "suggestion": (
                                f"将「{move['name']}」改到池内其它设备，或后移到 {suggest_start[5:]}"
                            ),
                            "status": "conflict",
                            "conflict_kind": "equipment",
                            "quick_action": "defer",
                            "action_op_id": move["id"],
                            "suggest_start": suggest_start,
                        }
                    )

        # 2) 班组硬冲突（降级）：仅当两道工序都未选设备时，同班组日期重叠才互斥
        by_res: dict[str, list[dict]] = {}
        for op in ops:
            if op.get("equipment_id"):
                continue
            rid = op.get("resource_id")
            if rid:
                by_res.setdefault(str(rid), []).append(op)

        for res_id, group in by_res.items():
            group = sorted(group, key=lambda o: o["plan_start"])
            res_name = resources.get(res_id, {}).get("name", res_id)
            for i, a in enumerate(group):
                for b in group[i + 1 :]:
                    if a.get("equipment_id") or b.get("equipment_id"):
                        continue
                    a_start, a_end = _parse(a["plan_start"]), _parse(a["plan_end"])
                    b_start, b_end = _parse(b["plan_start"]), _parse(b["plan_end"])
                    if a_end < b_start or b_end < a_start:
                        continue
                    if not self._ops_shift_overlap(a, b):
                        continue
                    overlap_start = max(a_start, b_start)
                    overlap_end = min(a_end, b_end)
                    overlap_days = (overlap_end - overlap_start).days + 1
                    wa = wos.get(a["work_order_id"], {})
                    wb = wos.get(b["work_order_id"], {})
                    keep, move = _pair_priority_move(a, b)
                    suggest_start = max(
                        _parse(keep["plan_end"]) + timedelta(days=1),
                        _planning_today(),
                    ).isoformat()
                    conflicts.append(
                        {
                            **base_row(a),
                            "conflict_with": b["name"],
                            "conflict_with_order": wb.get("code"),
                            "conflict_with_window": f"{b['plan_start'][5:]} ~ {b['plan_end'][5:]}",
                            "overlap_days": overlap_days,
                            "overlap_window": (
                                f"{overlap_start.isoformat()[5:]} ~ {overlap_end.isoformat()[5:]}"
                            ),
                            "reason": (
                                f"班组「{res_name}」在 {overlap_start.isoformat()[5:]}~"
                                f"{overlap_end.isoformat()[5:]} 同时被「{a['name']}」与「{b['name']}」"
                                f"占用（均未指定设备），重叠 {overlap_days} 天"
                            ),
                            "impact": (
                                f"影响工单 {wa.get('code', '')} 与 {wb.get('code', '')}；"
                                f"建议指定设备或后移优先级较低的工序"
                            ),
                            "suggestion": (
                                f"为工序选择设备，或一键后移「{move['name']}」到 {suggest_start[5:]}"
                            ),
                            "status": "conflict",
                            "conflict_kind": "resource",
                            "quick_action": "defer",
                            "action_op_id": move["id"],
                            "suggest_start": suggest_start,
                        }
                    )

        # 2b) 人/设备班次负荷超载（同班多单默认串行，只校验总工时）
        # key: (kind, id, day, shift_family) -> {hours, ops, label}
        load_buckets: dict[tuple, dict[str, Any]] = {}

        def _add_load(kind: str, key_id: str, label: str, op: dict) -> None:
            if not op.get("plan_start") or not op.get("plan_end"):
                return
            shift = self._resolve_op_shift(op)
            fam = (shift or {}).get("family_id") or op.get("shift_family_id") or "sh-day"
            # 负荷按班次时段时长计，与可用工时 cap 同源
            hpd = _shift_available_hours(shift)
            for i in range(_duration_days(op["plan_start"], op["plan_end"])):
                day = _add_days(op["plan_start"], i)
                bk = (kind, key_id, day, fam)
                bucket = load_buckets.setdefault(
                    bk,
                    {
                        "kind": kind,
                        "key_id": key_id,
                        "label": label,
                        "day": day,
                        "family_id": fam,
                        "hours": 0.0,
                        "ops": [],
                        "cap": hpd,
                        "shift_name": (shift or {}).get("name") or fam,
                    },
                )
                bucket["hours"] += hpd
                bucket["ops"].append(op)

        for op in ops:
            for pid in _assignee_ids_of(op):
                pname = persons.get(pid, {}).get("name") or pid
                _add_load("person", pid, pname, op)
            eid = op.get("equipment_id")
            if eid:
                ename = equipments.get(eid, {}).get("name") or eid
                _add_load("equipment", str(eid), ename, op)

        seen_overload: set[tuple] = set()
        for bucket in load_buckets.values():
            if bucket["hours"] <= bucket["cap"] + 1e-6:
                continue
            # 每桶取第一道工序作展示主体，避免刷屏：同桶只一条
            op0 = bucket["ops"][0]
            sig = (bucket["kind"], bucket["key_id"], bucket["day"], bucket["family_id"])
            if sig in seen_overload:
                continue
            seen_overload.add(sig)
            kind_cn = "人员" if bucket["kind"] == "person" else "设备"
            others = "、".join(
                dict.fromkeys(o.get("name") or o["id"] for o in bucket["ops"])
            )
            conflicts.append(
                {
                    **base_row(op0),
                    "conflict_with": None,
                    "reason": (
                        f"{kind_cn}「{bucket['label']}」在 {bucket['day'][5:]} "
                        f"{bucket['shift_name']} 计划合计 {bucket['hours']:.1f}h，"
                        f"超过班次可用 {bucket['cap']:.1f}h（涉及：{others}）"
                    ),
                    "impact": "默认按串行理解；超载可能需加班、拆单或改派/换机",
                    "suggestion": "降低日工时、错开日期、换人或换设备，或标记加班后继续",
                    "status": "overload",
                    "conflict_kind": f"{bucket['kind']}_overload",
                    "overload_hours": round(bucket["hours"], 2),
                    "capacity_hours": round(bucket["cap"], 2),
                    "quick_action": "edit",
                    "action_op_id": op0["id"],
                }
            )

        # 3) 技能不匹配
        for op in ops:
            skill_id = op.get("skill_id")
            ids = _assignee_ids_of(op)
            if not skill_id:
                continue
            if not ids:
                # 缺编冲突已覆盖「没派人」
                if int(op.get("staffing_gap") or 0) > 0:
                    continue
                skill_name = skills.get(skill_id, {}).get("name", skill_id)
                conflicts.append(
                    {
                        **base_row(op),
                        "conflict_with": None,
                        "reason": f"工序需要技能「{skill_name}」，但尚未指定责任人",
                        "impact": "无法确认现场谁执行，排产落地风险高",
                        "suggestion": "点击「改派」指定具备该技能的人员",
                        "status": "risk",
                        "quick_action": "reassign",
                        "action_op_id": op["id"],
                    }
                )
                continue
            skill_name = skills.get(skill_id, {}).get("name", skill_id)
            for pid in ids:
                person = persons.get(pid, {})
                if skill_id not in (person.get("skill_ids") or []):
                    conflicts.append(
                        {
                            **base_row(op),
                            "conflict_with": None,
                            "reason": (
                                f"工序需要「{skill_name}」，责任人「{person.get('name', '')}」"
                                f"当前技能列表不含该技能"
                            ),
                            "impact": "即使时间不冲突，也可能无法开工",
                            "suggestion": "改派具备该技能的人员，或在基础数据补充技能",
                            "status": "risk",
                            "quick_action": "reassign",
                            "action_op_id": op["id"],
                        }
                    )

        # 4) 延期：计划结束晚于订单/工单交期（与甘特交期竖线一致）
        for op in ops:
            wo = wos.get(op["work_order_id"], {})
            order = orders.get(wo.get("order_id") or "", {})
            delay = self._delay_days(op, wo, order)
            if delay <= 0:
                continue
            due = self._effective_due(wo, order) or ""
            conflicts.append(
                {
                    **base_row(op),
                    "conflict_with": None,
                    "delay_days": delay,
                    "reason": (
                        f"工序计划结束 {op['plan_end'][5:]}，晚于交期 {due[5:] if due else '-'} "
                        f"共 {delay} 天"
                    ),
                    "impact": (
                        f"拖累订单 {order.get('code') or '-'} / 工单 {wo.get('code') or '-'}；"
                        f"后续前置依赖工序也可能一起后移"
                    ),
                    "suggestion": (
                        "优先给插队/高优腾出资源，或缩短本工序工期、加班、拆分并行"
                        if delay >= 2
                        else "点「调整」微调开始日，或一键重排后复核交期"
                    ),
                    "status": "delay",
                    "quick_action": "edit",
                    "action_op_id": op["id"],
                }
            )

        # 5) 请假期间仍排给该人的工序
        for leave in self._data.get("leaves") or []:
            if leave.get("status") == "closed":
                continue
            pid = leave.get("person_id") or ""
            pname = persons.get(pid, {}).get("name") or pid
            ls, le = leave.get("start_date") or "", leave.get("end_date") or ""
            if not ls or not le:
                continue
            for op in self._ops_hit_by_leave_unlocked(leave):
                conflicts.append(
                    {
                        **base_row(op),
                        "conflict_with": None,
                        "leave_id": leave.get("id"),
                        "reason": (
                            f"人员「{pname}」请假 {ls[5:]}~{le[5:]}，"
                            f"但仍排在工序「{op['name']}」上"
                        ),
                        "impact": "现场无人或需临时顶替，至少影响本订单；若顶替人已有任务还可能牵动其它订单",
                        "suggestion": "点「改派」换人，或到基础数据处理请假替班",
                        "status": "leave",
                        "quick_action": "reassign",
                        "action_op_id": op["id"],
                    }
                )

        # 6) 人力不足：计划已排但人数未配齐（空岗缺编）
        for op in ops:
            _normalize_op_fields(op)
            need = int(op.get("required_headcount") or 1)
            gap = int(op.get("staffing_gap") or 0)
            if gap <= 0:
                continue
            skill_name = skills.get(op.get("skill_id") or "", {}).get("name") or "对应技能"
            conflicts.append(
                {
                    **base_row(op),
                    "conflict_with": None,
                    "required_headcount": need,
                    "staffing_gap": gap,
                    "reason": (
                        f"工序「{op['name']}」需 {need} 人/天（{skill_name}），"
                        f"当前时段缺 {gap} 人，责任人先空着"
                    ),
                    "impact": "甘特上保留工序占位，但现场可能开不了工；交期风险上升",
                    "suggestion": "点「改派」补人，或改期 / 降低每天人数后重排",
                    "status": "staffing",
                    "quick_action": "reassign",
                    "action_op_id": op["id"],
                }
            )

        # 硬冲突 → 缺编 → 请假 → 超载 → 风险 → 延期
        rank = {
            "conflict": 0,
            "staffing": 1,
            "leave": 2,
            "overload": 3,
            "risk": 4,
            "delay": 5,
        }
        conflicts.sort(key=lambda c: (rank.get(c.get("status", ""), 9), c.get("task") or ""))
        return conflicts

    def gantt_overview(self, *, horizon: str = "focus") -> dict[str, Any]:
        with self._lock:
            return self.gantt_overview_unlocked(horizon=horizon)

    def replan(self, strategy: str = "priority", scope: str = "gantt") -> dict[str, Any]:
        with self._lock:
            self._checkpoint()
            return self._replan_unlocked(strategy=strategy, scope=scope)

    def _normalize_replan_strategy(self, strategy: str | None) -> str:
        key = (strategy or "priority").strip()
        if key not in REPLAN_STRATEGIES:
            raise ValidationException(
                f"未知重排策略，可选：{', '.join(REPLAN_STRATEGIES)}"
            )
        return key

    def _normalize_replan_scope(self, scope: str | None) -> str:
        key = (scope or "gantt").strip()
        if key not in REPLAN_SCOPES:
            raise ValidationException(f"未知重排范围，可选：{', '.join(REPLAN_SCOPES)}")
        return key

    def _replan_sort_key(
        self, op: dict, *, strategy: str, today: date, wos: dict[str, dict]
    ) -> tuple:
        wo = wos.get(op["work_order_id"], {})
        pri = PRIORITY_RANK.get(wo.get("priority", "normal"), 9)
        insert = 0 if op.get("is_insert") else 1
        due = (wo.get("due_date") or "9999-12-31")[:10]
        seq = op.get("seq") or 0
        oid = op["id"]
        if strategy == "due_date":
            return (insert, due, pri, seq, oid)
        if strategy == "protect_due":
            near = 0
            if wo.get("due_date"):
                try:
                    delta = (_parse(wo["due_date"]) - today).days
                    if delta <= NEAR_DUE_DAYS:
                        near = 0  # 临近交期最优先档
                    else:
                        near = 1
                except ValueError:
                    near = 1
            else:
                near = 1
            return (insert, near, pri, due, seq, oid)
        # priority（默认）
        return (insert, pri, due, seq, oid)

    def _replan_reason(
        self, op: dict, *, strategy: str, today: date, wos: dict[str, dict]
    ) -> str:
        wo = wos.get(op["work_order_id"], {})
        pri = PRIORITY_LABEL_CN.get(wo.get("priority", "normal"), wo.get("priority") or "普通")
        due = (wo.get("due_date") or "")[:10]
        due_s = due[5:] if due else "无交期"
        bits = []
        if op.get("is_insert"):
            bits.append("插队")
        if strategy == "protect_due" and due:
            try:
                if (_parse(due) - today).days <= NEAR_DUE_DAYS:
                    bits.append(f"临近交期({due_s})")
            except ValueError:
                pass
        bits.append(pri)
        bits.append(f"交期{due_s}")
        code = wo.get("code") or ""
        return f"{code} · {' · '.join(bits)}" if code else " · ".join(bits)

    def _replan_unlocked(
        self, strategy: str = "priority", scope: str = "gantt"
    ) -> dict[str, Any]:
            strategy = self._normalize_replan_strategy(strategy)
            scope = self._normalize_replan_scope(scope)
            meta = REPLAN_STRATEGIES[strategy]
            scope_meta = REPLAN_SCOPES[scope]
            today = _planning_today()
            today_iso = today.isoformat()
            # 未完工 + 有班组；范围=gantt 时仅已排上甘特的工序
            cancelled = self._cancelled_work_order_ids()
            candidates = [
                o
                for o in self._data["operations"]
                if o["status"] != "done"
                and o.get("status") != "cancelled"
                and o.get("resource_id")
                and o.get("work_order_id") not in cancelled
                and (scope != "gantt" or bool(o.get("plan_start")))
            ]
            wos = self._wo_map()

            def is_frozen(op: dict) -> bool:
                """已开工，或开始日早于今天 → 冻结，重排不改日期。"""
                if op.get("status") == "running":
                    return True
                ps = (op.get("plan_start") or "")[:10]
                return bool(ps and ps < today_iso)

            frozen = [o for o in candidates if is_frozen(o)]
            movable = [o for o in candidates if not is_frozen(o)]

            ordered = sorted(
                movable,
                key=lambda o: self._replan_sort_key(o, strategy=strategy, today=today, wos=wos),
            )
            queue_preview = [
                {
                    "op_id": o["id"],
                    "name": o["name"],
                    "work_order_code": wos.get(o["work_order_id"], {}).get("code"),
                    "reason": self._replan_reason(o, strategy=strategy, today=today, wos=wos),
                }
                for o in ordered[:12]
            ]
            occupied: dict[str, dict[str, str]] = {}  # res_id -> {date_iso: op_id}

            def occupies(res_id: str, start: date, days: int, op_id: str) -> bool:
                for i in range(days):
                    d = (start + timedelta(days=i)).isoformat()
                    owner = occupied.get(res_id, {}).get(d)
                    if owner and owner != op_id:
                        return True
                return False

            def mark(res_id: str, start: date, days: int, op_id: str) -> None:
                occupied.setdefault(res_id, {})
                for i in range(days):
                    occupied[res_id][(start + timedelta(days=i)).isoformat()] = op_id

            planned: dict[str, tuple[str, str]] = {}
            # 冻结工序占坑：含已开工、今天以前开始的排产
            for op in frozen:
                if not op.get("plan_start") or not op.get("plan_end"):
                    continue
                days = op.get("duration_days") or _duration_days(
                    op["plan_start"], op["plan_end"]
                )
                mark(op["resource_id"], _parse(op["plan_start"]), days, op["id"])
                planned[op["id"]] = (op["plan_start"], op["plan_end"])

            for op in ordered:
                days = op.get("duration_days") or 1
                earliest = today
                for pid in op.get("prev_op_ids") or []:
                    if pid in planned:
                        earliest = max(earliest, _parse(planned[pid][1]) + timedelta(days=1))
                    else:
                        prev = self._op_map().get(pid)
                        if prev and prev.get("plan_end"):
                            earliest = max(earliest, _parse(prev["plan_end"]) + timedelta(days=1))

                start = earliest
                for _ in range(60):
                    if not occupies(op["resource_id"], start, days, op["id"]):
                        break
                    start += timedelta(days=1)
                end = start + timedelta(days=days - 1)
                op["plan_start"] = start.isoformat()
                op["plan_end"] = end.isoformat()
                op["duration_days"] = days
                if not op.get("slot"):
                    op["slot"] = "full"
                planned[op["id"]] = (op["plan_start"], op["plan_end"])
                mark(op["resource_id"], start, days, op["id"])

            # 重排日期后按「每天人数」自动派人；配不齐则空岗并记缺编
            reserved: dict[str, set[str]] = {}
            for op in frozen + ordered:
                if op.get("status") == "done" or not op.get("plan_start"):
                    continue
                if op.get("status") != "running" and op not in frozen:
                    continue
                for pid in _assignee_ids_of(op):
                    for i in range(
                        _duration_days(op["plan_start"], op["plan_end"] or op["plan_start"])
                    ):
                        reserved.setdefault(_add_days(op["plan_start"], i), set()).add(pid)
            # 冻结但未开工（历史日开始）也占人
            for op in frozen:
                if op.get("status") in ("done", "running") or not op.get("plan_start"):
                    continue
                for pid in _assignee_ids_of(op):
                    for i in range(
                        _duration_days(op["plan_start"], op["plan_end"] or op["plan_start"])
                    ):
                        reserved.setdefault(_add_days(op["plan_start"], i), set()).add(pid)
            for op in ordered:
                if op["status"] in ("done", "running"):
                    continue
                if not op.get("plan_start"):
                    continue
                self._auto_staff_op_unlocked(op, reserved_by_person=reserved)

            overview = self.gantt_overview_unlocked()
            overview["replan_meta"] = {
                "strategy": strategy,
                "strategy_label": meta["label"],
                "strategy_description": meta["description"],
                "scope": scope,
                "scope_label": scope_meta["label"],
                "scope_description": scope_meta["description"],
                "queue_preview": queue_preview,
                "candidate_count": len(ordered),
                "frozen_count": len(frozen),
                "freeze_note": (
                    f"已冻结 {len(frozen)} 道（已开工或开始日早于 {today_iso}），"
                    f"重排 {len(ordered)} 道"
                    if frozen
                    else f"重排 {len(ordered)} 道（无历史冻结）"
                ),
            }
            return overview

    def _person_on_leave_unlocked(self, person_id: str, start: str, end: str) -> bool:
        for leave in self._data.get("leaves") or []:
            if leave.get("status") == "closed":
                continue
            if leave.get("person_id") != person_id:
                continue
            ls, le = leave.get("start_date") or "", leave.get("end_date") or ""
            if not ls or not le:
                continue
            if self._date_ranges_overlap(start, end, ls, le):
                return True
        return False

    def _person_free_for_op_unlocked(
        self,
        person_id: str,
        op: dict,
        *,
        reserved: dict[str, set[str]] | None = None,
    ) -> bool:
        """该人在工序整段计划内是否空闲（含请假、已排任务、本轮预占）。"""
        ps, pe = op.get("plan_start") or "", op.get("plan_end") or ""
        if not ps or not pe:
            return False
        if self._person_on_leave_unlocked(person_id, ps, pe):
            return False
        # 本轮预占：按天
        if reserved:
            for i in range(_duration_days(ps, pe)):
                day = _add_days(ps, i)
                if person_id in (reserved.get(day) or set()):
                    return False
        for other in self._data["operations"]:
            if other["id"] == op["id"] or other.get("status") == "done":
                continue
            if not other.get("plan_start") or not other.get("plan_end"):
                continue
            if person_id not in _assignee_ids_of(other):
                continue
            if not self._date_ranges_overlap(ps, pe, other["plan_start"], other["plan_end"]):
                continue
            if not self._ops_shift_overlap(op, other):
                continue
            return False
        return True

    def _person_eligible_on_day_unlocked(
        self, person: dict, day: str, fam: str | None, skill_id: str | None
    ) -> bool:
        """某日是否可上该班：技能 + 可上班次能力 + 当日排班（无任职记录则只看能力）。

        请假按「该日是否在请假窗内」判断；status=leave 只表示今天在假，
        不能挡住非请假日（例如 11 号请假仍可派 12–13 号）。
        """
        if person.get("status") == "disabled":
            return False
        if skill_id and skill_id not in (person.get("skill_ids") or []):
            return False
        pid = person["id"]
        allowed = person.get("shift_family_ids")
        if fam and allowed is not None and len(allowed) > 0 and fam not in allowed:
            return False
        if self._person_on_leave_unlocked(pid, day, day):
            return False
        if fam and self._person_has_assignments_unlocked(pid):
            return self._person_roster_family_on_day_unlocked(pid, day) == fam
        return True

    def _person_free_on_day_unlocked(
        self,
        person_id: str,
        op: dict,
        day: str,
        *,
        reserved: dict[str, set[str]] | None = None,
    ) -> bool:
        """某日×本工序班次是否空闲。"""
        if self._person_on_leave_unlocked(person_id, day, day):
            return False
        if reserved and person_id in (reserved.get(day) or set()):
            return False
        for other in self._data["operations"]:
            if other["id"] == op["id"] or other.get("status") == "done":
                continue
            if not other.get("plan_start") or not other.get("plan_end"):
                continue
            segs = _normalize_plan_segments(other)
            if segs:
                on_other = any(
                    s.get("person_id") == person_id and s["start"] <= day <= s["end"]
                    for s in segs
                )
            else:
                on_other = person_id in _assignee_ids_of(other) and (
                    other["plan_start"][:10]
                    <= day
                    <= (other.get("plan_end") or other["plan_start"])[:10]
                )
            if not on_other:
                continue
            if not self._ops_shift_overlap(op, other):
                continue
            return False
        return True

    def _restaff_op_from_roster_unlocked(
        self,
        op: dict,
        *,
        reserved_by_person: dict[str, set[str]] | None = None,
        only_fill_empty: bool = False,
    ) -> None:
        """按「日 × 班次」从排班解析责任人，写入 plan_segments（连续同人集合并）。

        各时间段可带 required_headcount（缺省用工序级）；段边界保留，不跨段合并。
        三班倒换人时各日可不同人；某日配不齐则该日空岗并计入 staffing_gap。
        only_fill_empty=True 时保留已有 person_ids，只补空日（拉宽新增格用）。
        """
        _normalize_op_fields(op)
        shift = self._resolve_op_shift(op)
        if shift:
            op["shift_id"] = shift["id"]
            op["shift_family_id"] = shift["family_id"]
        fam = op.get("shift_family_id") or (shift or {}).get("family_id")
        default_need = max(int(op.get("required_headcount") or 1), 1)
        skill_id = op.get("skill_id")
        res_id = op.get("resource_id")
        ps = (op.get("plan_start") or "")[:10]
        pe = (op.get("plan_end") or ps)[:10]
        if not ps:
            return

        input_segs = _normalize_plan_segments(op)
        # 用户段：保留日期窗与人数/设备需求；无段则铺满开始~结束
        windows: list[dict] = []
        if input_segs:
            for s in input_segs:
                windows.append(
                    {
                        "start": s["start"],
                        "end": s["end"],
                        "required_headcount": int(
                            s.get("required_headcount") or default_need
                        ),
                        "required_equipment": int(s.get("required_equipment") or 1),
                        "kept_by_day": {},
                    }
                )
                cur = _parse(s["start"])
                end = _parse(s["end"])
                kept_pids = list(s.get("person_ids") or [])
                primary = s.get("person_id")
                while cur <= end:
                    day = cur.isoformat()
                    if only_fill_empty and (kept_pids or primary):
                        windows[-1]["kept_by_day"][day] = (
                            list(kept_pids) if kept_pids else [str(primary)]
                        )
                    cur += timedelta(days=1)
        else:
            windows.append(
                {
                    "start": ps,
                    "end": pe,
                    "required_headcount": default_need,
                    "required_equipment": 1,
                    "kept_by_day": {},
                }
            )

        out_segs: list[dict] = []
        max_day_gap = 0
        all_pids: list[str] = []
        max_need = default_need

        for win in windows:
            need = max(1, int(win["required_headcount"]))
            max_need = max(max_need, need)
            req_eq = max(1, int(win.get("required_equipment") or 1))
            days = [
                _add_days(win["start"], i)
                for i in range(_duration_days(win["start"], win["end"]))
            ]
            day_cells: list[dict] = []
            win_gap = 0
            for day in days:
                kept = win["kept_by_day"].get(day)
                if only_fill_empty and kept:
                    picked = list(kept)
                    day_cells.append({"date": day, "person_ids": picked})
                    for pid in picked:
                        if pid not in all_pids:
                            all_pids.append(pid)
                        if reserved_by_person is not None:
                            reserved_by_person.setdefault(day, set()).add(pid)
                    continue

                candidates = [
                    p
                    for p in self._data["persons"]
                    if self._person_eligible_on_day_unlocked(p, day, fam, skill_id)
                ]
                candidates.sort(
                    key=lambda p: (
                        0 if p.get("resource_id") == res_id else 1,
                        p.get("code") or p["id"],
                    )
                )
                picked: list[str] = []
                for person in candidates:
                    if len(picked) >= need:
                        break
                    pid = person["id"]
                    if not self._person_free_on_day_unlocked(
                        pid, op, day, reserved=reserved_by_person
                    ):
                        continue
                    picked.append(pid)
                gap = max(0, need - len(picked))
                win_gap = max(win_gap, gap)
                max_day_gap = max(max_day_gap, gap)
                # 配不齐 need：该日空岗（不写半套）
                if len(picked) < need:
                    picked = []
                day_cells.append({"date": day, "person_ids": picked})
                for pid in picked:
                    if pid not in all_pids:
                        all_pids.append(pid)
                    if reserved_by_person is not None:
                        reserved_by_person.setdefault(day, set()).add(pid)

            # 段内：连续同人集合并；保留人数/设备需求
            for cell in day_cells:
                last = out_segs[-1] if out_segs else None
                pids = list(cell.get("person_ids") or [])
                same_people = (
                    last is not None
                    and last.get("_win_key") == id(win)
                    and (last.get("person_ids") or []) == pids
                    and _add_days(last["end"], 1) == cell["date"]
                )
                if same_people:
                    last["end"] = cell["date"]
                else:
                    out_segs.append(
                        {
                            "id": f"seg-{len(out_segs) + 1}",
                            "person_id": pids[0] if pids else None,
                            "person_ids": pids,
                            "equipment_ids": [],
                            "required_headcount": need,
                            "required_equipment": req_eq,
                            "staffing_gap": win_gap,
                            "equipment_gap": 0,
                            "start": cell["date"],
                            "end": cell["date"],
                            "_win_key": id(win),
                        }
                    )
            # 把段级 gap 回写到本窗产出的段
            for s in out_segs:
                if s.get("_win_key") == id(win):
                    s["staffing_gap"] = win_gap

        for s in out_segs:
            s.pop("_win_key", None)

        op["plan_segments"] = out_segs
        op["required_headcount"] = max_need
        op["hours_per_day"] = _shift_available_hours(shift)
        _sync_plan_from_segments(op)
        if all_pids:
            op["assignee_ids"] = list(all_pids)
            op["assignee_id"] = all_pids[0]
        else:
            op["assignee_ids"] = []
            op["assignee_id"] = None
        _normalize_op_fields(op)
        # 按日最大缺口为准（勿被「全工序去重人数」盖掉）
        op["staffing_gap"] = (
            max_day_gap if all_pids else max(max_need, max_day_gap)
        )

    def _auto_staff_op_unlocked(
        self,
        op: dict,
        *,
        reserved_by_person: dict[str, set[str]] | None = None,
    ) -> None:
        """按 required_headcount 自动派人：逐日对照排班（兼容一班/多班）。"""
        self._restaff_op_from_roster_unlocked(op, reserved_by_person=reserved_by_person)

    def _gantt_axis_unlocked(self, *, horizon: str = "focus") -> tuple[list[str], dict[str, Any]]:
        """
        甘特日期轴：左端 = 今天往前最多约一个月；右端 = 最远未完工计划结束日。
        默认滚动仍落在今天附近；交期不撑轴，由前端轴右侧「交货截止日期」列展示。
        """
        today = _planning_today()
        start = today - timedelta(days=GANTT_LOOKBACK_DAYS)
        # 至少铺到今天，避免空数据时轴塌掉
        end = today
        mode = (horizon or "all").strip().lower()
        if mode not in ("focus", "all"):
            mode = "all"

        cancelled = self._cancelled_work_order_ids()
        content_end: date | None = None
        for o in self._data["operations"]:
            if o.get("status") in ("done", "cancelled"):
                continue
            if o.get("work_order_id") in cancelled:
                continue
            if not o.get("plan_start") or not o.get("plan_end"):
                continue
            pe = _parse(o["plan_end"][:10])
            if pe >= start:
                content_end = pe if content_end is None else max(content_end, pe)

        if content_end is not None:
            end = max(end, content_end)

        dates: list[str] = []
        cur = start
        while cur <= end:
            dates.append(cur.isoformat())
            cur += timedelta(days=1)
        if not dates:
            dates = [today.isoformat()]

        meta = {
            "today": today.isoformat(),
            "start": dates[0],
            "end": dates[-1],
            "horizon": mode,
            "scroll_to": today.isoformat() if today.isoformat() in set(dates) else dates[0],
            "lookback_days": GANTT_LOOKBACK_DAYS,
            "ahead_days": (end - today).days,
            "clipped": False,
            "hint": "",
        }
        return dates, meta

    def _signed_work_dates(self, op_id: str) -> list[str]:
        """已签字确认的报工日（实绩行只认签字，不认未确认进度）。"""
        days: list[str] = []
        for lg in self._data.get("daily_logs") or []:
            if lg.get("op_id") != op_id:
                continue
            if not (lg.get("confirmed") and lg.get("signature_data")):
                continue
            d = (lg.get("work_date") or "")[:10]
            if d:
                days.append(d)
        return sorted(set(days))

    def _signed_actual_window(self, op: dict) -> tuple[str | None, str | None]:
        """签字后的实绩日历窗；无签字则不上实绩行。"""
        signed = self._signed_work_dates(op["id"])
        if not signed:
            return None, None
        a0 = (op.get("actual_start") or "")[:10] or signed[0]
        if op.get("status") == "done":
            a1 = (op.get("actual_end") or "")[:10] or signed[-1]
        else:
            a1 = signed[-1]
        if a1 < a0:
            a1 = a0
        return a0, a1

    def _build_gantt_cells(
        self,
        ops: list[dict],
        *,
        dates: list[str],
        date_set: set[str],
        axis_start: str,
        window_of=None,
        runs_of=None,
    ) -> dict[str, list[dict]]:
        cells: dict[str, list[dict]] = {d: [] for d in dates}
        for op in ops:
            if runs_of is not None:
                runs = list(runs_of(op) or [])
            else:
                win = window_of(op) if window_of else None
                if not win:
                    continue
                start, end = win
                runs = [(start, end)] if start and end else []
            for start, end in runs:
                if not start or not end:
                    continue
                start, end = start[:10], end[:10]
                cur = _parse(start)
                last = _parse(end)
                while cur <= last:
                    day = cur.isoformat()
                    if day in date_set:
                        # 日×班独立色块：连续多天也不横跨合并（避免左半/右半）
                        cells[day].append(
                            {
                                **op,
                                "segment": "single",
                                "continues_left": False,
                                "busy_hints": self._person_busy_hints(op, day),
                                "bar_start": day,
                                "bar_end": day,
                            }
                        )
                    cur += timedelta(days=1)
        for d in dates:
            cells[d].sort(
                key=lambda o: (
                    int((self._resolve_op_shift(o) or {}).get("sort_order") or 999),
                    {"am": 0, "full": 1, "pm": 2}.get(o.get("slot") or "full", 1),
                    o.get("seq") or 0,
                    (o.get("bar_start") or ""),
                )
            )
        return cells

    def gantt_overview_unlocked(self, *, horizon: str = "focus") -> dict[str, Any]:
        self._ensure_three_shift_regime_unlocked()
        self._ensure_shift_sort_orders_unlocked()
        self._sync_person_leave_status_unlocked()
        cancelled = self._cancelled_work_order_ids()
        ops_all = [
            o
            for o in self._data["operations"]
            if o.get("plan_start")
            and o.get("status") != "cancelled"
            and o.get("work_order_id") not in cancelled
        ]
        dates, axis_meta = self._gantt_axis_unlocked(horizon=horizon)
        date_set = set(dates)
        axis_start = dates[0]
        enriched_ops = [self._enrich_op(o) for o in ops_all]
        active_ops = [o for o in enriched_ops if o.get("status") != "done"]

        order_ops: dict[str, list[dict]] = {}
        for op in enriched_ops:
            oid = op.get("order_id") or f"orphan-{op['work_order_id']}"
            order_ops.setdefault(oid, []).append(op)

        rows: list[dict] = []
        due_markers: list[dict] = []
        for order in self._data["orders"]:
            if order.get("status") == "cancelled":
                continue
            ops = order_ops.get(order["id"])
            if not ops:
                continue
            ops = sorted(ops, key=lambda o: (o.get("seq") or 0, o.get("plan_start") or ""))
            wo = self._wo_map().get(ops[0]["work_order_id"], {})
            plan_cells = self._build_gantt_cells(
                ops,
                dates=dates,
                date_set=date_set,
                axis_start=axis_start,
                runs_of=lambda o: _plan_runs(o),
            )
            actual_ops = []
            for o in ops:
                if self._signed_work_dates(o["id"]):
                    actual_ops.append(o)
            actual_cells = self._build_gantt_cells(
                actual_ops,
                dates=dates,
                date_set=date_set,
                axis_start=axis_start,
                runs_of=lambda o: _merge_day_runs(self._signed_work_dates(o["id"])),
            )
            starts = [o["plan_start"][:10] for o in ops if o.get("plan_start")]
            ends = [o["plan_end"][:10] for o in ops if o.get("plan_end")]
            plan_start = min(starts) if starts else None
            estimated_end = max(ends) if ends else None
            span_days = (
                (_parse(estimated_end) - _parse(plan_start)).days + 1
                if plan_start and estimated_end
                else 0
            )
            total_duration = sum(int(o.get("duration_days") or 1) for o in ops)
            due = order.get("due_date") or wo.get("due_date")
            # 视窗外（整段已结束于左缘之前，或整段在右缘之后）不占行
            if estimated_end and estimated_end < axis_start:
                continue
            if plan_start and plan_start > dates[-1]:
                continue
            unreleased_count = sum(
                1
                for wox in self._data["work_orders"]
                if wox.get("order_id") == order["id"] and wox.get("status") != "cancelled"
                for x in self._data["operations"]
                if x["work_order_id"] == wox["id"]
                and not x.get("plan_start")
                and x.get("status") not in ("done", "cancelled")
            )
            kind_set: list[str] = []
            for o in ops:
                k = o.get("wo_kind") or "normal"
                if k not in kind_set:
                    kind_set.append(k)
            base = {
                "order_id": order["id"],
                "order_code": order["code"],
                "order_name": order["name"],
                "source_type": order.get("source_type"),
                "source_type_label": (
                    "客户订单" if order.get("source_type") == "customer" else "内部生产"
                ),
                "customer_name": order.get("customer_name"),
                "product": order.get("product") or wo.get("product"),
                "due_date": due,
                "plan_start": plan_start,
                "estimated_end": estimated_end,
                "duration_days": total_duration,
                "span_days": span_days,
                "priority": wo.get("priority", "normal"),
                "work_order_id": wo.get("id"),
                "work_order_code": wo.get("code"),
                "work_order_name": wo.get("name"),
                "wo_kinds": kind_set,
                "wo_kind_labels": [WO_KIND_LABELS.get(k, k) for k in kind_set],
                "is_insert_row": any(o.get("is_insert") for o in ops),
                "unreleased_count": unreleased_count,
            }
            rows.append(
                {
                    **base,
                    "row_kind": "plan",
                    "row_label": "计划",
                    "editable": True,
                    "cells": plan_cells,
                    "operations": ops,
                }
            )
            # 有签字实绩才出第二行，避免空「实绩/只读」占位
            if actual_ops:
                rows.append(
                    {
                        **base,
                        "row_kind": "actual",
                        "row_label": "实绩",
                        "editable": False,
                        "cells": actual_cells,
                        "operations": actual_ops,
                    }
                )
            if due and due in date_set:
                due_markers.append(
                    {
                        "order_id": order["id"],
                        "order_code": order["code"],
                        "due_date": due,
                    }
                )

        conflicts = self._detect_conflicts()
        heatmap = self._capacity_heatmap_unlocked(dates=dates)

        plan_rows = [r for r in rows if r.get("row_kind") == "plan"]
        order_n = len(plan_rows)
        wo_n = len({r.get("work_order_id") for r in plan_rows if r.get("work_order_id")})

        conflict_items = [c for c in conflicts if c.get("status") == "conflict"]
        conflict_n = len(conflict_items)
        conflict_order_n = len(
            {c.get("order_code") for c in conflict_items if c.get("order_code")}
        )

        staffing_ops = [o for o in active_ops if int(o.get("staffing_gap") or 0) > 0]
        staffing_n = len(staffing_ops)
        staffing_gap_sum = sum(int(o.get("staffing_gap") or 0) for o in staffing_ops)

        delayed_order_ids = {
            o.get("order_id")
            for o in active_ops
            if int(o.get("delay_days") or 0) > 0 and o.get("order_id")
        }
        delay_n = len(delayed_order_ids)
        delay_ops_n = sum(1 for o in active_ops if int(o.get("delay_days") or 0) > 0)

        return {
            "kpis": [
                {
                    "title": "在排订单",
                    "value": order_n,
                    "ratio": f"含 {wo_n} 张工单" if wo_n else None,
                },
                {
                    "title": "资源冲突",
                    "value": conflict_n,
                    "ratio": f"涉及 {conflict_order_n} 单" if conflict_n else None,
                },
                {
                    "title": "缺编工序",
                    "value": staffing_n,
                    "ratio": f"共缺 {staffing_gap_sum} 人" if staffing_n else None,
                },
                {
                    "title": "预计延期",
                    "value": delay_n,
                    "ratio": f"{delay_ops_n} 道工序" if delay_ops_n else None,
                },
            ],
            "dates": dates,
            "axis": axis_meta,
            "due_markers": due_markers,
            "order_options": [
                {
                    "id": o["id"],
                    "code": o["code"],
                    "name": o["name"],
                    "source_type": o.get("source_type"),
                    "due_date": o.get("due_date"),
                    "unscheduled_count": len(
                        [
                            op
                            for wo in self._data["work_orders"]
                            if wo.get("order_id") == o["id"] and wo.get("status") != "cancelled"
                            for op in self._data["operations"]
                            if op["work_order_id"] == wo["id"]
                            and not op.get("plan_start")
                            and op.get("status") != "cancelled"
                        ]
                    ),
                    "unscheduled_ops": [
                        {
                            "id": op["id"],
                            "name": op["name"],
                            "seq": op.get("seq"),
                            "duration_days": op.get("duration_days") or 2,
                        }
                        for wo in self._data["work_orders"]
                        if wo.get("order_id") == o["id"] and wo.get("status") != "cancelled"
                        for op in sorted(
                            [
                                x
                                for x in self._data["operations"]
                                if x["work_order_id"] == wo["id"]
                                and not x.get("plan_start")
                                and x.get("status") != "cancelled"
                            ],
                            key=lambda x: x.get("seq") or 0,
                        )
                    ],
                    "label": f"{o['code']} · {o['name']}",
                }
                for o in self._data["orders"]
                if o.get("status") not in ("done", "cancelled")
            ],
            "persons": [
                {
                    **p,
                    "skill_names": [
                        self._skill_map()[sid]["name"]
                        for sid in p.get("skill_ids", [])
                        if sid in self._skill_map()
                    ],
                    "shift_family_ids": list(p.get("shift_family_ids") or []),
                    "status_label": (
                        "请假中"
                        if p.get("status") == "leave"
                        else ("停用" if p.get("status") == "disabled" else "在岗")
                    ),
                }
                for p in self._data["persons"]
                if p.get("status") != "disabled"
            ],
            # 开放请假台账：甘特编辑按段日期判断能否派此人（勿只看 persons.status）
            "leaves": [
                {
                    "id": lv.get("id"),
                    "person_id": lv.get("person_id"),
                    "start_date": (lv.get("start_date") or "")[:10],
                    "end_date": (lv.get("end_date") or "")[:10],
                    "reason": lv.get("reason"),
                    "status": lv.get("status") or "open",
                }
                for lv in (self._data.get("leaves") or [])
                if (lv.get("status") or "open") != "closed"
            ],
            "resources": deepcopy(self._data["resources"]),
            "equipments": self._list_equipments_unlocked(),
            "shift_options": [
                self._enrich_shift(s) for s in self._ordered_active_shifts_unlocked()
            ],
            "day_segments": self._day_segments_unlocked(),
            "rows": rows,
            "tasks": enriched_ops,
            "conflicts": conflicts,
            "heatmap": heatmap,
            "sandbox": {
                "active": self._sandbox_base is not None,
                "hint": "试排中：改动不影响正式计划，可「放弃」或「发布」" if self._sandbox_base else None,
            },
            "history": self._history_meta(),
            "today_digest": self._today_digest_unlocked(conflicts=conflicts, heatmap=heatmap),
            "schedule_horizons": [
                {"value": 7, "label": "本周", "description": "快捷填入 7 天"},
                {"value": 14, "label": "两周", "description": "快捷填入 14 天"},
                {"value": 30, "label": "本月", "description": "快捷填入 30 天"},
                {"value": 0, "label": "全部释放", "description": "不限制窗口，排完全部待排工序"},
            ],
        }

    def _today_digest_unlocked(
        self,
        *,
        conflicts: list[dict] | None = None,
        heatmap: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """甘特页「今日待办」摘要。"""
        today_iso = _planning_today().isoformat()
        conflicts = conflicts if conflicts is not None else self._detect_conflicts()
        heatmap = heatmap if heatmap is not None else self._capacity_heatmap_unlocked()
        unscheduled_orders = []
        for o in self._data["orders"]:
            if o.get("status") == "cancelled":
                continue
            n = 0
            for wo in self._data["work_orders"]:
                if wo.get("order_id") != o["id"] or wo.get("status") == "cancelled":
                    continue
                for op in self._data["operations"]:
                    if (
                        op["work_order_id"] == wo["id"]
                        and not op.get("plan_start")
                        and op.get("status") != "cancelled"
                    ):
                        n += 1
            if n:
                unscheduled_orders.append(
                    {"id": o["id"], "code": o["code"], "name": o["name"], "count": n}
                )
        overload_dates = sorted(
            {
                c["date"]
                for row in heatmap.get("rows") or []
                for c in row.get("cells") or []
                if c.get("level") == "overload" and (c.get("date") or "") >= today_iso
            }
        )
        return {
            "today": today_iso,
            "unscheduled_order_count": len(unscheduled_orders),
            "unscheduled_op_count": sum(x["count"] for x in unscheduled_orders),
            "unscheduled_orders": unscheduled_orders[:8],
            "conflict_count": sum(1 for c in conflicts if c.get("status") == "conflict"),
            "leave_count": sum(1 for c in conflicts if c.get("status") == "leave"),
            "staffing_count": sum(1 for c in conflicts if c.get("status") == "staffing"),
            "delay_count": sum(1 for c in conflicts if c.get("status") == "delay"),
            "capacity_overload_count": sum(
                1 for c in conflicts if c.get("status") == "overload"
            ),
            "overload_day_count": len(overload_dates),
            "overload_dates": overload_dates[:5],
        }

    def move_task(
        self,
        op_id: str,
        plan_start: str,
        *,
        slot: str | None = None,
        shift_id: str | None = None,
        assignee_ids: list[str] | None = None,
        duration_days: int | None = None,
        plan_segments: list[dict] | None = None,
        hours_per_day: float | None = None,
        equipment_id: str | None = None,
        cascade: bool = True,
        clear_equipment: bool = False,
        resolve_roster: bool = False,
        only_fill_empty: bool = False,
        required_headcount: int | None = None,
        auto_equipment: bool = False,
    ) -> dict:
        with self._lock:
            self._checkpoint()
            return self._move_task_unlocked(
                op_id,
                plan_start,
                slot=slot,
                shift_id=shift_id,
                assignee_ids=assignee_ids,
                duration_days=duration_days,
                plan_segments=plan_segments,
                hours_per_day=hours_per_day,
                equipment_id=equipment_id,
                cascade=cascade,
                clear_equipment=clear_equipment,
                resolve_roster=resolve_roster,
                only_fill_empty=only_fill_empty,
                required_headcount=required_headcount,
                auto_equipment=auto_equipment,
            )

    def _move_task_unlocked(
        self,
        op_id: str,
        plan_start: str,
        *,
        slot: str | None = None,
        shift_id: str | None = None,
        assignee_ids: list[str] | None = None,
        duration_days: int | None = None,
        plan_segments: list[dict] | None = None,
        hours_per_day: float | None = None,
        equipment_id: str | None = None,
        cascade: bool = True,
        clear_equipment: bool = False,
        resolve_roster: bool = False,
        only_fill_empty: bool = False,
        required_headcount: int | None = None,
        auto_equipment: bool = False,
    ) -> dict:
        op = self._op_map().get(op_id)
        if not op:
            raise NotFoundException("任务不存在")
        if op["status"] == "done":
            raise ValidationException("已完工任务不可调整")
        today_iso = _planning_today().isoformat()
        new_start = plan_start[:10]
        old_start = (op.get("plan_start") or "")[:10]
        if new_start < today_iso and new_start != old_start:
            raise ValidationException("不能排到今天之前的日期（历史计划已冻结）")
        if old_start and old_start < today_iso and new_start != old_start:
            raise ValidationException("已开始于今天之前的工序不可改开始日（历史已冻结）")

        # hours_per_day 由班次时段决定，忽略客户端手填
        _ = hours_per_day

        if required_headcount is not None:
            op["required_headcount"] = max(1, min(20, int(required_headcount)))

        if plan_segments is not None:
            # 显式提交时间段（可空=回到连续段）
            op["plan_segments"] = list(plan_segments)
            if plan_segments:
                _sync_plan_from_segments(op)
            else:
                op["plan_segments"] = []
                days = duration_days if duration_days is not None else (
                    op.get("duration_days") or 2
                )
                days = max(int(days), 1)
                op["plan_start"] = new_start
                op["plan_end"] = _end_from_start(op["plan_start"], days)
                op["duration_days"] = days
                if assignee_ids is not None:
                    op["assignee_ids"] = list(assignee_ids)
                    op["assignee_id"] = assignee_ids[0] if assignee_ids else None
                _sync_plan_from_segments(op)
        else:
            existing_segs = _normalize_plan_segments(op)
            if existing_segs:
                # 拖拽/只改开始：整体平移各时间段
                delta = (_parse(new_start) - _parse(old_start)).days if old_start else 0
                if delta:
                    for s in existing_segs:
                        s["start"] = _add_days(s["start"], delta)
                        s["end"] = _add_days(s["end"], delta)
                    op["plan_segments"] = existing_segs
                if assignee_ids is not None and not any(
                    s.get("person_id") for s in existing_segs
                ):
                    op["assignee_ids"] = list(assignee_ids)
                    op["assignee_id"] = assignee_ids[0] if assignee_ids else None
                _sync_plan_from_segments(op)
            else:
                days = duration_days if duration_days is not None else (
                    op.get("duration_days")
                    or (
                        _duration_days(op["plan_start"], op["plan_end"])
                        if op.get("plan_start") and op.get("plan_end")
                        else 2
                    )
                )
                days = max(int(days), 1)
                op["plan_start"] = new_start
                op["plan_end"] = _end_from_start(op["plan_start"], days)
                op["duration_days"] = days
                if assignee_ids is not None:
                    op["assignee_ids"] = list(assignee_ids)
                    op["assignee_id"] = assignee_ids[0] if assignee_ids else None
                    need = int(op.get("required_headcount") or 1)
                    op["staffing_gap"] = max(0, need - len(assignee_ids))

        op.pop("variance_ack", None)
        if shift_id is not None:
            shift = self._shift_map().get(shift_id)
            if not shift:
                raise ValidationException("班次不存在")
            op["shift_id"] = shift_id
            op["shift_family_id"] = shift.get("family_id")
            op["slot"] = "full"
        elif slot:
            if slot not in ("full", "am", "pm"):
                raise ValidationException("时段仅支持 full/am/pm")
            op["slot"] = slot
            fam = "sh-day"
            active = self._active_shift_for_family(fam)
            if active:
                op["shift_id"] = active["id"]
                op["shift_family_id"] = fam

        if clear_equipment:
            op["equipment_id"] = None
        elif equipment_id is not None:
            self._ensure_equipments_shape_unlocked()
            eid = (equipment_id or "").strip() or None
            if eid:
                eq = self._equipment_map().get(eid)
                if not eq:
                    raise ValidationException("设备不存在")
                if eq.get("status") == "disabled":
                    raise ValidationException("不能占用已停用设备")
            op["equipment_id"] = eid

        # 日期/班次落定后：按排班解析各日责任人（拖拽换班、保存自动派）
        # 若前端显式传了 assignee_ids 且未要求 resolve，则尊重手选，不覆盖。
        should_resolve = resolve_roster or only_fill_empty
        if should_resolve and assignee_ids is None:
            self._restaff_op_from_roster_unlocked(
                op, only_fill_empty=only_fill_empty and not resolve_roster
            )
            if auto_equipment and not clear_equipment:
                op["equipment_id"] = None
                op["equipment_ids"] = []
                self._auto_equip_segments_unlocked(op)
            elif not op.get("equipment_id") and not clear_equipment:
                self._auto_equip_segments_unlocked(op)

        self._sync_op_hours_from_shift_unlocked(op)
        _normalize_op_fields(op)

        if cascade:
            self._cascade_successors_unlocked(op_id)

        enriched = self._enrich_op(op)
        enriched["busy_hints"] = self._person_busy_hints(op, op["plan_start"][:10])
        return enriched

    def _template_equipment_pool(self, op: dict) -> list[str]:
        tid = op.get("template_id")
        if not tid:
            return []
        tpl = next((t for t in (self._data.get("templates") or []) if t.get("id") == tid), None)
        return [str(x) for x in ((tpl or {}).get("equipment_ids") or []) if x]

    def _equipment_options_for_op_unlocked(self, op: dict) -> list[dict]:
        """甘特可选设备：模板池优先，否则同班组启用设备 + 公共设备。"""
        self._ensure_equipments_shape_unlocked()
        eq_map = self._equipment_map()
        pool = self._template_equipment_pool(op)
        rows: list[dict] = []
        if pool:
            for eid in pool:
                e = eq_map.get(eid)
                if e and e.get("status") == "active":
                    rows.append(deepcopy(e))
        else:
            rid = op.get("resource_id")
            for e in self._list_equipments_unlocked():
                if e.get("status") != "active":
                    continue
                if not e.get("resource_id") or e.get("resource_id") == rid:
                    rows.append(e)
        return rows

    def _pick_equipment_for_op_unlocked(
        self, op: dict, *, reserved: dict[str, set[str]] | None = None
    ) -> str | None:
        """从池内选当日该班次占用最少的启用设备；无池返回 None。"""
        picked = self._pick_n_equipments_for_window_unlocked(
            op,
            start=(op.get("plan_start") or "")[:10],
            end=(op.get("plan_end") or op.get("plan_start") or "")[:10],
            need=1,
            reserved=reserved,
            prefer=op.get("equipment_id"),
        )
        return picked[0] if picked else None

    def _pick_n_equipments_for_window_unlocked(
        self,
        op: dict,
        *,
        start: str,
        end: str,
        need: int = 1,
        reserved: dict[str, set[str]] | None = None,
        prefer: str | None = None,
        exclude: set[str] | None = None,
    ) -> list[str]:
        """从池内为日期窗挑选 need 台负荷最低的启用设备。"""
        options = self._equipment_options_for_op_unlocked(op)
        if not options or need < 1:
            return []
        reserved = reserved or {}
        exclude = exclude or set()
        days = (
            [_add_days(start, i) for i in range(_duration_days(start, end))]
            if start
            else []
        )
        avail = [e for e in options if e["id"] not in exclude]
        if not avail:
            return []

        def score(eid: str) -> tuple[int, int, int]:
            hits = sum(1 for d in days if eid in reserved.get(d, set()))
            prefer_rank = 0 if prefer and eid == prefer else 1
            idx = next(i for i, e in enumerate(options) if e["id"] == eid)
            return (hits, prefer_rank, idx)

        ordered = sorted((e["id"] for e in avail), key=score)
        return ordered[:need]

    def _auto_equip_segments_unlocked(self, op: dict) -> None:
        """按各段 required_equipment 自动占机，写入 segment.equipment_ids。"""
        segs = _normalize_plan_segments(op)
        if not segs:
            return
        reserved: dict[str, set[str]] = {}
        # 其它工序已占机（同班重叠）计入 reserved，降低选到冲突机的概率
        fam = op.get("shift_family_id")
        for other in self._data["operations"]:
            if other.get("id") == op.get("id") or not other.get("plan_start"):
                continue
            if other.get("status") in ("done", "cancelled"):
                continue
            if fam and other.get("shift_family_id") and other.get("shift_family_id") != fam:
                if not self._ops_shift_overlap(op, other):
                    continue
            other_eids = list(other.get("equipment_ids") or [])
            if other.get("equipment_id") and other["equipment_id"] not in other_eids:
                other_eids.append(other["equipment_id"])
            if not other_eids:
                continue
            for s in _normalize_plan_segments(other) or [
                {"start": other["plan_start"][:10], "end": (other.get("plan_end") or other["plan_start"])[:10]}
            ]:
                cur = _parse(s["start"])
                end = _parse(s["end"])
                while cur <= end:
                    day = cur.isoformat()
                    reserved.setdefault(day, set()).update(other_eids)
                    cur += timedelta(days=1)

        all_eids: list[str] = []
        max_eq_gap = 0
        for s in segs:
            need = max(1, int(s.get("required_equipment") or 1))
            picked = self._pick_n_equipments_for_window_unlocked(
                op,
                start=s["start"],
                end=s["end"],
                need=need,
                reserved=reserved,
                prefer=op.get("equipment_id"),
            )
            gap = max(0, need - len(picked))
            max_eq_gap = max(max_eq_gap, gap)
            if len(picked) < need:
                picked = []
            s["equipment_ids"] = picked
            s["equipment_gap"] = gap
            cur = _parse(s["start"])
            end = _parse(s["end"])
            while cur <= end:
                if picked:
                    reserved.setdefault(cur.isoformat(), set()).update(picked)
                cur += timedelta(days=1)
            for eid in picked:
                if eid not in all_eids:
                    all_eids.append(eid)

        op["plan_segments"] = segs
        if all_eids:
            op["equipment_id"] = all_eids[0]
            op["equipment_ids"] = all_eids
        else:
            op["equipment_id"] = None
            op["equipment_ids"] = []
        op["equipment_gap"] = max_eq_gap
        _sync_plan_from_segments(op)

    def schedule_order_ops(self, payload: dict[str, Any]) -> dict:
        """把工单上已拆分、尚未排产的工序拉进甘特，并按每天人数自动派人。"""
        with self._lock:
            self._checkpoint()
            return self._schedule_order_ops_unlocked(payload)

    def _schedule_order_ops_unlocked(self, payload: dict[str, Any]) -> dict:
            order_id = payload.get("order_id")
            order = self._order_map().get(order_id or "")
            if not order:
                raise NotFoundException("请选择订单")
            wo_ids = {
                w["id"]
                for w in self._data["work_orders"]
                if w.get("order_id") == order_id and w.get("status") != "cancelled"
            }
            if not wo_ids:
                raise ValidationException("该订单还没有可排产工单，请先在工单管理创建并拆分工序")

            ops = [
                o
                for o in self._data["operations"]
                if o["work_order_id"] in wo_ids
                and not o.get("plan_start")
                and o["status"] not in ("done", "cancelled")
            ]
            if not ops:
                raise ValidationException("该订单没有待排产工序（可能已全部排上甘特）")

            ops = sorted(ops, key=lambda o: (o.get("seq") or 0, o["id"]))
            today_iso = _planning_today().isoformat()
            cursor = (payload.get("plan_start") or today_iso)[:10]
            if cursor < today_iso:
                cursor = today_iso

            # 滚动细排：只释放开始日落在窗口内的工序；其余留待下周期
            raw_h = payload.get("horizon_days")
            try:
                horizon_days = 14 if raw_h is None else int(raw_h)
            except (TypeError, ValueError):
                horizon_days = 14
            if horizon_days < 0:
                horizon_days = 14
            window_end: date | None = None
            if horizon_days > 0:
                window_end = _parse(cursor) + timedelta(days=horizon_days - 1)

            reserved: dict[str, set[str]] = {}
            reserved_eq: dict[str, set[str]] = {}
            # 先收集甘特上已有占用，避免和新排工序抢人/机
            for other in self._data["operations"]:
                if other.get("status") == "done" or not other.get("plan_start"):
                    continue
                if other["id"] in {o["id"] for o in ops}:
                    continue
                for i in range(
                    _duration_days(other["plan_start"], other["plan_end"] or other["plan_start"])
                ):
                    day = _add_days(other["plan_start"], i)
                    for pid in _assignee_ids_of(other):
                        reserved.setdefault(day, set()).add(pid)
                    eid = other.get("equipment_id")
                    if eid:
                        reserved_eq.setdefault(day, set()).add(str(eid))

            scheduled: list[dict] = []
            held: list[dict] = []
            releasing = True
            for op in ops:
                days = max(int(op.get("duration_days") or 2), 1)
                earliest = _parse(cursor)
                for pid in op.get("prev_op_ids") or []:
                    prev = self._op_map().get(pid)
                    if prev and prev.get("plan_end"):
                        earliest = max(earliest, _parse(prev["plan_end"]) + timedelta(days=1))
                start = earliest
                if releasing and window_end is not None and start > window_end:
                    releasing = False
                if not releasing:
                    held.append(
                        {
                            "id": op["id"],
                            "name": op["name"],
                            "seq": op.get("seq"),
                            "duration_days": days,
                        }
                    )
                    continue

                op["plan_start"] = start.isoformat()
                op["plan_end"] = _end_from_start(op["plan_start"], days)
                op["duration_days"] = days
                op["slot"] = op.get("slot") or "full"
                if not op.get("required_headcount"):
                    op["required_headcount"] = 1
                self._auto_staff_op_unlocked(op, reserved_by_person=reserved)
                picked = self._pick_equipment_for_op_unlocked(op, reserved=reserved_eq)
                if picked:
                    op["equipment_id"] = picked
                    for i in range(_duration_days(op["plan_start"], op["plan_end"])):
                        day = _add_days(op["plan_start"], i)
                        reserved_eq.setdefault(day, set()).add(picked)
                cursor = _add_days(op["plan_end"], 1)
                scheduled.append(self._enrich_op(op))
                self._sync_work_order_status(op["work_order_id"])

            if not scheduled:
                raise ValidationException(
                    f"滚动窗口内排不下下一道工序（窗口至 {window_end.isoformat() if window_end else '-'}）。"
                    "请加大窗口、提前开始日，或选「全部释放」。"
                )

            overview = self.gantt_overview_unlocked()
            overview["scheduled"] = scheduled
            overview["held_ops"] = held
            shortage = sum(1 for o in scheduled if int(o.get("staffing_gap") or 0) > 0)
            horizon_label = (
                "全部剩余"
                if horizon_days <= 0
                else (
                    f"{horizon_days} 天"
                    if horizon_days not in (1, 7, 14, 30)
                    else {1: "天", 7: "本周", 14: "两周", 30: "本月"}[horizon_days]
                )
            )
            msg = f"本窗（{horizon_label}）已排 {len(scheduled)} 道"
            if shortage:
                msg += f"，其中 {shortage} 道缺人"
            else:
                msg += "，人员已配齐"
            if held:
                msg += f"；另有 {len(held)} 道留待下周期"
            overview["schedule_summary"] = {
                "scheduled_count": len(scheduled),
                "held_count": len(held),
                "shortage_count": shortage,
                "horizon_days": horizon_days,
                "window_start": (payload.get("plan_start") or today_iso)[:10],
                "window_end": window_end.isoformat() if window_end else None,
                "message": msg,
            }
            return overview

    def delete_gantt_task(self, op_id: str, *, force: bool = False) -> dict:
        with self._lock:
            op = self._op_map().get(op_id)
            if not op:
                raise NotFoundException("工序不存在")
            forced = False
            if op["status"] == "running":
                if not force:
                    raise ValidationException(
                        "该工序进行中，不能直接从甘特撤下（现场可能正在报工）。"
                        "请先在报工页暂停或完工；确需撤下请使用「强制撤下」。"
                    )
                forced = True
            self._checkpoint()
            if forced:
                # 强制撤下：清空计划并退回待排，避免甘特上还有进行中幽灵
                op["status"] = "pending"
                op["progress"] = 0
                op["actual_start"] = None
                op["actual_end"] = None
            wo_id = op["work_order_id"]
            op["plan_start"] = None
            op["plan_end"] = None
            self._sync_work_order_status(wo_id)
            return {
                "ok": True,
                "deleted_id": op_id,
                "unscheduled": True,
                "forced": forced,
            }

    # ----- shop floor report -----

    def report_overview(self, *, person_id: str | None = None, work_date: str | None = None) -> dict[str, Any]:
        with self._lock:
            # 「今天」与甘特一致：真实日历；种子数据里的 ANCHOR 仅作演示落点
            today = (work_date or _planning_today().isoformat())[:10]
            cancelled_wos = self._cancelled_work_order_ids()
            # 与甘特同一套可见性：排除已取消工序/工单；未排产仍保留在「全部工序」便于对照
            raw_ops = [
                o
                for o in self._data["operations"]
                if o.get("status") != "cancelled"
                and o.get("work_order_id") not in cancelled_wos
            ]
            ops = [self._enrich_op(o) for o in raw_ops]

            # 工单进度：取第一张生产中工单
            wo = next((w for w in self._data["work_orders"] if w["status"] == "producing"), None)
            wo_progress = None
            if wo:
                wo_ops = [o for o in ops if o["work_order_id"] == wo["id"]]
                if wo_ops:
                    avg = round(sum(o["progress"] for o in wo_ops) / len(wo_ops))
                    started = sum(1 for o in wo_ops if o["status"] in ("running", "done", "paused"))
                    enriched_wo = self._enrich_work_order(wo)
                    wo_progress = {
                        "order_code": enriched_wo.get("order_code"),
                        "order_name": enriched_wo.get("order_name"),
                        "source_type_label": enriched_wo.get("source_type_label"),
                        "work_order_code": wo["code"],
                        "work_order_name": wo["name"],
                        "percent": avg,
                        "summary": f"{avg}% 已完成 · {len(wo_ops)} 道工序中的 {started} 道已开工",
                    }

            today_tasks = self._today_tasks_unlocked(today, person_id)
            # 当日全部报工记录（不按顶栏人过滤，供多人签字/删错签）
            daily_logs = self._daily_logs_unlocked(today, None)
            logs_today = [
                lg
                for lg in (self._data.get("daily_logs") or [])
                if (lg.get("work_date") or "")[:10] == today
            ]
            if person_id:
                logs_for_kpi = [lg for lg in logs_today if lg.get("person_id") == person_id]
            else:
                logs_for_kpi = logs_today
            hours_today = round(sum(float(lg.get("hours") or 0) for lg in logs_for_kpi), 1)
            people_today = len({lg.get("person_id") for lg in logs_today if lg.get("person_id")})

            # KPI 按「当日任务」计，避免与甘特今日待办口径打架
            pending = sum(1 for o in today_tasks if o["status"] == "pending")
            running = sum(1 for o in today_tasks if o["status"] == "running")
            abnormal = sum(1 for o in today_tasks if o["status"] in ("paused", "exception"))

            return {
                "kpis": [
                    {"title": "今日待开工", "value": pending},
                    {"title": "进行中", "value": running},
                    {"title": "今日报工工时", "value": hours_today, "ratio": f"{people_today} 人已报"},
                    {"title": "异常 / 暂停", "value": abnormal},
                ],
                "work_date": today,
                "items": sorted(
                    ops,
                    key=lambda o: (
                        {"running": 0, "pending": 1, "paused": 2, "exception": 3, "done": 4}.get(
                            o["status"], 9
                        ),
                        o.get("plan_start") or "",
                    ),
                ),
                "today_tasks": today_tasks,
                "daily_logs": daily_logs,
                "daily_summary": {
                    "work_date": today,
                    "log_count": len(logs_today),
                    "hours_total": hours_today,
                    "people_count": people_today,
                    "task_count": len(today_tasks),
                    "message": (
                        f"{today}：{len(today_tasks)} 道今日任务，"
                        f"已报 {len(logs_today)} 条 / {hours_today} 工时"
                    ),
                },
                "persons": [
                    {
                        "id": p["id"],
                        "name": p["name"],
                        "code": p.get("code"),
                        "status": p.get("status"),
                    }
                    for p in self._data["persons"]
                    if p.get("status") != "disabled"
                ],
                "work_order_progress": wo_progress,
                "events": deepcopy(self._data["events"]),
            }

    def _today_tasks_unlocked(self, work_date: str, person_id: str | None = None) -> list[dict]:
        """现场「今日任务」：

        - 计划盖住当天 / 进行中 / 当日已报工 / 当日刚完工（可补签）
        - 补做：计划已结束仍未完工（如 23 号一天没干完，24 号仍可开）
        - 提前：计划在未来 REPORT_EARLY_PULL_DAYS 天内（如 24 号可开 25 号）
        未排产不进清单。
        """
        day = work_date[:10]
        day_d = _parse(day)
        early_until = (day_d + timedelta(days=REPORT_EARLY_PULL_DAYS)).isoformat()
        cancelled_wos = self._cancelled_work_order_ids()
        logged_op_ids = {
            lg.get("op_id")
            for lg in (self._data.get("daily_logs") or [])
            if (lg.get("work_date") or "")[:10] == day and lg.get("op_id")
        }
        tasks: list[dict] = []
        seen: set[str] = set()
        for op in self._data["operations"]:
            if op.get("status") == "cancelled":
                continue
            if op.get("work_order_id") in cancelled_wos:
                continue
            finished_today = (
                op.get("status") == "done" and (op.get("actual_end") or "")[:10] == day
            )
            if op.get("status") == "done" and not finished_today:
                continue
            ps, pe = op.get("plan_start") or "", op.get("plan_end") or ""
            if not ps and not finished_today:
                continue  # 未排产：不进今日任务
            pe = pe or ps or day
            ps10, pe10 = ps[:10], pe[:10]
            in_plan_window = bool(ps) and ps10 <= day <= pe10
            in_progress = op.get("status") in ("running", "paused", "exception")
            has_log = op["id"] in logged_op_ids
            # 计划窗已过、仍未完工 → 补做
            overdue = (
                op.get("status") in ("pending", "paused", "exception")
                and bool(ps)
                and pe10 < day
            )
            # 计划在「明天起…提前窗口内」且待开工 → 可提前
            early = (
                op.get("status") == "pending"
                and bool(ps)
                and day < ps10 <= early_until
            )
            if not (
                in_plan_window
                or in_progress
                or has_log
                or finished_today
                or overdue
                or early
            ):
                continue
            # 不按计划责任人过滤：班组/管理视角看全部；谁上手谁报（person_id 只影响「我的签字」态）
            if op["id"] in seen:
                continue
            seen.add(op["id"])
            enriched = self._enrich_op(op)
            day_logs = [
                lg
                for lg in (self._data.get("daily_logs") or [])
                if lg.get("op_id") == op["id"] and (lg.get("work_date") or "")[:10] == day
            ]
            my_log = next(
                (lg for lg in day_logs if person_id and lg.get("person_id") == person_id),
                None,
            )
            # 无选人时：用「是否已有人签」；有选人时：看该人是否已签
            if person_id:
                logged = my_log
            else:
                logged = next(
                    (
                        lg
                        for lg in day_logs
                        if lg.get("confirmed") and lg.get("signature_data")
                    ),
                    day_logs[0] if day_logs else None,
                )
            signed_logs = [
                lg for lg in day_logs if lg.get("confirmed") and lg.get("signature_data")
            ]
            persons = self._person_map()
            actual_workers = []
            for lg in signed_logs:
                pid = lg.get("person_id") or ""
                actual_workers.append(
                    {
                        "person_id": pid,
                        "person_name": persons.get(pid, {}).get("name") or pid,
                        "hours": lg.get("hours"),
                        "confirmed": True,
                    }
                )
            # 已报未签也展示在「实际」侧（灰），便于班组看到谁上手了
            for lg in day_logs:
                pid = lg.get("person_id") or ""
                if any(w["person_id"] == pid for w in actual_workers):
                    continue
                actual_workers.append(
                    {
                        "person_id": pid,
                        "person_name": persons.get(pid, {}).get("name") or pid,
                        "hours": lg.get("hours"),
                        "confirmed": bool(lg.get("confirmed") and lg.get("signature_data")),
                    }
                )

            enriched["plan_assignee_name"] = enriched.get("assignee_name") or "未派人"
            enriched["plan_assignee_names"] = list(enriched.get("assignee_names") or [])
            enriched["actual_workers_today"] = actual_workers
            enriched["actual_assignee_names"] = (
                "、".join(w["person_name"] for w in actual_workers) if actual_workers else None
            )
            enriched["today_signed_count"] = len(signed_logs)
            enriched["today_report_count"] = len(day_logs)
            enriched["today_logged"] = (
                my_log is not None if person_id else len(day_logs) > 0
            )
            enriched["today_confirmed"] = bool(
                (my_log and my_log.get("confirmed") and my_log.get("signature_data"))
                if person_id
                else signed_logs
            )
            enriched["today_log"] = self._enrich_daily_log(logged) if logged else None
            # 完工补签：选人后看该人是否已签；未选人则「仍有人未签」也可补
            if finished_today:
                if person_id:
                    enriched["can_resign"] = not bool(
                        my_log and my_log.get("confirmed") and my_log.get("signature_data")
                    )
                else:
                    enriched["can_resign"] = True
            else:
                enriched["can_resign"] = False

            if early:
                task_bucket = "early"
            elif overdue:
                task_bucket = "overdue"
            elif in_progress:
                task_bucket = "running"
            elif finished_today:
                task_bucket = "done_today"
            else:
                task_bucket = "today"
            enriched["task_bucket"] = task_bucket
            enriched["task_bucket_label"] = {
                "early": "可提前",
                "overdue": "补做",
                "running": "进行中",
                "done_today": "今日完工",
                "today": "今日计划",
            }.get(task_bucket, task_bucket)

            # 已排产的待开工：当日计划 / 补做 / 提前 均可开
            enriched["can_start"] = enriched["status"] == "pending" and bool(ps)
            enriched["start_blocked_reason"] = None
            if enriched["status"] == "pending" and not ps:
                enriched["can_start"] = False
                enriched["start_blocked_reason"] = "工序尚未排产"
            elif early:
                enriched["start_hint"] = f"计划 {ps10} 开始，开工将把计划前移到今天"
            elif overdue:
                enriched["start_hint"] = f"原计划至 {pe10}，逾期未完成，开工将计划锚到今天"
            # 进行中：后来者直接报工签字，不必再点开工
            if enriched["status"] in ("running", "paused"):
                enriched["start_hint"] = (
                    (enriched.get("start_hint") or "") + "；已开工，上手人直接报工签字即可"
                ).lstrip("；")

            tasks.append(enriched)
        tasks.sort(
            key=lambda o: (
                {"running": 0, "overdue": 1, "today": 2, "early": 3, "done_today": 4}.get(
                    o.get("task_bucket") or "", 9
                ),
                0 if o.get("status") == "paused" else 1,
                o.get("plan_start") or "",
                o.get("seq") or 0,
            )
        )
        return tasks

    def _enrich_daily_log(self, log: dict | None) -> dict | None:
        if not log:
            return None
        op = self._op_map().get(log.get("op_id") or "")
        person = self._person_map().get(log.get("person_id") or "", {})
        wo = self._wo_map().get((op or {}).get("work_order_id") or "", {}) if op else {}
        order = self._order_map().get(wo.get("order_id") or "", {}) if wo else {}
        return {
            **deepcopy(log),
            "person_name": person.get("name"),
            "person_code": person.get("code"),
            "op_name": (op or {}).get("name"),
            "work_order_code": wo.get("code"),
            "order_code": order.get("code"),
            "order_name": order.get("name"),
            "resource_name": self._resource_map()
            .get((op or {}).get("resource_id") or "", {})
            .get("name"),
            "progress_after": (op or {}).get("progress"),
            "confirmed": bool(log.get("confirmed") and log.get("signature_data")),
            "has_signature": bool(log.get("signature_data")),
        }

    def _daily_logs_unlocked(
        self, work_date: str | None = None, person_id: str | None = None
    ) -> list[dict]:
        rows = list(self._data.get("daily_logs") or [])
        if work_date:
            day = work_date[:10]
            rows = [lg for lg in rows if (lg.get("work_date") or "")[:10] == day]
        if person_id:
            rows = [lg for lg in rows if lg.get("person_id") == person_id]
        rows.sort(key=lambda lg: (lg.get("at") or "", lg.get("id") or ""), reverse=True)
        return [self._enrich_daily_log(lg) for lg in rows]  # type: ignore[misc]

    def submit_daily_log(self, payload: dict[str, Any]) -> dict:
        """每日任务确认：工作内容 + 工时/进度 + 手写签字。"""
        with self._lock:
            op_id = payload.get("op_id") or ""
            person_id = payload.get("person_id") or ""
            work_date = (payload.get("work_date") or _planning_today().isoformat())[:10]
            op = self._op_map().get(op_id)
            if not op:
                raise NotFoundException("工序不存在")
            # 已完工：仅允许完工当日补签，不改工序状态
            resign_only = False
            if op.get("status") == "done":
                end_day = (op.get("actual_end") or "")[:10]
                if end_day != work_date:
                    raise ValidationException("仅完工当日可补签确认，历史完工请到「每日生产记录」查看")
                resign_only = True
            person = self._person_map().get(person_id)
            if not person:
                raise NotFoundException("人员不存在")
            hours = float(payload.get("hours") or 0)
            if hours < 0 or hours > 24:
                raise ValidationException("工时需在 0～24 之间")
            progress = payload.get("progress")
            if progress is None:
                raise ValidationException("请填写进度百分比")
            progress = int(progress)
            if progress < 0 or progress > 100:
                raise ValidationException("进度需在 0～100 之间")
            if resign_only:
                progress = 100

            work_content = (payload.get("work_content") or payload.get("note") or "").strip()
            if not work_content:
                raise ValidationException("请填写今日工作内容确认")
            signature_data = payload.get("signature_data") or ""
            if not isinstance(signature_data, str) or not signature_data.startswith("data:image"):
                raise ValidationException("请手写签字确认（鼠标在签字区书写）")
            # 简单长度限制，避免异常大图
            if len(signature_data) > 800_000:
                raise ValidationException("签字图片过大，请重签")

            # 同人同工序同日：更新已有记录，否则新增
            existing = next(
                (
                    lg
                    for lg in (self._data.get("daily_logs") or [])
                    if lg.get("op_id") == op_id
                    and lg.get("person_id") == person_id
                    and (lg.get("work_date") or "")[:10] == work_date
                ),
                None,
            )
            now = datetime.now().isoformat(timespec="seconds")
            note = (payload.get("note") or "").strip() or work_content
            if existing:
                existing["hours"] = hours
                existing["progress"] = progress
                existing["note"] = note
                existing["work_content"] = work_content
                existing["signature_data"] = signature_data
                existing["signed_at"] = now
                existing["confirmed"] = True
                existing["at"] = now
                log = existing
            else:
                log = {
                    "id": self._next_id("daily_log", "dlog"),
                    "work_date": work_date,
                    "op_id": op_id,
                    "person_id": person_id,
                    "hours": hours,
                    "progress": progress,
                    "note": note,
                    "work_content": work_content,
                    "signature_data": signature_data,
                    "signed_at": now,
                    "confirmed": True,
                    "at": now,
                }
                self._data.setdefault("daily_logs", []).append(log)

            # 回写工序进度（补签不改状态；进行中取较大值）
            auto_finished = False
            calibration = None
            if resign_only:
                op["progress"] = 100
            else:
                prev_progress = int(op.get("progress") or 0)
                op["progress"] = max(prev_progress, progress)
                if op["status"] == "pending" and progress > 0:
                    op["status"] = "running"
                    if not op.get("actual_start"):
                        op["actual_start"] = now
                if progress >= 100 and op["status"] != "done":
                    op["status"] = "done"
                    op["progress"] = 100
                    op["actual_end"] = now
                    if not op.get("actual_start"):
                        op["actual_start"] = now
                    auto_finished = True
                    calibration = self._calibrate_template_from_op_unlocked(op)

            self._append_event(
                person.get("name") or "现场",
                op["name"],
                (
                    f"完工补签 · {hours}h · 已签字"
                    if resign_only
                    else f"下班确认 · {hours}h · 进度 {progress}% · 已签字"
                    + (" · 已完工" if auto_finished else "")
                ),
            )
            self._sync_work_order_status(op["work_order_id"])

            return {
                "log": self._enrich_daily_log(log),
                "operation": self._enrich_op(op),
                "auto_finished": auto_finished,
                "calibration": calibration,
                "message": (
                    f"已补签确认 {work_date} 工作内容：{hours} 工时"
                    if resign_only
                    else (
                        f"已确认 {work_date} 工作内容并签字：{hours} 工时，进度 {progress}%"
                        + ("，工序已自动完工" if auto_finished else "")
                    )
                ),
            }

    def delete_daily_log(self, log_id: str) -> dict:
        """删除错签/误报的日报记录（不回滚工序进度）。"""
        with self._lock:
            logs = self._data.setdefault("daily_logs", [])
            idx = next((i for i, lg in enumerate(logs) if lg.get("id") == log_id), None)
            if idx is None:
                raise NotFoundException("报工记录不存在")
            removed = logs.pop(idx)
            person = self._person_map().get(removed.get("person_id") or "", {})
            op = self._op_map().get(removed.get("op_id") or "") or {}
            day = (removed.get("work_date") or "")[:10]
            self._append_event(
                person.get("name") or "现场",
                op.get("name") or removed.get("op_id") or "",
                f"删除报工记录 · {day}",
            )
            return {
                "ok": True,
                "deleted_id": log_id,
                "message": f"已删除 {person.get('name') or ''} {day} 报工记录",
            }

    # ── 生产日报（免排产：员工提交 → 主任确认）──────────────────────────

    def _ensure_shop_floor_reports_unlocked(self) -> None:
        if not isinstance(self._data.get("shop_floor_reports"), list):
            self._data["shop_floor_reports"] = []
        seq = self._data.setdefault("_seq", {})
        if "shop_floor_report" not in seq:
            seq["shop_floor_report"] = len(self._data["shop_floor_reports"])
        self._ensure_shop_floor_settings_unlocked()

    def _ensure_shop_floor_settings_unlocked(self) -> dict[str, Any]:
        raw = self._data.get("shop_floor_settings")
        if not isinstance(raw, dict):
            raw = {}
        grace = int(raw.get("off_shift_grace_minutes") or 30)
        grace = max(0, min(grace, 240))
        backfill = int(raw.get("history_backfill_days") or 7)
        backfill = max(0, min(backfill, 31))
        settings = {
            "off_shift_grace_minutes": grace,
            "history_backfill_days": backfill,
        }
        self._data["shop_floor_settings"] = settings
        return settings

    def get_shop_floor_settings(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._ensure_shop_floor_settings_unlocked())

    def update_shop_floor_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            cur = self._ensure_shop_floor_settings_unlocked()
            if "off_shift_grace_minutes" in payload and payload.get("off_shift_grace_minutes") is not None:
                grace = int(payload.get("off_shift_grace_minutes"))
                if grace < 0 or grace > 240:
                    raise ValidationException("下班宽限须在 0～240 分钟")
                cur["off_shift_grace_minutes"] = grace
            if "history_backfill_days" in payload and payload.get("history_backfill_days") is not None:
                days = int(payload.get("history_backfill_days"))
                if days < 0 or days > 31:
                    raise ValidationException("历史补报天数须在 0～31")
                cur["history_backfill_days"] = days
            self._data["shop_floor_settings"] = cur
            return dict(cur)

    def _slot_duty_state_unlocked(
        self,
        *,
        work_date: str,
        shift_family_id: str | None,
        now: datetime | None = None,
        grace_minutes: int | None = None,
    ) -> str:
        """人×日班次相对此刻的催报状态：not_started | open | due。"""
        today = _planning_today().isoformat()
        day = (work_date or "")[:10]
        if day and day < today:
            return "due"
        settings = self._ensure_shop_floor_settings_unlocked()
        grace = (
            int(grace_minutes)
            if grace_minutes is not None
            else int(settings.get("off_shift_grace_minutes") or 30)
        )
        now_dt = now or datetime.now()
        shift = self._active_shift_for_family(shift_family_id) if shift_family_id else None
        if not shift:
            # 无班次定义时：归属日当天结束才催
            end_dt = datetime.combine(date.fromisoformat(day or today), datetime.min.time()) + timedelta(
                hours=23, minutes=59
            )
            start_dt = datetime.combine(date.fromisoformat(day or today), datetime.min.time())
        else:
            start_dt, end_dt = _shift_start_end_dt(day or today, shift)
        if now_dt < start_dt:
            return "not_started"
        if now_dt < end_dt + timedelta(minutes=max(0, grace)):
            return "open"
        return "due"

    def _enrich_shop_floor_report(self, row: dict[str, Any]) -> dict[str, Any]:
        persons = self._person_map()
        eqs = {e["id"]: e for e in (self._data.get("equipments") or [])}
        orders = self._order_map()
        wos = self._wo_map()
        person = persons.get(row.get("person_id") or "") or {}
        eq = eqs.get(row.get("equipment_id") or "") or {}
        wo = wos.get(row.get("work_order_id") or "") or {}
        order_id = row.get("order_id") or wo.get("order_id")
        order = orders.get(order_id or "") or {}
        product = (
            (row.get("product") or "").strip()
            or (wo.get("product") or "").strip()
            or (order.get("product") or "").strip()
        )
        wo_label = (
            (row.get("work_order_label") or "").strip()
            or (
                f"{wo.get('code')} · {wo.get('name')}"
                if wo.get("code") or wo.get("name")
                else ""
            )
        )
        eq_name = (eq.get("name") or "").strip() or (row.get("equipment_name") or "").strip() or None
        applicant = (row.get("submitted_by") or "").strip() or None
        confirmer = (row.get("reviewed_by") or "").strip() or None
        work_date = (row.get("work_date") or "")[:10]
        person_id = row.get("person_id") or ""
        fam = (row.get("shift_family_id") or "").strip() or None
        if not fam and person_id and work_date:
            fam = self._person_roster_family_on_day_unlocked(str(person_id), work_date)
        shift = self._active_shift_for_family(fam) if fam else None
        shift_name = (
            (row.get("shift_name") or "").strip()
            or (shift.get("name") if shift else None)
            or None
        )
        return {
            **row,
            "person_name": person.get("name"),
            "person_code": person.get("code"),
            "equipment_name": eq_name,
            "equipment_code": eq.get("code"),
            "work_order_code": wo.get("code"),
            "work_order_name": wo.get("name"),
            "work_order_label": wo_label or None,
            "order_code": order.get("code"),
            "order_name": order.get("name"),
            "order_due_date": order.get("due_date"),
            "product_display": product,
            "applicant_name": applicant,
            "confirmer_name": confirmer,
            "shift_family_id": fam,
            "shift_name": shift_name,
            "status_label": {
                "pending": "待确认",
                "confirmed": "已确认",
                "rejected": "已驳回",
            }.get(row.get("status") or "", row.get("status") or ""),
            "link_type_label": {
                "work_order": "工单",
                "product": "产品",
            }.get(row.get("link_type") or "", row.get("link_type") or ""),
        }

    def _resolve_shop_floor_link(
        self, payload: dict[str, Any]
    ) -> tuple[str, str | None, str | None, str, str | None]:
        """挂接：工单（可选 id 或手写）或产品。返回 link_type, wo_id, order_id, product, wo_label。"""
        wo_id = (payload.get("work_order_id") or "").strip() or None
        wo_label = (payload.get("work_order_label") or "").strip() or None
        product = (payload.get("product") or "").strip()
        link_type = (payload.get("link_type") or "").strip() or None

        if link_type == "product" or (not wo_id and not wo_label and product):
            if not product:
                raise ValidationException("请选择或填写产品")
            return "product", None, None, product, None

        if wo_id:
            wo = self._wo_map().get(wo_id)
            if not wo:
                raise NotFoundException("工单不存在")
            if wo.get("status") == "cancelled":
                raise ValidationException("工单已作废，不能挂接")
            return (
                "work_order",
                wo_id,
                wo.get("order_id"),
                product or (wo.get("product") or ""),
                f"{wo.get('code') or ''} · {wo.get('name') or ''}".strip(" ·"),
            )
        if wo_label:
            return "work_order", None, None, product, wo_label
        if product:
            return "product", None, None, product, None
        raise ValidationException("请选择或填写工单，或填写产品")

    def person_shift_window(
        self, person_id: str, *, work_date: str | None = None
    ) -> dict[str, Any]:
        """取人员当日班次起止；无排班则 found=False，由前端让用户自填。"""
        with self._lock:
            day = (work_date or _planning_today().isoformat())[:10]
            if not person_id or person_id not in self._person_map():
                raise ValidationException("请选择作业人员")
            fam = self._person_roster_family_on_day_unlocked(person_id, day)
            shift = self._active_shift_for_family(fam) if fam else None
            if not shift:
                return {
                    "found": False,
                    "work_date": day,
                    "start_time": None,
                    "end_time": None,
                    "shift_name": None,
                    "shift_family_id": None,
                    "message": "未找到当日班次，请自行填写起止时间",
                }
            return {
                "found": True,
                "work_date": day,
                "start_time": (shift.get("start_time") or "08:00")[:5],
                "end_time": (shift.get("end_time") or "16:00")[:5],
                "shift_name": shift.get("name"),
                "shift_family_id": fam,
                "message": None,
            }

    @staticmethod
    def _hours_from_range(start_time: str | None, end_time: str | None) -> float:
        """HH:MM → 工时；跨午夜按跨日计。"""
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
        return round((end_m - start_m) / 60.0, 2)

    def list_shop_floor_reports(
        self,
        *,
        work_date: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            self._ensure_shop_floor_reports_unlocked()
            rows = list(self._data.get("shop_floor_reports") or [])
            d0 = (date_from or work_date or "")[:10] or None
            d1 = (date_to or work_date or date_from or "")[:10] or None
            if work_date and not date_from and not date_to:
                d0 = d1 = work_date[:10]
            if d0 and d1:
                rows = [
                    r
                    for r in rows
                    if d0 <= (r.get("work_date") or "")[:10] <= d1
                ]
            elif d0:
                rows = [r for r in rows if (r.get("work_date") or "")[:10] == d0]
            if status:
                rows = [r for r in rows if r.get("status") == status]
            rows.sort(
                key=lambda r: (
                    (r.get("work_date") or ""),
                    (r.get("submitted_at") or ""),
                    r.get("id") or "",
                ),
                reverse=True,
            )
            items = [self._enrich_shop_floor_report(r) for r in rows]
            pending_n = sum(1 for r in (self._data.get("shop_floor_reports") or []) if r.get("status") == "pending")
            confirmed_n = sum(
                1 for r in (self._data.get("shop_floor_reports") or []) if r.get("status") == "confirmed"
            )
            day_pending = sum(1 for r in items if r.get("status") == "pending")
            day_confirmed = sum(1 for r in items if r.get("status") == "confirmed")
            products: list[str] = []
            seen_p: set[str] = set()
            for w in self._data.get("work_orders") or []:
                p = (w.get("product") or "").strip()
                if p and p not in seen_p:
                    seen_p.add(p)
                    products.append(p)
            for o in self._data.get("orders") or []:
                p = (o.get("product") or "").strip()
                if p and p not in seen_p:
                    seen_p.add(p)
                    products.append(p)
            for r in self._data.get("shop_floor_reports") or []:
                p = (r.get("product") or "").strip()
                if p and p not in seen_p:
                    seen_p.add(p)
                    products.append(p)
            resources = deepcopy(self._data.get("resources") or [])
            shifts = [
                {
                    "family_id": s.get("family_id"),
                    "name": s.get("name"),
                    "start_time": s.get("start_time"),
                    "end_time": s.get("end_time"),
                    "status": s.get("status"),
                }
                for s in (self._data.get("shifts") or [])
                if s.get("status") == "active"
            ]
            return {
                "kpis": [
                    {
                        "title": "报工条数",
                        "value": len(items),
                    },
                    {"title": "待确认", "value": day_pending},
                    {"title": "已确认", "value": day_confirmed},
                    {"title": "全局待确认", "value": pending_n},
                    {"title": "全局已确认", "value": confirmed_n},
                ],
                "items": items,
                "persons": deepcopy(self._data.get("persons") or []),
                "equipments": deepcopy(self._data.get("equipments") or []),
                "templates": deepcopy(self._data.get("templates") or []),
                "resources": resources,
                "shifts": shifts,
                "product_options": products,
                "work_orders": [
                    self._enrich_work_order(w)
                    for w in (self._data.get("work_orders") or [])
                    if w.get("status") != "cancelled"
                ],
                "settings": self._ensure_shop_floor_settings_unlocked(),
                "date_from": d0,
                "date_to": d1,
                "today": _planning_today().isoformat(),
            }

    def _submit_shop_floor_report_unlocked(self, payload: dict[str, Any]) -> dict[str, Any]:
        process_name = (payload.get("process_name") or "").strip()
        if not process_name:
            tpl_id = (payload.get("template_id") or "").strip()
            tpl = next((t for t in (self._data.get("templates") or []) if t["id"] == tpl_id), None)
            if tpl:
                process_name = tpl.get("name") or ""
                payload = {**payload, "template_id": tpl_id}
        if not process_name:
            raise ValidationException("请填写或选择工序")

        person_id = (payload.get("person_id") or "").strip()
        if not person_id or person_id not in self._person_map():
            raise ValidationException("请选择作业人员")

        qty = float(payload.get("qty") or 0)
        if qty <= 0:
            raise ValidationException("完成数量须大于 0")

        start_time = (payload.get("start_time") or "").strip()[:5] or None
        end_time = (payload.get("end_time") or "").strip()[:5] or None
        hours = float(payload.get("hours") or 0)
        if hours <= 0 and start_time and end_time:
            hours = self._hours_from_range(start_time, end_time)
        if hours < 0:
            raise ValidationException("工时不能为负")

        equipment_id = (payload.get("equipment_id") or "").strip() or None
        equipment_name = (payload.get("equipment_name") or "").strip() or None
        if equipment_id:
            eq = next((e for e in (self._data.get("equipments") or []) if e["id"] == equipment_id), None)
            if not eq:
                # 当作手写名称（前端可能把名称塞进 id 槽）
                if not equipment_name:
                    equipment_name = equipment_id
                equipment_id = None
            elif eq.get("status") == "disabled":
                raise ValidationException("设备已停用")
            else:
                equipment_name = eq.get("name") or equipment_name

        link_type, wo_id, order_id, product, wo_label = self._resolve_shop_floor_link(payload)
        work_date = (payload.get("work_date") or _planning_today().isoformat())[:10]
        today = _planning_today()
        settings = self._ensure_shop_floor_settings_unlocked()
        backfill_days = int(settings.get("history_backfill_days") or 7)
        try:
            work_d = date.fromisoformat(work_date)
        except ValueError as exc:
            raise ValidationException("报工日期无效") from exc
        if work_d > today:
            raise ValidationException("不能提交未来日期的报工")
        is_backfill = work_d < today
        if is_backfill and (today - work_d).days > backfill_days:
            raise ValidationException(f"仅允许补报近 {backfill_days} 天内的历史报工")
        now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        applicant = (payload.get("submitted_by") or payload.get("applicant_name") or "").strip()
        applicant_uid = payload.get("submitted_by_user_id")
        if applicant_uid is not None and applicant_uid != "":
            try:
                applicant_uid = int(applicant_uid)
            except (TypeError, ValueError):
                applicant_uid = None
        else:
            applicant_uid = None
        if not applicant:
            person_fallback = self._person_map().get(person_id) or {}
            applicant = (person_fallback.get("name") or "").strip() or "现场"
        fam = self._person_roster_family_on_day_unlocked(person_id, work_date)
        shift = self._active_shift_for_family(fam) if fam else None
        rid = self._next_id("shop_floor_report", "sfr")
        row = {
            "id": rid,
            "work_date": work_date,
            "status": "pending",
            "link_type": link_type,
            "work_order_id": wo_id,
            "work_order_label": wo_label,
            "order_id": order_id,
            "product": product,
            "process_name": process_name,
            "template_id": (payload.get("template_id") or "").strip() or None,
            "qty": qty,
            "hours": hours,
            "start_time": start_time,
            "end_time": end_time,
            "person_id": person_id,
            "shift_family_id": fam,
            "shift_name": (shift.get("name") if shift else None),
            "equipment_id": equipment_id,
            "equipment_name": equipment_name,
            "note": (payload.get("note") or "").strip(),
            "submitted_at": now,
            "submitted_by": applicant,
            "submitted_by_user_id": applicant_uid,
            "is_backfill": is_backfill,
            "reviewed_at": None,
            "reviewed_by": None,
            "reviewed_by_user_id": None,
            "review_note": "",
        }
        self._data["shop_floor_reports"].append(row)
        person = self._person_map().get(person_id) or {}
        verb = "历史补报" if is_backfill else "生产日报提交"
        self._append_event(
            applicant or person.get("name") or "现场",
            process_name,
            f"{verb} · {work_date} · {qty:g} 件（待确认）· 作业人 {person.get('name') or ''}",
        )
        return self._enrich_shop_floor_report(row)

    def submit_shop_floor_report(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._ensure_shop_floor_reports_unlocked()
            return self._submit_shop_floor_report_unlocked(payload)

    def submit_shop_floor_reports_batch(self, payload: dict[str, Any]) -> dict[str, Any]:
        """一人多行：同一 person_id / work_date，多道工序/工单/产品。"""
        with self._lock:
            self._ensure_shop_floor_reports_unlocked()
            person_id = (payload.get("person_id") or "").strip()
            work_date = (payload.get("work_date") or _planning_today().isoformat())[:10]
            rows = payload.get("rows") or []
            if not isinstance(rows, list) or not rows:
                raise ValidationException("请至少填写一行报工")
            applicant = (payload.get("submitted_by") or payload.get("applicant_name") or "").strip()
            applicant_uid = payload.get("submitted_by_user_id")
            created = []
            for i, raw in enumerate(rows):
                if not isinstance(raw, dict):
                    raise ValidationException(f"第 {i + 1} 行格式无效")
                item = {
                    **raw,
                    "person_id": person_id,
                    "work_date": work_date,
                }
                if applicant and not item.get("submitted_by"):
                    item["submitted_by"] = applicant
                if applicant_uid is not None and item.get("submitted_by_user_id") in (None, ""):
                    item["submitted_by_user_id"] = applicant_uid
                try:
                    created.append(self._submit_shop_floor_report_unlocked(item))
                except (ValidationException, NotFoundException) as exc:
                    detail = getattr(exc, "detail", None) or getattr(exc, "message", None) or str(exc)
                    raise ValidationException(f"第 {i + 1} 行：{detail}") from exc
            return {"ok": True, "count": len(created), "items": created}

    def review_shop_floor_report(
        self,
        report_id: str,
        *,
        action: str,
        reviewer: str | None = None,
        reviewer_user_id: int | None = None,
        note: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            return self._review_shop_floor_report_unlocked(
                report_id,
                action=action,
                reviewer=reviewer,
                reviewer_user_id=reviewer_user_id,
                note=note,
            )

    def review_shop_floor_reports_batch(
        self,
        *,
        ids: list[str],
        action: str,
        reviewer: str | None = None,
        reviewer_user_id: int | None = None,
        note: str | None = None,
    ) -> dict[str, Any]:
        """批量确认/驳回待审报工。"""
        with self._lock:
            raw_ids = [str(i).strip() for i in (ids or []) if str(i).strip()]
            # 保序去重
            seen: set[str] = set()
            uniq: list[str] = []
            for i in raw_ids:
                if i in seen:
                    continue
                seen.add(i)
                uniq.append(i)
            if not uniq:
                raise ValidationException("请选择要处理的报工")
            action_norm = (action or "").strip().lower()
            if action_norm not in ("confirm", "reject"):
                raise ValidationException("action 须为 confirm 或 reject")
            review_note = (note or "").strip()
            if action_norm == "reject" and not review_note:
                raise ValidationException("驳回时请填写原因，方便作业人修改")
            items: list[dict[str, Any]] = []
            for rid in uniq:
                items.append(
                    self._review_shop_floor_report_unlocked(
                        rid,
                        action=action_norm,
                        reviewer=reviewer,
                        reviewer_user_id=reviewer_user_id,
                        note=review_note,
                    )
                )
            verb = "确认" if action_norm == "confirm" else "驳回"
            return {
                "ok": True,
                "action": action_norm,
                "count": len(items),
                "items": items,
                "message": f"已全部{verb} {len(items)} 条",
            }

    def _review_shop_floor_report_unlocked(
        self,
        report_id: str,
        *,
        action: str,
        reviewer: str | None = None,
        reviewer_user_id: int | None = None,
        note: str | None = None,
    ) -> dict[str, Any]:
        self._ensure_shop_floor_reports_unlocked()
        row = next(
            (r for r in self._data["shop_floor_reports"] if r.get("id") == report_id),
            None,
        )
        if not row:
            raise NotFoundException("日报不存在")
        if row.get("status") != "pending":
            raise ValidationException("仅待确认的日报可审核")
        action = (action or "").strip().lower()
        if action not in ("confirm", "reject"):
            raise ValidationException("action 须为 confirm 或 reject")
        review_note = (note or "").strip()
        if action == "reject" and not review_note:
            raise ValidationException("驳回时请填写原因，方便作业人修改")
        now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        row["status"] = "confirmed" if action == "confirm" else "rejected"
        row["reviewed_at"] = now
        row["reviewed_by"] = (reviewer or "").strip() or "车间主任"
        try:
            row["reviewed_by_user_id"] = (
                int(reviewer_user_id) if reviewer_user_id is not None else None
            )
        except (TypeError, ValueError):
            row["reviewed_by_user_id"] = None
        row["review_note"] = review_note
        person = self._person_map().get(row.get("person_id") or "") or {}
        verb = "确认" if action == "confirm" else "驳回"
        self._append_event(
            row["reviewed_by"],
            row.get("process_name") or "",
            f"生产日报{verb} · {person.get('name') or ''} · {row.get('work_date')}",
        )
        return self._enrich_shop_floor_report(row)

    def delete_shop_floor_report(self, report_id: str) -> dict[str, Any]:
        with self._lock:
            self._ensure_shop_floor_reports_unlocked()
            logs = self._data["shop_floor_reports"]
            idx = next((i for i, r in enumerate(logs) if r.get("id") == report_id), None)
            if idx is None:
                raise NotFoundException("日报不存在")
            row = logs[idx]
            if row.get("status") == "confirmed":
                raise ValidationException("已确认日报不能删除")
            if row.get("status") not in ("pending", "rejected"):
                raise ValidationException("仅待确认或已驳回的日报可删除")
            today = _planning_today()
            work_date = (row.get("work_date") or "")[:10]
            try:
                work_d = date.fromisoformat(work_date)
            except ValueError as exc:
                raise ValidationException("报工日期无效") from exc
            settings = self._ensure_shop_floor_settings_unlocked()
            backfill_days = int(settings.get("history_backfill_days") or 7)
            if work_d > today:
                raise ValidationException("报工日期异常")
            if (today - work_d).days > backfill_days:
                raise ValidationException(
                    f"仅允许删除近 {backfill_days} 天内未确认的报工"
                )
            logs.pop(idx)
            return {"ok": True, "deleted_id": report_id}

    def _ensure_shop_floor_finished_unlocked(self) -> None:
        if not isinstance(self._data.get("shop_floor_finished"), list):
            self._data["shop_floor_finished"] = []
        seq = self._data.setdefault("_seq", {})
        if "shop_floor_finished" not in seq:
            seq["shop_floor_finished"] = len(self._data["shop_floor_finished"])

    def _iter_days(self, date_from: str, date_to: str) -> list[str]:
        d0 = date.fromisoformat(date_from[:10])
        d1 = date.fromisoformat(date_to[:10])
        if d1 < d0:
            d0, d1 = d1, d0
        out: list[str] = []
        cur = d0
        while cur <= d1:
            out.append(cur.isoformat())
            cur += timedelta(days=1)
            if len(out) > 93:
                break
        return out

    def shop_floor_dashboard_stats(
        self,
        *,
        date_from: str,
        date_to: str,
        last_process_by_product: dict[str, str] | None = None,
        product_hints: list[dict[str, Any]] | None = None,
        resource_id: str | None = None,
        process_name: str | None = None,
        equipment_key: str | None = None,
        shift_family_id: str | None = None,
    ) -> dict[str, Any]:
        """每日报工看板：应报/已报（仅排班）、工序/班次/设备分布、成品建议与已确认。"""
        with self._lock:
            self._ensure_shop_floor_reports_unlocked()
            self._ensure_shop_floor_finished_unlocked()
            d0 = (date_from or _planning_today().isoformat())[:10]
            d1 = (date_to or d0)[:10]
            days = self._iter_days(d0, d1)
            last_map = {
                (k or "").strip(): (v or "").strip()
                for k, v in (last_process_by_product or {}).items()
                if k
            }
            hints: list[dict[str, str]] = []
            seen_hint: set[str] = set()
            for h in product_hints or []:
                name = (h.get("product") or "").strip()
                if not name or name in seen_hint:
                    continue
                seen_hint.add(name)
                hints.append(
                    {
                        "product": name,
                        "code": (h.get("code") or "").strip(),
                        "last_process": (h.get("last_process") or last_map.get(name) or "").strip(),
                    }
                )
            if not hints and last_map:
                for name, last in last_map.items():
                    if name in seen_hint:
                        continue
                    # last_map 含编码别名时可能重复；仅作兜底
                    seen_hint.add(name)
                    hints.append({"product": name, "code": "", "last_process": last})
            fam_names: dict[str, str] = {}
            for s in self._data.get("shifts") or []:
                fid = s.get("family_id")
                if fid and (s.get("status") == "active" or fid not in fam_names):
                    fam_names[str(fid)] = s.get("name") or str(fid)

            persons = [p for p in (self._data.get("persons") or []) if p.get("status") != "disabled"]
            if resource_id:
                persons = [p for p in persons if p.get("resource_id") == resource_id]
            person_map = {p["id"]: p for p in persons}

            settings = self._ensure_shop_floor_settings_unlocked()
            grace_minutes = int(settings.get("off_shift_grace_minutes") or 30)
            now_dt = datetime.now()

            # 应报池：有排班且非请假的人×日；催报仅统计 duty=due（下班+宽限后）
            roster_slots: list[dict[str, Any]] = []
            for day in days:
                for p in persons:
                    cell = self._roster_cell_for_day_unlocked(p["id"], day, fam_names)
                    if cell.get("kind") != "shift":
                        continue
                    fam = cell.get("shift_family_id")
                    if shift_family_id and fam != shift_family_id:
                        continue
                    duty = self._slot_duty_state_unlocked(
                        work_date=day,
                        shift_family_id=fam,
                        now=now_dt,
                        grace_minutes=grace_minutes,
                    )
                    roster_slots.append(
                        {
                            "person_id": p["id"],
                            "person_name": p.get("name"),
                            "work_date": day,
                            "shift_family_id": fam,
                            "shift_name": cell.get("shift_name"),
                            "resource_id": p.get("resource_id"),
                            "duty_state": duty,
                        }
                    )

            # 催报分母：仅已到催报点；未开班/宽限内不进未报
            expected_slots = [s for s in roster_slots if s.get("duty_state") == "due"]
            not_started_n = sum(1 for s in roster_slots if s.get("duty_state") == "not_started")
            open_n = sum(1 for s in roster_slots if s.get("duty_state") == "open")

            rows = [
                r
                for r in (self._data.get("shop_floor_reports") or [])
                if d0 <= (r.get("work_date") or "")[:10] <= d1
                and r.get("status") in ("pending", "confirmed")
            ]
            # 筛选
            filtered: list[dict] = []
            for r in rows:
                pid = r.get("person_id")
                if pid not in person_map and resource_id:
                    continue
                if resource_id and (person_map.get(pid) or {}).get("resource_id") != resource_id:
                    continue
                proc = (r.get("process_name") or "").strip()
                if process_name and proc != process_name:
                    continue
                eq = (r.get("equipment_name") or r.get("equipment_id") or "").strip()
                if equipment_key and eq != equipment_key and r.get("equipment_id") != equipment_key:
                    continue
                day = (r.get("work_date") or "")[:10]
                fam = self._person_roster_family_on_day_unlocked(pid or "", day)
                if shift_family_id and fam != shift_family_id:
                    continue
                filtered.append({**r, "_shift_family_id": fam, "_shift_name": fam_names.get(fam or "")})

            reported_keys = {
                f"{(r.get('work_date') or '')[:10]}::{r.get('person_id')}"
                for r in filtered
            }
            expected_n = len(expected_slots)
            reported_n = sum(
                1
                for s in expected_slots
                if f"{s['work_date']}::{s['person_id']}" in reported_keys
            )
            unreported = [
                s
                for s in expected_slots
                if f"{s['work_date']}::{s['person_id']}" not in reported_keys
            ]
            by_shift_att: dict[str, dict[str, Any]] = {}
            for s in expected_slots:
                key = s.get("shift_family_id") or "unknown"
                bucket = by_shift_att.setdefault(
                    key,
                    {
                        "shift_family_id": s.get("shift_family_id"),
                        "shift_name": s.get("shift_name") or "未排班次",
                        "expected": 0,
                        "reported": 0,
                    },
                )
                bucket["expected"] += 1
                if f"{s['work_date']}::{s['person_id']}" in reported_keys:
                    bucket["reported"] += 1
            for b in by_shift_att.values():
                b["unreported"] = max(0, b["expected"] - b["reported"])

            by_process: dict[str, float] = {}
            by_shift_process: dict[str, dict[str, float]] = {}
            by_equipment: dict[str, float] = {}
            for r in filtered:
                qty = float(r.get("qty") or 0)
                proc = (r.get("process_name") or "未命名工序").strip()
                by_process[proc] = by_process.get(proc, 0) + qty
                sn = r.get("_shift_name") or "未排班"
                sp = by_shift_process.setdefault(sn, {})
                sp[proc] = sp.get(proc, 0) + qty
                eq = (r.get("equipment_name") or "").strip() or "未填设备"
                by_equipment[eq] = by_equipment.get(eq, 0) + qty

            # 成品建议：末道工序（按产品）当日/区间已确认数量
            finished_suggest: dict[str, dict[str, Any]] = {}
            for r in filtered:
                if r.get("status") != "confirmed":
                    continue
                product = (r.get("product") or r.get("product_display") or "").strip()
                if not product:
                    continue
                last = last_map.get(product)
                proc = (r.get("process_name") or "").strip()
                if not last or proc != last:
                    continue
                day = (r.get("work_date") or "")[:10]
                key = f"{day}::{product}"
                bucket = finished_suggest.setdefault(
                    key,
                    {
                        "work_date": day,
                        "product": product,
                        "last_process": last,
                        "suggested_qty": 0.0,
                    },
                )
                bucket["suggested_qty"] += float(r.get("qty") or 0)

            confirms = [
                c
                for c in (self._data.get("shop_floor_finished") or [])
                if d0 <= (c.get("work_date") or "")[:10] <= d1
            ]
            # 无末道报工时也给出产品行，建议量默认 0，便于人工填写
            seed_days = days if len(days) <= 14 else [d1]
            for day in seed_days:
                for h in hints:
                    key = f"{day}::{h['product']}"
                    if key in finished_suggest:
                        if not finished_suggest[key].get("last_process") and h.get("last_process"):
                            finished_suggest[key]["last_process"] = h["last_process"]
                        continue
                    finished_suggest[key] = {
                        "work_date": day,
                        "product": h["product"],
                        "last_process": h.get("last_process") or "",
                        "suggested_qty": 0.0,
                    }
            for c in confirms:
                day = (c.get("work_date") or "")[:10]
                product = (c.get("product") or "").strip()
                if not day or not product:
                    continue
                key = f"{day}::{product}"
                if key not in finished_suggest:
                    finished_suggest[key] = {
                        "work_date": day,
                        "product": product,
                        "last_process": last_map.get(product) or "",
                        "suggested_qty": float(c.get("suggested_qty") or 0),
                    }

            confirmed_qty = sum(
                float(c.get("confirmed_qty") or 0) for c in confirms if c.get("status") == "confirmed"
            )
            suggest_list = sorted(
                finished_suggest.values(),
                key=lambda x: (x.get("work_date") or "", x.get("product") or ""),
            )
            for s in suggest_list:
                s["suggested_qty"] = round(float(s.get("suggested_qty") or 0), 2)
                matched = next(
                    (
                        c
                        for c in confirms
                        if (c.get("work_date") or "")[:10] == s["work_date"]
                        and (c.get("product") or "") == s["product"]
                        and c.get("status") == "confirmed"
                    ),
                    None,
                )
                s["confirmed_qty"] = float(matched["confirmed_qty"]) if matched else None
                s["confirm_id"] = matched.get("id") if matched else None

            process_total = round(sum(by_process.values()), 2)
            return {
                "date_from": d0,
                "date_to": d1,
                "settings": dict(settings),
                "attendance": {
                    "expected": expected_n,
                    "reported": reported_n,
                    "unreported": max(0, expected_n - reported_n),
                    "rostered": len(roster_slots),
                    "not_started": not_started_n,
                    "within_grace_or_running": open_n,
                    "grace_minutes": grace_minutes,
                    "note": (
                        f"应报=已过下班+宽限（{grace_minutes} 分钟）的人×日；"
                        f"未开班 {not_started_n}、进行中/宽限内 {open_n} 不计入未报；"
                        "无排班不计入应报。"
                    ),
                    "by_shift": sorted(
                        by_shift_att.values(),
                        key=lambda x: x.get("shift_name") or "",
                    ),
                    "unreported_list": unreported[:100],
                },
                "report_count": len(filtered),
                "process_total_qty": process_total,
                "by_process": [
                    {"name": k, "qty": round(v, 2)}
                    for k, v in sorted(by_process.items(), key=lambda x: -x[1])
                ],
                "by_shift_process": [
                    {
                        "shift_name": sn,
                        "processes": [
                            {"name": pn, "qty": round(q, 2)}
                            for pn, q in sorted(procs.items(), key=lambda x: -x[1])
                        ],
                    }
                    for sn, procs in sorted(by_shift_process.items(), key=lambda x: x[0])
                ],
                "by_equipment": [
                    {"name": k, "qty": round(v, 2)}
                    for k, v in sorted(by_equipment.items(), key=lambda x: -x[1])
                ][:12],
                "finished": {
                    "confirmed_qty": round(confirmed_qty, 2),
                    "suggested": suggest_list,
                    "confirms": deepcopy(confirms),
                    "product_options": hints,
                    "note": "",
                },
            }

    def confirm_shop_floor_finished(self, payload: dict[str, Any]) -> dict[str, Any]:
        """成品产量确认：程序建议 + 人改数确认。"""
        with self._lock:
            self._ensure_shop_floor_finished_unlocked()
            work_date = (payload.get("work_date") or "")[:10]
            product = (payload.get("product") or "").strip()
            if not work_date or not product:
                raise ValidationException("请指定日期与产品")
            qty = float(payload.get("confirmed_qty") if payload.get("confirmed_qty") is not None else 0)
            if qty < 0:
                raise ValidationException("成品数量不能为负")
            suggested = float(payload.get("suggested_qty") or 0)
            now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
            rows = self._data["shop_floor_finished"]
            existing = next(
                (
                    r
                    for r in rows
                    if (r.get("work_date") or "")[:10] == work_date
                    and (r.get("product") or "") == product
                    and r.get("status") == "confirmed"
                ),
                None,
            )
            if existing:
                existing["confirmed_qty"] = qty
                existing["suggested_qty"] = suggested
                existing["confirmed_by"] = (payload.get("confirmed_by") or "").strip() or "车间主任"
                existing["confirmed_at"] = now
                existing["note"] = (payload.get("note") or "").strip()
                self._persist_unlocked()
                return deepcopy(existing)
            rid = self._next_id("shop_floor_finished", "sff")
            row = {
                "id": rid,
                "work_date": work_date,
                "product": product,
                "suggested_qty": suggested,
                "confirmed_qty": qty,
                "status": "confirmed",
                "confirmed_by": (payload.get("confirmed_by") or "").strip() or "车间主任",
                "confirmed_at": now,
                "note": (payload.get("note") or "").strip(),
            }
            rows.append(row)
            self._persist_unlocked()
            return deepcopy(row)

    def shop_floor_progress(self) -> dict[str, Any]:
        """进度看板：现场按工单/产品；老板按订单上卷。产量均来自已确认日报；距交期为日历天。"""
        with self._lock:
            self._ensure_shop_floor_reports_unlocked()
            today = _planning_today()
            confirmed = [
                r for r in (self._data.get("shop_floor_reports") or []) if r.get("status") == "confirmed"
            ]
            # key -> bucket；key = wo:{id} | wolabel:{text} | product:{name}
            buckets: dict[str, dict[str, Any]] = {}
            by_order: dict[str, dict[str, Any]] = {}
            unlinked_n = 0

            def _touch(
                store: dict[str, dict[str, Any]],
                key: str,
                *,
                meta: dict[str, Any],
                proc: str,
                qty: float,
                hours: float,
                person_id: str | None,
                submitted: str,
            ) -> None:
                bucket = store.setdefault(
                    key,
                    {
                        **meta,
                        "processes": {},
                        "last_report_at": "",
                        "last_person_id": None,
                        "last_process": "",
                    },
                )
                for k, v in meta.items():
                    if v and not bucket.get(k):
                        bucket[k] = v
                pinfo = bucket["processes"].setdefault(
                    proc, {"process_name": proc, "qty": 0.0, "hours": 0.0}
                )
                pinfo["qty"] += qty
                pinfo["hours"] += hours
                if submitted >= (bucket["last_report_at"] or ""):
                    bucket["last_report_at"] = submitted
                    bucket["last_person_id"] = person_id
                    bucket["last_process"] = proc

            for r in confirmed:
                proc = (r.get("process_name") or "").strip() or "未命名工序"
                qty = float(r.get("qty") or 0)
                hours = float(r.get("hours") or 0)
                submitted = r.get("submitted_at") or r.get("work_date") or ""
                person_id = r.get("person_id")
                wo_id = (r.get("work_order_id") or "").strip() or None
                wo_label = (r.get("work_order_label") or "").strip() or None
                product = (r.get("product") or "").strip()
                link_type = (r.get("link_type") or "").strip()
                wo = self._wo_map().get(wo_id or "") or {}
                oid = (r.get("order_id") or wo.get("order_id") or "").strip() or None
                order = self._order_map().get(oid or "") or {}

                if wo_id or (link_type == "work_order" and wo_label):
                    key = f"wo:{wo_id}" if wo_id else f"wolabel:{wo_label}"
                    _touch(
                        buckets,
                        key,
                        meta={
                            "link_type": "work_order",
                            "work_order_id": wo_id,
                            "work_order_code": wo.get("code"),
                            "work_order_name": wo.get("name"),
                            "work_order_label": wo_label
                            or (
                                f"{wo.get('code')} · {wo.get('name')}".strip(" ·")
                                if wo
                                else None
                            ),
                            "product": product or (wo.get("product") or "") or (order.get("product") or ""),
                            "due_date": (self._effective_due(wo, order) or "")[:10] or None,
                            "wo_status": wo.get("status"),
                            "order_id": oid,
                        },
                        proc=proc,
                        qty=qty,
                        hours=hours,
                        person_id=person_id,
                        submitted=submitted,
                    )
                elif product:
                    _touch(
                        buckets,
                        f"product:{product}",
                        meta={
                            "link_type": "product",
                            "work_order_id": None,
                            "work_order_code": None,
                            "work_order_name": None,
                            "work_order_label": None,
                            "product": product,
                            "due_date": None,
                            "wo_status": None,
                            "order_id": None,
                        },
                        proc=proc,
                        qty=qty,
                        hours=hours,
                        person_id=person_id,
                        submitted=submitted,
                    )
                else:
                    unlinked_n += 1
                    continue

                if oid:
                    _touch(
                        by_order,
                        oid,
                        meta={"order_id": oid},
                        proc=proc,
                        qty=qty,
                        hours=hours,
                        person_id=person_id,
                        submitted=submitted,
                    )
                else:
                    unlinked_n += 1

            # 主数据工单也上榜（无日报的也能看交期），取消的除外
            for wo in self._data.get("work_orders") or []:
                if wo.get("status") == "cancelled":
                    continue
                wid = wo.get("id")
                if not wid:
                    continue
                key = f"wo:{wid}"
                if key in buckets:
                    continue
                order = self._order_map().get(wo.get("order_id") or "") or {}
                buckets[key] = {
                    "link_type": "work_order",
                    "work_order_id": wid,
                    "work_order_code": wo.get("code"),
                    "work_order_name": wo.get("name"),
                    "work_order_label": f"{wo.get('code') or ''} · {wo.get('name') or ''}".strip(" ·"),
                    "product": (wo.get("product") or "") or (order.get("product") or ""),
                    "due_date": (self._effective_due(wo, order) or "")[:10] or None,
                    "wo_status": wo.get("status"),
                    "order_id": wo.get("order_id"),
                    "processes": {},
                    "last_report_at": "",
                    "last_person_id": None,
                    "last_process": "",
                }

            def _days_to_due(due: str | None) -> int | None:
                if not due:
                    return None
                try:
                    return (date.fromisoformat(due[:10]) - today).days
                except ValueError:
                    return None

            items = []
            for key, bucket in buckets.items():
                due = (bucket.get("due_date") or "")[:10] or None
                processes = sorted(
                    bucket["processes"].values(),
                    key=lambda x: -float(x.get("qty") or 0),
                )
                last_person = self._person_map().get(bucket.get("last_person_id") or "") or {}
                total_qty = sum(float(p.get("qty") or 0) for p in processes)
                link_type = bucket.get("link_type") or "work_order"
                items.append(
                    {
                        "id": key,
                        "link_type": link_type,
                        "link_type_label": "工单" if link_type == "work_order" else "产品",
                        "work_order_id": bucket.get("work_order_id"),
                        "work_order_code": bucket.get("work_order_code"),
                        "work_order_name": bucket.get("work_order_name"),
                        "work_order_label": bucket.get("work_order_label"),
                        "product": bucket.get("product") or "",
                        "due_date": due,
                        "days_to_due": _days_to_due(due),
                        "wo_status": bucket.get("wo_status"),
                        "total_confirmed_qty": total_qty,
                        "processes": processes,
                        "current_process": bucket.get("last_process") or None,
                        "current_holder": last_person.get("name"),
                        "last_report_at": bucket.get("last_report_at") or None,
                        "has_reports": bool(processes),
                    }
                )

            items.sort(
                key=lambda x: (
                    0 if x.get("has_reports") else 1,
                    0 if x.get("link_type") == "work_order" else 1,
                    x.get("days_to_due") if x.get("days_to_due") is not None else 9999,
                    x.get("work_order_code") or x.get("product") or "",
                )
            )

            # 订单视图：主数据订单 + 已确认日报上卷（工单挂订单后汇总）
            order_items = []
            for order in self._data.get("orders") or []:
                oid = order.get("id")
                if not oid:
                    continue
                bucket = by_order.get(oid) or {
                    "processes": {},
                    "last_report_at": "",
                    "last_person_id": None,
                    "last_process": "",
                }
                due = (order.get("due_date") or "")[:10] or None
                processes = sorted(
                    bucket["processes"].values(),
                    key=lambda x: -float(x.get("qty") or 0),
                )
                last_person = self._person_map().get(bucket.get("last_person_id") or "") or {}
                wo_codes = [
                    (w.get("code") or "")
                    for w in (self._data.get("work_orders") or [])
                    if w.get("order_id") == oid and w.get("status") != "cancelled"
                ]
                order_items.append(
                    {
                        "id": f"order:{oid}",
                        "order_id": oid,
                        "order_code": order.get("code"),
                        "order_name": order.get("name"),
                        "product": order.get("product") or "",
                        "due_date": due,
                        "days_to_due": _days_to_due(due),
                        "order_status": order.get("status"),
                        "work_order_count": len([c for c in wo_codes if c]),
                        "work_order_codes": [c for c in wo_codes if c][:8],
                        "total_confirmed_qty": sum(float(p.get("qty") or 0) for p in processes),
                        "processes": processes,
                        "current_process": bucket.get("last_process") or None,
                        "current_holder": last_person.get("name"),
                        "last_report_at": bucket.get("last_report_at") or None,
                        "has_reports": bool(processes),
                    }
                )

            order_items.sort(
                key=lambda x: (
                    0 if x.get("has_reports") else 1,
                    x.get("days_to_due") if x.get("days_to_due") is not None else 9999,
                    x.get("order_code") or "",
                )
            )

            return {
                "as_of": today.isoformat(),
                "note": "报工挂工单/产品；订单进度由工单上卷。距交期为日历天；产量仅计已确认日报。",
                "items": items,
                "work_orders": items,
                "orders": order_items,
                "unlinked_product_reports": unlinked_n,
            }

    def shop_floor_progress_detail(
        self,
        *,
        scope: str,
        target_id: str,
        date_from: str | None = None,
        date_to: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        """订单/工单/产品进度下钻：粗略摘要 + 日×班×设备×人×工序明细。"""
        with self._lock:
            self._ensure_shop_floor_reports_unlocked()
            self._ensure_shop_floor_finished_unlocked()
            today = _planning_today()
            scope_n = (scope or "").strip().lower()
            tid = (target_id or "").strip()
            if scope_n not in ("order", "work_order", "product") or not tid:
                raise ValidationException("请指定 scope=order|work_order|product 与 id")

            if tid.startswith("order:"):
                tid = tid[6:]
            elif tid.startswith("wo:"):
                tid = tid[3:]
            elif tid.startswith("product:"):
                tid = tid[8:]

            d0 = (date_from or "")[:10] or None
            d1 = (date_to or "")[:10] or None
            if d0 and not d1:
                d1 = d0
            if d1 and not d0:
                d0 = d1

            order = self._order_map().get(tid) if scope_n == "order" else {}
            wo = self._wo_map().get(tid) if scope_n == "work_order" else {}
            if scope_n == "order" and not order:
                raise NotFoundException("订单不存在")
            if scope_n == "work_order" and not wo:
                raise NotFoundException("工单不存在")

            product_name = ""
            if scope_n == "product":
                product_name = tid
            elif scope_n == "order":
                product_name = (order.get("product") or "").strip()
            else:
                parent = self._order_map().get(wo.get("order_id") or "") or {}
                product_name = (
                    (wo.get("product") or "").strip() or (parent.get("product") or "").strip()
                )

            child_wos: list[dict[str, Any]] = []
            if scope_n == "order":
                child_wos = [
                    w
                    for w in (self._data.get("work_orders") or [])
                    if w.get("order_id") == tid and w.get("status") != "cancelled"
                ]
            elif scope_n == "work_order":
                child_wos = [wo] if wo else []

            def _report_matches(r: dict[str, Any]) -> bool:
                r_wo = self._wo_map().get(r.get("work_order_id") or "") or {}
                r_oid = (r.get("order_id") or r_wo.get("order_id") or "").strip() or None
                r_wid = (r.get("work_order_id") or "").strip() or None
                r_prod = (
                    (r.get("product") or "").strip()
                    or (r_wo.get("product") or "").strip()
                    or ((self._order_map().get(r_oid or "") or {}).get("product") or "").strip()
                )
                if scope_n == "order":
                    return r_oid == tid
                if scope_n == "work_order":
                    if r_wid == tid:
                        return True
                    label = (r.get("work_order_label") or "").strip()
                    if label and wo:
                        expect = f"{wo.get('code') or ''} · {wo.get('name') or ''}".strip(" ·")
                        return bool(expect) and label == expect
                    return False
                return bool(product_name) and r_prod == product_name

            rows = [r for r in (self._data.get("shop_floor_reports") or []) if _report_matches(r)]
            if d0 and d1:
                rows = [r for r in rows if d0 <= (r.get("work_date") or "")[:10] <= d1]
            if status:
                rows = [r for r in rows if r.get("status") == status]

            lines: list[dict[str, Any]] = []
            by_day: dict[str, dict[str, Any]] = {}
            by_shift: dict[str, dict[str, Any]] = {}
            by_equipment: dict[str, dict[str, Any]] = {}
            by_person: dict[str, dict[str, Any]] = {}
            processes: dict[str, dict[str, Any]] = {}
            person_ids: set[str] = set()
            equipment_keys: set[str] = set()
            shift_keys: set[str] = set()
            confirmed_qty = 0.0
            pending_qty = 0.0
            rejected_qty = 0.0
            last_report_at = ""
            last_person_id: str | None = None
            last_process = ""

            def _bump(store: dict[str, dict[str, Any]], key: str, meta: dict[str, Any], qty: float, conf: bool) -> None:
                b = store.setdefault(key, {**meta, "qty": 0.0, "confirmed_qty": 0.0, "count": 0})
                for k, v in meta.items():
                    if v and not b.get(k):
                        b[k] = v
                b["qty"] += qty
                b["count"] += 1
                if conf:
                    b["confirmed_qty"] += qty

            for r in rows:
                enriched = self._enrich_shop_floor_report(r)
                work_date = (enriched.get("work_date") or "")[:10]
                person_id = (enriched.get("person_id") or "").strip() or None
                fam = (
                    self._person_roster_family_on_day_unlocked(person_id, work_date)
                    if person_id and work_date
                    else None
                )
                shift = self._active_shift_for_family(fam) if fam else None
                shift_name = (shift or {}).get("name") or "未排班"
                shift_fid = fam or "none"
                eq_name = (enriched.get("equipment_name") or "").strip() or "未挂设备"
                eq_id = (enriched.get("equipment_id") or "").strip() or eq_name
                person_name = (enriched.get("person_name") or person_id or "未知") 
                proc = (enriched.get("process_name") or "").strip() or "未命名工序"
                qty = float(enriched.get("qty") or 0)
                st = enriched.get("status") or ""
                conf = st == "confirmed"
                submitted = enriched.get("submitted_at") or work_date or ""

                if person_id:
                    person_ids.add(person_id)
                equipment_keys.add(eq_id)
                shift_keys.add(shift_fid)

                if conf:
                    confirmed_qty += qty
                    pinfo = processes.setdefault(proc, {"process_name": proc, "qty": 0.0, "hours": 0.0})
                    pinfo["qty"] += qty
                    pinfo["hours"] += float(enriched.get("hours") or 0)
                    if submitted >= last_report_at:
                        last_report_at = submitted
                        last_person_id = person_id
                        last_process = proc
                elif st == "pending":
                    pending_qty += qty
                elif st == "rejected":
                    rejected_qty += qty

                if work_date:
                    _bump(by_day, work_date, {"date": work_date}, qty, conf)
                _bump(
                    by_shift,
                    shift_fid,
                    {"shift_family_id": fam, "shift_name": shift_name},
                    qty,
                    conf,
                )
                _bump(
                    by_equipment,
                    eq_id,
                    {"equipment_id": enriched.get("equipment_id"), "equipment_name": eq_name},
                    qty,
                    conf,
                )
                if person_id:
                    _bump(
                        by_person,
                        person_id,
                        {"person_id": person_id, "person_name": person_name},
                        qty,
                        conf,
                    )

                lines.append(
                    {
                        "id": enriched.get("id"),
                        "work_date": work_date,
                        "shift_family_id": fam,
                        "shift_name": shift_name,
                        "equipment_id": enriched.get("equipment_id"),
                        "equipment_name": eq_name,
                        "person_id": person_id,
                        "person_name": person_name,
                        "process_name": proc,
                        "qty": qty,
                        "hours": float(enriched.get("hours") or 0),
                        "status": st,
                        "status_label": enriched.get("status_label"),
                        "submitted_at": enriched.get("submitted_at"),
                        "reviewed_at": enriched.get("reviewed_at"),
                        "reviewed_by": enriched.get("reviewed_by"),
                        "review_note": enriched.get("review_note"),
                        "note": enriched.get("note"),
                        "work_order_id": enriched.get("work_order_id"),
                        "work_order_label": enriched.get("work_order_label"),
                        "order_id": enriched.get("order_id") or (order.get("id") if order else None),
                        "product": enriched.get("product_display") or product_name,
                        "start_time": enriched.get("start_time"),
                        "end_time": enriched.get("end_time"),
                    }
                )

            lines.sort(
                key=lambda x: (
                    x.get("work_date") or "",
                    x.get("shift_name") or "",
                    x.get("equipment_name") or "",
                    x.get("person_name") or "",
                    x.get("submitted_at") or "",
                ),
                reverse=True,
            )

            # 成品确认（按产品名对上）
            finished_confirmed = 0.0
            if product_name:
                for f in self._data.get("shop_floor_finished") or []:
                    if f.get("status") != "confirmed":
                        continue
                    if (f.get("product") or "").strip() != product_name:
                        continue
                    fd = (f.get("work_date") or "")[:10]
                    if d0 and d1 and not (d0 <= fd <= d1):
                        continue
                    finished_confirmed += float(f.get("confirmed_qty") or 0)

            # 近 7 日 / 今日（仅已确认）
            day7 = (today - timedelta(days=6)).isoformat()
            qty_7d = 0.0
            days_with_qty = 0
            today_qty = 0.0
            last_produce_date: str | None = None
            for day_key, b in by_day.items():
                cq = float(b.get("confirmed_qty") or 0)
                if cq <= 0:
                    continue
                if day_key >= day7:
                    qty_7d += cq
                    days_with_qty += 1
                if day_key == today.isoformat():
                    today_qty = cq
                if last_produce_date is None or day_key > last_produce_date:
                    last_produce_date = day_key
            avg_7d = round(qty_7d / max(days_with_qty, 1), 1) if qty_7d else 0.0

            due: str | None = None
            plan_qty: float | None = None
            status_label = None
            title = ""
            code = None
            name = None
            if scope_n == "order":
                due = (order.get("due_date") or "")[:10] or None
                plan_candidate = order.get("plan_qty") or order.get("qty") or order.get("quantity")
                plan_qty = float(plan_candidate) if plan_candidate not in (None, "") else None
                status_label = order.get("status")
                code = order.get("code")
                name = order.get("name")
                title = f"{code or ''} · {product_name or name or ''}".strip(" ·")
            elif scope_n == "work_order":
                parent = self._order_map().get(wo.get("order_id") or "") or {}
                due = (self._effective_due(wo, parent) or "")[:10] or None
                plan_candidate = wo.get("plan_qty") or parent.get("plan_qty")
                plan_qty = float(plan_candidate) if plan_candidate not in (None, "") else None
                status_label = wo.get("status")
                code = wo.get("code")
                name = wo.get("name")
                title = f"{code or ''} · {name or product_name or ''}".strip(" ·")
            else:
                title = product_name or tid

            try:
                days_to_due = (date.fromisoformat(due) - today).days if due else None
            except ValueError:
                days_to_due = None

            progress_pct = (
                round(min(100.0, confirmed_qty / plan_qty * 100), 1)
                if plan_qty and plan_qty > 0
                else None
            )
            last_person = self._person_map().get(last_person_id or "") or {}
            last_dt = self._parse_report_dt(last_report_at)
            now = datetime.now()
            silent_hours = (
                round((now - last_dt).total_seconds() / 3600, 1) if last_dt else None
            )

            # 图表全量区间：工序开工 → 交期/完工/最近产出（进行中含今天）
            wo_ids = {str(w.get("id")) for w in child_wos if w.get("id")}
            start_cands: list[str] = []
            end_cands: list[str] = []
            if wo_ids:
                for op in self._data.get("operations") or []:
                    if str(op.get("work_order_id") or "") not in wo_ids:
                        continue
                    ps = (op.get("plan_start") or "")[:10]
                    pe = (op.get("plan_end") or "")[:10]
                    if ps:
                        start_cands.append(ps)
                    if pe:
                        end_cands.append(pe)
            for day_key in by_day:
                start_cands.append(day_key)
                end_cands.append(day_key)
            if due:
                end_cands.append(due)
            if last_produce_date:
                end_cands.append(last_produce_date)
            producing = (status_label or "") in (
                "producing",
                "open",
                "released",
                "in_progress",
                "pending",
            )
            if producing or not end_cands:
                end_cands.append(today.isoformat())
            period_start = min(start_cands) if start_cands else (d0 or today.isoformat())
            period_end = max(end_cands) if end_cands else (d1 or today.isoformat())
            if period_start > period_end:
                period_start, period_end = period_end, period_start

            def _sorted_buckets(store: dict[str, dict[str, Any]], prefer_date: bool = False) -> list[dict[str, Any]]:
                vals = list(store.values())
                if prefer_date:
                    vals.sort(key=lambda x: x.get("date") or "", reverse=True)
                else:
                    vals.sort(key=lambda x: -float(x.get("confirmed_qty") or x.get("qty") or 0))
                return vals

            return {
                "as_of": today.isoformat(),
                "scope": scope_n,
                "id": tid,
                "date_from": d0,
                "date_to": d1,
                "note": "粗略看交期与累计；明细按日–班–设备–人–工序。正式产量以已确认为准。",
                "summary": {
                    "scope": scope_n,
                    "id": tid,
                    "title": title,
                    "code": code,
                    "name": name,
                    "product": product_name or None,
                    "status": status_label,
                    "due_date": due,
                    "days_to_due": days_to_due,
                    "period_start": period_start,
                    "period_end": period_end,
                    "plan_qty": plan_qty,
                    "progress_pct": progress_pct,
                    "total_confirmed_qty": confirmed_qty,
                    "total_pending_qty": pending_qty,
                    "total_rejected_qty": rejected_qty,
                    "finished_confirmed_qty": finished_confirmed,
                    "finished_gap": (
                        round(max(0.0, (plan_qty or 0) - finished_confirmed), 1)
                        if plan_qty
                        else None
                    ),
                    "avg_7d": avg_7d,
                    "today_qty": today_qty,
                    "last_produce_date": last_produce_date,
                    "person_count": len(person_ids),
                    "equipment_count": len(equipment_keys),
                    "shift_count": len([k for k in shift_keys if k != "none"]),
                    "report_count": len(lines),
                    "processes": sorted(processes.values(), key=lambda x: -float(x.get("qty") or 0)),
                    "current_process": last_process or None,
                    "current_holder": last_person.get("name"),
                    "last_report_at": last_report_at or None,
                    "silent_hours": silent_hours,
                    "work_orders": [
                        {
                            "id": w.get("id"),
                            "code": w.get("code"),
                            "name": w.get("name"),
                            "product": w.get("product"),
                            "status": w.get("status"),
                            "due_date": (w.get("due_date") or "")[:10] or None,
                        }
                        for w in child_wos
                    ],
                },
                "by_day": _sorted_buckets(by_day, prefer_date=True),
                "by_shift": _sorted_buckets(by_shift),
                "by_equipment": _sorted_buckets(by_equipment),
                "by_person": _sorted_buckets(by_person),
                "lines": lines,
            }

    @staticmethod
    def _parse_report_dt(raw: str | None) -> datetime | None:
        if not raw:
            return None
        text = str(raw).strip().replace("T", " ").replace("Z", "")
        for candidate, fmt in (
            (text[:19], "%Y-%m-%d %H:%M:%S"),
            (text[:16], "%Y-%m-%d %H:%M"),
            (text[:10], "%Y-%m-%d"),
        ):
            try:
                return datetime.strptime(candidate, fmt)
            except ValueError:
                continue
        return None

    @staticmethod
    def _age_label(minutes: int) -> str:
        if minutes < 60:
            return f"{minutes} 分钟"
        hours = minutes / 60
        if hours < 24:
            return f"{round(hours, 1)} 小时"
        return f"{round(hours / 24, 1)} 天"

    def shop_floor_cockpit(
        self,
        *,
        near_days: int = 3,
        active_limit: int = 30,
        view: str = "manager",
        silent_hours: float = 8,
        pending_timeout_hours: float = 2,
        attendance_target_rate: float = 80,
    ) -> dict[str, Any]:
        """全局看板：指挥条 + 必办 + 交期/在制/脉搏（报工确认口径）。"""
        near = max(0, min(int(near_days or 3), 14))
        limit = max(5, min(int(active_limit or 30), 100))
        role = (view or "manager").strip().lower()
        if role not in ("manager", "director"):
            role = "manager"
        silent_h = max(1.0, float(silent_hours or 8))
        pending_h = max(0.5, float(pending_timeout_hours or 2))
        target_rate = max(0.0, min(100.0, float(attendance_target_rate or 80)))
        progress = self.shop_floor_progress()
        as_of = (progress.get("as_of") or _planning_today().isoformat())[:10]
        day_stats = self.shop_floor_dashboard_stats(date_from=as_of, date_to=as_of)
        now = datetime.now()

        with self._lock:
            self._ensure_shop_floor_reports_unlocked()
            self._ensure_shop_floor_finished_unlocked()
            reports = list(self._data.get("shop_floor_reports") or [])
            pending_rows = [r for r in reports if r.get("status") == "pending"]
            rejected_rows = [r for r in reports if r.get("status") == "rejected"]
            pending_n = len(pending_rows)
            rejected_n = len(rejected_rows)

            last_eq: dict[str, str] = {}
            for r in sorted(
                (x for x in reports if x.get("status") == "confirmed"),
                key=lambda x: x.get("submitted_at") or x.get("work_date") or "",
            ):
                eq = (r.get("equipment_name") or "").strip()
                if not eq:
                    continue
                wo_id = (r.get("work_order_id") or "").strip()
                product = (r.get("product") or r.get("product_display") or "").strip()
                wo_label = (r.get("work_order_label") or "").strip()
                if wo_id:
                    last_eq[f"wo:{wo_id}"] = eq
                elif wo_label:
                    last_eq[f"wolabel:{wo_label}"] = eq
                if product:
                    last_eq[f"product:{product}"] = eq

            att = day_stats.get("attendance") or {}
            finished = day_stats.get("finished") or {}
            suggest_pending = [
                s
                for s in (finished.get("suggested") or [])
                if s.get("confirmed_qty") is None
                and float(s.get("suggested_qty") or 0) > 0
            ]
            unreported_list = list(att.get("unreported_list") or [])

            orders = list(progress.get("orders") or [])
            overdue = [o for o in orders if isinstance(o.get("days_to_due"), int) and o["days_to_due"] < 0]
            near_list = [
                o
                for o in orders
                if isinstance(o.get("days_to_due"), int) and 0 <= o["days_to_due"] <= near
            ]
            ok_n = len(orders) - len(overdue) - len(near_list)
            overdue.sort(key=lambda o: o.get("days_to_due") if o.get("days_to_due") is not None else 0)

            active: list[dict[str, Any]] = []
            for it in progress.get("work_orders") or []:
                if not it.get("has_reports"):
                    continue
                if it.get("wo_status") == "done":
                    continue
                key = it.get("id") or ""
                last_at = it.get("last_report_at")
                last_dt = self._parse_report_dt(last_at)
                silent_hours_val = None
                if last_dt:
                    silent_hours_val = round((now - last_dt).total_seconds() / 3600, 1)
                days = it.get("days_to_due")
                is_overdue = isinstance(days, int) and days < 0
                is_near = isinstance(days, int) and 0 <= days <= near
                is_silent = silent_hours_val is not None and silent_hours_val >= silent_h
                if is_overdue:
                    tone = "red"
                elif is_near or is_silent:
                    tone = "yellow"
                else:
                    tone = "green"
                proc_name = (it.get("current_process") or "").strip() or "未报工序"
                done_qty = float(it.get("total_confirmed_qty") or 0)
                # 主数据暂无计划量字段时 plan 为空；有则算进度
                plan_raw = it.get("plan_qty")
                plan_qty = float(plan_raw) if plan_raw not in (None, "") else None
                progress_pct = (
                    round(min(100.0, done_qty / plan_qty * 100), 1)
                    if plan_qty and plan_qty > 0
                    else None
                )
                active.append(
                    {
                        "id": key,
                        "link_type": it.get("link_type"),
                        "link_type_label": it.get("link_type_label"),
                        "work_order_label": it.get("work_order_label")
                        or it.get("work_order_code")
                        or it.get("product"),
                        "product": it.get("product"),
                        "current_process": it.get("current_process"),
                        "current_holder": it.get("current_holder"),
                        "equipment_name": last_eq.get(key) or None,
                        "total_confirmed_qty": done_qty,
                        "plan_qty": plan_qty,
                        "progress_pct": progress_pct,
                        "due_date": it.get("due_date"),
                        "days_to_due": days,
                        "last_report_at": last_at,
                        "silent_hours": silent_hours_val,
                        "lane": proc_name,
                        "tone": tone,
                        "wo_status": it.get("wo_status"),
                    }
                )
            active.sort(
                key=lambda x: (
                    {"red": 0, "yellow": 1, "green": 2}.get(x.get("tone") or "green", 9),
                    x.get("days_to_due") if isinstance(x.get("days_to_due"), int) else 9999,
                    -(x.get("silent_hours") or 0),
                )
            )
            silent_active = [a for a in active if (a.get("silent_hours") or 0) >= silent_h]
            green_active_n = sum(1 for a in active if a.get("tone") == "green")
            active_out = active[:limit]

            # —— 异常/必办事件（全量；首屏截 Top5）——
            actions: list[dict[str, Any]] = []
            _action_seq = 0

            def _push_action(
                *,
                type_: str,
                level: str,
                title: str,
                object_label: str,
                age_minutes: int,
                suggested_action: str,
                link: str,
                owner_role: str,
            ) -> None:
                nonlocal _action_seq
                _action_seq += 1
                actions.append(
                    {
                        "id": f"{type_}-{_action_seq}",
                        "type": type_,
                        "level": level,
                        "title": title,
                        "object_label": object_label,
                        "age_minutes": max(0, int(age_minutes)),
                        "age_label": self._age_label(max(0, int(age_minutes))),
                        "suggested_action": suggested_action,
                        "link": link,
                        "owner_role": owner_role,
                    }
                )

            for o in overdue:
                age_m = abs(int(o.get("days_to_due") or 0)) * 24 * 60
                label = f"{o.get('order_code') or ''} · {o.get('product') or ''}".strip(" ·")
                oid = (o.get("order_id") or str(o.get("id") or "").replace("order:", "")).strip()
                _push_action(
                    type_="order_overdue",
                    level="error",
                    title="订单已逾期",
                    object_label=label or "逾期订单",
                    age_minutes=age_m,
                    suggested_action="跟交期",
                    link=(
                        f"/production-progress/analysis?focus=order&id={oid}"
                        if oid
                        else "/production-progress/analysis"
                    ),
                    owner_role="manager",
                )

            for a in silent_active:
                sh = float(a.get("silent_hours") or 0)
                _push_action(
                    type_="wip_silent",
                    level="warning",
                    title="在制静默",
                    object_label=str(a.get("work_order_label") or a.get("product") or a.get("id")),
                    age_minutes=int(sh * 60),
                    suggested_action="查卡点",
                    link="/production-progress/cockpit",
                    owner_role="manager",
                )

            for u in unreported_list[:80]:
                label = f"{u.get('person_name') or u.get('person_id')} · {u.get('shift_name') or '班次'}"
                _push_action(
                    type_="unreported",
                    level="warning",
                    title="今日应报未报",
                    object_label=label,
                    age_minutes=0,
                    suggested_action="催报",
                    link="/production-progress/daily",
                    owner_role="director",
                )

            timed_out_pending = 0
            for r in pending_rows:
                dt = self._parse_report_dt(r.get("submitted_at") or r.get("work_date"))
                mins = int((now - dt).total_seconds() / 60) if dt else 0
                person = self._person_map().get(r.get("person_id") or "") or {}
                who = person.get("name") or r.get("person_id") or "作业人"
                proc = (r.get("process_name") or "").strip() or "报工"
                if dt and mins >= pending_h * 60:
                    timed_out_pending += 1
                    _push_action(
                        type_="pending_timeout",
                        level="warning",
                        title="报工待确认超时",
                        object_label=f"{who} · {proc}",
                        age_minutes=mins,
                        suggested_action="去确认",
                        link="/production-progress/daily?status=pending",
                        owner_role="director",
                    )
            if pending_n > 0 and timed_out_pending == 0:
                _push_action(
                    type_="pending_timeout",
                    level="warning",
                    title="报工待确认",
                    object_label=f"{pending_n} 条待主任确认",
                    age_minutes=0,
                    suggested_action="去确认",
                    link="/production-progress/daily?status=pending",
                    owner_role="director",
                )

            for r in rejected_rows[:40]:
                person = self._person_map().get(r.get("person_id") or "") or {}
                who = person.get("name") or r.get("person_id") or "作业人"
                note = (r.get("review_note") or "").strip()
                obj = f"{who} · {(r.get('process_name') or '报工')}"
                if note:
                    obj = f"{obj}（{note[:24]}）"
                _push_action(
                    type_="rejected_open",
                    level="error",
                    title="报工已驳回",
                    object_label=obj,
                    age_minutes=0,
                    suggested_action="督促重报",
                    link="/production-progress/daily?status=rejected",
                    owner_role="director",
                )

            for s in suggest_pending[:40]:
                _push_action(
                    type_="finished_pending",
                    level="info",
                    title="成品待确认",
                    object_label=f"{s.get('product')} · 建议 {s.get('suggested_qty')}",
                    age_minutes=0,
                    suggested_action="确认成品",
                    link="/production-progress/daily",
                    owner_role="director",
                )

            level_rank = {"error": 0, "warning": 1, "info": 2}
            if role == "director":
                type_boost = {
                    "unreported": 0,
                    "pending_timeout": 1,
                    "rejected_open": 2,
                    "finished_pending": 3,
                    "wip_silent": 4,
                    "order_overdue": 5,
                    "order_near_behind": 6,
                }
            else:
                type_boost = {
                    "order_overdue": 0,
                    "order_near_behind": 1,
                    "wip_silent": 2,
                    "rejected_open": 3,
                    "pending_timeout": 4,
                    "unreported": 5,
                    "finished_pending": 6,
                }
            actions.sort(
                key=lambda x: (
                    type_boost.get(x.get("type") or "", 9),
                    level_rank.get(x.get("level") or "info", 9),
                    -(x.get("age_minutes") or 0),
                )
            )

            # 兼容旧 alerts
            alerts: list[dict[str, Any]] = []
            unreported = int(att.get("unreported") or 0)
            if unreported > 0:
                alerts.append(
                    {
                        "type": "unreported",
                        "level": "warning",
                        "title": "今日应报未报",
                        "count": unreported,
                        "hint": "有排班未提交报工",
                        "link": "/production-progress/daily",
                    }
                )
            if pending_n > 0:
                alerts.append(
                    {
                        "type": "pending",
                        "level": "warning",
                        "title": "报工待确认",
                        "count": pending_n,
                        "hint": "主任确认后才计入进度",
                        "link": "/production-progress/daily",
                    }
                )
            if rejected_n > 0:
                alerts.append(
                    {
                        "type": "rejected",
                        "level": "error",
                        "title": "报工已驳回",
                        "count": rejected_n,
                        "hint": "需按驳回原因改正后重报",
                        "link": "/production-progress/daily",
                    }
                )
            if suggest_pending:
                alerts.append(
                    {
                        "type": "finished_pending",
                        "level": "info",
                        "title": "成品待确认",
                        "count": len(suggest_pending),
                        "hint": "末道产量建议尚未人工确认",
                        "link": "/production-progress/daily",
                    }
                )
            if overdue:
                alerts.append(
                    {
                        "type": "overdue",
                        "level": "error",
                        "title": "订单已逾期",
                        "count": len(overdue),
                        "hint": "优先看交期与在制责任人",
                        "link": "/production-progress/analysis",
                    }
                )

            expected = int(att.get("expected") or 0)
            reported = int(att.get("reported") or 0)
            rate = round(reported / expected * 100, 1) if expected else None
            top_overdue = overdue[0] if overdue else None
            red_headline = (
                f"{top_overdue.get('order_code')} · {top_overdue.get('product') or ''} · "
                f"{top_overdue.get('current_holder') or '未指认'}"
                if top_overdue
                else "无逾期订单"
            )
            yellow_count = len(near_list) + len(silent_active)
            yellow_headline = f"{len(near_list)} 临期 · {len(silent_active)} 静默超 {silent_h:g}h"
            rate_txt = f"{rate}%" if rate is not None else "—"
            green_headline = f"报工率 {rate_txt}（目标 {target_rate:g}%）"

            brief = lambda o: {
                "order_code": o.get("order_code"),
                "order_name": o.get("order_name"),
                "product": o.get("product"),
                "due_date": o.get("due_date"),
                "days_to_due": o.get("days_to_due"),
                "current_holder": o.get("current_holder"),
                "current_process": o.get("current_process"),
            }

            # —— 交期驾驶舱：分桶 + 进度行 ——
            behind_pct = 70.0
            order_raw = {
                o.get("id"): o for o in (self._data.get("orders") or []) if o.get("id")
            }
            bucket = {"overdue": 0, "d3": 0, "d7": 0, "later": 0, "no_due": 0}
            due_rows: list[dict[str, Any]] = []
            for o in orders:
                days = o.get("days_to_due")
                if not isinstance(days, int):
                    bucket["no_due"] += 1
                elif days < 0:
                    bucket["overdue"] += 1
                elif days <= 3:
                    bucket["d3"] += 1
                elif days <= 7:
                    bucket["d7"] += 1
                else:
                    bucket["later"] += 1

                done_qty = float(o.get("total_confirmed_qty") or 0)
                oid = o.get("order_id") or (str(o.get("id") or "").replace("order:", ""))
                raw = order_raw.get(oid) or {}
                plan_candidate = raw.get("plan_qty") or raw.get("qty") or raw.get("quantity")
                plan_qty = (
                    float(plan_candidate)
                    if plan_candidate not in (None, "")
                    else None
                )
                progress_pct = (
                    round(min(100.0, done_qty / plan_qty * 100), 1)
                    if plan_qty and plan_qty > 0
                    else None
                )
                last_dt = self._parse_report_dt(o.get("last_report_at"))
                silent_h_ord = (
                    round((now - last_dt).total_seconds() / 3600, 1) if last_dt else None
                )
                is_overdue = isinstance(days, int) and days < 0
                is_near = isinstance(days, int) and 0 <= days <= near
                is_silent = silent_h_ord is not None and silent_h_ord >= silent_h
                behind = False
                if (is_overdue or is_near) and progress_pct is not None:
                    behind = progress_pct < behind_pct
                elif is_overdue and done_qty <= 0:
                    behind = True
                tags: list[str] = []
                if is_overdue:
                    tags.append("逾期")
                elif is_near:
                    tags.append("临期")
                if is_silent:
                    tags.append("静默")
                if behind:
                    tags.append("落后")
                due_rows.append(
                    {
                        "order_id": oid,
                        "order_code": o.get("order_code"),
                        "order_name": o.get("order_name"),
                        "product": o.get("product"),
                        "due_date": o.get("due_date"),
                        "days_to_due": days,
                        "plan_qty": plan_qty,
                        "done_qty": done_qty,
                        "progress_pct": progress_pct,
                        "behind": behind,
                        "current_process": o.get("current_process"),
                        "current_holder": o.get("current_holder"),
                        "silent_hours": silent_h_ord,
                        "last_report_at": o.get("last_report_at"),
                        "risk_tags": tags,
                        "risk_tag": tags[0] if tags else None,
                    }
                )
            due_rows.sort(
                key=lambda x: (
                    0 if "逾期" in (x.get("risk_tags") or []) else 1,
                    0 if "落后" in (x.get("risk_tags") or []) else 1,
                    0 if "临期" in (x.get("risk_tags") or []) else 1,
                    x.get("days_to_due") if isinstance(x.get("days_to_due"), int) else 9999,
                )
            )
            # 列表默认：逾期+临期优先，补足到 8
            due_focus = [
                r
                for r in due_rows
                if "逾期" in (r.get("risk_tags") or []) or "临期" in (r.get("risk_tags") or [])
            ]
            if len(due_focus) < 8:
                for r in due_rows:
                    if r not in due_focus:
                        due_focus.append(r)
                    if len(due_focus) >= 8:
                        break

            for r in due_rows:
                if not r.get("behind"):
                    continue
                if "逾期" not in (r.get("risk_tags") or []) and "临期" not in (r.get("risk_tags") or []):
                    continue
                label = f"{r.get('order_code') or ''} · {r.get('product') or ''}".strip(" ·")
                pct = r.get("progress_pct")
                oid = (r.get("order_id") or "").strip()
                _push_action(
                    type_="order_near_behind",
                    level="warning",
                    title="交期进度落后",
                    object_label=f"{label} · {pct}%" if pct is not None else label,
                    age_minutes=0,
                    suggested_action="加催",
                    link=(
                        f"/production-progress/analysis?focus=order&id={oid}"
                        if oid
                        else "/production-progress/analysis"
                    ),
                    owner_role="manager",
                )
            actions_all = list(actions)
            actions_all.sort(
                key=lambda x: (
                    type_boost.get(x.get("type") or "", 9),
                    level_rank.get(x.get("level") or "info", 9),
                    -(x.get("age_minutes") or 0),
                )
            )
            actions_top = actions_all[:5]

            # 近 7 日趋势（工序确认产量 / 成品确认）
            as_of_d = date.fromisoformat(as_of)
            finished_rows = list(self._data.get("shop_floor_finished") or [])
            process_trend: list[dict[str, Any]] = []
            finished_trend: list[dict[str, Any]] = []
            for i in range(6, -1, -1):
                day = (as_of_d - timedelta(days=i)).isoformat()
                pq = sum(
                    float(r.get("qty") or 0)
                    for r in reports
                    if r.get("status") == "confirmed" and (r.get("work_date") or "")[:10] == day
                )
                fq = sum(
                    float(c.get("confirmed_qty") or 0)
                    for c in finished_rows
                    if c.get("status") == "confirmed" and (c.get("work_date") or "")[:10] == day
                )
                process_trend.append({"date": day, "label": day[5:], "value": round(pq, 2)})
                finished_trend.append({"date": day, "label": day[5:], "value": round(fq, 2)})

            # 建议合计用当日成品建议列表（含已确认行的 suggested）
            suggested_all_today = round(
                sum(float(s.get("suggested_qty") or 0) for s in (finished.get("suggested") or [])),
                2,
            )
            finished_confirmed = float(finished.get("confirmed_qty") or 0)
            finished_gap = round(suggested_all_today - finished_confirmed, 2)

            return {
                "as_of": as_of,
                "view": role,
                "note": "进度来自已确认报工，非设备实时采集。静默=太久无新确认报工。",
                "config": {
                    "near_days": near,
                    "silent_hours": silent_h,
                    "pending_timeout_hours": pending_h,
                    "attendance_target_rate": target_rate,
                    "progress_behind_pct": behind_pct,
                },
                "command": {
                    "near_days": near,
                    "red": {
                        "count": len(overdue),
                        "headline": red_headline.strip(" ·"),
                    },
                    "yellow": {
                        "count": yellow_count,
                        "headline": yellow_headline,
                        "near_count": len(near_list),
                        "silent_count": len(silent_active),
                    },
                    "green": {
                        "count": green_active_n,
                        "headline": green_headline,
                        "attendance_rate": rate,
                        "attendance_target_rate": target_rate,
                    },
                },
                "actions": actions_top,
                "actions_all": actions_all,
                "alerts_total": len(actions_all),
                "due": {
                    "buckets": bucket,
                    "rows": due_focus,
                    "all_count": len(due_rows),
                },
                "due_risk": {
                    "near_days": near,
                    "overdue": len(overdue),
                    "near": len(near_list),
                    "ok": max(0, ok_n),
                    "order_total": len(orders),
                    "overdue_orders": [brief(o) for o in overdue[:8]],
                    "near_orders": [brief(o) for o in near_list[:8]],
                },
                "active": active_out,
                "alerts": alerts,
                "pulse": {
                    "attendance_expected": expected,
                    "attendance_reported": reported,
                    "attendance_unreported": unreported,
                    "attendance_rate": rate,
                    "attendance_target_rate": target_rate,
                    "process_total_qty": day_stats.get("process_total_qty") or 0,
                    "finished_suggested_qty": suggested_all_today,
                    "finished_confirmed_qty": finished_confirmed,
                    "finished_gap": finished_gap,
                    "pending_reports": pending_n,
                    "rejected_reports": rejected_n,
                    "trend": {
                        "process_qty_7d": process_trend,
                        "finished_qty_7d": finished_trend,
                    },
                },
            }

    def start_op(self, op_id: str) -> dict:
        """现场开工：须已排产。

        - 逾期未开：计划锚到今天，标记 late_start（补做）
        - 提前开未来计划：计划前移到今天，标记 early_start（赶工）
        """
        with self._lock:
            op = self._op_map().get(op_id)
            if not op:
                raise NotFoundException("工序不存在")
            if op["status"] == "done":
                raise ValidationException("工序已完工")
            if op.get("status") == "cancelled":
                raise ValidationException("工序已取消")
            if op["status"] == "running":
                return self._enrich_op(op)

            ps = (op.get("plan_start") or "")[:10]
            if not ps:
                raise ValidationException("工序尚未排产，请先在甘特排期后再开工")

            today = _planning_today()
            today_iso = today.isoformat()
            early_until = (today + timedelta(days=REPORT_EARLY_PULL_DAYS)).isoformat()

            days = int(op.get("duration_days") or 0) or max(
                1, _duration_days(op["plan_start"], op.get("plan_end") or op["plan_start"])
            )

            # 提前开工：仅允许提前窗口内（默认明天）
            if op["status"] == "pending" and today_iso < ps:
                if ps > early_until:
                    raise ValidationException(
                        f"计划开始日为 {ps}，超出可提前窗口（最多提前到 {early_until}）。"
                        "如需更早，请调度在甘特改期。"
                    )
                if not op.get("original_plan_start"):
                    op["original_plan_start"] = ps
                op["plan_start"] = today_iso
                op["plan_end"] = (today + timedelta(days=days - 1)).isoformat()
                op["duration_days"] = days
                op["plan_drift"] = "early_start"
            # 逾期 / 计划日已过仍待开：锚到今天
            elif op["status"] == "pending" and today_iso > ps:
                if not op.get("original_plan_start"):
                    op["original_plan_start"] = ps
                op["plan_start"] = today_iso
                op["plan_end"] = (today + timedelta(days=days - 1)).isoformat()
                op["duration_days"] = days
                op["plan_drift"] = "late_start"

            op["status"] = "running"
            op["actual_start"] = datetime.now().isoformat(timespec="seconds")
            if int(op.get("progress") or 0) <= 0:
                op["progress"] = 5
            names = [
                self._person_map()[i]["name"]
                for i in _assignee_ids_of(op)
                if i in self._person_map()
            ]
            drift_msg = ""
            if op.get("plan_drift") == "late_start":
                drift_msg = "（补做：计划已锚到今日）"
            elif op.get("plan_drift") == "early_start":
                drift_msg = "（提前开工：计划已前移到今日）"
            self._append_event(
                "、".join(names) if names else "现场",
                op["name"],
                "进行中" + drift_msg,
            )
            self._sync_work_order_status(op["work_order_id"])
            return self._enrich_op(op)

    def finish_op(self, op_id: str) -> dict:
        with self._lock:
            op = self._op_map().get(op_id)
            if not op:
                raise NotFoundException("工序不存在")
            op["status"] = "done"
            op["progress"] = 100
            op["actual_end"] = datetime.now().isoformat(timespec="seconds")
            if not op.get("actual_start"):
                op["actual_start"] = op["actual_end"]
            person = self._person_map().get(op.get("assignee_id") or "", {})
            self._append_event(person.get("name") or "现场", op["name"], "已完工")
            self._sync_work_order_status(op["work_order_id"])
            calibration = self._calibrate_template_from_op_unlocked(op)
            enriched = self._enrich_op(op)
            if calibration:
                enriched["calibration"] = calibration
            return enriched

    def _calibrate_template_from_op_unlocked(self, op: dict) -> dict | None:
        """用实际耗时回写模板建议天数。"""
        tid = op.get("template_id")
        if not tid:
            # 按名称兜底匹配
            tid = next(
                (t["id"] for t in self._data["templates"] if t["name"] == op.get("name")),
                None,
            )
        if not tid and op.get("skill_id"):
            tid = next(
                (
                    t["id"]
                    for t in self._data["templates"]
                    if t.get("skill_id") == op.get("skill_id")
                ),
                None,
            )
        if not tid:
            return None
        tpl = next((t for t in self._data["templates"] if t["id"] == tid), None)
        if not tpl:
            return None
        start = (op.get("actual_start") or "")[:10]
        end = (op.get("actual_end") or "")[:10]
        if not start or not end:
            return None
        actual_days = max(1, _duration_days(start, end))
        samples = list(tpl.get("actual_samples") or [])
        samples.append({"days": actual_days, "at": end})
        samples = samples[-20:]
        avg = sum(float(s["days"]) for s in samples) / len(samples)
        suggested_days = round(avg, 1)
        suggested_hours = round(suggested_days * 8, 1)
        tpl["actual_samples"] = samples
        tpl["suggested_days"] = suggested_days
        tpl["suggested_hours"] = suggested_hours
        std_days = max(1, round(float(tpl.get("std_hours") or 8) / 8, 1))
        return {
            "template_id": tid,
            "template_name": tpl["name"],
            "actual_days": actual_days,
            "sample_count": len(samples),
            "suggested_days": suggested_days,
            "std_hours": tpl.get("std_hours"),
            "message": (
                f"模板「{tpl['name']}」已根据 {len(samples)} 次实绩校准："
                f"建议约 {suggested_days} 天（标准工时 {tpl.get('std_hours')}h≈{std_days} 天）"
            ),
        }

    def _impact_snapshot_unlocked(self) -> dict[str, Any]:
        wos = self._wo_map()
        rows = []
        for op in self._data["operations"]:
            if not op.get("plan_start") or op.get("status") == "done":
                continue
            wo = wos.get(op["work_order_id"], {})
            delay = self._delay_days(op, wo)
            _normalize_op_fields(op)
            rows.append(
                {
                    "op_id": op["id"],
                    "name": op["name"],
                    "plan_start": op.get("plan_start"),
                    "plan_end": op.get("plan_end"),
                    "delay_days": delay,
                    "staffing_gap": int(op.get("staffing_gap") or 0),
                    "assignee_ids": list(_assignee_ids_of(op)),
                }
            )
        conflicts = self._detect_conflicts()
        return {
            "ops": {r["op_id"]: r for r in rows},
            "conflict_count": len(conflicts),
            "delay_count": sum(1 for r in rows if r["delay_days"] > 0),
            "staffing_count": sum(1 for r in rows if r["staffing_gap"] > 0),
            "conflicts": conflicts,
        }

    def _build_impact_report(
        self, before: dict[str, Any], after: dict[str, Any], *, action: str
    ) -> dict[str, Any]:
        changed: list[dict] = []
        before_ops = before["ops"]
        after_ops = after["ops"]
        all_ids = set(before_ops) | set(after_ops)
        for oid in all_ids:
            b, a = before_ops.get(oid), after_ops.get(oid)
            if not a:
                continue
            if not b:
                changed.append(
                    {
                        "op_id": oid,
                        "name": a["name"],
                        "change": "新排上",
                        "plan_window": f"{a['plan_start'][5:]}~{a['plan_end'][5:]}",
                        "delay_days": a["delay_days"],
                        "staffing_gap": a["staffing_gap"],
                    }
                )
                continue
            if (
                b["plan_start"] != a["plan_start"]
                or b["plan_end"] != a["plan_end"]
                or b["delay_days"] != a["delay_days"]
                or b["staffing_gap"] != a["staffing_gap"]
                or b["assignee_ids"] != a["assignee_ids"]
            ):
                changed.append(
                    {
                        "op_id": oid,
                        "name": a["name"],
                        "change": (
                            f"{b['plan_start'][5:]}~{b['plan_end'][5:]}"
                            f" → {a['plan_start'][5:]}~{a['plan_end'][5:]}"
                        ),
                        "plan_window": f"{a['plan_start'][5:]}~{a['plan_end'][5:]}",
                        "delay_before": b["delay_days"],
                        "delay_days": a["delay_days"],
                        "staffing_gap": a["staffing_gap"],
                    }
                )

        new_delays = [
            c for c in changed if c.get("delay_days", 0) > c.get("delay_before", 0)
        ]
        risk_level = "low"
        if after["conflict_count"] > before["conflict_count"] or new_delays:
            risk_level = "high"
        elif after["staffing_count"] > before["staffing_count"] or changed:
            risk_level = "medium"

        summary = (
            f"将影响 {len(changed)} 道工序；"
            f"冲突 {before['conflict_count']}→{after['conflict_count']}；"
            f"延期 {before['delay_count']}→{after['delay_count']}；"
            f"缺编 {before['staffing_count']}→{after['staffing_count']}"
        )
        return {
            "action": action,
            "risk_level": risk_level,
            "summary": summary,
            "changed_ops": changed[:30],
            "conflicts_after": after["conflicts"][:20],
            "metrics": {
                "changed_count": len(changed),
                "conflict_before": before["conflict_count"],
                "conflict_after": after["conflict_count"],
                "delay_before": before["delay_count"],
                "delay_after": after["delay_count"],
                "staffing_before": before["staffing_count"],
                "staffing_after": after["staffing_count"],
            },
        }

    def _preview_on_copy(self, mutator) -> tuple[dict[str, Any], dict[str, Any]]:
        """在数据副本上试算，不影响正式/_data。"""
        backup_data = self._data
        backup_undo = self._undo_stack
        backup_redo = self._redo_stack
        self._data = deepcopy(backup_data)
        self._undo_stack = []
        self._redo_stack = []
        try:
            before = self._impact_snapshot_unlocked()
            mutator()
            after = self._impact_snapshot_unlocked()
            return before, after
        finally:
            self._data = backup_data
            self._undo_stack = backup_undo
            self._redo_stack = backup_redo

    def preview_move_task(
        self,
        op_id: str,
        plan_start: str,
        *,
        slot: str | None = None,
        shift_id: str | None = None,
        assignee_ids: list[str] | None = None,
        duration_days: int | None = None,
        plan_segments: list[dict] | None = None,
        hours_per_day: float | None = None,
        equipment_id: str | None = None,
        clear_equipment: bool = False,
        cascade: bool = True,
        resolve_roster: bool = False,
        only_fill_empty: bool = False,
        required_headcount: int | None = None,
        auto_equipment: bool = False,
    ) -> dict:
        with self._lock:
            resolved_holder: dict[str, Any] = {}

            def mutator() -> None:
                resolved_holder["op"] = self._move_task_unlocked(
                    op_id,
                    plan_start,
                    slot=slot,
                    shift_id=shift_id,
                    assignee_ids=assignee_ids,
                    duration_days=duration_days,
                    plan_segments=plan_segments,
                    hours_per_day=hours_per_day,
                    equipment_id=equipment_id,
                    clear_equipment=clear_equipment,
                    cascade=cascade,
                    resolve_roster=resolve_roster,
                    only_fill_empty=only_fill_empty,
                    required_headcount=required_headcount,
                    auto_equipment=auto_equipment,
                )

            before, after = self._preview_on_copy(mutator)
            report = self._build_impact_report(before, after, action="move")
            report["can_apply"] = True
            report["resolved_op"] = resolved_holder.get("op")
            # 仅与本工序相关的冲突，便于编辑弹窗按段标红
            op_conflicts = [
                c
                for c in (after.get("conflicts") or [])
                if c.get("op_id") == op_id or c.get("action_op_id") == op_id
            ]
            report["op_conflicts"] = op_conflicts
            return report

    def preview_schedule_order(self, payload: dict[str, Any]) -> dict:
        with self._lock:
            before, after = self._preview_on_copy(
                lambda: self._schedule_order_ops_unlocked(payload)
            )
            report = self._build_impact_report(before, after, action="schedule")
            report["can_apply"] = True
            return report

    def preview_replan(self, strategy: str = "priority", scope: str = "gantt") -> dict:
        with self._lock:
            strategy = self._normalize_replan_strategy(strategy)
            scope = self._normalize_replan_scope(scope)
            meta_holder: dict[str, Any] = {}

            def mutator() -> None:
                overview = self._replan_unlocked(strategy=strategy, scope=scope)
                meta_holder["replan_meta"] = overview.get("replan_meta") or {}

            before, after = self._preview_on_copy(mutator)
            report = self._build_impact_report(before, after, action="replan")
            meta = meta_holder.get("replan_meta") or {
                "strategy": strategy,
                "strategy_label": REPLAN_STRATEGIES[strategy]["label"],
                "strategy_description": REPLAN_STRATEGIES[strategy]["description"],
                "scope": scope,
                "scope_label": REPLAN_SCOPES[scope]["label"],
                "scope_description": REPLAN_SCOPES[scope]["description"],
                "queue_preview": [],
            }
            report["can_apply"] = True
            report["strategy"] = meta.get("strategy", strategy)
            report["strategy_label"] = meta.get("strategy_label")
            report["strategy_description"] = meta.get("strategy_description")
            report["scope"] = meta.get("scope", scope)
            report["scope_label"] = meta.get("scope_label")
            report["scope_description"] = meta.get("scope_description")
            report["queue_preview"] = meta.get("queue_preview") or []
            report["candidate_count"] = meta.get("candidate_count")
            report["frozen_count"] = meta.get("frozen_count")
            report["freeze_note"] = meta.get("freeze_note")
            report["strategies"] = [
                {"value": k, "label": v["label"], "description": v["description"]}
                for k, v in REPLAN_STRATEGIES.items()
            ]
            report["scopes"] = [
                {"value": k, "label": v["label"], "description": v["description"]}
                for k, v in REPLAN_SCOPES.items()
            ]
            s_label = meta.get("strategy_label") or strategy
            sc_label = meta.get("scope_label") or scope
            freeze = meta.get("freeze_note") or ""
            report["summary"] = (
                f"【{sc_label} · {s_label}】{report['summary']}"
                + (f"；{freeze}" if freeze else "")
            )
            return report

    def _capacity_heatmap_unlocked(self, dates: list[str] | None = None) -> dict[str, Any]:
        """人员 × 归属日负荷：0 空闲 / 1 满 / >1 超载。默认与甘特视窗对齐。

        工序 plan_start/end 按归属日（挂牌日）累计，凌晨班与跨午夜班不拆到次日格子。
        """
        if not dates:
            dates, _ = self._gantt_axis_unlocked(horizon="focus")

        persons = [p for p in self._data["persons"] if p.get("status") == "active"]
        # person_id -> belong_day -> load count
        load: dict[str, dict[str, float]] = {p["id"]: {d: 0.0 for d in dates} for p in persons}
        detail: dict[str, dict[str, list]] = {p["id"]: {d: [] for d in dates} for p in persons}

        for op in self._data["operations"]:
            if op.get("status") == "done" or not op.get("plan_start"):
                continue
            slot = op.get("slot") or "full"
            weight = 1.0 if slot == "full" else 0.5
            shift = self._resolve_op_shift(op)
            shift_tag = (shift or {}).get("name") or ""
            for pid in _assignee_ids_of(op):
                if pid not in load:
                    continue
                for i in range(_duration_days(op["plan_start"], op["plan_end"] or op["plan_start"])):
                    day = _add_days(op["plan_start"], i)  # 归属日
                    if day not in load[pid]:
                        continue
                    load[pid][day] += weight
                    label = op["name"] + (f"·{shift_tag}" if shift_tag else "")
                    detail[pid][day].append(label)

        # 请假占满
        for leave in self._data.get("leaves") or []:
            if leave.get("status") == "closed":
                continue
            pid = leave.get("person_id")
            if pid not in load:
                continue
            ls, le = leave.get("start_date") or "", leave.get("end_date") or ""
            if not ls or not le:
                continue
            for i in range(_duration_days(ls, le)):
                day = _add_days(ls, i)
                if day in load[pid]:
                    load[pid][day] = max(load[pid][day], 1.0)
                    detail[pid][day].append(f"请假:{leave.get('reason') or ''}")

        rows = []
        overload_days = 0
        for p in persons:
            cells = []
            for d in dates:
                v = load[p["id"]][d]
                level = "free" if v <= 0 else ("ok" if v <= 1 else "overload")
                if level == "overload":
                    overload_days += 1
                cells.append(
                    {
                        "date": d,
                        "load": round(v, 1),
                        "level": level,
                        "ops": detail[p["id"]][d][:4],
                    }
                )
            rows.append(
                {
                    "person_id": p["id"],
                    "person_name": p["name"],
                    "code": p.get("code"),
                    "cells": cells,
                }
            )
        return {
            "dates": dates,
            "rows": rows,
            "overload_cell_count": overload_days,
            "summary": (
                f"{len(persons)} 人 × {len(dates)} 归属日"
                + (f"，超载格 {overload_days} 个" if overload_days else "，暂无超载")
            ),
            "axis_note": "横轴为归属日（与甘特挂牌日一致）",
        }

    def sandbox_enter(self) -> dict:
        with self._lock:
            if self._sandbox_base is not None:
                raise ValidationException("已在试排模式中")
            self._sandbox_base = deepcopy(self._data)
            self._undo_stack.clear()
            self._redo_stack.clear()
            overview = self.gantt_overview_unlocked()
            overview["sandbox_message"] = "已进入试排：可随意改排，确认后发布，或放弃还原"
            return overview

    def sandbox_discard(self) -> dict:
        with self._lock:
            if self._sandbox_base is None:
                raise ValidationException("当前不在试排模式")
            self._data = self._sandbox_base
            self._sandbox_base = None
            self._undo_stack.clear()
            self._redo_stack.clear()
            overview = self.gantt_overview_unlocked()
            overview["sandbox_message"] = "已放弃试排，已还原正式计划"
            return overview

    def sandbox_publish(self) -> dict:
        with self._lock:
            if self._sandbox_base is None:
                raise ValidationException("当前不在试排模式")
            self._sandbox_base = None
            self._undo_stack.clear()
            self._redo_stack.clear()
            overview = self.gantt_overview_unlocked()
            overview["sandbox_message"] = "试排已发布为正式计划"
            return overview

    def pause_op(self, op_id: str, reason: str | None = None) -> dict:
        with self._lock:
            op = self._op_map().get(op_id)
            if not op:
                raise NotFoundException("工序不存在")
            if op["status"] not in ("running", "pending"):
                raise ValidationException("当前状态不可暂停")
            op["status"] = "paused"
            person = self._person_map().get(op.get("assignee_id") or "", {})
            msg = f"暂停{(' · ' + reason) if reason else ''}"
            self._append_event(person.get("name") or "现场", op["name"], msg.strip())
            self._sync_work_order_status(op["work_order_id"])
            return self._enrich_op(op)


_stores: dict[int, SchedulingStore] = {}
_stores_lock = Lock()


def get_store(tenant_id: int) -> SchedulingStore:
    """按租户返回独立排产 Store；快照 id == tenant_id。"""
    tid = int(tenant_id or 1)
    with _stores_lock:
        existing = _stores.get(tid)
        if existing is not None:
            return existing
        created = SchedulingStore(tenant_id=tid)
        _stores[tid] = created
        return created


# 兼容旧导入：默认指向演示租户
store = get_store(1)
