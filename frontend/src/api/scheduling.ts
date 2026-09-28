import { deleteData, getData, postData, putData } from "@/api/client";
import type { KpiItem } from "@/components/blocks";

export type PersonStatus = "active" | "leave" | "disabled" | string;
export type TemplateStatus = "active" | "incomplete" | string;
export type WorkOrderStatus = "pending" | "producing" | "done" | "cancelled" | string;
export type OrderStatus = "open" | "producing" | "done" | string;
export type SourceType = "customer" | "internal" | string;
export type Priority = "normal" | "high" | "rush" | string;
export type OpStatus = "pending" | "running" | "paused" | "done" | "exception" | string;

export interface SkillItem {
  id: string;
  name: string;
}

export interface ResourceItem {
  id: string;
  name: string;
}

export interface PersonItem {
  id: string;
  name: string;
  code: string;
  skill_ids: string[];
  skill_names?: string[];
  status: PersonStatus;
  resource_id?: string | null;
  shift_family_ids?: string[];
  shift_names?: string[];
  current_assignment?: ShiftAssignmentItem | null;
}

export interface ShiftItem {
  id: string;
  family_id: string;
  code: string;
  name: string;
  version: number;
  start_time: string;
  end_time: string;
  crosses_midnight?: boolean;
  status: "active" | "superseded" | "disabled" | string;
  status_label?: string;
  lifecycle?: "active" | "upcoming" | "expired" | "superseded" | "disabled" | string;
  effective_from?: string;
  effective_to?: string | null;
  effective_to_label?: string;
  superseded_by?: string | null;
  note?: string | null;
  time_label?: string;
}

export interface ShiftAssignmentItem {
  id: string;
  person_id: string;
  person_name?: string;
  person_code?: string;
  shift_family_id: string;
  shift_name?: string;
  start_date: string;
  end_date?: string | null;
  end_date_label?: string;
  kind?: string;
  status: "open" | "closed" | string;
  lifecycle?: "active" | "upcoming" | "expired" | "closed" | string;
  status_label?: string;
  note?: string | null;
}

export interface TemplateItem {
  id: string;
  name: string;
  std_hours: number;
  skill_id: string;
  skill_name?: string;
  prev_template_id?: string | null;
  prev_template_name?: string | null;
  status: TemplateStatus;
  sample_count?: number;
  suggested_days?: number | null;
  suggested_hours?: number | null;
}

export interface OrderItem {
  id: string;
  code: string;
  name: string;
  source_type: SourceType;
  source_type_label?: string;
  customer_name?: string | null;
  product: string;
  due_date: string;
  status: OrderStatus;
  work_order_count?: number;
}

export interface OperationItem {
  id: string;
  work_order_id: string;
  work_order_code?: string;
  work_order_name?: string;
  wo_kind?: string;
  wo_kind_label?: string;
  order_id?: string;
  order_code?: string;
  order_name?: string;
  source_type?: SourceType;
  source_type_label?: string;
  name: string;
  seq: number;
  skill_id?: string;
  skill_name?: string;
  resource_id?: string;
  resource_name?: string;
  assignee_id?: string | null;
  assignee_ids?: string[];
  assignee_name?: string;
  assignee_names?: string[];
  slot?: "full" | "am" | "pm" | string;
  slot_label?: string;
  duration_days: number;
  plan_start?: string | null;
  plan_end?: string | null;
  /** 可选：多人/多段计划；非连续则甘特色块断开 */
  plan_segments?: Array<{
    id?: string;
    person_id?: string | null;
    start: string;
    end: string;
  }>;
  /** 日工时，默认 8；计划工时 = 段合计天 × 日工时 */
  hours_per_day?: number;
  segment_day_sum?: number;
  planned_hours?: number;
  actual_start?: string | null;
  actual_end?: string | null;
  progress: number;
  status: OpStatus;
  is_insert: boolean;
  prev_op_ids: string[];
  priority?: Priority;
  due_date?: string;
  delay_days?: number;
  plan_drift?: "late_start" | "early_start" | string | null;
  plan_drift_label?: string | null;
  original_plan_start?: string | null;
  plan_vs_actual?: {
    has_actual?: boolean;
    has_variance?: boolean;
    variance_ack?: boolean;
    needs_action?: boolean;
    plan_start?: string | null;
    plan_end?: string | null;
    actual_start?: string | null;
    actual_end?: string | null;
    start_delta_days?: number | null;
    end_delta_days?: number | null;
    original_plan_start?: string | null;
    summary?: string | null;
  };
  can_start?: boolean;
  start_blocked_reason?: string | null;
  required_headcount?: number;
  staffing_gap?: number;
  staffing_label?: string;
  shift_id?: string | null;
  shift_family_id?: string | null;
  shift_name?: string;
  shift_code?: string;
  shift_version?: number;
  shift_time_label?: string;
  segment?: "single" | "start" | "mid" | "end" | string;
  /** 甘特色块实际铺开的起止（计划行=计划窗；实绩行=签字窗） */
  bar_start?: string | null;
  bar_end?: string | null;
  busy_hints?: Array<{
    person_id: string;
    person_name: string;
    other_op_id?: string;
    other_op: string;
    other_order_code?: string;
    other_slot?: string;
    message: string;
    acknowledged?: boolean;
    acknowledged_at?: string;
  }>;
}

export interface GanttOrderRow {
  order_id: string;
  order_code: string;
  order_name: string;
  source_type?: SourceType;
  source_type_label?: string;
  customer_name?: string | null;
  product?: string;
  due_date?: string;
  plan_start?: string;
  estimated_end?: string;
  duration_days?: number;
  span_days?: number;
  priority?: Priority;
  work_order_id?: string;
  work_order_code?: string;
  work_order_name?: string;
  wo_kinds?: string[];
  wo_kind_labels?: string[];
  is_insert_row?: boolean;
  /** 尚未释放到甘特的工序数（滚动细排剩余） */
  unreleased_count?: number;
  /** plan=可调计划行；actual=签字实绩行（只读） */
  row_kind?: "plan" | "actual" | string;
  row_label?: string;
  editable?: boolean;
  cells: Record<string, OperationItem[]>;
  operations: OperationItem[];
}

export interface GanttOption {
  id: string;
  code?: string;
  name?: string;
  label: string;
  due_date?: string;
  skill_id?: string;
  std_hours?: number;
  unscheduled_count?: number;
  unscheduled_ops?: Array<{
    id: string;
    name: string;
    seq?: number;
    duration_days?: number;
  }>;
}

export interface GanttDueMarker {
  order_id: string;
  order_code: string;
  due_date: string;
}

export interface WorkOrderItem {
  id: string;
  order_id?: string;
  order_code?: string;
  order_name?: string;
  source_type?: SourceType;
  source_type_label?: string;
  customer_name?: string | null;
  code: string;
  name: string;
  product: string;
  due_date: string;
  priority: Priority;
  wo_kind?: string;
  wo_kind_label?: string;
  status: WorkOrderStatus;
  op_count?: number;
  operations?: OperationItem[];
}

export interface MasterDataResponse {
  kpis: KpiItem[];
  skills: SkillItem[];
  resources: ResourceItem[];
  persons: PersonItem[];
  templates: TemplateItem[];
  leaves?: LeaveItem[];
  substitutions?: SubstitutionItem[];
  shifts?: ShiftItem[];
  shift_options?: ShiftItem[];
  shift_assignments?: ShiftAssignmentItem[];
}

export interface LeaveItem {
  id: string;
  person_id: string;
  person_name?: string;
  person_code?: string;
  start_date: string;
  end_date: string;
  reason?: string;
  status: "open" | "closed" | string;
  affected_ops?: OperationItem[];
  affected_count?: number;
}

export interface SubstitutionItem {
  id: string;
  leave_id?: string | null;
  op_id: string;
  from_person_ids: string[];
  to_person_ids: string[];
  from_names?: string;
  to_names?: string;
  op_name?: string;
  order_code?: string;
  order_name?: string;
  leave_reason?: string | null;
  at: string;
  note?: string | null;
}

export interface WorkOrdersResponse {
  kpis: KpiItem[];
  orders: OrderItem[];
  templates: TemplateItem[];
  items: WorkOrderItem[];
}

export interface GanttConflict {
  task: string;
  op_id?: string;
  order_code?: string;
  order_name?: string;
  work_order_code?: string;
  work_order_name?: string;
  resource_name?: string;
  assignee_name?: string;
  plan_window?: string;
  due_date?: string;
  conflict_with?: string | null;
  conflict_with_order?: string | null;
  conflict_with_window?: string | null;
  overlap_days?: number;
  overlap_window?: string;
  reason: string;
  impact?: string;
  suggestion: string;
  status: string;
  delay_days?: number;
  leave_id?: string;
  required_headcount?: number;
  staffing_gap?: number;
  quick_action?: "defer" | "reassign" | "edit" | string;
  action_op_id?: string;
  suggest_start?: string;
}

export interface TodayDigest {
  today: string;
  unscheduled_order_count: number;
  unscheduled_op_count: number;
  unscheduled_orders: Array<{ id: string; code: string; name: string; count: number }>;
  conflict_count: number;
  leave_count: number;
  staffing_count: number;
  delay_count: number;
  overload_day_count: number;
  overload_dates: string[];
}

export interface GanttAxis {
  today: string;
  start: string;
  end: string;
  horizon: "focus" | "all" | string;
  scroll_to: string;
  lookback_days?: number;
  ahead_days?: number;
  clipped?: boolean;
  hint?: string;
}

export interface GanttResponse {
  kpis: KpiItem[];
  dates: string[];
  axis?: GanttAxis;
  due_markers?: GanttDueMarker[];
  order_options?: GanttOption[];
  template_options?: GanttOption[];
  persons?: PersonItem[];
  resources: ResourceItem[];
  rows?: GanttOrderRow[];
  tasks: OperationItem[];
  conflicts: GanttConflict[];
  /** 本次从工单排产拉上的工序 */
  scheduled?: OperationItem[];
  schedule_summary?: {
    scheduled_count: number;
    shortage_count: number;
    held_count?: number;
    horizon_days?: number;
    window_start?: string;
    window_end?: string | null;
    message: string;
  };
  held_ops?: Array<{ id: string; name: string; seq?: number; duration_days?: number }>;
  schedule_horizons?: Array<{ value: number; label: string; description: string }>;
  history?: {
    can_undo: boolean;
    can_redo: boolean;
    undo_steps: number;
    redo_steps: number;
    limit: number;
  };
  heatmap?: CapacityHeatmap;
  sandbox?: { active: boolean; hint?: string | null };
  sandbox_message?: string;
  shift_options?: ShiftItem[];
  today_digest?: TodayDigest;
  replan_meta?: {
    frozen_count?: number;
    freeze_note?: string;
    candidate_count?: number;
  };
}

export interface ImpactPreview {
  action: string;
  risk_level: "low" | "medium" | "high" | string;
  summary: string;
  can_apply?: boolean;
  changed_ops: Array<{
    op_id: string;
    name: string;
    change: string;
    plan_window?: string;
    delay_days?: number;
    delay_before?: number;
    staffing_gap?: number;
  }>;
  conflicts_after?: GanttConflict[];
  metrics?: Record<string, number>;
  strategy?: string;
  strategy_label?: string;
  strategy_description?: string;
  scope?: string;
  scope_label?: string;
  scope_description?: string;
  queue_preview?: Array<{
    op_id: string;
    name: string;
    work_order_code?: string;
    reason?: string;
  }>;
  candidate_count?: number;
  frozen_count?: number;
  freeze_note?: string;
  strategies?: Array<{ value: string; label: string; description: string }>;
  scopes?: Array<{ value: string; label: string; description: string }>;
}

export const REPLAN_SCOPE_OPTIONS = [
  {
    value: "gantt",
    label: "仅甘特当前",
    description: "只重排已排上甘特的工序；未排产的不动。今天以前已排冻结。",
  },
  {
    value: "all",
    label: "全部未完成",
    description: "所有未完工工序一起重排（含尚未排上甘特的）。今天以前已排冻结。",
  },
] as const;

export const REPLAN_STRATEGY_OPTIONS = [
  {
    value: "protect_due",
    label: "保交期",
    description: "距交期 ≤3 天抬档，再按级别+交期；插队优先。推荐默认。",
  },
  {
    value: "priority",
    label: "级别优先",
    description: "加急 > 高优 > 普通，同级再比交期；插队优先。",
  },
  {
    value: "due_date",
    label: "交期优先",
    description: "交期早的先占资源，同交期再比级别；插队优先。",
  },
] as const;

export interface CapacityHeatmap {
  dates: string[];
  rows: Array<{
    person_id: string;
    person_name: string;
    code?: string;
    cells: Array<{
      date: string;
      load: number;
      level: "free" | "ok" | "overload" | string;
      ops: string[];
    }>;
  }>;
  overload_cell_count: number;
  summary: string;
}

export interface ReportEvent {
  id: string;
  at: string;
  person_name: string;
  op_name: string;
  message: string;
}

export interface DailyLogItem {
  id: string;
  work_date: string;
  op_id: string;
  person_id: string;
  hours: number;
  progress: number;
  note?: string | null;
  work_content?: string | null;
  signature_data?: string | null;
  signed_at?: string | null;
  confirmed?: boolean;
  has_signature?: boolean;
  at: string;
  person_name?: string;
  person_code?: string;
  op_name?: string;
  work_order_code?: string;
  order_code?: string;
  order_name?: string;
  resource_name?: string;
  progress_after?: number;
}

export interface ReportResponse {
  kpis: KpiItem[];
  work_date?: string;
  items: OperationItem[];
  today_tasks?: Array<
    OperationItem & {
      today_logged?: boolean;
      today_confirmed?: boolean;
      today_log?: DailyLogItem | null;
      task_bucket?: "today" | "overdue" | "early" | "running" | "done_today" | string;
      task_bucket_label?: string;
      start_hint?: string;
      can_resign?: boolean;
      plan_assignee_name?: string;
      plan_assignee_names?: string[];
      actual_assignee_names?: string | null;
      actual_workers_today?: Array<{
        person_id: string;
        person_name: string;
        hours?: number;
        confirmed?: boolean;
      }>;
      today_signed_count?: number;
      today_report_count?: number;
    }
  >;
  daily_logs?: DailyLogItem[];
  daily_summary?: {
    work_date: string;
    log_count: number;
    hours_total: number;
    people_count: number;
    task_count: number;
    message: string;
  };
  persons?: Array<{ id: string; name: string; code?: string; status?: string }>;
  work_order_progress?: {
    order_code?: string;
    order_name?: string;
    source_type_label?: string;
    work_order_code: string;
    work_order_name: string;
    percent: number;
    summary: string;
  } | null;
  events: ReportEvent[];
}

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  customer: "客户订单",
  internal: "内部生产",
};

export const SOURCE_TYPE_COLOR: Record<string, string> = {
  customer: "blue",
  internal: "default",
};

export const PRIORITY_LABEL: Record<string, string> = {
  normal: "普通",
  high: "高",
  rush: "紧急插队",
};

export const PRIORITY_COLOR: Record<string, string> = {
  normal: "default",
  high: "red",
  rush: "orange",
};

export const WO_KIND_LABEL: Record<string, string> = {
  normal: "正常生产",
  rework: "返工",
  add_ops: "增补工序",
  repair: "返修",
};

export const WO_KIND_COLOR: Record<string, string> = {
  normal: "default",
  rework: "magenta",
  add_ops: "cyan",
  repair: "purple",
};

export const WO_STATUS_LABEL: Record<string, string> = {
  pending: "待排产",
  producing: "生产中",
  done: "已完成",
  cancelled: "已作废",
};

export const WO_STATUS_COLOR: Record<string, string> = {
  pending: "orange",
  producing: "green",
  done: "default",
  cancelled: "default",
};

export const OP_STATUS_LABEL: Record<string, string> = {
  pending: "待开工",
  running: "进行中",
  paused: "暂停",
  done: "已完工",
  exception: "异常",
};

export const OP_STATUS_COLOR: Record<string, string> = {
  pending: "orange",
  running: "processing",
  paused: "gold",
  done: "green",
  exception: "red",
};

export const PERSON_STATUS_LABEL: Record<string, string> = {
  active: "在岗",
  leave: "休假",
  disabled: "停用",
};

export function fetchMasterData() {
  return getData<MasterDataResponse>("/scheduling/master");
}

export function createPerson(payload: Partial<PersonItem>) {
  return postData<PersonItem>("/scheduling/persons", payload);
}

export function updatePerson(id: string, payload: Partial<PersonItem>) {
  return putData<PersonItem>(`/scheduling/persons/${id}`, payload);
}

export function createShift(payload: {
  code: string;
  name: string;
  start_time?: string;
  end_time?: string;
  crosses_midnight?: boolean;
  effective_from?: string;
  effective_to?: string | null;
  note?: string;
}) {
  return postData<ShiftItem>("/scheduling/shifts", payload);
}

export function publishShiftVersion(
  familyId: string,
  payload: {
    code?: string;
    name?: string;
    start_time?: string;
    end_time?: string;
    crosses_midnight?: boolean;
    effective_from?: string;
    effective_to?: string | null;
    note?: string;
  },
) {
  return postData<{ current: ShiftItem; archived: ShiftItem; history: ShiftItem[] }>(
    `/scheduling/shifts/${familyId}/versions`,
    payload,
  );
}

export function fetchShiftHistory(familyId: string) {
  return getData<{ family_id: string; items: ShiftItem[] }>(
    `/scheduling/shifts/${familyId}/history`,
  );
}

export function deleteShiftFamily(familyId: string) {
  return deleteData<{ family_id: string; items: ShiftItem[] }>(
    `/scheduling/shifts/${familyId}`,
  );
}

export function createShiftAssignment(payload: {
  person_id: string;
  shift_family_id: string;
  start_date: string;
  end_date?: string | null;
  kind?: string;
  note?: string;
}) {
  return postData<ShiftAssignmentItem>("/scheduling/shift-assignments", payload);
}

export function closeShiftAssignment(id: string, end_date?: string | null) {
  return postData<ShiftAssignmentItem>(`/scheduling/shift-assignments/${id}/close`, {
    end_date: end_date ?? undefined,
  });
}

export function deleteShiftAssignment(id: string) {
  return deleteData<ShiftAssignmentItem>(`/scheduling/shift-assignments/${id}`);
}

export function createTemplate(payload: Partial<TemplateItem>) {
  return postData<TemplateItem>("/scheduling/templates", payload);
}

export function updateTemplate(id: string, payload: Partial<TemplateItem>) {
  return putData<TemplateItem>(`/scheduling/templates/${id}`, payload);
}

export function fetchWorkOrders() {
  return getData<WorkOrdersResponse>("/scheduling/work-orders");
}

export function createWorkOrder(payload: {
  name: string;
  product?: string;
  due_date: string;
  priority?: string;
  wo_kind?: string;
  template_ids?: string[];
  op_specs?: Array<{
    template_id: string;
    duration_days?: number;
    required_headcount?: number;
  }>;
  order_id?: string;
  source_type?: string;
  order_name?: string;
  customer_name?: string;
}) {
  return postData<WorkOrderItem>("/scheduling/work-orders", payload);
}

export function updateWorkOrder(
  id: string,
  payload: {
    name?: string;
    product?: string;
    due_date?: string;
    priority?: string;
    wo_kind?: string;
    status?: string;
  },
) {
  return putData<WorkOrderItem>(`/scheduling/work-orders/${id}`, payload);
}

export function cancelWorkOrder(id: string) {
  return postData<WorkOrderItem>(`/scheduling/work-orders/${id}/cancel`);
}

export function deleteWorkOrder(id: string) {
  return deleteData<{ ok: boolean; deleted_id: string }>(`/scheduling/work-orders/${id}`);
}

export function deleteOrder(orderId: string) {
  return deleteData<{
    ok: boolean;
    mode: "deleted" | "cancelled" | string;
    order_id: string;
    order_code?: string;
    message?: string;
  }>(`/scheduling/orders/${orderId}`);
}

export function fetchGantt(horizon: "focus" | "all" | string = "focus") {
  const q = horizon && horizon !== "focus" ? `?horizon=${encodeURIComponent(horizon)}` : "";
  return getData<GanttResponse>(`/scheduling/gantt${q}`);
}

export function replanGantt(strategy = "protect_due", scope = "gantt") {
  return postData<GanttResponse>("/scheduling/gantt/replan", { strategy, scope });
}

export function previewReplanGantt(strategy = "protect_due", scope = "gantt") {
  return postData<ImpactPreview>("/scheduling/gantt/preview/replan", { strategy, scope });
}

export function undoGantt() {
  return postData<GanttResponse>("/scheduling/gantt/undo");
}

export function redoGantt() {
  return postData<GanttResponse>("/scheduling/gantt/redo");
}

export function moveGanttTask(
  opId: string,
  payload: {
    plan_start: string;
    slot?: string;
    shift_id?: string;
    assignee_ids?: string[];
    duration_days?: number;
    plan_segments?: Array<{
      id?: string;
      person_id?: string | null;
      start: string;
      end: string;
    }>;
    hours_per_day?: number;
    cascade?: boolean;
  },
) {
  return putData<OperationItem>(`/scheduling/gantt/tasks/${opId}`, payload);
}

/** 确认同人多单并行合理：降级 busy 提示并留痕；计划一变自动作废。 */
export function acknowledgeBusy(
  opId: string,
  payload?: { other_op_id?: string; person_id?: string; note?: string },
) {
  return postData<{
    operation: OperationItem;
    acked: number;
    message: string;
  }>(`/scheduling/gantt/tasks/${opId}/ack-busy`, payload ?? {});
}

/** 计划/实绩偏差处置：保持计划 / 跟实现 / 顺延后置。 */
export function resolvePlanVariance(
  opId: string,
  payload: {
    action: "keep" | "adopt_actual" | "cascade_successors";
    note?: string;
    cascade?: boolean;
  },
) {
  return postData<{
    operation: OperationItem;
    action: string;
    touched_op_ids: string[];
    message: string;
  }>(`/scheduling/gantt/tasks/${opId}/resolve-variance`, payload);
}

export function previewMoveGanttTask(
  opId: string,
  payload: {
    plan_start: string;
    slot?: string;
    shift_id?: string;
    assignee_ids?: string[];
    duration_days?: number;
    plan_segments?: Array<{
      id?: string;
      person_id?: string | null;
      start: string;
      end: string;
    }>;
    hours_per_day?: number;
    cascade?: boolean;
  },
) {
  return postData<ImpactPreview>(`/scheduling/gantt/preview/move/${opId}`, payload);
}

export function scheduleGanttOrder(payload: {
  order_id: string;
  plan_start?: string;
  horizon_days?: number;
}) {
  return postData<GanttResponse>("/scheduling/gantt/schedule", payload);
}

export function previewScheduleGanttOrder(payload: {
  order_id: string;
  plan_start?: string;
  horizon_days?: number;
}) {
  return postData<ImpactPreview>("/scheduling/gantt/preview/schedule", payload);
}

export function enterSandbox() {
  return postData<GanttResponse>("/scheduling/gantt/sandbox/enter");
}

export function discardSandbox() {
  return postData<GanttResponse>("/scheduling/gantt/sandbox/discard");
}

export function publishSandbox() {
  return postData<GanttResponse>("/scheduling/gantt/sandbox/publish");
}

export function deleteGanttTask(opId: string, force = false) {
  const q = force ? "?force=true" : "";
  return deleteData<{ ok: boolean; deleted_id: string; unscheduled?: boolean; forced?: boolean }>(
    `/scheduling/gantt/tasks/${opId}${q}`,
  );
}

export function fetchReport(params?: { person_id?: string; work_date?: string }) {
  const q = new URLSearchParams();
  if (params?.person_id) q.set("person_id", params.person_id);
  if (params?.work_date) q.set("work_date", params.work_date);
  const qs = q.toString();
  return getData<ReportResponse>(`/scheduling/report${qs ? `?${qs}` : ""}`);
}

export function submitDailyLog(payload: {
  op_id: string;
  person_id: string;
  work_date?: string;
  hours: number;
  progress: number;
  work_content?: string;
  note?: string;
  signature_data?: string;
}) {
  return postData<{
    log: DailyLogItem;
    operation: OperationItem;
    auto_finished: boolean;
    calibration?: { message?: string } | null;
    message: string;
  }>("/scheduling/report/daily-log", payload);
}

export function deleteDailyLog(logId: string) {
  return deleteData<{ ok: boolean; deleted_id: string; message: string }>(
    `/scheduling/report/daily-log/${logId}`,
  );
}

export function startOperation(opId: string) {
  return postData<OperationItem>(`/scheduling/report/${opId}/start`);
}

export function finishOperation(opId: string) {
  return postData<OperationItem>(`/scheduling/report/${opId}/finish`);
}

export function pauseOperation(opId: string, reason?: string) {
  return postData<OperationItem>(`/scheduling/report/${opId}/pause`, { reason });
}

export function resetSchedulingDemo() {
  return postData<{
    ok: boolean;
    anchor?: string;
    scenarios?: string[];
    message?: string;
  }>("/scheduling/reset");
}

export function createLeave(payload: {
  person_id: string;
  start_date: string;
  end_date?: string;
  reason?: string;
}) {
  return postData<LeaveItem>("/scheduling/leaves", payload);
}

export function closeLeave(leaveId: string) {
  return postData<LeaveItem>(`/scheduling/leaves/${leaveId}/close`);
}

export function reassignForLeave(payload: {
  op_id: string;
  assignee_ids: string[];
  leave_id?: string;
  note?: string;
}) {
  return postData<{
    operation: OperationItem;
    substitution: SubstitutionItem;
    leave?: LeaveItem | null;
    gantt: GanttResponse;
  }>("/scheduling/leaves/reassign", payload);
}
