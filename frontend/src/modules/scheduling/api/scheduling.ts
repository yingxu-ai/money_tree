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
  code?: string;
  status?: "active" | "disabled" | string;
  status_label?: string;
  sort?: number;
  person_count?: number;
  template_count?: number;
}

export interface ResourceItem {
  id: string;
  name: string;
  code?: string;
  status?: "active" | "disabled" | string;
  status_label?: string;
  sort?: number;
  member_count?: number;
}

export interface EquipmentItem {
  id: string;
  name: string;
  code?: string;
  status?: "active" | "disabled" | string;
  status_label?: string;
  sort?: number;
  resource_id?: string | null;
  resource_name?: string | null;
  is_shared?: boolean;
  op_count?: number;
}

export interface PersonTodayRoster {
  day: string;
  kind: "shift" | "leave" | "empty" | string;
  label: string;
  shift_family_id?: string | null;
  shift_name?: string | null;
  leave_id?: string | null;
  leave_reason?: string | null;
}

export interface PersonItem {
  id: string;
  name: string;
  code: string;
  skill_ids: string[];
  skill_names?: string[];
  status: PersonStatus;
  resource_id?: string | null;
  resource_name?: string | null;
  shift_family_ids?: string[];
  shift_names?: string[];
  /** @deprecated 长期任职已不在人员表展示；请用 today_roster */
  current_assignment?: ShiftAssignmentItem | null;
  /** 今日当班（从排班周历/请假推导） */
  today_roster?: PersonTodayRoster | null;
  /** 本周七天缩略：白/中/夜/假/— */
  week_roster_labels?: string[];
  week_start?: string;
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
  /** 班序：甘特一天内从左到右、轮换链共用 */
  sort_order?: number;
  /** 归属日：start_day=开班日；previous_day=前一日（凌晨班跟首班生产日） */
  belong_day_rule?: "start_day" | "previous_day" | string;
  belong_day_label?: string;
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

/** 甘特/排产共用的一天 N 段（与当前启用班一致） */
export interface DaySegment {
  family_id: string;
  shift_id: string;
  name: string;
  code?: string;
  start_time?: string;
  end_time?: string;
  crosses_midnight?: boolean;
  sort_order?: number;
  belong_day_rule?: "start_day" | "previous_day" | string;
  belong_day_label?: string;
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
  equipment_ids?: string[];
  equipment_names?: string[];
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
  equipment_id?: string | null;
  equipment_name?: string | null;
  equipment_code?: string | null;
  equipment_pool_ids?: string[];
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
    person_ids?: string[];
    person_names?: string[];
    equipment_ids?: string[];
    equipment_names?: string[];
    required_headcount?: number | null;
    required_equipment?: number | null;
    staffing_gap?: number;
    equipment_gap?: number;
    start: string;
    end: string;
  }>;
  equipment_ids?: string[];
  equipment_names?: string[];
  equipment_gap?: number;
  /** 班次工时（由班制时段推算）；计划工时 = 段合计天 × 班次工时 */
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
  equipments?: EquipmentItem[];
  persons: PersonItem[];
  templates: TemplateItem[];
  leaves?: LeaveItem[];
  substitutions?: SubstitutionItem[];
  shifts?: ShiftItem[];
  shift_options?: ShiftItem[];
  day_segments?: DaySegment[];
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
  equipment_id?: string;
  equipment_name?: string;
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
  conflict_kind?: string;
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
  capacity_overload_count?: number;
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
  /** 未关闭请假；派工按段日期判断，勿只看 persons.status */
  leaves?: LeaveItem[];
  resources: ResourceItem[];
  equipments?: EquipmentItem[];
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
  /** 与启用班同步：一天切成 N 段 */
  day_segments?: DaySegment[];
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
  /** 试算后的工序快照（含自动派人/占机结果） */
  resolved_op?: OperationItem;
  /** 与本工序相关的冲突（编辑弹窗标红） */
  op_conflicts?: GanttConflict[];
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

export function createResource(payload: {
  name: string;
  code: string;
  status?: string;
  sort?: number;
}) {
  return postData<ResourceItem>("/scheduling/resources", payload);
}

export function updateResource(
  id: string,
  payload: { name: string; code: string; status?: string; sort?: number },
) {
  return putData<ResourceItem>(`/scheduling/resources/${id}`, payload);
}

export function deleteResource(id: string, migrateTo?: string | null) {
  return deleteData<{
    ok: boolean;
    deleted_id: string;
    migrated_persons: number;
    migrate_to?: string | null;
  }>(`/scheduling/resources/${id}`, migrateTo ? { migrate_to: migrateTo } : undefined);
}

export function createSkill(payload: {
  name: string;
  code: string;
  status?: string;
  sort?: number;
}) {
  return postData<SkillItem>("/scheduling/skills", payload);
}

export function updateSkill(
  id: string,
  payload: { name: string; code: string; status?: string; sort?: number },
) {
  return putData<SkillItem>(`/scheduling/skills/${id}`, payload);
}

export function deleteSkill(id: string, migrateTo?: string | null) {
  return deleteData<{
    ok: boolean;
    deleted_id: string;
    migrated_persons: number;
    migrated_templates: number;
    migrated_ops: number;
    migrate_to?: string | null;
  }>(`/scheduling/skills/${id}`, migrateTo ? { migrate_to: migrateTo } : undefined);
}

export function createEquipment(payload: {
  name: string;
  code: string;
  status?: string;
  sort?: number;
  resource_id?: string | null;
}) {
  return postData<EquipmentItem>("/scheduling/equipments", payload);
}

export function updateEquipment(
  id: string,
  payload: {
    name: string;
    code: string;
    status?: string;
    sort?: number;
    resource_id?: string | null;
  },
) {
  return putData<EquipmentItem>(`/scheduling/equipments/${id}`, payload);
}

export function deleteEquipment(id: string, migrateTo?: string | null) {
  return deleteData<{
    ok: boolean;
    deleted_id: string;
    migrated_ops: number;
    migrate_to?: string | null;
  }>(`/scheduling/equipments/${id}`, migrateTo ? { migrate_to: migrateTo } : undefined);
}

export function createShift(payload: {
  code: string;
  name: string;
  start_time?: string;
  end_time?: string;
  crosses_midnight?: boolean;
  belong_day_rule?: "start_day" | "previous_day" | string;
  effective_from?: string;
  effective_to?: string | null;
  note?: string;
  sort_order?: number;
}) {
  return postData<ShiftItem>("/scheduling/shifts", payload);
}

/** 调整班序（甘特 N 段顺序 / 轮换链） */
export function reorderShifts(familyIds: string[]) {
  return postData<{
    family_ids: string[];
    day_segments: DaySegment[];
    shift_options: ShiftItem[];
  }>("/scheduling/shifts/reorder", { family_ids: familyIds });
}

export function publishShiftVersion(
  familyId: string,
  payload: {
    code?: string;
    name?: string;
    start_time?: string;
    end_time?: string;
    crosses_midnight?: boolean;
    belong_day_rule?: "start_day" | "previous_day" | string;
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

export interface ShiftUsageResponse {
  family_id: string;
  family_name?: string;
  open_op_count: number;
  open_assignment_count: number;
  /** 有未完成工序时强制选择替换目标 */
  requires_migrate: boolean;
  /** 有工序或任职占用时建议选择替换（否则任职会被直接结束） */
  suggest_migrate?: boolean;
  ops: Array<{
    id: string;
    name?: string;
    plan_start?: string;
    plan_end?: string;
    work_order_code?: string;
  }>;
  migrate_targets: ShiftItem[];
}

export function fetchShiftUsage(familyId: string) {
  return getData<ShiftUsageResponse>(`/scheduling/shifts/${familyId}/usage`);
}

export function disableShiftFamily(
  familyId: string,
  migrateToFamilyId?: string | null,
) {
  return postData<{
    family_id: string;
    migrated_op_count: number;
    migrated_assignment_count: number;
    closed_assignment_count?: number;
    migrate_to_family_id?: string | null;
    items: ShiftItem[];
  }>(`/scheduling/shifts/${familyId}/disable`, {
    migrate_to_family_id: migrateToFamilyId ?? null,
  });
}

/** @deprecated 请用 disableShiftFamily；无占用时可直接停用 */
export function deleteShiftFamily(familyId: string) {
  return disableShiftFamily(familyId);
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

export type RosterCellKind = "shift" | "leave" | "empty";

export interface RosterCell {
  kind: RosterCellKind;
  label: string;
  shift_family_id?: string | null;
  shift_name?: string | null;
  leave_id?: string | null;
  leave_reason?: string | null;
}

export interface RosterWeekRow {
  person_id: string;
  person_name?: string;
  person_code?: string;
  resource_id?: string | null;
  shift_family_ids?: string[];
  cells: Record<string, RosterCell>;
}

export interface RosterWeekResponse {
  week_start: string;
  week_end: string;
  dates: string[];
  shift_options: Array<{
    family_id: string;
    name: string;
    short: string;
    color?: string;
    /** 周内仍挂着的旧班（已停用），仅便于显示/清空 */
    disabled?: boolean;
  }>;
  rotate_chain?: string;
  rows: RosterWeekRow[];
  generated?: {
    mode?: "seed" | "assign" | "rotate" | string;
    mode_label?: string;
    assignment_segments: number;
    skipped_leave_days: number;
    person_count: number;
    skipped_no_prev?: number;
    capability_opened?: number;
    family_count?: number;
    family_ids?: string[];
    shift_family_id?: string;
    shift_name?: string;
    effective_from?: string;
    end_date?: string;
    mapping?: Record<string, string>;
    rotate_chain?: string;
  };
}

export function fetchRosterWeek(weekStart?: string) {
  return getData<RosterWeekResponse>("/scheduling/roster/week", {
    week_start: weekStart || undefined,
  });
}

export interface RosterAnalysisSeries {
  key: string;
  name: string;
  color: string;
  values: number[];
}

export interface RosterAnalysisResponse {
  start_date: string;
  end_date: string;
  dates: string[];
  day_labels: string[];
  series: RosterAnalysisSeries[];
  totals: number[];
  person_total: number;
}

export function fetchRosterAnalysis(startDate?: string, endDate?: string) {
  return getData<RosterAnalysisResponse>("/scheduling/roster/analysis", {
    start_date: startDate || undefined,
    end_date: endDate || undefined,
  });
}

/** 排班：时间段 + 一个班 + 一批人 */
export function assignRosterBatch(payload: {
  start_date: string;
  end_date: string;
  shift_family_id: string;
  person_ids: string[];
  note?: string;
}) {
  return postData<RosterWeekResponse>("/scheduling/roster/assign", payload);
}

/** 换班：两班自动对换；三班传 mapping{旧→新}；覆盖起止日期 */
export function rotateRoster(payload: {
  week_start?: string;
  effective_from: string;
  end_date: string;
  person_ids?: string[];
  family_ids?: string[];
  mapping?: Record<string, string>;
}) {
  return postData<RosterWeekResponse>("/scheduling/roster/rotate", payload);
}

export function setRosterDay(payload: {
  person_id: string;
  day: string;
  shift_family_id?: string | null;
  note?: string;
}) {
  return postData<RosterWeekResponse>("/scheduling/roster/day", payload);
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

/** 默认 all：从今天往前留几天，右端拉到未完工计划结束（排到哪看到哪）。 */
export function fetchGantt(horizon: "focus" | "all" | string = "all") {
  const mode = horizon || "all";
  return getData<GanttResponse>(
    `/scheduling/gantt?horizon=${encodeURIComponent(mode)}`,
  );
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
    equipment_id?: string | null;
    clear_equipment?: boolean;
    cascade?: boolean;
    /** 按排班重解析各日责任人（换班/整段平移） */
    resolve_roster?: boolean;
    /** 仅补空人的日（拉宽新增格） */
    only_fill_empty?: boolean;
    required_headcount?: number;
    /** 按负荷自动重选设备 */
    auto_equipment?: boolean;
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
    equipment_id?: string | null;
    clear_equipment?: boolean;
    cascade?: boolean;
    resolve_roster?: boolean;
    only_fill_empty?: boolean;
    required_headcount?: number;
    auto_equipment?: boolean;
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

export function resetSchedulingBaseline() {
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
