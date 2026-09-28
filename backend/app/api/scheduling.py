"""生产排产 MVP API：快照落库，重启保留；POST /reset 可还原演示 seed。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from app.auth.deps import get_current_user
from app.core.response import ok
from app.scheduling.store import store

router = APIRouter(prefix="/scheduling", tags=["生产排产"])


class PersonUpsert(BaseModel):
    name: str
    code: str
    skill_ids: list[str] = Field(default_factory=list)
    status: str | None = "active"
    resource_id: str | None = None
    shift_family_ids: list[str] = Field(default_factory=list)


class TemplateUpsert(BaseModel):
    name: str
    std_hours: float = 1.0
    skill_id: str
    prev_template_id: str | None = None
    status: str | None = "active"


class ShiftCreate(BaseModel):
    code: str
    name: str
    start_time: str = "08:00"
    end_time: str = "16:00"
    crosses_midnight: bool | None = None
    effective_from: str | None = None
    effective_to: str | None = None
    note: str | None = None


class ShiftPublish(BaseModel):
    code: str | None = None
    name: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    crosses_midnight: bool | None = None
    effective_from: str | None = None
    effective_to: str | None = None
    note: str | None = None


class ShiftAssignmentCreate(BaseModel):
    person_id: str
    shift_family_id: str
    start_date: str
    end_date: str | None = None
    kind: str | None = "roster"
    note: str | None = None


class ShiftAssignmentClose(BaseModel):
    end_date: str | None = None


class WorkOrderCreate(BaseModel):
    name: str
    product: str | None = ""
    due_date: str
    priority: str = "normal"
    # normal | rework | add_ops | repair
    wo_kind: str = "normal"
    template_ids: list[str] | None = None
    # 每道工序：模板 + 预计天数 + 每天人数
    op_specs: list[dict] | None = None
    # 挂已有订单；为空则按 source_type 自动创建客户订单或内部生产任务
    order_id: str | None = None
    source_type: str = "internal"  # customer | internal
    order_name: str | None = None
    customer_name: str | None = None


class WorkOrderUpdate(BaseModel):
    name: str | None = None
    product: str | None = None
    due_date: str | None = None
    priority: str | None = None
    wo_kind: str | None = None
    status: str | None = None


class MoveTaskBody(BaseModel):
    plan_start: str
    slot: str | None = None  # full | am | pm（兼容）
    shift_id: str | None = None  # 班次版本 id（优先）
    assignee_ids: list[str] | None = None
    duration_days: int | None = None
    plan_segments: list[dict] | None = None
    hours_per_day: float | None = None
    cascade: bool = True


class ScheduleOrderBody(BaseModel):
    order_id: str
    plan_start: str | None = None
    # 滚动细排窗口：7/14/30；0=一次释放全部剩余工序
    horizon_days: int | None = 14


class PauseBody(BaseModel):
    reason: str | None = None


class LeaveCreate(BaseModel):
    person_id: str
    start_date: str
    end_date: str | None = None
    reason: str | None = "事假"


class ReassignLeaveBody(BaseModel):
    op_id: str
    assignee_ids: list[str] = Field(default_factory=list)
    leave_id: str | None = None
    note: str | None = None


@router.post("/reset")
async def reset_demo(request: Request, _user=Depends(get_current_user)):
    """恢复演示排产：按今天重铺任务进度与排班故事，保留人员等主数据。"""
    return ok(request, store.reset())


@router.get("/master")
async def master_data(request: Request, _user=Depends(get_current_user)):
    return ok(request, store.master_overview())


@router.post("/leaves")
async def create_leave(payload: LeaveCreate, request: Request, _user=Depends(get_current_user)):
    data = payload.model_dump()
    if not data.get("end_date"):
        data["end_date"] = data["start_date"]
    return ok(request, store.create_leave(data))


@router.post("/leaves/{leave_id}/close")
async def close_leave(leave_id: str, request: Request, _user=Depends(get_current_user)):
    return ok(request, store.close_leave(leave_id))


@router.post("/leaves/reassign")
async def reassign_for_leave(
    payload: ReassignLeaveBody, request: Request, _user=Depends(get_current_user)
):
    return ok(request, store.reassign_for_leave(payload.model_dump()))


@router.post("/persons")
async def create_person(payload: PersonUpsert, request: Request, _user=Depends(get_current_user)):
    return ok(request, store.upsert_person(payload.model_dump()))


@router.put("/persons/{person_id}")
async def update_person(
    person_id: str, payload: PersonUpsert, request: Request, _user=Depends(get_current_user)
):
    return ok(request, store.upsert_person(payload.model_dump(), person_id))


@router.post("/shifts")
async def create_shift(payload: ShiftCreate, request: Request, _user=Depends(get_current_user)):
    return ok(request, store.create_shift(payload.model_dump()))


@router.post("/shifts/{family_id}/versions")
async def publish_shift_version(
    family_id: str, payload: ShiftPublish, request: Request, _user=Depends(get_current_user)
):
    return ok(request, store.publish_shift_version(family_id, payload.model_dump(exclude_none=True)))


@router.get("/shifts/{family_id}/history")
async def shift_history(family_id: str, request: Request, _user=Depends(get_current_user)):
    return ok(request, store.list_shift_history(family_id))


@router.delete("/shifts/{family_id}")
async def delete_shift(family_id: str, request: Request, _user=Depends(get_current_user)):
    return ok(request, store.delete_shift_family(family_id))


@router.post("/shift-assignments")
async def create_shift_assignment(
    payload: ShiftAssignmentCreate, request: Request, _user=Depends(get_current_user)
):
    return ok(request, store.create_shift_assignment(payload.model_dump()))


@router.post("/shift-assignments/{assignment_id}/close")
async def close_shift_assignment(
    assignment_id: str,
    payload: ShiftAssignmentClose,
    request: Request,
    _user=Depends(get_current_user),
):
    return ok(
        request,
        store.close_shift_assignment(assignment_id, end_date=payload.end_date),
    )


@router.delete("/shift-assignments/{assignment_id}")
async def delete_shift_assignment(
    assignment_id: str, request: Request, _user=Depends(get_current_user)
):
    return ok(request, store.delete_shift_assignment(assignment_id))


@router.post("/templates")
async def create_template(payload: TemplateUpsert, request: Request, _user=Depends(get_current_user)):
    return ok(request, store.upsert_template(payload.model_dump()))


@router.put("/templates/{template_id}")
async def update_template(
    template_id: str, payload: TemplateUpsert, request: Request, _user=Depends(get_current_user)
):
    return ok(request, store.upsert_template(payload.model_dump(), template_id))


@router.get("/work-orders")
async def list_work_orders(request: Request, _user=Depends(get_current_user)):
    return ok(request, store.work_orders_overview())


@router.post("/work-orders")
async def create_work_order(
    payload: WorkOrderCreate, request: Request, _user=Depends(get_current_user)
):
    return ok(request, store.create_work_order(payload.model_dump()))


@router.put("/work-orders/{wo_id}")
async def update_work_order(
    wo_id: str, payload: WorkOrderUpdate, request: Request, _user=Depends(get_current_user)
):
    return ok(request, store.update_work_order(wo_id, payload.model_dump(exclude_none=True)))


@router.post("/work-orders/{wo_id}/cancel")
async def cancel_work_order(wo_id: str, request: Request, _user=Depends(get_current_user)):
    return ok(request, store.cancel_work_order(wo_id))


@router.delete("/work-orders/{wo_id}")
async def delete_work_order(wo_id: str, request: Request, _user=Depends(get_current_user)):
    return ok(request, store.delete_work_order(wo_id))


@router.get("/gantt")
async def gantt(
    request: Request,
    horizon: str = "focus",
    _user=Depends(get_current_user),
):
    """horizon=focus 以今天为中心；all 右端拉满未完工计划。"""
    return ok(request, store.gantt_overview(horizon=horizon))


class ReplanBody(BaseModel):
    strategy: str = "priority"  # priority | due_date | protect_due
    scope: str = "gantt"  # gantt | all


@router.post("/gantt/replan")
async def gantt_replan(
    request: Request, payload: ReplanBody = ReplanBody(), _user=Depends(get_current_user)
):
    return ok(
        request,
        store.replan(
            strategy=payload.strategy or "priority",
            scope=payload.scope or "gantt",
        ),
    )


@router.post("/gantt/preview/replan")
async def preview_replan(
    request: Request, payload: ReplanBody = ReplanBody(), _user=Depends(get_current_user)
):
    return ok(
        request,
        store.preview_replan(
            strategy=payload.strategy or "priority",
            scope=payload.scope or "gantt",
        ),
    )


@router.delete("/orders/{order_id}")
async def delete_order(order_id: str, request: Request, _user=Depends(get_current_user)):
    """甘特误录：无实绩则删除；有进行中/已完工则作废并撤出排产。"""
    return ok(request, store.remove_order(order_id))


@router.post("/gantt/undo")
async def gantt_undo(request: Request, _user=Depends(get_current_user)):
    return ok(request, store.undo())


@router.post("/gantt/redo")
async def gantt_redo(request: Request, _user=Depends(get_current_user)):
    return ok(request, store.redo())


class BusyAckBody(BaseModel):
    other_op_id: str | None = None
    person_id: str | None = None
    note: str | None = None


class ResolveVarianceBody(BaseModel):
    action: str  # keep | adopt_actual | cascade_successors
    note: str | None = None
    cascade: bool = True


@router.put("/gantt/tasks/{op_id}")
async def move_task(
    op_id: str, payload: MoveTaskBody, request: Request, _user=Depends(get_current_user)
):
    return ok(
        request,
        store.move_task(
            op_id,
            payload.plan_start,
            slot=payload.slot,
            shift_id=payload.shift_id,
            assignee_ids=payload.assignee_ids,
            duration_days=payload.duration_days,
            plan_segments=payload.plan_segments,
            hours_per_day=payload.hours_per_day,
            cascade=payload.cascade,
        ),
    )


@router.post("/gantt/tasks/{op_id}/ack-busy")
async def ack_busy(
    op_id: str, payload: BusyAckBody, request: Request, _user=Depends(get_current_user)
):
    """确认同人多单并行合理：降级 busy 提示并留痕。"""
    return ok(
        request,
        store.acknowledge_busy(
            op_id,
            other_op_id=payload.other_op_id,
            person_id=payload.person_id,
            note=payload.note,
        ),
    )


@router.post("/gantt/tasks/{op_id}/resolve-variance")
async def resolve_variance(
    op_id: str, payload: ResolveVarianceBody, request: Request, _user=Depends(get_current_user)
):
    """计划/实绩偏差处置：保持计划 / 跟实现 / 顺延后置。"""
    return ok(
        request,
        store.resolve_plan_variance(
            op_id,
            action=payload.action,
            note=payload.note,
            cascade=payload.cascade,
        ),
    )


@router.post("/gantt/preview/move/{op_id}")
async def preview_move_task(
    op_id: str, payload: MoveTaskBody, request: Request, _user=Depends(get_current_user)
):
    return ok(
        request,
        store.preview_move_task(
            op_id,
            payload.plan_start,
            slot=payload.slot,
            shift_id=payload.shift_id,
            assignee_ids=payload.assignee_ids,
            duration_days=payload.duration_days,
            plan_segments=payload.plan_segments,
            hours_per_day=payload.hours_per_day,
            cascade=payload.cascade,
        ),
    )


@router.post("/gantt/schedule")
async def schedule_order(
    payload: ScheduleOrderBody, request: Request, _user=Depends(get_current_user)
):
    return ok(request, store.schedule_order_ops(payload.model_dump(exclude_none=True)))


@router.post("/gantt/preview/schedule")
async def preview_schedule_order(
    payload: ScheduleOrderBody, request: Request, _user=Depends(get_current_user)
):
    return ok(request, store.preview_schedule_order(payload.model_dump(exclude_none=True)))


@router.post("/gantt/sandbox/enter")
async def sandbox_enter(request: Request, _user=Depends(get_current_user)):
    return ok(request, store.sandbox_enter())


@router.post("/gantt/sandbox/discard")
async def sandbox_discard(request: Request, _user=Depends(get_current_user)):
    return ok(request, store.sandbox_discard())


@router.post("/gantt/sandbox/publish")
async def sandbox_publish(request: Request, _user=Depends(get_current_user)):
    return ok(request, store.sandbox_publish())


@router.delete("/gantt/tasks/{op_id}")
async def delete_gantt_task(
    op_id: str,
    request: Request,
    force: bool = Query(False),
    _user=Depends(get_current_user),
):
    return ok(request, store.delete_gantt_task(op_id, force=force))


class DailyLogBody(BaseModel):
    op_id: str
    person_id: str
    work_date: str | None = None
    hours: float = 0
    progress: int
    work_content: str | None = None
    note: str | None = None
    signature_data: str | None = None


@router.get("/report")
async def report(
    request: Request,
    person_id: str | None = Query(None),
    work_date: str | None = Query(None),
    _user=Depends(get_current_user),
):
    return ok(request, store.report_overview(person_id=person_id, work_date=work_date))


@router.post("/report/daily-log")
async def submit_daily_log(payload: DailyLogBody, request: Request, _user=Depends(get_current_user)):
    return ok(request, store.submit_daily_log(payload.model_dump()))


@router.delete("/report/daily-log/{log_id}")
async def delete_daily_log(log_id: str, request: Request, _user=Depends(get_current_user)):
    return ok(request, store.delete_daily_log(log_id))


@router.post("/report/{op_id}/start")
async def start_op(op_id: str, request: Request, _user=Depends(get_current_user)):
    return ok(request, store.start_op(op_id))


@router.post("/report/{op_id}/finish")
async def finish_op(op_id: str, request: Request, _user=Depends(get_current_user)):
    return ok(request, store.finish_op(op_id))


@router.post("/report/{op_id}/pause")
async def pause_op(
    op_id: str, payload: PauseBody, request: Request, _user=Depends(get_current_user)
):
    return ok(request, store.pause_op(op_id, payload.reason))
