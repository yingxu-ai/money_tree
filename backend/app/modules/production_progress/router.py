"""生产进度 API：菜单/权限独立；人员班制工单日报暂复用排产 Store；工序产品工艺用独立目录。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.factory_code_service import (
    ensure_factory_code,
    get_tenant_by_factory_code,
    get_tenant_by_id,
)
from app.application.wechat_mp import create_factory_wxacode_png, wechat_mp_configured
from app.auth.context import CurrentUser
from app.auth.deps import get_current_user, require_permission
from app.core.config import get_settings
from app.core.database import get_session
from app.core.exceptions import NotFoundException, PermissionException, ValidationException
from app.core.response import ok
from app.core.security import create_access_token
from app.modules.production_progress.catalog_store import CatalogStore, get_catalog_store
from app.modules.scheduling.store import SchedulingStore, get_store


def _store(current: CurrentUser = Depends(get_current_user)) -> SchedulingStore:
    return get_store(current.effective_tenant_id)


def _catalog(current: CurrentUser = Depends(get_current_user)) -> CatalogStore:
    return get_catalog_store(current.effective_tenant_id)

router = APIRouter(prefix="/production-progress", tags=["生产进度"])


class MpIdentifyBody(BaseModel):
    name: str
    code: str
    """来自本机厂码绑定的租户 id（扫厂码后写入）。"""
    tenant_id: int


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
    # 本单数量（件/套/批），用于进度与工艺预计工时
    quantity: float | None = 1
    plan_qty: float | None = None
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
    quantity: float | None = None
    plan_qty: float | None = None


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
    _user=Depends(require_permission("production_progress:view")),
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
    payload: ResourceUpsert,
    request: Request,
    _user: CurrentUser = Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    body = payload.model_dump()
    actor = _actor_name(_user)
    body["created_by"] = actor
    body["updated_by"] = actor
    return ok(request, store.upsert_resource(body))


@router.put("/resources/{resource_id}")
async def update_resource(
    resource_id: str,
    payload: ResourceUpsert,
    request: Request,
    _user: CurrentUser = Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    body = payload.model_dump()
    body["updated_by"] = _actor_name(_user)
    return ok(request, store.upsert_resource(body, resource_id))


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
    payload: SkillUpsert,
    request: Request,
    _user: CurrentUser = Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    body = payload.model_dump()
    actor = _actor_name(_user)
    body["created_by"] = actor
    body["updated_by"] = actor
    return ok(request, store.upsert_skill(body))


@router.put("/skills/{skill_id}")
async def update_skill(
    skill_id: str,
    payload: SkillUpsert,
    request: Request,
    _user: CurrentUser = Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    body = payload.model_dump()
    body["updated_by"] = _actor_name(_user)
    return ok(request, store.upsert_skill(body, skill_id))


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
    payload: EquipmentUpsert,
    request: Request,
    _user: CurrentUser = Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    body = payload.model_dump()
    actor = _actor_name(_user)
    body["created_by"] = actor
    body["updated_by"] = actor
    return ok(request, store.upsert_equipment(body))


@router.put("/equipments/{equipment_id}")
async def update_equipment(
    equipment_id: str,
    payload: EquipmentUpsert,
    request: Request,
    _user: CurrentUser = Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    body = payload.model_dump()
    body["updated_by"] = _actor_name(_user)
    return ok(request, store.upsert_equipment(body, equipment_id))


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
async def create_person(
    payload: PersonUpsert,
    request: Request,
    _user: CurrentUser = Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    body = payload.model_dump()
    actor = _actor_name(_user)
    body["created_by"] = actor
    body["updated_by"] = actor
    return ok(request, store.upsert_person(body))


@router.put("/persons/{person_id}")
async def update_person(
    person_id: str,
    payload: PersonUpsert,
    request: Request,
    _user: CurrentUser = Depends(get_current_user),
    store: SchedulingStore = Depends(_store),
):
    body = payload.model_dump()
    body["updated_by"] = _actor_name(_user)
    return ok(request, store.upsert_person(body, person_id))


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
    submitted_by: str | None = None
    submitted_by_user_id: int | None = None
    rows: list[ShopFloorReportRowBody]


class ShopFloorReviewBody(BaseModel):
    action: str  # confirm | reject
    reviewer: str | None = None
    reviewer_user_id: int | None = None
    note: str | None = None


class ShopFloorReviewBatchBody(BaseModel):
    ids: list[str]
    action: str  # confirm | reject
    reviewer: str | None = None
    reviewer_user_id: int | None = None
    note: str | None = None


class ShopFloorSettingsBody(BaseModel):
    off_shift_grace_minutes: int | None = None
    history_backfill_days: int | None = None


class ShopFloorFinishedBody(BaseModel):
    work_date: str
    product: str
    confirmed_qty: float | None = None
    suggested_qty: float | None = None
    confirmed_by: str | None = None
    submitted_by: str | None = None
    note: str | None = None
    # apply=手工申请 pending；confirm=确认；modify=只改数量；reject=驳回需原因
    action: str | None = "confirm"
    # 口径二：按班确认
    shift_name: str | None = None
    shift_family_id: str | None = None


@router.get("/mp/factory/{factory_code}")
async def mp_resolve_factory(
    factory_code: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """公开：扫厂码后解析客户（工人不填租户）。"""
    tenant = await get_tenant_by_factory_code(session, factory_code)
    code = await ensure_factory_code(session, tenant)
    return ok(
        request,
        {
            "tenant_id": int(tenant.id),
            "tenant_name": tenant.name,
            "factory_code": code,
        },
    )


@router.get("/mp/factory-code")
async def mp_factory_code_for_admin(
    request: Request,
    current: CurrentUser = Depends(require_permission("production_progress:view")),
    session: AsyncSession = Depends(get_session),
):
    """当前租户车间厂码（PC 出示 / 打印）。"""
    settings = get_settings()
    tenant = await get_tenant_by_id(session, current.effective_tenant_id)
    code = await ensure_factory_code(session, tenant)
    page = (settings.wechat_mp_factory_page or "").strip().lstrip("/")
    return ok(
        request,
        {
            "tenant_id": int(tenant.id),
            "tenant_name": tenant.name,
            "factory_code": code,
            "mp_page": page,
            "scene": code,
            "wxacode_ready": wechat_mp_configured(),
            "tip": "请用微信扫一扫扫描小程序码；贴在车间入口。工人无需填写租户。",
        },
    )


@router.get("/mp/factory-wxacode")
async def mp_factory_wxacode(
    request: Request,
    current: CurrentUser = Depends(require_permission("production_progress:view")),
    session: AsyncSession = Depends(get_session),
):
    """生成无限小程序码 PNG；未配置微信凭据时返回业务错误。"""
    if not wechat_mp_configured():
        raise ValidationException(
            "未配置 WECHAT_MP_APPID / WECHAT_MP_SECRET。"
            "可在微信公众平台用下方 scene 与页面路径手动生成小程序码。"
        )
    settings = get_settings()
    tenant = await get_tenant_by_id(session, current.effective_tenant_id)
    code = await ensure_factory_code(session, tenant)
    page = (settings.wechat_mp_factory_page or "").strip().lstrip("/")
    png = await create_factory_wxacode_png(scene=code, page=page)
    return Response(content=png, media_type="image/png")


@router.post("/mp/identify")
async def mp_identify(
    payload: MpIdentifyBody,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """
    小程序现场作业人：姓名+工号 + 已扫厂码的 tenant_id → 作业人令牌。
    管理员仍用 /auth/login。
    """
    name = (payload.name or "").strip()
    code = (payload.code or "").strip()
    if not name or not code:
        raise ValidationException("请填写姓名和工号")
    if not payload.tenant_id:
        raise ValidationException("请先扫车间厂码后再进入")
    tenant = await get_tenant_by_id(session, int(payload.tenant_id))
    store = get_store(int(tenant.id))
    person = store.find_person_by_name_code(name, code)
    if person is None:
        raise NotFoundException("未找到该员工，请核对姓名与工号")
    token = create_access_token(
        f"mp:{person['id']}",
        {
            "kind": "mp_worker",
            "tenant_id": int(tenant.id),
            "person_id": person["id"],
            "person_name": person.get("name") or name,
            "person_code": person.get("code") or code,
        },
    )
    return ok(
        request,
        {
            "access_token": token,
            "token_type": "bearer",
            "person": {
                "id": person["id"],
                "name": person.get("name"),
                "code": person.get("code"),
                "resource_id": person.get("resource_id"),
                "status": person.get("status"),
            },
            "tenant": {
                "id": int(tenant.id),
                "name": tenant.name,
                "factory_code": tenant.factory_code,
            },
            "permissions": [
                "production_progress:view",
                "production_progress:report",
            ],
        },
    )


@router.get("/shop-floor-reports")
async def list_shop_floor_reports(
    request: Request,
    work_date: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    status: str | None = Query(None),
    person_id: str | None = Query(None),
    current: CurrentUser = Depends(require_permission("production_progress:view")),
    store: SchedulingStore = Depends(_store),
):
    """生产日报列表（免排产）：员工提交记录 + 主数据选项。"""
    # 现场作业人只能看本人
    effective_person = person_id
    if current.is_mp_worker:
        effective_person = current.person_id
    return ok(
        request,
        store.list_shop_floor_reports(
            work_date=work_date,
            date_from=date_from,
            date_to=date_to,
            status=status,
            person_id=effective_person,
        ),
    )


@router.get("/shop-floor-reports/shift-hint")
async def shop_floor_shift_hint(
    request: Request,
    person_id: str = Query(...),
    work_date: str | None = Query(None),
    current: CurrentUser = Depends(require_permission("production_progress:view")),
    store: SchedulingStore = Depends(_store),
):
    """人员当日班次起止，供报工默认填入。"""
    if current.is_mp_worker and person_id != current.person_id:
        raise PermissionException("只能查看本人班次")
    return ok(request, store.person_shift_window(person_id, work_date=work_date))


@router.get("/shop-floor-reports/progress")
async def shop_floor_progress(
    request: Request,
    _user=Depends(require_permission("production_progress:view")),
    store: SchedulingStore = Depends(_store),
):
    """工单/产品进度看板：已确认产量汇总 + 距交期日历天数。"""
    return ok(request, store.shop_floor_progress())


@router.get("/shop-floor-reports/progress/detail")
async def shop_floor_progress_detail(
    request: Request,
    scope: str = Query(..., description="order | work_order | product"),
    id: str = Query(..., description="订单/工单 id 或产品名"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    status: str | None = Query(None),
    _user=Depends(require_permission("production_progress:view")),
    store: SchedulingStore = Depends(_store),
):
    """订单/工单/产品进度下钻：摘要 + 日班设备人明细。"""
    return ok(
        request,
        store.shop_floor_progress_detail(
            scope=scope,
            target_id=id,
            date_from=date_from,
            date_to=date_to,
            status=status,
        ),
    )


@router.get("/cockpit")
async def production_progress_cockpit(
    request: Request,
    near_days: int = Query(3, ge=0, le=14),
    view: str = Query("manager", description="manager=负责人 | director=主任"),
    silent_hours: float = Query(8, ge=1, le=72),
    _user=Depends(require_permission("production_progress:view")),
    store: SchedulingStore = Depends(_store),
):
    """全局看板：指挥条、必办、交期/在制/脉搏。"""
    return ok(
        request,
        store.shop_floor_cockpit(
            near_days=near_days,
            view=view,
            silent_hours=silent_hours,
        ),
    )


@router.get("/shop-floor-settings")
async def get_shop_floor_settings(
    request: Request,
    _user=Depends(require_permission("production_progress:view")),
    store: SchedulingStore = Depends(_store),
):
    """报工口径配置：下班宽限、历史补报天数。"""
    return ok(request, store.get_shop_floor_settings())


@router.put("/shop-floor-settings")
async def update_shop_floor_settings(
    payload: ShopFloorSettingsBody,
    request: Request,
    _user=Depends(require_permission("production_progress:review")),
    store: SchedulingStore = Depends(_store),
):
    """修改下班宽限（分钟）与历史补报窗口（天）。"""
    return ok(
        request,
        store.update_shop_floor_settings(payload.model_dump(exclude_none=True)),
    )


@router.get("/shop-floor-reports/stats")
async def shop_floor_stats(
    request: Request,
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    work_date: str | None = Query(None),
    resource_id: str | None = Query(None),
    process_name: str | None = Query(None),
    equipment_key: str | None = Query(None),
    shift_family_id: str | None = Query(None),
    _user=Depends(require_permission("production_progress:view")),
    store: SchedulingStore = Depends(_store),
    catalog: CatalogStore = Depends(_catalog),
):
    """每日报工统计：应报/未报、工序/班次/设备、成品建议。"""
    d0 = (date_from or work_date or "")[:10] or None
    d1 = (date_to or work_date or date_from or "")[:10] or None
    if not d0:
        from datetime import date as _date

        d0 = d1 = _date.today().isoformat()
    if not d1:
        d1 = d0
    return ok(
        request,
        store.shop_floor_dashboard_stats(
            date_from=d0,
            date_to=d1,
            last_process_by_product=catalog.last_process_by_product_name(),
            product_hints=catalog.product_finish_hints(),
            resource_id=resource_id,
            process_name=process_name,
            equipment_key=equipment_key,
            shift_family_id=shift_family_id,
        ),
    )


@router.post("/shop-floor-reports/finished-confirm")
async def shop_floor_finished_confirm(
    payload: ShopFloorFinishedBody,
    request: Request,
    _user=Depends(require_permission("production_progress:review")),
    store: SchedulingStore = Depends(_store),
):
    """成品产量确认（程序建议 + 人工确认）。"""
    return ok(request, store.confirm_shop_floor_finished(payload.model_dump()))


@router.post("/shop-floor-reports")
async def submit_shop_floor_report(
    payload: ShopFloorReportBody,
    request: Request,
    current: CurrentUser = Depends(require_permission("production_progress:report")),
    store: SchedulingStore = Depends(_store),
):
    """员工下班提交生产日报（待主任确认）。"""
    data = payload.model_dump()
    if current.is_mp_worker:
        data["person_id"] = current.person_id
        data["submitted_by"] = data.get("submitted_by") or current.user.display_name
    return ok(request, store.submit_shop_floor_report(data))


@router.post("/shop-floor-reports/batch")
async def submit_shop_floor_reports_batch(
    payload: ShopFloorBatchBody,
    request: Request,
    current: CurrentUser = Depends(require_permission("production_progress:report")),
    store: SchedulingStore = Depends(_store),
):
    """一人多行批量提交。"""
    person_id = payload.person_id
    submitted_by = payload.submitted_by
    if current.is_mp_worker:
        person_id = current.person_id or person_id
        submitted_by = submitted_by or current.user.display_name
    return ok(
        request,
        store.submit_shop_floor_reports_batch(
            {
                "person_id": person_id,
                "work_date": payload.work_date,
                "submitted_by": submitted_by,
                "submitted_by_user_id": payload.submitted_by_user_id,
                "rows": [r.model_dump() for r in payload.rows],
            }
        ),
    )


@router.post("/shop-floor-reports/review-batch")
async def review_shop_floor_reports_batch(
    payload: ShopFloorReviewBatchBody,
    request: Request,
    _user=Depends(require_permission("production_progress:review")),
    store: SchedulingStore = Depends(_store),
):
    """批量确认或驳回待审报工。"""
    return ok(
        request,
        store.review_shop_floor_reports_batch(
            ids=payload.ids,
            action=payload.action,
            reviewer=payload.reviewer,
            reviewer_user_id=payload.reviewer_user_id,
            note=payload.note,
        ),
    )


@router.post("/shop-floor-reports/{report_id}/review")
async def review_shop_floor_report(
    report_id: str,
    payload: ShopFloorReviewBody,
    request: Request,
    _user=Depends(require_permission("production_progress:review")),
    store: SchedulingStore = Depends(_store),
):
    """车间主任确认或驳回。"""
    return ok(
        request,
        store.review_shop_floor_report(
            report_id,
            action=payload.action,
            reviewer=payload.reviewer,
            reviewer_user_id=payload.reviewer_user_id,
            note=payload.note,
        ),
    )


@router.delete("/shop-floor-reports/{report_id}")
async def delete_shop_floor_report(
    report_id: str,
    request: Request,
    _user=Depends(require_permission("production_progress:report")),
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


# ----- 工序 / 产品工艺（独立目录） -----


class ProcessBody(BaseModel):
    code: str
    name: str
    unit_minutes: float = 0
    status: str | None = "active"
    note: str | None = None


class ProductStepBody(BaseModel):
    process_id: str
    qty: float = 1
    qty_unit: str = "件"
    unit_minutes: float | None = None


class ProductBody(BaseModel):
    code: str
    name: str
    status: str | None = "active"
    effective_from: str | None = None
    effective_to: str | None = None
    steps: list[ProductStepBody] = Field(default_factory=list)


@router.get("/processes")
async def list_processes(
    request: Request,
    _user=Depends(require_permission("production_progress:view")),
    catalog: CatalogStore = Depends(_catalog),
):
    return ok(request, catalog.list_processes())


@router.post("/processes")
async def create_process(
    payload: ProcessBody,
    request: Request,
    _user: CurrentUser = Depends(require_permission("production_progress:view")),
    catalog: CatalogStore = Depends(_catalog),
):
    body = payload.model_dump()
    actor = _actor_name(_user)
    body["created_by"] = actor
    body["updated_by"] = actor
    return ok(request, catalog.upsert_process(body))


@router.put("/processes/{process_id}")
async def update_process(
    process_id: str,
    payload: ProcessBody,
    request: Request,
    _user: CurrentUser = Depends(require_permission("production_progress:view")),
    catalog: CatalogStore = Depends(_catalog),
):
    body = payload.model_dump()
    body["updated_by"] = _actor_name(_user)
    return ok(request, catalog.upsert_process(body, process_id=process_id))


@router.delete("/processes/{process_id}")
async def delete_process(
    process_id: str,
    request: Request,
    _user=Depends(require_permission("production_progress:view")),
    catalog: CatalogStore = Depends(_catalog),
):
    return ok(request, catalog.delete_process(process_id))


@router.get("/products")
async def list_products(
    request: Request,
    _user=Depends(require_permission("production_progress:view")),
    catalog: CatalogStore = Depends(_catalog),
):
    return ok(request, catalog.list_products())


@router.post("/products")
async def create_product(
    payload: ProductBody,
    request: Request,
    _user: CurrentUser = Depends(require_permission("production_progress:view")),
    catalog: CatalogStore = Depends(_catalog),
):
    actor = _actor_name(_user)
    return ok(
        request,
        catalog.upsert_product(
            {
                **payload.model_dump(),
                "steps": [s.model_dump() for s in payload.steps],
                "created_by": actor,
                "updated_by": actor,
            }
        ),
    )


@router.put("/products/{product_id}")
async def update_product(
    product_id: str,
    payload: ProductBody,
    request: Request,
    _user: CurrentUser = Depends(require_permission("production_progress:view")),
    catalog: CatalogStore = Depends(_catalog),
):
    return ok(
        request,
        catalog.upsert_product(
            {
                **payload.model_dump(),
                "steps": [s.model_dump() for s in payload.steps],
                "updated_by": _actor_name(_user),
            },
            product_id=product_id,
        ),
    )


@router.delete("/products/{product_id}")
async def delete_product(
    product_id: str,
    request: Request,
    _user=Depends(require_permission("production_progress:view")),
    catalog: CatalogStore = Depends(_catalog),
):
    return ok(request, catalog.delete_product(product_id))
