"""生产排产 Store：内存运算 + DATABASE_URL 快照落库（SQLite/PG）。"""

from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta
from threading import Lock
from typing import Any

from app.core.exceptions import NotFoundException, ValidationException
from app.scheduling.persist import load_scheduling_payload, save_scheduling_payload

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


# 甘特日期轴：以今天为中心，不从最早历史订单起铺整年
GANTT_LOOKBACK_DAYS = 3  # 今天往前留几天（已冻结，仅作上下文）
GANTT_DEFAULT_AHEAD_DAYS = 27  # 默认向后约四周
GANTT_MAX_AHEAD_DAYS = 90  # 「聚焦」模式最多铺到今天+90，避免超长轴


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
    if op.get("plan_start"):
        op["staffing_gap"] = max(0, need - len(ids))
    else:
        op["staffing_gap"] = max(0, int(op.get("staffing_gap") or 0))
    # 无班次时统一默认白班（演示只保留一个班）
    if not op.get("shift_id") and not op.get("shift_family_id"):
        op["shift_family_id"] = "sh-day"
    _sync_plan_from_segments(op)


def _hours_per_day_of(op: dict) -> float:
    try:
        v = float(op.get("hours_per_day") if op.get("hours_per_day") is not None else 8)
    except (TypeError, ValueError):
        v = 8.0
    return v if v > 0 else 8.0


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
        pid = s.get("person_id")
        out.append(
            {
                "id": str(s.get("id") or f"seg-{i + 1}"),
                "person_id": str(pid) if pid else None,
                "start": start,
                "end": end,
            }
        )
    out.sort(key=lambda x: (x["start"], x["end"], x.get("person_id") or ""))
    return out


def _sync_plan_from_segments(op: dict) -> None:
    """时间段（可选）→ 信封 plan_start/end、合计天数、责任人。

    日工时 hours_per_day 默认 8：计划工时 = 各段日历天合计 × 日工时。
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
    for s in segs:
        pid = s.get("person_id")
        if pid and pid not in pids:
            pids.append(pid)
    if pids:
        op["assignee_ids"] = pids
        op["assignee_id"] = pids[0]


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


def _duration_days(start: str, end: str) -> int:
    """闭区间天数：09-18~09-19 = 2 天。"""
    return (_parse(end) - _parse(start)).days + 1


def _end_from_start(start: str, days: int) -> str:
    return _add_days(start, max(days, 1) - 1)


def _build_seed() -> dict[str, Any]:
    skills = [
        {"id": "sk-assembly", "name": "装配"},
        {"id": "sk-weld", "name": "焊接"},
        {"id": "sk-debug", "name": "调试"},
        {"id": "sk-qc", "name": "质检"},
        {"id": "sk-pack", "name": "包装"},
        {"id": "sk-cnc", "name": "机加"},
        {"id": "sk-paint", "name": "喷涂"},
        {"id": "sk-elec", "name": "电装"},
    ]
    resources = [
        {"id": "res-assembly", "name": "装配一组"},
        {"id": "res-weld", "name": "焊接二组"},
        {"id": "res-debug", "name": "调试组"},
        {"id": "res-qc", "name": "质检组"},
    ]
    # 班次：演示默认仅白班（family + 版本）；中/夜等先不放进种子
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
            "start_time": "08:30",
            "end_time": "16:30",
            "crosses_midnight": False,
            "status": "active",
            "effective_from": "2026-09-01",
            "effective_to": None,
            "superseded_by": None,
            "note": "现行：8:30–16:30",
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
            "shift_family_ids": ["sh-day"],
        },
        {
            "id": "p2",
            "name": "李强",
            "code": "EMP-002",
            "skill_ids": ["sk-weld"],
            "status": "active",
            "resource_id": "res-weld",
            "shift_family_ids": ["sh-day"],
        },
        {
            "id": "p3",
            "name": "王敏",
            "code": "EMP-003",
            "skill_ids": ["sk-qc"],
            "status": "active",
            "resource_id": "res-qc",
            "shift_family_ids": ["sh-day"],
        },
        {
            "id": "p4",
            "name": "赵磊",
            "code": "EMP-004",
            "skill_ids": ["sk-debug"],
            "status": "active",
            "resource_id": "res-debug",
            "shift_family_ids": ["sh-day"],
        },
        {
            "id": "p5",
            "name": "陈芳",
            "code": "EMP-005",
            "skill_ids": ["sk-assembly", "sk-pack"],
            "status": "active",
            "resource_id": "res-assembly",
            "shift_family_ids": ["sh-day"],
        },
    ]
    templates = [
        {
            "id": "tpl-1",
            "name": "零件装配",
            "std_hours": 2.0,
            "skill_id": "sk-assembly",
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
        "_seq": {
            "person": 5,
            "template": 4,
            "order": 8,
            "work_order": 9,
            "operation": 100,
            "event": 3,
            "leave": 1,
            "substitution": 0,
            "shift_version": 2,
            "shift_family": 1,
            "shift_assignment": 5,
            "daily_log": 2,
            "busy_ack": 0,
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
    def __init__(self) -> None:
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
            loaded = load_scheduling_payload()
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
                self._sync_person_leave_status_unlocked()
                self._persist_unlocked()
                return True
            # 库空：落一份 seed
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
            save_scheduling_payload(self._data)
            self._last_saved_payload = payload
        except Exception:
            # 落库失败不阻断演示接口；下次写入再试
            import logging

            logging.getLogger(__name__).exception("排产快照落库失败")

    def reset(self) -> dict[str, Any]:
        """恢复演示排产：按今天重铺计划/进度/请假/报工；保留人员与主数据。

        不动：skills / resources / shifts / persons / templates（若当前已有则保留）。
        重铺：orders / work_orders / operations / leaves / 任职排班 / daily_logs / events。
        单号仍用固定演示编号（SO-202609-001 等），不随机生成。
        """
        with self._lock:
            master_keys = ("skills", "resources", "shifts", "persons", "templates")
            preserved = {
                k: deepcopy(self._data[k])
                for k in master_keys
                if isinstance(self._data.get(k), list) and self._data.get(k)
            }
            fresh = _build_seed()
            for k, rows in preserved.items():
                fresh[k] = rows
            # 请假演示会改人员状态；Reset 后人员先回到在岗，再由请假同步
            for p in fresh.get("persons") or []:
                if p.get("status") == "leave":
                    p["status"] = "active"
            self._data = fresh
            self._undo_stack.clear()
            self._redo_stack.clear()
            self._sandbox_base = None
            self._last_saved_payload = None
            self._sync_person_leave_status_unlocked()
            self._persist_unlocked()
            snap = self.snapshot_unlocked()
            meta = snap.get("_demo_meta") or {}
            return {
                "ok": True,
                "anchor": meta.get("anchor") or _d(0),
                "scenarios": meta.get("scenarios") or [],
                "message": f"已按今天（{meta.get('anchor') or _d(0)}）恢复演示排产；人员与主数据已保留。",
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

    def _sync_person_leave_status_unlocked(self) -> None:
        """人员 status=leave 与未关闭请假台账对齐；无请假却标请假的（如旧种子）自动恢复在岗。"""
        open_pids = {
            lv.get("person_id")
            for lv in (self._data.get("leaves") or [])
            if lv.get("status") != "closed" and lv.get("person_id")
        }
        for p in self._data.get("persons") or []:
            if p.get("status") == "disabled":
                continue
            if p["id"] in open_pids:
                p["status"] = "leave"
            elif p.get("status") == "leave":
                p["status"] = "active"

    def _person_map(self) -> dict[str, dict]:
        return {p["id"]: p for p in self._data["persons"]}

    def _skill_map(self) -> dict[str, dict]:
        return {s["id"]: s for s in self._data["skills"]}

    def _resource_map(self) -> dict[str, dict]:
        return {r["id"]: r for r in self._data["resources"]}

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
        return {
            **deepcopy(shift),
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
        """某人在指定日的任职班次族；无任职返回 None。"""
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
        persons = self._person_map()
        skills = self._skill_map()
        resources = self._resource_map()
        wos = self._wo_map()
        wo = wos.get(op["work_order_id"], {})
        order = self._order_map().get(wo.get("order_id") or "", {})
        ids = _assignee_ids_of(op)
        names = [persons[i]["name"] for i in ids if i in persons]
        kind = wo.get("wo_kind") or "normal"
        shift = self._resolve_op_shift(op)
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
            # 加急工单工序一律视为插队（避免历史种子 / 手改标志与优先级不一致）
            "is_insert": bool(op.get("is_insert")) or (wo.get("priority") == "rush"),
            "delay_days": self._delay_days(op, wo, order),
            "plan_drift": op.get("plan_drift"),
            "plan_drift_label": {
                "late_start": "延期开工",
                "early_start": "提前开工",
            }.get(op.get("plan_drift") or "", None),
            "plan_vs_actual": self._plan_vs_actual(op),
            "plan_segments": list(op.get("plan_segments") or []),
            "hours_per_day": _hours_per_day_of(op),
            "segment_day_sum": int(op.get("segment_day_sum") or 0),
            "planned_hours": float(op.get("planned_hours") or 0),
        }

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
            current_by_person: dict[str, dict] = {}
            for a in shift_assignments:
                if a.get("lifecycle") == "active" and a.get("person_id") not in current_by_person:
                    current_by_person[a["person_id"]] = a
            return {
                "kpis": [
                    {"title": "人员总数", "value": len(persons), "ratio": f"在岗 {active} 人"},
                    {"title": "技能类别", "value": len(self._data["skills"]), "ratio": "焊接、装配、调试等"},
                    {
                        "title": "工序模板",
                        "value": len(templates),
                        "ratio": f"启用 {sum(1 for t in templates if t['status'] == 'active')} 个",
                    },
                    {
                        "title": "进行中请假",
                        "value": len(open_leaves),
                        "ratio": f"替班记录 {len(self._data.get('substitutions') or [])} 条",
                    },
                ],
                "skills": deepcopy(self._data["skills"]),
                "resources": deepcopy(self._data["resources"]),
                "shifts": [self._enrich_shift(s) for s in (self._data.get("shifts") or [])],
                "shift_options": [
                    self._enrich_shift(s)
                    for s in (self._data.get("shifts") or [])
                    if s.get("status") == "active"
                    and self._shift_lifecycle(s)[0] in ("active", "upcoming")
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
                        "current_assignment": current_by_person.get(p["id"]),
                    }
                    for p in persons
                ],
                "templates": [
                    {
                        **t,
                        "skill_name": self._skill_map().get(t["skill_id"], {}).get("name"),
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
            # 有未关闭请假时标记人员状态，便于列表展示
            person["status"] = "leave"
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

    def upsert_person(self, payload: dict[str, Any], person_id: str | None = None) -> dict:
        with self._lock:
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
                        "resource_id": payload.get("resource_id") or person.get("resource_id"),
                        "shift_family_ids": list(
                            payload["shift_family_ids"]
                            if "shift_family_ids" in payload
                            else person.get("shift_family_ids") or []
                        ),
                    }
                )
                return deepcopy(person)
            person = {
                "id": self._next_id("person", "p"),
                "name": payload["name"],
                "code": payload["code"],
                "skill_ids": list(payload.get("skill_ids") or []),
                "status": payload.get("status") or "active",
                "resource_id": payload.get("resource_id"),
                "shift_family_ids": list(payload.get("shift_family_ids") or ["sh-day"]),
            }
            self._data["persons"].append(person)
            return deepcopy(person)

    def upsert_template(self, payload: dict[str, Any], template_id: str | None = None) -> dict:
        with self._lock:
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
                return deepcopy(tpl)
            tpl = {
                "id": self._next_id("template", "tpl"),
                "name": payload["name"],
                "std_hours": float(payload["std_hours"]),
                "skill_id": payload["skill_id"],
                "prev_template_id": payload.get("prev_template_id"),
                "status": payload.get("status") or "active",
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
            # family_id 用稳定前缀
            family_id = self._next_id("shift_family", "sh")
            # 修正 seq key - use shift_family in _seq
            ver_id = self._next_id("shift_version", "shv")
            shift = {
                "id": ver_id,
                "family_id": family_id,
                "code": code,
                "name": name,
                "version": 1,
                "start_time": start,
                "end_time": end,
                "crosses_midnight": crosses,
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

    def delete_shift_family(self, family_id: str) -> dict:
        """停用班次族：版本保留为 disabled；任职与人员能力中移除引用。"""
        with self._lock:
            family = [
                s for s in (self._data.get("shifts") or []) if s.get("family_id") == family_id
            ]
            if not family:
                raise NotFoundException("班次不存在")
            today = date.today().isoformat()
            # 若仍有未完成工序绑此班次，不允许删
            for op in self._data.get("operations") or []:
                if op.get("status") == "done":
                    continue
                if op.get("shift_family_id") == family_id:
                    raise ValidationException("仍有未完成工序使用该班次，无法删除")
                sid = op.get("shift_id")
                if sid and any(s["id"] == sid for s in family):
                    raise ValidationException("仍有未完成工序使用该班次版本，无法删除")
            for s in family:
                s["status"] = "disabled"
                if not s.get("effective_to"):
                    s["effective_to"] = today
            for p in self._data.get("persons") or []:
                ids = list(p.get("shift_family_ids") or [])
                if family_id in ids:
                    p["shift_family_ids"] = [x for x in ids if x != family_id]
            for a in self._data.get("shift_assignments") or []:
                if a.get("shift_family_id") == family_id and (a.get("status") or "open") != "closed":
                    a["status"] = "closed"
                    if not a.get("end_date"):
                        a["end_date"] = today
            return {
                "family_id": family_id,
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
            active_wos = [w for w in wos if w.get("status") != "cancelled"]
            return {
                "kpis": [
                    {
                        "title": "订单 / 任务",
                        "value": len(self._data["orders"]),
                        "ratio": f"客户 {customer_n} · 内部 {internal_n}",
                    },
                    {
                        "title": "全部工单",
                        "value": len(active_wos),
                        "ratio": f"作废 {sum(1 for w in wos if w.get('status') == 'cancelled')} 单",
                    },
                    {
                        "title": "待排产",
                        "value": sum(1 for w in active_wos if w["status"] == "pending"),
                    },
                    {
                        "title": "生产中",
                        "value": sum(1 for w in active_wos if w["status"] == "producing"),
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
                op = {
                    "id": self._next_id("operation", "op"),
                    "work_order_id": wo["id"],
                    "name": tpl["name"],
                    "seq": i,
                    "skill_id": tpl["skill_id"],
                    "resource_id": skill_to_res.get(tpl["skill_id"], "res-assembly"),
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
        ops = [o for o in self._data["operations"] if o.get("plan_start") and o["status"] != "done"]
        conflicts: list[dict] = []
        persons = self._person_map()
        skills = self._skill_map()
        resources = self._resource_map()
        orders = self._order_map()
        wos = self._wo_map()

        def base_row(op: dict) -> dict:
            _normalize_op_fields(op)
            wo = wos.get(op["work_order_id"], {})
            order = orders.get(wo.get("order_id") or "", {})
            ids = _assignee_ids_of(op)
            names = [persons[i]["name"] for i in ids if i in persons]
            return {
                "task": op["name"],
                "op_id": op["id"],
                "order_code": order.get("code"),
                "order_name": order.get("name"),
                "work_order_code": wo.get("code"),
                "work_order_name": wo.get("name"),
                "resource_name": resources.get(op.get("resource_id") or "", {}).get("name"),
                "assignee_name": "、".join(names) if names else None,
                "plan_window": (
                    f"{op['plan_start'][5:]} ~ {op['plan_end'][5:]}"
                    f" · {SLOT_LABEL.get(op.get('slot') or 'full', '全天')}"
                ),
                "due_date": (self._effective_due(wo, order) or "")[5:] or None,
            }

        # 1) 同一班组时间重叠
        by_res: dict[str, list[dict]] = {}
        for op in ops:
            by_res.setdefault(op["resource_id"], []).append(op)

        for res_id, group in by_res.items():
            group = sorted(group, key=lambda o: o["plan_start"])
            res_name = resources.get(res_id, {}).get("name", res_id)
            for i, a in enumerate(group):
                for b in group[i + 1 :]:
                    a_start, a_end = _parse(a["plan_start"]), _parse(a["plan_end"])
                    b_start, b_end = _parse(b["plan_start"]), _parse(b["plan_end"])
                    if a_end < b_start or b_end < a_start:
                        continue
                    overlap_start = max(a_start, b_start)
                    overlap_end = min(a_end, b_end)
                    overlap_days = (overlap_end - overlap_start).days + 1
                    wa = wos.get(a["work_order_id"], {})
                    wb = wos.get(b["work_order_id"], {})
                    pa = PRIORITY_RANK.get(wa.get("priority", "normal"), 9)
                    pb = PRIORITY_RANK.get(wb.get("priority", "normal"), 9)
                    if pa < pb:
                        keep, move = a, b
                    elif pb < pa:
                        keep, move = b, a
                    else:
                        keep, move = (a, b) if a.get("is_insert") else (b, a)
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
                                f"占用，重叠 {overlap_days} 天"
                            ),
                            "impact": (
                                f"影响工单 {wa.get('code', '')} 与 {wb.get('code', '')}；"
                                f"建议保留优先级更高的「{keep['name']}」，将「{move['name']}」后移"
                            ),
                            "suggestion": (
                                f"一键后移「{move['name']}」到 {suggest_start[5:]}，或点重排"
                            ),
                            "status": "conflict",
                            "quick_action": "defer",
                            "action_op_id": move["id"],
                            "suggest_start": suggest_start,
                        }
                    )

        # 2) 同责任人时间重叠（人有多技能 / 多订单时更常见）
        by_person: dict[str, list[dict]] = {}
        for op in ops:
            for pid in _assignee_ids_of(op):
                by_person.setdefault(pid, []).append(op)
        for pid, group in by_person.items():
            group = sorted(group, key=lambda o: (o["plan_start"], o.get("slot") or "full"))
            pname = persons.get(pid, {}).get("name", pid)
            for i, a in enumerate(group):
                for b in group[i + 1 :]:
                    a_start, a_end = _parse(a["plan_start"]), _parse(a["plan_end"])
                    b_start, b_end = _parse(b["plan_start"]), _parse(b["plan_end"])
                    if a_end < b_start or b_end < a_start:
                        continue
                    if not self._ops_shift_overlap(a, b):
                        continue
                    # 同一订单内同日并行允许，仅提示跨订单
                    wa = wos.get(a["work_order_id"], {})
                    wb = wos.get(b["work_order_id"], {})
                    if wa.get("order_id") and wa.get("order_id") == wb.get("order_id"):
                        continue
                    overlap_start = max(a_start, b_start)
                    overlap_end = min(a_end, b_end)
                    overlap_days = (overlap_end - overlap_start).days + 1
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
                                f"责任人「{pname}」在同一时段既要做「{a['name']}」"
                                f"（{SLOT_LABEL.get(a.get('slot') or 'full')}）又要做「{b['name']}」"
                                f"（{SLOT_LABEL.get(b.get('slot') or 'full')}），跨订单冲突"
                            ),
                            "impact": "现场无法并行，两道工序至少有一道会拖延",
                            "suggestion": f"改派其中一道，或一键后移「{b['name']}」",
                            "status": "conflict",
                            "quick_action": "defer",
                            "action_op_id": b["id"],
                            "suggest_start": max(
                                _parse(a["plan_end"]) + timedelta(days=1),
                                _planning_today(),
                            ).isoformat(),
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

        # 冲突优先、再缺编、再请假、再风险、再延期
        rank = {"conflict": 0, "staffing": 1, "leave": 2, "risk": 3, "delay": 4}
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

    def _auto_staff_op_unlocked(
        self,
        op: dict,
        *,
        reserved_by_person: dict[str, set[str]] | None = None,
    ) -> None:
        """
        按 required_headcount 自动派人。
        配不齐时：责任人全部空着（不写半套人），并标注 staffing_gap。
        """
        _normalize_op_fields(op)
        # 落到当前生效班次版本
        shift = self._resolve_op_shift(op)
        if shift:
            op["shift_id"] = shift["id"]
            op["shift_family_id"] = shift["family_id"]
        need = int(op.get("required_headcount") or 1)
        skill_id = op.get("skill_id")
        fam = op.get("shift_family_id") or (shift or {}).get("family_id")
        candidates = []
        for p in self._data["persons"]:
            if p.get("status") != "active":
                continue
            if skill_id and skill_id not in (p.get("skill_ids") or []):
                continue
            if not self._person_matches_shift_on_op_unlocked(p, op, fam):
                continue
            candidates.append(p)
        # 同班组优先
        res_id = op.get("resource_id")
        candidates.sort(
            key=lambda p: (0 if p.get("resource_id") == res_id else 1, p.get("code") or p["id"])
        )

        picked: list[str] = []
        for person in candidates:
            if len(picked) >= need:
                break
            pid = person["id"]
            if not self._person_free_for_op_unlocked(
                pid, op, reserved=reserved_by_person
            ):
                continue
            picked.append(pid)

        if len(picked) >= need:
            op["assignee_ids"] = picked[:need]
            op["assignee_id"] = picked[0]
            op["staffing_gap"] = 0
            if reserved_by_person is not None and op.get("plan_start") and op.get("plan_end"):
                for i in range(_duration_days(op["plan_start"], op["plan_end"])):
                    day = _add_days(op["plan_start"], i)
                    reserved_by_person.setdefault(day, set()).update(picked[:need])
        else:
            # 分不开：空岗，只留工序，标注缺几人
            gap = need - len(picked)
            op["assignee_ids"] = []
            op["assignee_id"] = None
            op["staffing_gap"] = gap
        _normalize_op_fields(op)

    def _gantt_axis_unlocked(self, *, horizon: str = "focus") -> tuple[list[str], dict[str, Any]]:
        """
        甘特日期轴：默认从「今天-3」起，而不是最早历史计划日。
        - focus：向后至少约四周，覆盖近期未完工，最长今天+90
        - all：右端拉到全部未完工计划结束（左端仍不回到去年）
        """
        today = _planning_today()
        start = today - timedelta(days=GANTT_LOOKBACK_DAYS)
        end = today + timedelta(days=GANTT_DEFAULT_AHEAD_DAYS)
        mode = (horizon or "focus").strip().lower()
        if mode not in ("focus", "all"):
            mode = "focus"

        cancelled = self._cancelled_work_order_ids()
        for o in self._data["operations"]:
            if o.get("status") in ("done", "cancelled"):
                continue
            if o.get("work_order_id") in cancelled:
                continue
            if not o.get("plan_start") or not o.get("plan_end"):
                continue
            pe = _parse(o["plan_end"][:10])
            if pe >= start:
                end = max(end, pe)

        for order in self._data["orders"]:
            if order.get("status") in ("done", "cancelled"):
                continue
            due = (order.get("due_date") or "")[:10]
            if due:
                dd = _parse(due)
                if dd >= start:
                    end = max(end, dd)

        hard_cap = today + timedelta(days=GANTT_MAX_AHEAD_DAYS)
        clipped = False
        if mode == "focus" and end > hard_cap:
            end = hard_cap
            clipped = True

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
            "clipped": clipped,
            "hint": (
                "每单两行：上=计划（可调），下=实绩（签字后写入，只读）。"
                + (" 更远计划可切换「看全未完成」。" if clipped else "")
            ),
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
                        if start == end:
                            segment = "single"
                        elif day == start:
                            segment = "start"
                        elif day == end:
                            segment = "end"
                        elif day == axis_start and start < axis_start:
                            segment = "mid"
                        else:
                            segment = "mid"
                        cells[day].append(
                            {
                                **op,
                                "segment": segment,
                                "continues_left": bool(start < axis_start and day == axis_start),
                                "busy_hints": self._person_busy_hints(op, day),
                                "bar_start": start,
                                "bar_end": end,
                            }
                        )
                    cur += timedelta(days=1)
        for d in dates:
            cells[d].sort(
                key=lambda o: (
                    {"am": 0, "full": 1, "pm": 2}.get(o.get("slot") or "full", 1),
                    o.get("seq") or 0,
                    (o.get("bar_start") or ""),
                )
            )
        return cells

    def gantt_overview_unlocked(self, *, horizon: str = "focus") -> dict[str, Any]:
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
        insert_order_ids = {
            o.get("order_id")
            for o in active_ops
            if o.get("is_insert") and o.get("order_id")
        }
        delayed_order_ids = set()
        for o in active_ops:
            if int(o.get("delay_days") or 0) > 0 and o.get("order_id"):
                delayed_order_ids.add(o["order_id"])
        insert_n = len(insert_order_ids)
        delay_n = len(delayed_order_ids)
        insert_ops_n = sum(1 for o in active_ops if o.get("is_insert"))
        delay_ops_n = sum(1 for o in active_ops if int(o.get("delay_days") or 0) > 0)

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

        return {
            "kpis": [
                {"title": "订单行", "value": len(rows)},
                {"title": "未完成工序", "value": len(active_ops)},
                {
                    "title": "插队订单",
                    "value": insert_n,
                    "ratio": f"{insert_ops_n} 道工序" if insert_ops_n else None,
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
            "resources": deepcopy(self._data["resources"]),
            "shift_options": [
                self._enrich_shift(s)
                for s in (self._data.get("shifts") or [])
                if s.get("status") == "active"
            ],
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
        cascade: bool = True,
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
                cascade=cascade,
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
        cascade: bool = True,
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

        if hours_per_day is not None:
            op["hours_per_day"] = float(hours_per_day)

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
        _normalize_op_fields(op)

        if cascade:
            self._cascade_successors_unlocked(op_id)

        enriched = self._enrich_op(op)
        enriched["busy_hints"] = self._person_busy_hints(op, op["plan_start"][:10])
        return enriched

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
            # 先收集甘特上已有占用，避免和新排工序抢人
            for other in self._data["operations"]:
                if other.get("status") == "done" or not other.get("plan_start"):
                    continue
                if other["id"] in {o["id"] for o in ops}:
                    continue
                for pid in _assignee_ids_of(other):
                    for i in range(
                        _duration_days(other["plan_start"], other["plan_end"] or other["plan_start"])
                    ):
                        day = _add_days(other["plan_start"], i)
                        reserved.setdefault(day, set()).add(pid)

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
        cascade: bool = True,
    ) -> dict:
        with self._lock:
            before, after = self._preview_on_copy(
                lambda: self._move_task_unlocked(
                    op_id,
                    plan_start,
                    slot=slot,
                    shift_id=shift_id,
                    assignee_ids=assignee_ids,
                    duration_days=duration_days,
                    plan_segments=plan_segments,
                    hours_per_day=hours_per_day,
                    cascade=cascade,
                )
            )
            report = self._build_impact_report(before, after, action="move")
            report["can_apply"] = True
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
        """人员 × 日期负荷：0 空闲 / 1 满 / >1 超载。默认与甘特视窗对齐。"""
        if not dates:
            dates, _ = self._gantt_axis_unlocked(horizon="focus")

        persons = [p for p in self._data["persons"] if p.get("status") == "active"]
        # person_id -> date -> load count
        load: dict[str, dict[str, float]] = {p["id"]: {d: 0.0 for d in dates} for p in persons}
        detail: dict[str, dict[str, list]] = {p["id"]: {d: [] for d in dates} for p in persons}

        date_set = set(dates)
        for op in self._data["operations"]:
            if op.get("status") == "done" or not op.get("plan_start"):
                continue
            slot = op.get("slot") or "full"
            weight = 1.0 if slot == "full" else 0.5
            for pid in _assignee_ids_of(op):
                if pid not in load:
                    continue
                for i in range(_duration_days(op["plan_start"], op["plan_end"] or op["plan_start"])):
                    day = _add_days(op["plan_start"], i)
                    if day not in load[pid]:
                        continue
                    load[pid][day] += weight
                    detail[pid][day].append(op["name"])

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
                f"{len(persons)} 人 × {len(dates)} 天"
                + (f"，超载格 {overload_days} 个" if overload_days else "，暂无超载")
            ),
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


store = SchedulingStore()
