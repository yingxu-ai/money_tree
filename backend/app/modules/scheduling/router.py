"""生产排产 API：按租户隔离快照，重启保留。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from app.auth.context import CurrentUser
from app.auth.deps import get_current_user, require_permission
from app.core.response import ok
from app.modules.scheduling.store import SchedulingStore, get_store


def _store(current: CurrentUser = Depends(get_current_user)) -> SchedulingStore:
    return get_store(current.effective_tenant_id)

router = APIRouter(prefix="/scheduling", tags=["生产排产"])


class PersonUpsert(BaseModel):
    name: str
    code: str
    skill_ids: list[str] = Field(default_factory=list)
    status: str | None = "active"
    resource_id: str | None = None
    shift_family_ids: list[str] = Field(default_factory=list)


class ResourceUpsert(BaseModel):
    name: str
    code: str
    status: str | None = "active"
    sort: int | None = None


class SkillUpsert(BaseModel):
    name: str
    code: str
    status: str | None = "active"
    sort: int | None = None


class ResourceDeleteBody(BaseModel):
    migrate_to: str | None = None


class TemplateUpsert(BaseModel):
    name: str
    std_hours: float = 1.0
    skill_id: str
    prev_template_id: str | None = None
    status: str | None = "active"
    equipment_ids: list[str] | None = None


class ShiftCreate(BaseModel):
    code: str
    name: str
    start_time: str = "08:00"
    end_time: str = "16:00"
    crosses_midnight: bool | None = None
    # start_day=开班日；previous_day=前一日（凌晨接续班跟首班生产日）
    belong_day_rule: str | None = "start_day"
    effective_from: str | None = None
    effective_to: str | None = None
    note: str | None = None


class ShiftPublish(BaseModel):
    code: str | None = None
    name: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    crosses_midnight: bool | None = None
    belong_day_rule: str | None = None
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


class RosterGenerate(BaseModel):
    week_start: str | None = None
    person_ids: list[str] | None = None
    family_ids: list[str] | None = None


class RosterAssign(BaseModel):
    start_date: str
    end_date: str
    shift_family_id: str
    person_ids: list[str]
    note: str | None = None
    week_start: str | None = None


class RosterRotate(BaseModel):
    week_start: str | None = None
    effective_from: str | None = None
    end_date: str | None = None
    person_ids: list[str] | None = None
    family_ids: list[str] | None = None
    # 三班倒自定义：{ 旧班 family_id: 新班 family_id }；两班倒可空（自动对换）
    mapping: dict[str, str] | None = None


class RosterDaySet(BaseModel):
    person_id: str
    day: str
    shift_family_id: str | None = None
    note: str | None = None


class WorkOrderCreate(BaseModel):
    name: str
    product: str | None = ""
    due_date: str
    priority: str = "normal"
    # 预设或手工新增的工单类型
    wo_kind: str = "normal"
    code: str | None = None
    order_code: str | None = None
    template_ids: list[str] | None = None
    # 每道工序：模板 + 预计天数 + 每天人数
    op_specs: list[dict] | None = None
    # 挂已有订单；为空则按订单号/来源自动创建
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
    equipment_id: str | None = None
    clear_equipment: bool = False
    cascade: bool = True
    # 按排班重解析各日责任人（拖拽换班/整段平移）
    resolve_roster: bool = False
    # 仅补空人的日（拉宽新增格）；与 resolve_roster 同时为真时以 resolve 为准
    only_fill_empty: bool = False
    required_headcount: int | None = None
    # 保存时按负荷重选设备（忽略原机台）
    auto_equipment: bool = False


class EquipmentUpsert(BaseModel):
    name: str
    code: str
    status: str | None = "active"
    sort: int | None = None
    resource_id: str | None = None


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
async def reset_baseline(
    request: Request,
    _user=Depends(require_permission("scheduling:baseline:restore")),
    store: SchedulingStore = Depends(_store),
):
    """将当前租户的排产数据恢复为内置测试种子（仅影响本租户快照）。"""
    return ok(request, store.reset())


@router.get("/master")
async def master_data(request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.master_overview())


@router.post("/leaves")
async def create_leave(payload: LeaveCreate, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    data = payload.model_dump()
    if not data.get("end_date"):
        data["end_date"] = data["start_date"]
    return ok(request, store.create_leave(data))


@router.post("/leaves/{leave_id}/close")
async def close_leave(leave_id: str, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.close_leave(leave_id))


@router.post("/leaves/reassign")
async def reassign_for_leave(
    payload: ReassignLeaveBody, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.reassign_for_leave(payload.model_dump()))


@router.post("/resources")
async def create_resource(
    payload: ResourceUpsert, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)
):
    return ok(request, store.upsert_resource(payload.model_dump()))


@router.put("/resources/{resource_id}")
async def update_resource(
    resource_id: str,
    payload: ResourceUpsert,
    request: Request,
    _user=Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    return ok(request, store.upsert_resource(payload.model_dump(), resource_id))


@router.delete("/resources/{resource_id}")
async def delete_resource(
    resource_id: str,
    request: Request,
    migrate_to: str | None = Query(None, description="有人员时迁往的目标班组"),
    _user=Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    return ok(request, store.delete_resource(resource_id, migrate_to=migrate_to))


@router.post("/skills")
async def create_skill(
    payload: SkillUpsert, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)
):
    return ok(request, store.upsert_skill(payload.model_dump()))


@router.put("/skills/{skill_id}")
async def update_skill(
    skill_id: str,
    payload: SkillUpsert,
    request: Request,
    _user=Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    return ok(request, store.upsert_skill(payload.model_dump(), skill_id))


@router.delete("/skills/{skill_id}")
async def delete_skill(
    skill_id: str,
    request: Request,
    migrate_to: str | None = Query(None, description="有引用时迁往的目标技能"),
    _user=Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    return ok(request, store.delete_skill(skill_id, migrate_to=migrate_to))


@router.post("/equipments")
async def create_equipment(
    payload: EquipmentUpsert, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)
):
    return ok(request, store.upsert_equipment(payload.model_dump()))


@router.put("/equipments/{equipment_id}")
async def update_equipment(
    equipment_id: str,
    payload: EquipmentUpsert,
    request: Request,
    _user=Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    return ok(request, store.upsert_equipment(payload.model_dump(), equipment_id))


@router.delete("/equipments/{equipment_id}")
async def delete_equipment(
    equipment_id: str,
    request: Request,
    migrate_to: str | None = Query(None, description="有工序占用时迁往的目标设备"),
    _user=Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    return ok(request, store.delete_equipment(equipment_id, migrate_to=migrate_to))


@router.post("/persons")
async def create_person(payload: PersonUpsert, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.upsert_person(payload.model_dump()))


@router.put("/persons/{person_id}")
async def update_person(
    person_id: str, payload: PersonUpsert, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.upsert_person(payload.model_dump(), person_id))


@router.post("/shifts")
async def create_shift(payload: ShiftCreate, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.create_shift(payload.model_dump()))


class ShiftReorder(BaseModel):
    family_ids: list[str] = Field(default_factory=list)


@router.post("/shifts/reorder")
async def reorder_shifts(payload: ShiftReorder, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    """调整班序：甘特一天 N 段顺序与排产/轮换共用。"""
    return ok(request, store.reorder_shift_families(payload.family_ids))


@router.post("/shifts/{family_id}/versions")
async def publish_shift_version(
    family_id: str, payload: ShiftPublish, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.publish_shift_version(family_id, payload.model_dump(exclude_none=True)))


@router.get("/shifts/{family_id}/history")
async def shift_history(family_id: str, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.list_shift_history(family_id))


class ShiftDisable(BaseModel):
    migrate_to_family_id: str | None = None


@router.get("/shifts/{family_id}/usage")
async def shift_usage(family_id: str, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.shift_family_usage(family_id))


@router.post("/shifts/{family_id}/disable")
async def disable_shift(
    family_id: str, payload: ShiftDisable, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(
        request,
        store.delete_shift_family(family_id, migrate_to_family_id=payload.migrate_to_family_id),
    )


@router.delete("/shifts/{family_id}")
async def delete_shift(
    family_id: str,
    request: Request,
    migrate_to_family_id: str | None = Query(None),
    _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(
        request,
        store.delete_shift_family(family_id, migrate_to_family_id=migrate_to_family_id),
    )

@router.post("/shift-assignments")
async def create_shift_assignment(
    payload: ShiftAssignmentCreate, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.create_shift_assignment(payload.model_dump()))


@router.post("/shift-assignments/{assignment_id}/close")
async def close_shift_assignment(
    assignment_id: str,
    payload: ShiftAssignmentClose,
    request: Request,
    _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(
        request,
        store.close_shift_assignment(assignment_id, end_date=payload.end_date),
    )


@router.delete("/shift-assignments/{assignment_id}")
async def delete_shift_assignment(
    assignment_id: str, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.delete_shift_assignment(assignment_id))


@router.get("/roster/week")
async def roster_week(
    request: Request,
    week_start: str | None = Query(None),
    _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.roster_week(week_start))


@router.get("/roster/analysis")
async def roster_analysis(
    request: Request,
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.roster_headcount_analysis(start_date, end_date))


@router.post("/roster/generate")
async def generate_roster(
    payload: RosterGenerate, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.generate_three_shift_roster(payload.model_dump()))


@router.post("/roster/assign")
async def assign_roster(
    payload: RosterAssign, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.assign_roster_batch(payload.model_dump()))


@router.post("/roster/rotate")
async def rotate_roster(
    payload: RosterRotate, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.rotate_roster(payload.model_dump()))


@router.post("/roster/day")
async def set_roster_day(
    payload: RosterDaySet, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.set_roster_day(payload.model_dump()))


@router.post("/templates")
async def create_template(payload: TemplateUpsert, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.upsert_template(payload.model_dump()))


@router.put("/templates/{template_id}")
async def update_template(
    template_id: str, payload: TemplateUpsert, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.upsert_template(payload.model_dump(), template_id))


@router.get("/work-orders")
async def list_work_orders(request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.work_orders_overview())


def _actor_name(user: CurrentUser) -> str:
    return (user.user.display_name or user.user.username or "").strip() or "系统"


@router.post("/work-orders")
async def create_work_order(
    payload: WorkOrderCreate,
    request: Request,
    _user: CurrentUser = Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    body = payload.model_dump()
    body["created_by"] = _actor_name(_user)
    body["updated_by"] = body["created_by"]
    return ok(request, store.create_work_order(body))


@router.put("/work-orders/{wo_id}")
async def update_work_order(
    wo_id: str,
    payload: WorkOrderUpdate,
    request: Request,
    _user: CurrentUser = Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    body = payload.model_dump(exclude_none=True)
    body["updated_by"] = _actor_name(_user)
    return ok(request, store.update_work_order(wo_id, body))


@router.post("/work-orders/{wo_id}/cancel")
async def cancel_work_order(wo_id: str, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.cancel_work_order(wo_id))


@router.delete("/work-orders/{wo_id}")
async def delete_work_order(wo_id: str, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.delete_work_order(wo_id))


@router.get("/gantt")
async def gantt(
    request: Request,
    horizon: str = "all",
    _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    """默认 all：当天起右端跟到未完工计划结束；focus 为近景裁剪。"""
    return ok(request, store.gantt_overview(horizon=horizon))


class ReplanBody(BaseModel):
    strategy: str = "priority"  # priority | due_date | protect_due
    scope: str = "gantt"  # gantt | all


@router.post("/gantt/replan")
async def gantt_replan(
    request: Request, payload: ReplanBody = ReplanBody(), _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(
        request,
        store.replan(
            strategy=payload.strategy or "priority",
            scope=payload.scope or "gantt",
        ),
    )


@router.post("/gantt/preview/replan")
async def preview_replan(
    request: Request, payload: ReplanBody = ReplanBody(), _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(
        request,
        store.preview_replan(
            strategy=payload.strategy or "priority",
            scope=payload.scope or "gantt",
        ),
    )


@router.delete("/orders/{order_id}")
async def delete_order(order_id: str, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    """甘特误录：无实绩则删除；有进行中/已完工则作废并撤出排产。"""
    return ok(request, store.remove_order(order_id))


@router.post("/gantt/undo")
async def gantt_undo(request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.undo())


@router.post("/gantt/redo")
async def gantt_redo(request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
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
    op_id: str, payload: MoveTaskBody, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
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
            equipment_id=payload.equipment_id,
            clear_equipment=payload.clear_equipment,
            cascade=payload.cascade,
            resolve_roster=payload.resolve_roster,
            only_fill_empty=payload.only_fill_empty,
            required_headcount=payload.required_headcount,
            auto_equipment=payload.auto_equipment,
        ),
    )


@router.post("/gantt/tasks/{op_id}/ack-busy")
async def ack_busy(
    op_id: str, payload: BusyAckBody, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
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
    op_id: str, payload: ResolveVarianceBody, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
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
    op_id: str, payload: MoveTaskBody, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
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
            equipment_id=payload.equipment_id,
            clear_equipment=payload.clear_equipment,
            cascade=payload.cascade,
            resolve_roster=payload.resolve_roster,
            only_fill_empty=payload.only_fill_empty,
            required_headcount=payload.required_headcount,
            auto_equipment=payload.auto_equipment,
        ),
    )


@router.post("/gantt/schedule")
async def schedule_order(
    payload: ScheduleOrderBody, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.schedule_order_ops(payload.model_dump(exclude_none=True)))


@router.post("/gantt/preview/schedule")
async def preview_schedule_order(
    payload: ScheduleOrderBody, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.preview_schedule_order(payload.model_dump(exclude_none=True)))


@router.post("/gantt/sandbox/enter")
async def sandbox_enter(request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.sandbox_enter())


@router.post("/gantt/sandbox/discard")
async def sandbox_discard(request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.sandbox_discard())


@router.post("/gantt/sandbox/publish")
async def sandbox_publish(request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.sandbox_publish())


@router.delete("/gantt/tasks/{op_id}")
async def delete_gantt_task(
    op_id: str,
    request: Request,
    force: bool = Query(False),
    _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
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
    _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.report_overview(person_id=person_id, work_date=work_date))


@router.post("/report/daily-log")
async def submit_daily_log(payload: DailyLogBody, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.submit_daily_log(payload.model_dump()))


@router.delete("/report/daily-log/{log_id}")
async def delete_daily_log(log_id: str, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.delete_daily_log(log_id))


class ShopFloorReportBody(BaseModel):
    work_date: str | None = None
    person_id: str
    process_name: str | None = None
    template_id: str | None = None
    qty: float
    hours: float = 0
    start_time: str | None = None
    end_time: str | None = None
    link_type: str | None = None  # work_order | product
    work_order_id: str | None = None
    work_order_label: str | None = None
    product: str | None = None
    equipment_id: str | None = None
    equipment_name: str | None = None
    note: str | None = None


class ShopFloorReportRowBody(BaseModel):
    process_name: str | None = None
    template_id: str | None = None
    qty: float
    hours: float = 0
    start_time: str | None = None
    end_time: str | None = None
    link_type: str | None = None
    work_order_id: str | None = None
    work_order_label: str | None = None
    product: str | None = None
    equipment_id: str | None = None
    equipment_name: str | None = None
    note: str | None = None


class ShopFloorBatchBody(BaseModel):
    person_id: str
    work_date: str | None = None
    rows: list[ShopFloorReportRowBody]


class ShopFloorReviewBody(BaseModel):
    action: str  # confirm | reject
    reviewer: str | None = None
    note: str | None = None


@router.get("/shop-floor-reports")
async def list_shop_floor_reports(
    request: Request,
    work_date: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    status: str | None = Query(None),
    _user=Depends(require_permission("scheduling:view")),
    store: SchedulingStore = Depends(_store),
):
    """生产日报列表（免排产）：员工提交记录 + 主数据选项。"""
    return ok(
        request,
        store.list_shop_floor_reports(
            work_date=work_date,
            date_from=date_from,
            date_to=date_to,
            status=status,
        ),
    )


@router.get("/shop-floor-reports/shift-hint")
async def shop_floor_shift_hint(
    request: Request,
    person_id: str = Query(...),
    work_date: str | None = Query(None),
    _user=Depends(require_permission("scheduling:view")),
    store: SchedulingStore = Depends(_store),
):
    """人员当日班次起止，供报工默认填入。"""
    return ok(request, store.person_shift_window(person_id, work_date=work_date))


@router.get("/shop-floor-reports/progress")
async def shop_floor_progress(
    request: Request,
    _user=Depends(require_permission("scheduling:view")),
    store: SchedulingStore = Depends(_store),
):
    """工单/产品进度看板：已确认产量汇总 + 距交期日历天数。"""
    return ok(request, store.shop_floor_progress())


@router.post("/shop-floor-reports")
async def submit_shop_floor_report(
    payload: ShopFloorReportBody,
    request: Request,
    _user=Depends(require_permission("scheduling:report:start")),
    store: SchedulingStore = Depends(_store),
):
    """员工下班提交生产日报（待主任确认）。"""
    return ok(request, store.submit_shop_floor_report(payload.model_dump()))


@router.post("/shop-floor-reports/batch")
async def submit_shop_floor_reports_batch(
    payload: ShopFloorBatchBody,
    request: Request,
    _user=Depends(require_permission("scheduling:report:start")),
    store: SchedulingStore = Depends(_store),
):
    """一人多行批量提交。"""
    return ok(
        request,
        store.submit_shop_floor_reports_batch(
            {
                "person_id": payload.person_id,
                "work_date": payload.work_date,
                "rows": [r.model_dump() for r in payload.rows],
            }
        ),
    )


@router.post("/shop-floor-reports/{report_id}/review")
async def review_shop_floor_report(
    report_id: str,
    payload: ShopFloorReviewBody,
    request: Request,
    _user=Depends(require_permission("scheduling:shop_floor:review")),
    store: SchedulingStore = Depends(_store),
):
    """车间主任确认或驳回。"""
    return ok(
        request,
        store.review_shop_floor_report(
            report_id,
            action=payload.action,
            reviewer=payload.reviewer,
            note=payload.note,
        ),
    )


@router.delete("/shop-floor-reports/{report_id}")
async def delete_shop_floor_report(
    report_id: str,
    request: Request,
    _user=Depends(require_permission("scheduling:report:start")),
    store: SchedulingStore = Depends(_store),
):
    return ok(request, store.delete_shop_floor_report(report_id))


@router.post("/report/{op_id}/start")
async def start_op(op_id: str, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.start_op(op_id))


@router.post("/report/{op_id}/finish")
async def finish_op(op_id: str, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.finish_op(op_id))


@router.post("/report/{op_id}/pause")
async def pause_op(
    op_id: str, payload: PauseBody, request: Request, _user=Depends(get_current_user), store: SchedulingStore = Depends(_store)):
    return ok(request, store.pause_op(op_id, payload.reason))
