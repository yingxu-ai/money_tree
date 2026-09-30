import {
  Alert,
  Button,
  Collapse,
  DatePicker,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from "antd";
import {
  CloseOutlined,
  DownOutlined,
  FieldTimeOutlined,
  FullscreenOutlined,
  MinusOutlined,
  PlusOutlined,
  RedoOutlined,
  ReloadOutlined,
  RightOutlined,
  SwapOutlined,
  UndoOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  acknowledgeBusy,
  deleteGanttTask,
  deleteOrder,
  discardSandbox,
  enterSandbox,
  fetchGantt,
  moveGanttTask,
  previewMoveGanttTask,
  previewReplanGantt,
  previewScheduleGanttOrder,
  publishSandbox,
  redoGantt,
  resolvePlanVariance,
  REPLAN_SCOPE_OPTIONS,
  REPLAN_STRATEGY_OPTIONS,
  replanGantt,
  resetSchedulingDemo,
  scheduleGanttOrder,
  undoGantt,
  type GanttConflict,
  type GanttOption,
  type GanttOrderRow,
  type ImpactPreview,
  type OperationItem,
} from "@/modules/scheduling/api/scheduling";
import OrderDetailDrawer from "@/modules/scheduling/pages/OrderDetailDrawer";
import FleetStatsDrawer from "@/modules/scheduling/pages/FleetStatsDrawer";
import { KpiRow } from "@/components/blocks";
import { DataTable, DeleteAction, PageHeader, StatusTag } from "@/components/kit";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";

function formatDateLabel(iso?: string | null) {
  if (!iso) return "-";
  return iso.slice(0, 10);
}

function activeBusyHints(op?: OperationItem | null) {
  return (op?.busy_hints ?? []).filter((h) => !h.acknowledged);
}

type PlanDayCell = { date: string; person_id?: string | null };
type PlanSegPayload = {
  id?: string;
  person_id?: string | null;
  start: string;
  end: string;
};

/** 把工序计划展开为日历天（含各段责任人）。 */
function expandOpPlanDays(op: OperationItem): PlanDayCell[] {
  const segs = (op.plan_segments ?? []).filter((s) => s.start);
  if (segs.length) {
    const out: PlanDayCell[] = [];
    for (const s of segs) {
      let cur = dayjs(s.start.slice(0, 10));
      const end = dayjs((s.end || s.start).slice(0, 10));
      while (cur.isBefore(end, "day") || cur.isSame(end, "day")) {
        out.push({
          date: cur.format("YYYY-MM-DD"),
          person_id: s.person_id ?? null,
        });
        cur = cur.add(1, "day");
      }
    }
    return out;
  }
  const start = op.plan_start?.slice(0, 10);
  if (!start) return [];
  const end = (op.plan_end || op.plan_start || start).slice(0, 10);
  const out: PlanDayCell[] = [];
  let cur = dayjs(start);
  const endD = dayjs(end);
  const pid = op.assignee_id ?? op.assignee_ids?.[0] ?? null;
  while (cur.isBefore(endD, "day") || cur.isSame(endD, "day")) {
    out.push({ date: cur.format("YYYY-MM-DD"), person_id: pid });
    cur = cur.add(1, "day");
  }
  return out;
}

/** 连续同人日合并为 plan_segments。 */
function compressDaysToSegments(days: PlanDayCell[]): PlanSegPayload[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const segs: PlanSegPayload[] = [];
  for (const d of sorted) {
    const last = segs[segs.length - 1];
    const pid = d.person_id ?? null;
    if (
      last &&
      (last.person_id ?? null) === pid &&
      dayjs(last.end).add(1, "day").format("YYYY-MM-DD") === d.date
    ) {
      last.end = d.date;
    } else {
      segs.push({ start: d.date, end: d.date, person_id: pid });
    }
  }
  return segs;
}

/** 只挪某一日历天到目标日（其余天不动，连续块会拆开）。 */
function buildSegmentsAfterMovingDay(
  op: OperationItem,
  fromDate: string,
  toDate: string,
): PlanSegPayload[] | null {
  const days = expandOpPlanDays(op);
  if (!days.some((d) => d.date === fromDate)) return null;
  if (fromDate === toDate) return compressDaysToSegments(days);
  const src = days.find((d) => d.date === fromDate);
  const rest = days.filter((d) => d.date !== fromDate);
  if (!rest.some((d) => d.date === toDate)) {
    rest.push({ date: toDate, person_id: src?.person_id ?? null });
  }
  return compressDaysToSegments(rest);
}

/**
 * 左右拉宽某一连续 run（bar_start~bar_end）。
 * 左缘不得早于今天；右缘可拉到更远的未来。
 */
function buildAfterBarResize(
  op: OperationItem,
  edge: "left" | "right",
  runStart: string,
  runEnd: string,
  targetDate: string,
  today: string,
): {
  plan_start: string;
  duration_days: number;
  plan_segments?: PlanSegPayload[];
} | null {
  const preview = previewResizeRange(edge, runStart, runEnd, targetDate, today);
  if (!preview) return null;
  if (preview.start === runStart && preview.end === runEnd) return null;

  const newStart = preview.start;
  const newEnd = preview.end;
  const duration = dayjs(newEnd).diff(dayjs(newStart), "day") + 1;
  const segs = (op.plan_segments ?? []).filter((s) => s.start);
  if (!segs.length) {
    return { plan_start: newStart, duration_days: duration };
  }

  const days = expandOpPlanDays(op);
  const outside = days.filter((d) => d.date < runStart || d.date > runEnd);
  const pid =
    days.find((d) => d.date >= runStart && d.date <= runEnd)?.person_id ?? null;
  const runDays: PlanDayCell[] = [];
  let cur = dayjs(newStart);
  const endD = dayjs(newEnd);
  while (cur.isBefore(endD, "day") || cur.isSame(endD, "day")) {
    runDays.push({ date: cur.format("YYYY-MM-DD"), person_id: pid });
    cur = cur.add(1, "day");
  }
  const merged = compressDaysToSegments([...outside, ...runDays]);
  const planStart = merged.map((s) => s.start).sort()[0] || newStart;
  return {
    plan_start: planStart,
    duration_days: merged.reduce(
      (n, s) => n + dayjs(s.end).diff(dayjs(s.start), "day") + 1,
      0,
    ),
    plan_segments: merged,
  };
}

/** 拉伸过程中的预览起止（与正式提交同一套钳制规则）。 */
function previewResizeRange(
  edge: "left" | "right",
  runStart: string,
  runEnd: string,
  targetDate: string,
  today: string,
): { start: string; end: string } | null {
  let newStart = runStart;
  let newEnd = runEnd;
  if (edge === "left") {
    if (runStart < today) return { start: runStart, end: runEnd };
    if (targetDate < today) {
      if (runStart <= today) return { start: runStart, end: runEnd };
      newStart = today;
    } else {
      newStart = targetDate;
    }
    if (newStart > runEnd) newStart = runEnd;
  } else {
    newEnd = targetDate < runStart ? runStart : targetDate;
  }
  return { start: newStart, end: newEnd };
}

function shortDate(iso?: string | null) {
  if (!iso) return "-";
  return iso.slice(5, 10);
}

function orderRollupStatus(ops: OperationItem[]) {
  if (!ops.length) return "未排产";
  if (ops.every((o) => o.status === "done")) return "已完成";
  if (ops.some((o) => o.status === "exception")) return "异常";
  if (ops.some((o) => o.status === "running" || o.status === "paused")) return "进行中";
  if (ops.some((o) => o.plan_start)) return "未开始";
  return "未开始";
}

type EffortLine = { name: string; hours: number; days: number };

function personNameMap(persons?: Array<{ id: string; name: string }>) {
  const map = new Map<string, string>();
  for (const p of persons ?? []) map.set(p.id, p.name);
  return map;
}

/** 某日色块上应显示的责任人（优先看当天命中的时间段）。 */
function dayAssigneeNames(
  op: OperationItem,
  dateIso: string,
  nameById: Map<string, string>,
): string[] {
  const segs = (op.plan_segments ?? []).filter((s) => s.start);
  if (segs.length) {
    const names: string[] = [];
    for (const s of segs) {
      const a = s.start.slice(0, 10);
      const b = (s.end || s.start).slice(0, 10);
      if (dateIso < a || dateIso > b) continue;
      if (s.person_id) {
        const n = nameById.get(s.person_id) || s.person_id;
        if (!names.includes(n)) names.push(n);
      } else if (op.assignee_names?.length) {
        for (const n of op.assignee_names) if (!names.includes(n)) names.push(n);
      } else if (op.assignee_name && !names.includes(op.assignee_name)) {
        names.push(op.assignee_name);
      }
    }
    if (names.length) return names;
  }
  if (op.assignee_names?.length) return [...op.assignee_names];
  if (op.assignee_name) return [op.assignee_name];
  return [];
}

function planEffortByPerson(
  op: OperationItem,
  nameById: Map<string, string>,
): EffortLine[] {
  const hpd = op.hours_per_day ?? 8;
  const segs = (op.plan_segments ?? []).filter((s) => s.start);
  if (segs.length) {
    const daysByKey = new Map<string, number>();
    for (const s of segs) {
      const days = dayjs((s.end || s.start).slice(0, 10)).diff(dayjs(s.start.slice(0, 10)), "day") + 1;
      const key = s.person_id || "__shared__";
      daysByKey.set(key, (daysByKey.get(key) || 0) + days);
    }
    if (daysByKey.size === 1 && daysByKey.has("__shared__")) {
      const days = daysByKey.get("__shared__") || 1;
      const label =
        (op.assignee_names?.length ? op.assignee_names.join("、") : op.assignee_name) ||
        "未派人";
      return [{ name: label, hours: Math.round(days * hpd * 10) / 10, days }];
    }
    const out: EffortLine[] = [];
    for (const [key, days] of daysByKey) {
      if (key === "__shared__") {
        const label =
          (op.assignee_names?.length ? op.assignee_names.join("、") : op.assignee_name) ||
          "未派人";
        out.push({ name: label, hours: Math.round(days * hpd * 10) / 10, days });
        continue;
      }
      out.push({
        name: nameById.get(key) || key,
        hours: Math.round(days * hpd * 10) / 10,
        days,
      });
    }
    return out;
  }
  const days = Math.max(1, op.segment_day_sum || op.duration_days || 1);
  const hours = op.planned_hours || days * hpd;
  const names = op.assignee_names?.length
    ? op.assignee_names
    : op.assignee_name
      ? [op.assignee_name]
      : ["未派人"];
  if (names.length === 1) {
    return [{ name: names[0], hours: Math.round(hours * 10) / 10, days }];
  }
  return names.map((n) => ({
    name: n,
    hours: Math.round(days * hpd * 10) / 10,
    days,
  }));
}

function actualEffortByPerson(op: OperationItem): EffortLine[] {
  const a0 = op.actual_start?.slice(0, 10);
  if (!a0) return [];
  const a1 =
    op.actual_end?.slice(0, 10) ||
    (op.status === "running" || op.status === "paused" ? TODAY_ISO() : a0);
  const days = Math.max(1, dayjs(a1).diff(dayjs(a0), "day") + 1);
  const hpd = op.hours_per_day ?? 8;
  const names = op.assignee_names?.length
    ? op.assignee_names
    : op.assignee_name
      ? [op.assignee_name]
      : ["未派人"];
  return names.map((n) => ({
    name: n,
    hours: Math.round(days * hpd * 10) / 10,
    days,
  }));
}

function EffortSection({
  title,
  blocks,
}: {
  title: string;
  blocks: Array<{ name: string; lines: EffortLine[] }>;
}) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>
      {blocks.length ? (
        blocks.map((b) => (
          <div key={`${title}-${b.name}`} style={{ marginBottom: 4 }}>
            <div style={{ color: "rgba(255,255,255,0.88)" }}>{b.name}</div>
            {b.lines.map((l, i) => (
              <div
                key={`${b.name}-${l.name}-${i}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  columnGap: 12,
                  paddingLeft: 10,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</span>
                <span style={{ textAlign: "right", minWidth: 36 }}>{l.hours}h</span>
                <span style={{ textAlign: "right", minWidth: 28 }}>{l.days}天</span>
              </div>
            ))}
          </div>
        ))
      ) : (
        <div style={{ paddingLeft: 10 }}>—</div>
      )}
    </div>
  );
}

function buildOrderHoverTip(
  row: GanttOrderRow,
  opts: {
    nameById: Map<string, string>;
    conflictCount: number;
  },
): ReactNode {
  const ops = [...(row.operations || [])].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const status = orderRollupStatus(ops);
  const source = row.source_type_label || (row.source_type === "customer" ? "客户订单" : "内部生产");
  const title = [row.order_code, source].filter(Boolean).join(" · ");
  const subtitle = [row.work_order_name || row.work_order_code, status]
    .filter(Boolean)
    .join(" · ");

  const remaining =
    ops.filter((o) => o.status !== "done").length + (row.unreleased_count || 0);
  const planStart = row.plan_start || ops.map((o) => o.plan_start).filter(Boolean).sort()[0];
  const planEnd =
    row.estimated_end ||
    [...ops.map((o) => o.plan_end || o.plan_start).filter(Boolean)].sort().slice(-1)[0];
  const plannedHours = ops.reduce(
    (n, o) =>
      n +
      (o.planned_hours ||
        (o.segment_day_sum || o.duration_days || 0) * (o.hours_per_day ?? 8)),
    0,
  );
  const hpdHint = ops[0]?.hours_per_day ?? 8;

  const planBlocks = ops
    .filter((o) => o.plan_start || (o.plan_segments && o.plan_segments.length))
    .map((o) => ({
      name: o.name,
      lines: planEffortByPerson(o, opts.nameById),
    }));

  const actualBlocks = ops
    .map((o) => ({ name: o.name, lines: actualEffortByPerson(o) }))
    .filter((x) => x.lines.length);

  let progStart: string | undefined;
  let progEnd: string | undefined;
  for (const o of ops) {
    const a0 = o.actual_start?.slice(0, 10);
    if (!a0) continue;
    const a1 =
      o.actual_end?.slice(0, 10) ||
      (o.status === "running" || o.status === "paused" ? TODAY_ISO() : a0);
    if (!progStart || a0 < progStart) progStart = a0;
    if (!progEnd || a1 > progEnd) progEnd = a1;
  }
  // 进度工时：按工序实际窗×日工时，避免多人重复累加
  const actualHours = ops.reduce((n, o) => {
    const a0 = o.actual_start?.slice(0, 10);
    if (!a0) return n;
    const a1 =
      o.actual_end?.slice(0, 10) ||
      (o.status === "running" || o.status === "paused" ? TODAY_ISO() : a0);
    const days = Math.max(1, dayjs(a1).diff(dayjs(a0), "day") + 1);
    return n + days * (o.hours_per_day ?? 8);
  }, 0);

  const gap = ops.reduce((n, o) => n + (o.staffing_gap || 0), 0);
  const pct =
    plannedHours > 0 ? Math.min(100, Math.round((actualHours / plannedHours) * 100)) : 0;

  return (
    <div style={{ lineHeight: 1.55, maxWidth: 320, fontSize: 12 }}>
      <div style={{ fontSize: 13 }}>
        <b>{title}</b>
      </div>
      <div>{subtitle}</div>
      <div style={{ marginTop: 4 }}>
        交期 {shortDate(row.due_date)} · 剩余 {remaining} 道工序
      </div>
      <div>
        计划 {shortDate(planStart)}～{shortDate(planEnd)} · 共{" "}
        {Math.round(plannedHours * 10) / 10}h（日 {hpdHint}h）
      </div>
      <EffortSection title="计划人员" blocks={planBlocks} />
      <EffortSection title="实际" blocks={actualBlocks} />
      <div style={{ marginTop: 6 }}>
        进度{" "}
        {progStart
          ? `${shortDate(progStart)}～${shortDate(progEnd)} · ${Math.round(actualHours * 10) / 10}h / ${Math.round(plannedHours * 10) / 10}h（${pct}%）`
          : `— · 0h / ${Math.round(plannedHours * 10) / 10}h`}
      </div>
      <div>
        缺编 {gap} / 冲突 {opts.conflictCount}
      </div>
    </div>
  );
}

function buildDayCellTip(
  op: OperationItem,
  dateIso: string,
  nameById: Map<string, string>,
  kind: "plan" | "actual" = "plan",
  showDragHint = false,
): ReactNode {
  const names = dayAssigneeNames(op, dateIso, nameById);
  const who = names.length ? names.join("、") : "未派人";
  const slot =
    kind === "actual"
      ? "实绩"
      : op.shift_time_label || op.slot_label || "全天";
  return (
    <div style={{ lineHeight: 1.7 }}>
      <div>
        <b>{op.name}</b> · {who}
      </div>
      <div>
        {shortDate(dateIso)} · {slot}
      </div>
      {showDragHint ? (
        <div style={{ marginTop: 4, opacity: 0.85, fontSize: 12 }}>
          拖中间改期；左右边缘拉宽/缩短
        </div>
      ) : null}
    </div>
  );
}

/** 按计划区间（含多段）给工序固定泳道；段间隙可被其他工序占用。 */
function opPlanIntervals(op: OperationItem): Array<[string, string]> {
  const segs = op.plan_segments?.filter((s) => s.start);
  if (segs?.length) {
    return segs.map((s) => [
      s.start.slice(0, 10),
      (s.end || s.start).slice(0, 10),
    ]);
  }
  const start = (op.plan_start || "").slice(0, 10);
  const end = (op.plan_end || op.plan_start || "").slice(0, 10);
  return start ? [[start, end]] : [];
}

function intervalsOverlap(a0: string, a1: string, b0: string, b1: string) {
  return a0 <= b1 && b0 <= a1;
}

function assignGanttLanes(ops: OperationItem[]): {
  laneOf: Map<string, number>;
  laneCount: number;
} {
  const sorted = [...ops]
    .filter((o) => o.plan_start || (o.plan_segments && o.plan_segments.length))
    .sort((a, b) => {
      const as = (a.plan_start || a.plan_segments?.[0]?.start || "").slice(0, 10);
      const bs = (b.plan_start || b.plan_segments?.[0]?.start || "").slice(0, 10);
      if (as !== bs) return as.localeCompare(bs);
      return (a.seq || 0) - (b.seq || 0);
    });
  const laneOcc: Array<Array<[string, string]>> = [];
  const laneOf = new Map<string, number>();
  for (const op of sorted) {
    const intervals = opPlanIntervals(op);
    if (!intervals.length) continue;
    let placed = -1;
    for (let i = 0; i < laneOcc.length; i++) {
      const busy = laneOcc[i];
      const clash = intervals.some(([s, e]) =>
        busy.some(([bs, be]) => intervalsOverlap(s, e, bs, be)),
      );
      if (!clash) {
        placed = i;
        laneOcc[i] = [...busy, ...intervals];
        break;
      }
    }
    if (placed < 0) {
      placed = laneOcc.length;
      laneOcc.push([...intervals]);
    }
    laneOf.set(op.id, placed);
  }
  return { laneOf, laneCount: Math.max(laneOcc.length, 1) };
}

function slotLabel(op: { slot?: string; shift_time_label?: string; shift_name?: string }) {
  if (op.shift_name || op.shift_time_label) {
    return `${op.shift_name || ""}${op.shift_time_label ? ` ${op.shift_time_label}` : ""}`.trim();
  }
  if (op.slot === "am") return "上午";
  if (op.slot === "pm") return "下午";
  return "全天";
}

/** 过去日期灰色；今天及以后正常色 */
function pastDateCellRender(current: Dayjs, info: { type: string; originNode: ReactNode }) {
  if (info.type !== "date") return info.originNode;
  const isPast = current.isBefore(dayjs().startOf("day"));
  return (
    <div
      className="ant-picker-cell-inner"
      style={isPast ? { color: "#bfbfbf" } : undefined}
    >
      {current.date()}
    </div>
  );
}

function disablePastDate(current: Dayjs) {
  return current.isBefore(dayjs().startOf("day"));
}

function toDateStr(value: string | Dayjs | null | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value.slice(0, 10);
  return value.format("YYYY-MM-DD");
}

const TODAY_ISO = () => dayjs().format("YYYY-MM-DD");

export default function GanttPage() {
  const [horizon, setHorizon] = useState<"focus" | "all">("focus");
  const { data, loading, refresh, setData } = useRequest(() => fetchGantt(horizon), {
    immediate: true,
    deps: [horizon],
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const [sourceFilter, setSourceFilter] = useState<string | undefined>();
  const [dragState, setDragState] = useState<{
    opId: string;
    fromDate: string;
  } | null>(null);
  const [dragChoice, setDragChoice] = useState<{
    opId: string;
    opName: string;
    fromDate: string;
    toDate: string;
    dayCount: number;
  } | null>(null);
  const [detailRow, setDetailRow] = useState<GanttOrderRow | null>(null);
  const [fleetStatsOpen, setFleetStatsOpen] = useState(false);
  const [resizeState, setResizeState] = useState<{
    opId: string;
    edge: "left" | "right";
    runStart: string;
    runEnd: string;
    hoverDate: string;
  } | null>(null);
  const resizeStateRef = useRef(resizeState);
  resizeStateRef.current = resizeState;
  const suppressBarDragRef = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [editing, setEditing] = useState<OperationItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [impact, setImpact] = useState<ImpactPreview | null>(null);
  const [impactApplying, setImpactApplying] = useState(false);
  const [replanOpen, setReplanOpen] = useState(false);
  const [replanStrategy, setReplanStrategy] = useState<string>("protect_due");
  const [replanScope, setReplanScope] = useState<string>("gantt");
  const [replanPreviewing, setReplanPreviewing] = useState(false);
  const [replanAdvanced, setReplanAdvanced] = useState(false);
  const [ganttFullscreen, setGanttFullscreen] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(() => new Set());
  const [viewportH, setViewportH] = useState(
    () => (typeof window !== "undefined" ? window.innerHeight : 800),
  );
  const pendingActionRef = useRef<(() => Promise<void>) | null>(null);
  const pendingReplanRef = useRef({ strategy: "protect_due", scope: "gantt" });
  const conflictTableRef = useRef<HTMLDivElement | null>(null);
  const ganttScrollRef = useRef<HTMLDivElement | null>(null);
  const [form] = Form.useForm();
  const [addForm] = Form.useForm();
  const selectedOrderId = Form.useWatch("order_id", addForm) as string | undefined;
  const scheduleHorizon = Form.useWatch("horizon_days", addForm) as number | undefined;
  const scheduleStartWatch = Form.useWatch("plan_start", addForm) as Dayjs | string | null | undefined;

  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!ganttFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGanttFullscreen(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [ganttFullscreen]);

  const ganttTableScrollY = ganttFullscreen ? Math.max(320, viewportH - 160) : 480;

  const dates = data?.dates ?? [];
  const axis = data?.axis;
  const sandboxActive = !!data?.sandbox?.active;

  const scrollGanttToToday = () => {
    const target = axis?.scroll_to || TODAY_ISO();
    const idx = dates.indexOf(target);
    if (idx < 0) return;
    const root = ganttScrollRef.current;
    if (!root) return;
    const body =
      root.querySelector<HTMLElement>(".ant-table-body") ||
      root.querySelector<HTMLElement>(".ant-table-content");
    if (!body) return;
    const leftCol = 248 + 96;
    const colW = 128;
    body.scrollLeft = Math.max(0, leftCol + idx * colW - colW * 2);
  };

  useEffect(() => {
    if (!dates.length || !axis?.scroll_to) return;
    const t = window.setTimeout(() => scrollGanttToToday(), 80);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 数据刷新后滚到今天
  }, [axis?.scroll_to, dates.length, ganttFullscreen]);

  const schedulableOrders = useMemo(
    () => (data?.order_options ?? []).filter((o) => (o.unscheduled_count ?? 0) > 0),
    [data?.order_options],
  );

  /** 每行订单：工序固定泳道（跨天不错位）；计划/实绩分行计泳道 */
  const rowLanes = useMemo(() => {
    const map = new Map<string, ReturnType<typeof assignGanttLanes>>();
    for (const row of data?.rows ?? []) {
      const key = `${row.order_id || row.work_order_id || ""}:${row.row_kind || "plan"}`;
      map.set(key, assignGanttLanes(row.operations ?? []));
    }
    return map;
  }, [data?.rows]);

  const allOrderIds = useMemo(() => {
    const ids: string[] = [];
    for (const row of data?.rows ?? []) {
      if (row.row_kind === "plan" && row.order_id && !ids.includes(row.order_id)) {
        ids.push(row.order_id);
      }
    }
    return ids;
  }, [data?.rows]);

  const toggleOrderExpand = (orderId: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const expandAllOrders = () => setExpandedOrders(new Set(allOrderIds));
  const collapseAllOrders = () => setExpandedOrders(new Set());

  const selectedOrder: GanttOption | undefined = useMemo(
    () => schedulableOrders.find((o) => o.id === selectedOrderId),
    [schedulableOrders, selectedOrderId],
  );

  /** 按滚动窗口估算本窗释放 / 留待下周期 */
  const releasePreview = useMemo(() => {
    const ops = selectedOrder?.unscheduled_ops ?? [];
    if (!ops.length) return { release: [] as typeof ops, hold: [] as typeof ops };
    const horizon = scheduleHorizon ?? 14;
    let cursor = toDateStr(scheduleStartWatch) || TODAY_ISO();
    if (cursor < TODAY_ISO()) cursor = TODAY_ISO();
    if (horizon <= 0) return { release: ops, hold: [] as typeof ops };
    const windowEnd = dayjs(cursor).add(horizon - 1, "day").format("YYYY-MM-DD");
    const release: typeof ops = [];
    const hold: typeof ops = [];
    let stopped = false;
    for (const op of ops) {
      const days = Math.max(1, op.duration_days ?? 2);
      if (!stopped && cursor > windowEnd) stopped = true;
      if (stopped) {
        hold.push(op);
        continue;
      }
      release.push(op);
      cursor = dayjs(cursor).add(days, "day").format("YYYY-MM-DD");
    }
    return { release, hold };
  }, [selectedOrder, scheduleHorizon, scheduleStartWatch]);

  const rows = useMemo(() => {
    let list = data?.rows ?? [];
    if (sourceFilter) list = list.filter((r) => r.source_type === sourceFilter);
    // 折叠：每订单只占一行（隐藏实绩行）；展开才出计划+实绩双行
    return list.filter((r) => {
      if (r.row_kind === "actual") {
        return !!(r.order_id && expandedOrders.has(r.order_id));
      }
      return true;
    });
  }, [data?.rows, sourceFilter, expandedOrders]);

  /** 汇总统计用：全部计划行（抽屉内再筛） */
  const statsPlanRows = useMemo(() => {
    return (data?.rows ?? []).filter((r) => r.row_kind !== "actual");
  }, [data?.rows]);

  /** 订单斑马序号：同单一色，便于远看区分 */
  const orderStripeIndex = useMemo(() => {
    const map = new Map<string, number>();
    let i = 0;
    for (const r of rows) {
      const oid = r.order_id;
      if (r.row_kind === "plan" && oid && !map.has(oid)) {
        map.set(oid, i);
        i += 1;
      }
    }
    return map;
  }, [rows]);

  const actualRowByOrder = useMemo(() => {
    const map = new Map<string, GanttOrderRow>();
    for (const r of data?.rows ?? []) {
      if (r.row_kind === "actual" && r.order_id) map.set(r.order_id, r);
    }
    return map;
  }, [data?.rows]);

  const personNameById = useMemo(() => personNameMap(data?.persons), [data?.persons]);

  const conflictCountByOrder = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of data?.conflicts ?? []) {
      const code = c.order_code;
      if (!code) continue;
      map.set(code, (map.get(code) || 0) + 1);
    }
    return map;
  }, [data?.conflicts]);

  const openImpact = (preview: ImpactPreview, apply: () => Promise<void>) => {
    setImpact(preview);
    pendingActionRef.current = apply;
  };

  const confirmImpact = async () => {
    const action = pendingActionRef.current;
    if (!action) {
      setImpact(null);
      return;
    }
    setImpactApplying(true);
    try {
      await action();
      setImpact(null);
      pendingActionRef.current = null;
    } catch (e) {
      message.error(e instanceof Error ? e.message : "应用失败");
    } finally {
      setImpactApplying(false);
    }
  };

  const { mutate: doReplan, loading: replanning } = useMutation(
    (opts: { strategy: string; scope: string }) => replanGantt(opts.strategy, opts.scope),
    {
      successMessage: (_r, args) => {
        const { strategy, scope } = args[0];
        const sLabel =
          REPLAN_STRATEGY_OPTIONS.find((s) => s.value === strategy)?.label || strategy;
        const scLabel = REPLAN_SCOPE_OPTIONS.find((s) => s.value === scope)?.label || scope;
        return `重排完成（${scLabel} · ${sLabel}）`;
      },
      onSuccess: (next) => setData(next),
    },
  );

  const requestReplan = () => {
    setReplanStrategy("protect_due");
    setReplanScope("gantt");
    setReplanAdvanced(false);
    setReplanOpen(true);
  };

  const runReplanPreview = async () => {
    setReplanPreviewing(true);
    try {
      const strategy = replanStrategy || "protect_due";
      const scope = replanScope || "gantt";
      pendingReplanRef.current = { strategy, scope };
      const preview = await previewReplanGantt(strategy, scope);
      setReplanOpen(false);
      openImpact(preview, async () => {
        await doReplan(pendingReplanRef.current);
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "预览失败");
    } finally {
      setReplanPreviewing(false);
    }
  };

  const { mutate: doUndo, loading: undoing } = useMutation(undoGantt, {
    successMessage: "已回退到上一快照",
    onSuccess: (next) => setData(next),
  });

  const { mutate: doRedo, loading: redoing } = useMutation(redoGantt, {
    successMessage: "已前进到下一快照",
    onSuccess: (next) => setData(next),
  });

  const { mutate: doEnterSandbox, loading: enteringSandbox } = useMutation(enterSandbox, {
    successMessage: (r) => r?.sandbox_message || "已进入试排",
    onSuccess: (next) => setData(next),
  });

  const { mutate: doDiscardSandbox, loading: discardingSandbox } = useMutation(discardSandbox, {
    successMessage: (r) => r?.sandbox_message || "已放弃试排",
    onSuccess: (next) => setData(next),
  });

  const { mutate: doPublishSandbox, loading: publishingSandbox } = useMutation(publishSandbox, {
    successMessage: (r) => r?.sandbox_message || "试排已发布",
    onSuccess: (next) => setData(next),
  });

  const { mutate: doResetDemo, loading: resettingDemo } = useMutation(resetSchedulingDemo, {
    successMessage: (r) => r?.message || "已恢复演示排产",
    onSuccess: async () => {
      await refresh();
    },
  });

  const history = data?.history;

  const applyWholeShift = async (op: OperationItem, fromDate: string, toDate: string) => {
    const today = TODAY_ISO();
    const oldStart = (op.plan_start || fromDate).slice(0, 10);
    if (oldStart < today) {
      message.warning(
        "该工序已在今天之前开始，不可整段改开始日；可拖未来日并在弹窗选「只挪本日」",
      );
      return;
    }
    const delta = dayjs(toDate).diff(dayjs(fromDate), "day");
    if (delta === 0) return;
    const newStart = dayjs(oldStart).add(delta, "day").format("YYYY-MM-DD");
    if (newStart < today) {
      message.warning("整段平移后会落到今天之前，已取消");
      return;
    }
    const preview = await previewMoveGanttTask(op.id, {
      plan_start: newStart,
      cascade: true,
    });
    openImpact(preview, async () => {
      const result = await moveGanttTask(op.id, { plan_start: newStart, cascade: true });
      const active = activeBusyHints(result);
      if (active.length) {
        message.warning(active.map((h) => h.message).join("；"));
      } else {
        message.success(
          delta > 0
            ? `整段后移 ${delta} 天，后置工序已顺延`
            : `整段前移 ${-delta} 天，后置工序已顺延`,
        );
      }
      await refresh();
    });
  };

  const applySingleDayMove = async (
    op: OperationItem,
    fromDate: string,
    toDate: string,
  ) => {
    const today = TODAY_ISO();
    if (fromDate < today) {
      message.warning("历史日已冻结，不能拆开挪走");
      return;
    }
    if (toDate < today) {
      message.warning("不能挪到今天之前");
      return;
    }
    const segs = buildSegmentsAfterMovingDay(op, fromDate, toDate);
    if (!segs?.length) {
      message.warning("无法拆出该日，请点开工序手动改时间段");
      return;
    }
    const planStart = segs.map((s) => s.start).sort()[0];
    const preview = await previewMoveGanttTask(op.id, {
      plan_start: planStart,
      plan_segments: segs,
      cascade: true,
    });
    openImpact(preview, async () => {
      const result = await moveGanttTask(op.id, {
        plan_start: planStart,
        plan_segments: segs,
        cascade: true,
      });
      const active = activeBusyHints(result);
      if (active.length) {
        message.warning(active.map((h) => h.message).join("；"));
      } else {
        message.success(
          fromDate === toDate
            ? "日期未变"
            : `已把 ${fromDate.slice(5)} 拆开挪到 ${toDate.slice(5)}`,
        );
      }
      await refresh();
    });
  };

  const onDropToDate = async (opId: string, toDate: string, fromDate: string) => {
    const today = TODAY_ISO();
    if (toDate < today) {
      message.warning("历史日期已冻结，不能拖到今天之前");
      setDragState(null);
      return;
    }
    const op = data?.tasks?.find((t) => t.id === opId);
    if (!op) {
      setDragState(null);
      return;
    }
    const days = expandOpPlanDays(op);
    const dayCount = days.length;
    try {
      if (dayCount <= 1 || fromDate === toDate) {
        await applyWholeShift(op, fromDate || op.plan_start?.slice(0, 10) || toDate, toDate);
      } else {
        // 连续多天：先问整段一起移，还是只挪抓取日
        setDragChoice({
          opId,
          opName: op.name,
          fromDate,
          toDate,
          dayCount,
        });
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "预览失败");
    } finally {
      setDragState(null);
    }
  };

  const confirmDragChoice = async (mode: "whole" | "day") => {
    if (!dragChoice) return;
    const op = data?.tasks?.find((t) => t.id === dragChoice.opId);
    const choice = dragChoice;
    setDragChoice(null);
    if (!op) return;
    try {
      if (mode === "whole") {
        await applyWholeShift(op, choice.fromDate, choice.toDate);
      } else {
        await applySingleDayMove(op, choice.fromDate, choice.toDate);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "预览失败");
    }
  };

  const finishBarResize = async () => {
    const st = resizeStateRef.current;
    setResizeState(null);
    suppressBarDragRef.current = false;
    if (!st) return;
    const target = (st.hoverDate || "").slice(0, 10);
    if (!target) return;
    const op = dataRef.current?.tasks?.find((t) => t.id === st.opId);
    if (!op) return;
    const today = TODAY_ISO();
    const payload = buildAfterBarResize(
      op,
      st.edge,
      st.runStart,
      st.runEnd,
      target,
      today,
    );
    if (!payload) {
      if (st.edge === "left" && target < today) {
        message.warning("左缘不能拉到今天之前");
      }
      return;
    }
    try {
      const body = {
        plan_start: payload.plan_start,
        duration_days: payload.duration_days,
        ...(payload.plan_segments ? { plan_segments: payload.plan_segments } : {}),
        cascade: true,
      };
      const preview = await previewMoveGanttTask(op.id, body);
      openImpact(preview, async () => {
        const result = await moveGanttTask(op.id, body);
        const active = activeBusyHints(result);
        if (active.length) {
          message.warning(active.map((h) => h.message).join("；"));
        } else {
          const endIso = dayjs(payload.plan_start)
            .add(payload.duration_days - 1, "day")
            .format("YYYY-MM-DD");
          message.success(`已调整为 ${payload.plan_start} ~ ${endIso}（${payload.duration_days} 天）`);
        }
        await refresh();
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "预览失败");
    }
  };

  const startBarResize = (
    op: OperationItem,
    edge: "left" | "right",
    e: React.PointerEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    suppressBarDragRef.current = true;
    const runStart = (op.bar_start || op.plan_start || "").slice(0, 10);
    const runEnd = (op.bar_end || op.plan_end || runStart).slice(0, 10);
    if (!runStart) return;
    setDragState(null);
    setResizeState({
      opId: op.id,
      edge,
      runStart,
      runEnd,
      hoverDate: edge === "left" ? runStart : runEnd,
    });
  };

  useEffect(() => {
    if (!resizeState) return;
    const onUp = () => {
      void finishBarResize();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setResizeState(null);
        suppressBarDragRef.current = false;
      }
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!resizeState]);

  const openScheduleForOrder = (orderId: string) => {
    addForm.setFieldsValue({
      order_id: orderId,
      plan_start: dayjs(),
      horizon_days: 14,
    });
    setAddOpen(true);
  };

  const handleConflictAction = async (r: GanttConflict) => {
    const opId = r.action_op_id || r.op_id;
    if (!opId) {
      message.warning("未找到对应工序");
      return;
    }
    if (r.quick_action === "defer" && r.suggest_start) {
      try {
        const preview = await previewMoveGanttTask(opId, {
          plan_start: r.suggest_start.slice(0, 10),
          cascade: true,
        });
        openImpact(preview, async () => {
          await moveGanttTask(opId, {
            plan_start: r.suggest_start!.slice(0, 10),
            cascade: true,
          });
          message.success("已后移并顺延后置工序");
          await refresh();
        });
      } catch (e) {
        message.error(e instanceof Error ? e.message : "预览失败");
      }
      return;
    }
    const op = data?.tasks?.find((t) => t.id === opId);
    if (op) openEdit(op);
    else message.warning("未找到对应工序，请在甘特图上点选");
  };

  // 工单页「立即排产」跳转：?schedule=orderId
  useEffect(() => {
    const orderId = searchParams.get("schedule");
    if (!orderId || !data) return;
    const exists = (data.order_options ?? []).some((o) => o.id === orderId);
    if (exists) {
      openScheduleForOrder(orderId);
    } else {
      message.info("该订单暂无待排产工序，或已全部排上");
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("schedule");
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅响应 URL 参数一次打开
  }, [data, searchParams]);

  const digest = data?.today_digest;
  const digestHasWork =
    !!digest &&
    (digest.unscheduled_order_count > 0 ||
      digest.conflict_count > 0 ||
      digest.leave_count > 0 ||
      digest.staffing_count > 0 ||
      digest.overload_day_count > 0 ||
      digest.delay_count > 0);

  const openEdit = (op: OperationItem) => {
    setEditing(op);
    const segs = (op.plan_segments ?? []).filter((s) => s.start);
    form.setFieldsValue({
      plan_start: op.plan_start ? dayjs(op.plan_start.slice(0, 10)) : dayjs(),
      duration_days: op.duration_days || op.segment_day_sum || 2,
      hours_per_day: op.hours_per_day ?? 8,
      slot: op.slot || "full",
      shift_id: op.shift_id || undefined,
      assignee_ids: op.assignee_ids || (op.assignee_id ? [op.assignee_id] : []),
      plan_segments: segs.map((s) => ({
        person_id: s.person_id || undefined,
        range: [dayjs(s.start.slice(0, 10)), dayjs((s.end || s.start).slice(0, 10))],
      })),
    });
  };

  const { mutate: saveEdit, loading: saving } = useMutation(
    async (values: {
      plan_start: Dayjs | string;
      duration_days: number;
      hours_per_day?: number;
      shift_id?: string;
      assignee_ids?: string[];
      plan_segments?: Array<{
        person_id?: string;
        range?: [Dayjs, Dayjs] | Dayjs[];
      }>;
    }) => {
      if (!editing) return undefined;
      const segs = (values.plan_segments ?? [])
        .map((s, i) => {
          const r = s.range;
          const start = r?.[0] ? toDateStr(r[0]) : undefined;
          const end = r?.[1] ? toDateStr(r[1]) : start;
          if (!start) return null;
          return {
            id: `seg-${i + 1}`,
            person_id: s.person_id || null,
            start,
            end: end || start,
          };
        })
        .filter(Boolean) as Array<{
        id: string;
        person_id: string | null;
        start: string;
        end: string;
      }>;
      const planStart =
        segs.length > 0
          ? segs.map((s) => s.start).sort()[0]
          : toDateStr(values.plan_start);
      if (!planStart) throw new Error("请选择开始日期或时间段");
      const payload = {
        plan_start: planStart,
        duration_days: values.duration_days,
        hours_per_day: values.hours_per_day ?? 8,
        shift_id: values.shift_id,
        assignee_ids: values.assignee_ids ?? [],
        plan_segments: segs,
        cascade: true,
      };
      const preview = await previewMoveGanttTask(editing.id, payload);
      openImpact(preview, async () => {
        const result = await moveGanttTask(editing.id, payload);
        const active = activeBusyHints(result);
        if (active.length) {
          message.warning(active.map((h) => h.message).join("；"));
        } else {
          message.success("工序已更新");
        }
        setEditing(null);
        await refresh();
      });
      return undefined;
    },
    { successMessage: false },
  );

  const { mutate: ackBusy, loading: ackingBusy } = useMutation(
    async () => {
      if (!editing) throw new Error("未选择工序");
      return acknowledgeBusy(editing.id);
    },
    {
      successMessage: (res) => res.message || "已确认并行",
      onSuccess: async (res) => {
        if (res.operation) setEditing(res.operation);
        await refresh();
      },
    },
  );

  const { mutate: resolveVariance, loading: resolvingVariance } = useMutation(
    async (action: "keep" | "adopt_actual" | "cascade_successors") => {
      if (!editing) throw new Error("未选择工序");
      return resolvePlanVariance(editing.id, {
        action,
        cascade: action === "adopt_actual",
      });
    },
    {
      successMessage: (res) => res.message || "已处理偏差",
      onSuccess: async (res) => {
        if (res.operation) setEditing(res.operation);
        await refresh();
      },
    },
  );

  const { mutate: doDelete, loading: deleting } = useMutation(
    async (payload: { opId: string; force?: boolean }) =>
      deleteGanttTask(payload.opId, payload.force),
    {
      successMessage: (result) =>
        result?.forced
          ? "已强制撤下：计划已清空，工序退回待排"
          : "已从甘特撤下，工序仍保留在工单",
      onSuccess: async () => {
        setEditing(null);
        await refresh();
      },
    },
  );

  const { mutate: doSchedule, loading: scheduling } = useMutation(
    async (values: {
      order_id: string;
      plan_start?: Dayjs | string | null;
      horizon_days?: number;
    }) => {
      const payload = {
        order_id: values.order_id,
        plan_start: toDateStr(values.plan_start ?? undefined),
        horizon_days: values.horizon_days ?? 14,
      };
      const preview = await previewScheduleGanttOrder(payload);
      openImpact(preview, async () => {
        const result = await scheduleGanttOrder(payload);
        if (result) setData(result);
        message.success(result?.schedule_summary?.message || "排产完成");
        setAddOpen(false);
        addForm.resetFields();
        await refresh();
      });
      return undefined;
    },
    { successMessage: false },
  );

  const { mutate: doRemoveOrder } = useMutation(
    (orderId: string) => deleteOrder(orderId),
    {
      successMessage: (r) => r?.message || "订单已处理",
      onSuccess: async () => {
        await refresh();
      },
    },
  );

  const columns = [
    {
      title: "订单",
      key: "meta",
      fixed: "left" as const,
      width: 248,
      render: (_: unknown, row: GanttOrderRow) => {
        const isActual = row.row_kind === "actual";
        const tip = buildOrderHoverTip(row, {
          nameById: personNameById,
          conflictCount: conflictCountByOrder.get(row.order_code) || 0,
        });
        const expanded = !!(row.order_id && expandedOrders.has(row.order_id));
        const stripe = orderStripeIndex.get(row.order_id || "") ?? 0;
        const accent = stripe % 2 === 0 ? "#2563eb" : "#0f766e";
        if (isActual) {
          return (
            <div
              style={{
                paddingLeft: 28,
                color: "#4a5568",
                lineHeight: "44px",
                borderLeft: `3px solid ${accent}`,
              }}
            >
              <Tag>实绩</Tag>
              <span style={{ fontSize: 12, color: "#718096" }}>只读</span>
            </div>
          );
        }
        const titleText = row.order_code || row.order_name || "-";
        const subText = row.work_order_name || row.work_order_code || "";
        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              height: expanded ? undefined : 44,
              minHeight: expanded ? 44 : undefined,
              borderLeft: `3px solid ${accent}`,
              paddingLeft: 4,
              boxSizing: "border-box",
            }}
          >
            <Button
              type="text"
              size="small"
              aria-label={expanded ? "折叠订单" : "展开订单"}
              icon={expanded ? <DownOutlined /> : <RightOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                if (row.order_id) toggleOrderExpand(row.order_id);
              }}
              style={{ color: "#4a5568", flexShrink: 0 }}
            />
            <Tooltip title={tip} placement="right">
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  cursor: "default",
                  lineHeight: 1.25,
                  paddingRight: 4,
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {row.is_insert_row ? (
                    <Tag color="red" style={{ marginInlineEnd: 4 }}>
                      插
                    </Tag>
                  ) : null}
                  {titleText}
                </div>
                {subText ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#718096",
                      fontWeight: 400,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      marginTop: 1,
                    }}
                  >
                    {subText}
                  </div>
                ) : null}
              </div>
            </Tooltip>
          </div>
        );
      },
    },
    {
      title: "操作",
      key: "actions",
      fixed: "left" as const,
      width: 96,
      render: (_: unknown, row: GanttOrderRow) => {
        if (row.row_kind === "actual" || row.editable === false) {
          return <span style={{ color: "#a0aec0", fontSize: 12 }}>—</span>;
        }
        if (!row.order_id) return null;
        return (
          <Space size={0} wrap>
            <Button
              type="link"
              size="small"
              style={{ paddingInline: 4 }}
              onClick={() => setDetailRow(row)}
            >
              详情
            </Button>
            <DeleteAction
              title="删除 / 作废该订单？"
              content="无完工实绩则整单删除（含工单与工序）；若有进行中或已完工则作废并撤出甘特，实绩保留。"
              successMessage={false}
              onConfirm={() => doRemoveOrder(row.order_id!)}
              buttonProps={{ size: "small", type: "link", style: { paddingInline: 4 } }}
            >
              删除
            </DeleteAction>
          </Space>
        );
      },
    },
    ...dates.map((d) => {
      const headerHasDue = (data?.due_markers ?? []).some((m) => m.due_date?.slice(0, 10) === d);
      const isPastCol = d < TODAY_ISO();
      const isTodayCol = d === (axis?.today || TODAY_ISO());
      return {
        title: (
          <div
            style={{
              textAlign: "center",
              fontWeight: isTodayCol ? 700 : 500,
              fontSize: 12,
              lineHeight: 1.3,
              color: isTodayCol ? "#1677ff" : isPastCol ? "#a0aec0" : undefined,
            }}
          >
            <div>{formatDateLabel(d)}</div>
            {isTodayCol ? (
              <div style={{ fontSize: 10, color: "#1677ff" }}>今天</div>
            ) : isPastCol ? (
              <div style={{ fontSize: 10, color: "#a0aec0" }}>已冻结</div>
            ) : headerHasDue ? (
              <div
                title="有订单交期落在本日"
                style={{
                  margin: "2px auto 0",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#ea580c",
                }}
              />
            ) : (
              <div style={{ height: 8 }} />
            )}
          </div>
        ),
        key: d,
        width: 128,
        onCell: () => ({
          onDragOver: (e: React.DragEvent) => {
            if (!isPastCol) e.preventDefault();
          },
          style: {
            verticalAlign: "middle" as const,
            position: "relative" as const,
            padding: "2px 0",
            background: isTodayCol ? "#e6f4ff" : isPastCol ? "#f7f8fa" : undefined,
          },
        }),
        render: (_: unknown, row: GanttOrderRow) => {
          const isActualRow = row.row_kind === "actual" || row.editable === false;
          const orderExpanded = !!(row.order_id && expandedOrders.has(row.order_id));
          const isOrderDue = !!row.due_date && row.due_date.slice(0, 10) === d;
          const DUE_GAP = 7;
          const COLLAPSED_H = 44;

          // —— 折叠：一单一行高度，工序画细线（计划虚线 / 实绩实线）——
          if (!orderExpanded && !isActualRow) {
            const planCells = row.cells?.[d] || [];
            const actualCells =
              (row.order_id && actualRowByOrder.get(row.order_id)?.cells?.[d]) || [];
            type LineItem = { kind: "plan" | "actual"; op: OperationItem };
            const lines: LineItem[] = [
              ...planCells.map((op) => ({ kind: "plan" as const, op })),
              ...actualCells.map((op) => ({ kind: "actual" as const, op })),
            ];
            const n = Math.max(lines.length, 1);
            const step = Math.min(5, Math.max(2, Math.floor((COLLAPSED_H - 8) / n)));
            const lineH = Math.max(2, step - 1);
            return (
              <div
                style={{
                  position: "relative",
                  height: COLLAPSED_H,
                  padding: isOrderDue ? `0 ${DUE_GAP + 2}px 0 2px` : "0 2px",
                }}
                onClick={() => {
                  if (row.order_id) toggleOrderExpand(row.order_id);
                }}
              >
                {isOrderDue ? (
                  <Tooltip title={`交货日 ${formatDateLabel(row.due_date)} · ${row.order_code}`}>
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        right: 0,
                        borderRight: "2px dashed #ea580c",
                        zIndex: 3,
                      }}
                    />
                  </Tooltip>
                ) : null}
                {lines.map((line, i) => {
                  const op = line.op;
                  const seg = op.segment || "single";
                  const isStart = seg === "start" || seg === "single";
                  const isEnd = seg === "end" || seg === "single";
                  const tip = buildDayCellTip(
                    op,
                    d,
                    personNameById,
                    line.kind,
                    false,
                  );
                  return (
                    <Tooltip
                      key={`${line.kind}-${op.id}-${op.bar_start || ""}-${d}`}
                      title={tip}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: 4 + i * step,
                          left: isStart ? 2 : -2,
                          right: isOrderDue ? DUE_GAP : isEnd ? 2 : -2,
                          height: lineH,
                          boxSizing: "border-box",
                          borderRadius: 1,
                          cursor: "pointer",
                          zIndex: 1,
                          ...(line.kind === "plan"
                            ? {
                                height: 0,
                                borderTop: `2px dashed rgba(37,99,235,0.85)`,
                                background: "transparent",
                              }
                            : {
                                height: Math.max(2, lineH),
                                background: "rgba(71,85,105,0.92)",
                              }),
                        }}
                      />
                    </Tooltip>
                  );
                })}
              </div>
            );
          }

          let cells = row.cells?.[d] || [];
          const BAR_H = 44;
          const LANE_GAP = 4;
          const laneKey = `${row.order_id || row.work_order_id || ""}:${row.row_kind || "plan"}`;
          const { laneOf, laneCount } = rowLanes.get(laneKey) ?? {
            laneOf: new Map<string, number>(),
            laneCount: Math.max(cells.length, 1),
          };
          const stackH = Math.max(1, laneCount) * BAR_H + Math.max(0, laneCount - 1) * LANE_GAP;
          // 仅当本行含正在拉伸的工序时，才接收目标日（不影响其它行）
          const rowHasResizeOp =
            !!resizeState &&
            !isActualRow &&
            Object.values(row.cells || {})
              .flat()
              .some((op) => op.id === resizeState.opId);
          const resizePreview =
            rowHasResizeOp && resizeState
              ? previewResizeRange(
                  resizeState.edge,
                  resizeState.runStart,
                  resizeState.runEnd,
                  resizeState.hoverDate,
                  TODAY_ISO(),
                )
              : null;
          const inOrigRun =
            !!resizeState && d >= resizeState.runStart && d <= resizeState.runEnd;
          const inPreviewRun =
            !!resizePreview && d >= resizePreview.start && d <= resizePreview.end;
          // 拉长到空白日：本格没有该工序 → 画新增虚影
          const needAddGhost =
            !!resizeState &&
            rowHasResizeOp &&
            inPreviewRun &&
            !inOrigRun &&
            !cells.some((op) => op.id === resizeState.opId);
          const resizeLane =
            resizeState && rowHasResizeOp ? (laneOf.get(resizeState.opId) ?? 0) : 0;
          const ghostColor = "rgba(37,99,235,0.5)";
          const showStack = cells.length > 0 || needAddGhost;
          return (
            <div
              style={{
                position: "relative",
                minHeight: showStack ? stackH + 8 : 40,
                padding: isOrderDue ? `0 ${DUE_GAP + 2}px 0 2px` : "0 2px",
                background: isActualRow ? "rgba(148,163,184,0.08)" : undefined,
              }}
              onDragOver={(e) => {
                if (!isActualRow && !isPastCol) e.preventDefault();
              }}
              onPointerEnter={() => {
                if (!resizeState || isActualRow || !rowHasResizeOp) return;
                if (resizeState.edge === "left" && d < TODAY_ISO()) return;
                setResizeState((s) => (s ? { ...s, hoverDate: d } : s));
              }}
              onDrop={() => {
                if (isActualRow) {
                  message.warning("实绩行不可改，请调整上方计划行");
                  setDragState(null);
                  return;
                }
                if (isPastCol) {
                  message.warning("历史日期已冻结");
                  setDragState(null);
                  return;
                }
                if (dragState) {
                  void onDropToDate(dragState.opId, d, dragState.fromDate);
                }
              }}
            >
              {isOrderDue && !isActualRow ? (
                <Tooltip title={`交货日 ${formatDateLabel(row.due_date)} · ${row.order_code}`}>
                  <div
                    style={{
                      position: "absolute",
                      top: -2,
                      bottom: -2,
                      right: 0,
                      width: 0,
                      borderRight: "2px dashed #ea580c",
                      zIndex: 3,
                      pointerEvents: "auto",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        right: -5,
                        width: 0,
                        height: 0,
                        borderLeft: "5px solid transparent",
                        borderRight: "5px solid transparent",
                        borderTop: "7px solid #ea580c",
                      }}
                    />
                  </div>
                </Tooltip>
              ) : null}
              {showStack ? (
                <div style={{ position: "relative", height: stackH }}>
                  {needAddGhost ? (
                    <div
                      title="将占用（松手后确认）"
                      style={{
                        position: "absolute",
                        top: resizeLane * (BAR_H + LANE_GAP),
                        left: 0,
                        right: 0,
                        height: BAR_H,
                        background: ghostColor,
                        border: "1px dashed rgba(255,255,255,0.9)",
                        borderRadius: 6,
                        boxSizing: "border-box",
                        pointerEvents: "none",
                        zIndex: 2,
                      }}
                    />
                  ) : null}
                  {cells.map((op) => {
                    const seg = op.segment || "single";
                    const isStart = seg === "start" || seg === "single";
                    const isEnd = seg === "end" || seg === "single";
                    const lane = laneOf.get(op.id) ?? 0;
                    const barColor = isActualRow
                      ? "rgba(71,85,105,0.88)"
                      : (op.staffing_gap || 0) > 0
                        ? "rgba(192,38,211,0.85)"
                        : op.is_insert
                          ? "rgba(220,38,38,0.85)"
                          : op.plan_vs_actual?.needs_action || op.plan_drift
                            ? "rgba(217,119,6,0.9)"
                            : op.status === "running"
                              ? "rgba(22,163,74,0.85)"
                              : "rgba(37,99,235,0.85)";
                    const tip = (
                      <div style={{ lineHeight: 1.7 }}>
                        <div>
                          <b>{op.name}</b>
                          {isActualRow ? " · 实绩（已签字）" : ""}
                          {!isActualRow && op.is_insert ? " · 插队" : ""}
                          {!isActualRow && op.plan_drift_label ? ` · ${op.plan_drift_label}` : ""}
                        </div>
                        <div>
                          计划：{formatDateLabel(op.plan_start)} ~ {formatDateLabel(op.plan_end)}
                          {op.plan_segments?.length
                            ? ` · ${op.plan_segments.length} 段`
                            : ""}
                        </div>
                        {op.plan_segments?.length ? (
                          <div>
                            时间段：
                            {op.plan_segments
                              .map(
                                (s) =>
                                  `${formatDateLabel(s.start)}~${formatDateLabel(s.end)}`,
                              )
                              .join("；")}
                          </div>
                        ) : null}
                        {op.planned_hours ? (
                          <div>
                            计划工时：{op.planned_hours}h（日工时 {op.hours_per_day ?? 8}）
                          </div>
                        ) : null}
                        <div>
                          本条：
                          {formatDateLabel(op.bar_start || op.actual_start)} ~{" "}
                          {formatDateLabel(op.bar_end || op.actual_end)}
                        </div>
                        {!isActualRow && op.plan_vs_actual?.summary ? (
                          <div>偏差：{op.plan_vs_actual.summary}</div>
                        ) : null}
                        <div>责任人：{op.assignee_name || "未派人"}</div>
                        {isOrderDue ? <div>本日为订单交货日</div> : null}
                      </div>
                    );
                    const canDrag =
                      !isActualRow &&
                      op.status !== "done" &&
                      !(
                        op.plan_start &&
                        op.plan_start.slice(0, 10) < TODAY_ISO() &&
                        d < TODAY_ISO()
                      );
                    const runStart = (op.bar_start || op.plan_start || "").slice(0, 10);
                    const runEnd = (op.bar_end || op.plan_end || runStart).slice(0, 10);
                    const todayIso = TODAY_ISO();
                    // 左缘已进入历史：不能再改开始日；贴今天时仍可往右收，但不能再往左
                    const canResizeLeft =
                      !isActualRow && op.status !== "done" && !!runStart && runStart >= todayIso;
                    const canResizeRight =
                      !isActualRow && op.status !== "done" && !!runEnd;
                    const resizingThis = resizeState?.opId === op.id;
                    const willRemove =
                      resizingThis && !!resizePreview && inOrigRun && !inPreviewRun;
                    const needsVariance = !isActualRow && !!op.plan_vs_actual?.needs_action;
                    const dayTip = buildDayCellTip(
                      op,
                      d,
                      personNameById,
                      isActualRow ? "actual" : "plan",
                      !isActualRow && (canDrag || canResizeLeft || canResizeRight),
                    );
                    return (
                      <Tooltip
                        key={`${op.id}-${op.bar_start || ""}-${d}`}
                        title={
                          willRemove ? (
                            <div>将释放（松手后确认）</div>
                          ) : resizingThis ? (
                            <div>
                              横向拉伸中…
                              {resizeState ? ` 目标 ${resizeState.hoverDate}` : ""}
                            </div>
                          ) : (
                            dayTip
                          )
                        }
                      >
                        <div
                          draggable={canDrag && !resizeState}
                          onDragStart={(e) => {
                            if (suppressBarDragRef.current || resizeState) {
                              e.preventDefault();
                              return;
                            }
                            if (!canDrag) return;
                            e.dataTransfer.effectAllowed = "move";
                            setDragState({ opId: op.id, fromDate: d });
                          }}
                          onDragEnd={() => setDragState(null)}
                          onClick={() => {
                            if (!isActualRow && !resizeState) openEdit(op);
                          }}
                          style={{
                            position: "absolute",
                            top: lane * (BAR_H + LANE_GAP),
                            left: isStart ? 0 : -2,
                            right: isOrderDue ? 0 : isEnd ? 0 : -2,
                            cursor: canDrag ? "grab" : isActualRow ? "default" : "pointer",
                            height: BAR_H,
                            padding: "0 6px",
                            background: willRemove ? ghostColor : barColor,
                            color: "#fff",
                            borderTopLeftRadius: isStart ? 6 : 0,
                            borderBottomLeftRadius: isStart ? 6 : 0,
                            borderTopRightRadius: isEnd || isOrderDue ? 6 : 0,
                            borderBottomRightRadius: isEnd || isOrderDue ? 6 : 0,
                            border: willRemove
                              ? "1px dashed rgba(255,255,255,0.9)"
                              : activeBusyHints(op).length
                                ? "1px solid #f59e0b"
                                : needsVariance
                                  ? "1px dashed #fbbf24"
                                  : dragState?.opId === op.id
                                    ? "1px solid #fff"
                                    : "none",
                            opacity: dragState?.opId === op.id ? 0.85 : 1,
                            boxSizing: "border-box",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                            overflow: "hidden",
                            zIndex: 1,
                            pointerEvents: willRemove ? "none" : undefined,
                          }}
                        >
                          {isStart && canResizeLeft && !willRemove ? (
                            <div
                              title="向左拉宽 / 向右缩短（不早于今天）"
                              onPointerDown={(e) => startBarResize(op, "left", e)}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: 10,
                                cursor: "ew-resize",
                                zIndex: 3,
                                background:
                                  runStart <= todayIso
                                    ? "rgba(255,255,255,0.15)"
                                    : "rgba(255,255,255,0.35)",
                                borderTopLeftRadius: 6,
                                borderBottomLeftRadius: 6,
                              }}
                            />
                          ) : null}
                          {isEnd && canResizeRight && !willRemove ? (
                            <div
                              title="向右拉宽 / 向左缩短"
                              onPointerDown={(e) => startBarResize(op, "right", e)}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                position: "absolute",
                                right: 0,
                                top: 0,
                                bottom: 0,
                                width: 10,
                                cursor: "ew-resize",
                                zIndex: 3,
                                background: "rgba(255,255,255,0.35)",
                                borderTopRightRadius: 6,
                                borderBottomRightRadius: 6,
                              }}
                            />
                          ) : null}
                          {isStart ? (
                            <>
                              <div
                                style={{
                                  fontWeight: 600,
                                  fontSize: 12,
                                  lineHeight: 1.25,
                                  whiteSpace: "nowrap",
                                  textOverflow: "ellipsis",
                                  overflow: "hidden",
                                  paddingLeft: canResizeLeft ? 8 : 0,
                                  paddingRight: isEnd && canResizeRight ? 8 : 0,
                                }}
                              >
                                {op.name}
                              </div>
                              <div
                                style={{
                                  fontSize: 11,
                                  opacity: 0.95,
                                  whiteSpace: "nowrap",
                                  textOverflow: "ellipsis",
                                  overflow: "hidden",
                                  paddingLeft: canResizeLeft ? 8 : 0,
                                  paddingRight: isEnd && canResizeRight ? 8 : 0,
                                }}
                              >
                                {isActualRow
                                  ? "已签字"
                                  : willRemove
                                    ? "将释放"
                                    : `${op.segment_day_sum || op.duration_days || 1}天 · ${
                                        (op.staffing_gap || 0) > 0
                                          ? `缺${op.staffing_gap}人`
                                          : op.assignee_name || "未派人"
                                      }`}
                              </div>
                            </>
                          ) : null}
                        </div>
                      </Tooltip>
                    );
                  })}
                </div>
              ) : isActualRow ? (
                <div style={{ fontSize: 11, color: "#a0aec0", padding: "8px 4px" }}>待签字</div>
              ) : null}
            </div>
          );
        },
      };
    }),
  ];

  return (
    <div>
      <PageHeader
        title={
          <Space>
            排产甘特页
            <Tag color="blue">核心页面</Tag>
          </Space>
        }
        extra={
          <Space wrap>
            <Button size="small" type="primary" ghost onClick={() => setFleetStatsOpen(true)}>
              汇总统计
            </Button>
            {sandboxActive ? (
              <>
                <Tag color="orange">试排中</Tag>
                <Button danger loading={discardingSandbox} onClick={() => void doDiscardSandbox()}>
                  放弃试排
                </Button>
                <Button type="primary" loading={publishingSandbox} onClick={() => void doPublishSandbox()}>
                  发布为正式
                </Button>
              </>
            ) : (
              <Button loading={enteringSandbox} onClick={() => void doEnterSandbox()}>
                进入试排
              </Button>
            )}
            <Button
              type="primary"
              onClick={() => {
                addForm.resetFields();
                addForm.setFieldsValue({ plan_start: dayjs(), horizon_days: 14 });
                setAddOpen(true);
              }}
            >
              从工单排产
            </Button>
            <Tooltip
              title={history ? `回退（${history.undo_steps}/${history.limit}）` : "回退"}
            >
              <span>
                <Button
                  icon={<UndoOutlined />}
                  disabled={!history?.can_undo}
                  loading={undoing}
                  onClick={() => void doUndo()}
                />
              </span>
            </Tooltip>
            <Tooltip
              title={history ? `前进（${history.redo_steps}/${history.limit}）` : "前进"}
            >
              <span>
                <Button
                  icon={<RedoOutlined />}
                  disabled={!history?.can_redo}
                  loading={redoing}
                  onClick={() => void doRedo()}
                />
              </span>
            </Tooltip>
            <Button loading={replanning} onClick={() => requestReplan()}>
              一键重排
            </Button>
            <Popconfirm
              title="恢复演示排产？"
              description="按今天重铺计划与进度；人员/技能等主数据保留，订单号不变。"
              okText="恢复"
              cancelText="取消"
              onConfirm={() => void doResetDemo()}
            >
              <Button loading={resettingDemo}>恢复演示排产</Button>
            </Popconfirm>
            <Tooltip title="刷新">
              <Button
                icon={<ReloadOutlined />}
                onClick={() => void refresh()}
                loading={loading}
              />
            </Tooltip>
          </Space>
        }
      />
      {sandboxActive ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="试排模式"
          description={data?.sandbox?.hint || "当前改动在沙盘中，发布后才成为正式计划。"}
        />
      ) : null}
      <KpiRow items={data?.kpis ?? []} loading={loading && !data} />

      {digest ? (
        <div
          style={{
            background: digestHasWork ? "#fffbeb" : "#f0fdf4",
            border: `1px solid ${digestHasWork ? "#fde68a" : "#bbf7d0"}`,
            borderRadius: 12,
            padding: "10px 14px",
            marginBottom: 16,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 600, marginRight: 4 }}>
            今日待办 · {digest.today}
          </span>
          {!digestHasWork ? (
            <Tag color="success">暂无待处理</Tag>
          ) : null}
          {digest.unscheduled_order_count > 0 ? (
            <Button
              size="small"
              type="default"
              icon={<FieldTimeOutlined />}
              onClick={() => {
                const first = digest.unscheduled_orders[0];
                if (first) openScheduleForOrder(first.id);
                else {
                  addForm.resetFields();
                  addForm.setFieldsValue({ plan_start: dayjs(), horizon_days: 14 });
                  setAddOpen(true);
                }
              }}
            >
              待释放 {digest.unscheduled_op_count} 道 / {digest.unscheduled_order_count} 单
            </Button>
          ) : null}
          {digest.conflict_count > 0 ? (
            <Button
              size="small"
              danger
              icon={<WarningOutlined />}
              onClick={() =>
                conflictTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              冲突 {digest.conflict_count}
            </Button>
          ) : null}
          {digest.leave_count > 0 ? (
            <Button
              size="small"
              icon={<SwapOutlined />}
              onClick={() =>
                conflictTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              请假待改派 {digest.leave_count}
            </Button>
          ) : null}
          {digest.staffing_count > 0 ? (
            <Tag color="magenta">缺编 {digest.staffing_count}</Tag>
          ) : null}
          {digest.delay_count > 0 ? (
            <Tag color="orange">延期 {digest.delay_count}</Tag>
          ) : null}
          {digest.overload_day_count > 0 ? (
            <Tag color="red">
              超载 {digest.overload_day_count} 日
              {digest.overload_dates?.[0] ? ` · 起 ${digest.overload_dates[0].slice(5)}` : ""}
            </Tag>
          ) : null}
          <Button size="small" type="link" onClick={() => requestReplan()}>
            一键重排
          </Button>
        </div>
      ) : null}

      <div
        style={
          ganttFullscreen
            ? {
                position: "fixed",
                inset: 0,
                zIndex: 1000,
                background: "#f5f7fa",
                display: "flex",
                flexDirection: "column",
                padding: 16,
              }
            : {
                background: "#fff",
                border: "1px solid #e6eaf0",
                borderRadius: 12,
                padding: 16,
                marginBottom: 16,
              }
        }
      >
        <Space
          wrap
          style={{
            marginBottom: 12,
            width: "100%",
            justifyContent: "space-between",
          }}
        >
          <Space wrap>
            {ganttFullscreen ? (
              <span style={{ fontWeight: 700, fontSize: 16 }}>排产甘特 · 全屏</span>
            ) : null}
            <Select
              allowClear
              placeholder="来源：客户/内部"
              style={{ width: 160 }}
              value={sourceFilter}
              onChange={setSourceFilter}
              options={[
                { value: "customer", label: "客户订单" },
                { value: "internal", label: "内部生产" },
              ]}
            />
            <Select
              value={horizon}
              style={{ width: 140 }}
              onChange={(v: "focus" | "all") => setHorizon(v)}
              options={[
                { value: "focus", label: "聚焦今天" },
                { value: "all", label: "看全未完成" },
              ]}
            />
            <Button size="small" onClick={() => scrollGanttToToday()}>
              今天
            </Button>
            <Button size="small" onClick={expandAllOrders}>
              全部展开
            </Button>
            <Button size="small" onClick={collapseAllOrders}>
              全部折叠
            </Button>
            <span style={{ fontSize: 12, color: "#718096" }}>
              {resizeState
                ? `拉伸中 → ${resizeState.hoverDate}（松手确认，Esc 取消）`
                : axis?.hint ||
                  "展开后：拖中间改期；左右白边拉宽/缩短（左缘不早于今天）"}
            </span>
          </Space>
          <Space>
            {ganttFullscreen ? (
              <Tooltip title="退出全屏（Esc）">
                <Button icon={<CloseOutlined />} onClick={() => setGanttFullscreen(false)}>
                  退出全屏
                </Button>
              </Tooltip>
            ) : (
              <Tooltip title="放大全屏查看甘特">
                <Button icon={<FullscreenOutlined />} onClick={() => setGanttFullscreen(true)}>
                  全屏
                </Button>
              </Tooltip>
            )}
          </Space>
        </Space>
        <div
          ref={ganttScrollRef}
          style={{
            width: "100%",
            overflow: "auto",
            flex: ganttFullscreen ? 1 : undefined,
            background: ganttFullscreen ? "#fff" : undefined,
            borderRadius: ganttFullscreen ? 12 : undefined,
            border: ganttFullscreen ? "1px solid #e6eaf0" : undefined,
            padding: ganttFullscreen ? 12 : undefined,
          }}
        >
          <Table<GanttOrderRow>
            rowKey={(r) => `${r.order_id}:${r.row_kind || "plan"}`}
            loading={loading}
            pagination={false}
            size="small"
            sticky
            scroll={{
              x: Math.max(140 + dates.length * 128, 960),
              y: ganttTableScrollY,
            }}
            dataSource={rows}
            columns={columns}
            rowClassName={(row) => {
              const stripe = orderStripeIndex.get(row.order_id || "") ?? 0;
              const expanded = !!(row.order_id && expandedOrders.has(row.order_id));
              const isOrderBoundary = !expanded || row.row_kind === "actual";
              return [
                stripe % 2 === 1 ? "gantt-order-odd" : "gantt-order-even",
                isOrderBoundary ? "gantt-order-boundary" : "",
              ]
                .filter(Boolean)
                .join(" ");
            }}
          />
          <style>{`
            .gantt-order-even > td.ant-table-cell-fix-left {
              background: #ffffff !important;
            }
            .gantt-order-odd > td.ant-table-cell-fix-left {
              background: #e8eef5 !important;
            }
            .gantt-order-boundary > td {
              border-bottom: 2px solid #64748b !important;
            }
            /* 日期区轻斑马，不盖住「今天」高亮 */
            .gantt-order-odd > td:not(.ant-table-cell-fix-left) {
              box-shadow: inset 0 0 0 999px rgba(226, 232, 240, 0.35);
            }
          `}</style>
        </div>
      </div>

      {(data?.conflicts ?? []).some((c) => c.status === "leave" || c.status === "staffing") ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="存在请假或缺编"
          description={
            <span>
              缺编工序会空着责任人并标注缺几人；请假冲突可点「改派」，或到{" "}
              <Link to="/scheduling/master">基础数据 · 请假与替班</Link> 处理。
            </span>
          }
        />
      ) : null}

      <div ref={conflictTableRef}>
      <DataTable<GanttConflict>
        rowKey={(r) => `${r.status}-${r.op_id || r.task}-${r.reason}`}
        loading={loading}
        dataSource={data?.conflicts ?? []}
        title={() => <span style={{ fontWeight: 600 }}>排产冲突与延期</span>}
        columns={[
          {
            title: "类型",
            dataIndex: "status",
            width: 88,
            render: (v: string) => (
              <StatusTag
                value={v}
                labelMap={{
                  conflict: "冲突",
                  staffing: "缺编",
                  leave: "请假",
                  delay: "延期",
                  risk: "风险",
                }}
                colorMap={{
                  conflict: "red",
                  staffing: "magenta",
                  leave: "purple",
                  delay: "orange",
                  risk: "gold",
                }}
              />
            ),
          },
          {
            title: "工序 / 归属",
            key: "task",
            width: 200,
            render: (_, r) => (
              <div>
                <div style={{ fontWeight: 600 }}>{r.task}</div>
                <div style={{ fontSize: 12, color: "#718096" }}>
                  {r.order_code || "-"} · {r.work_order_code || "-"}
                </div>
              </div>
            ),
          },
          { title: "计划窗口", dataIndex: "plan_window", width: 140 },
          {
            title: "详情",
            key: "detail",
            render: (_, r) => (
              <div>
                <div>{r.reason}</div>
                {r.impact ? (
                  <div style={{ fontSize: 12, color: "#718096", marginTop: 4 }}>影响：{r.impact}</div>
                ) : null}
              </div>
            ),
          },
          { title: "建议动作", dataIndex: "suggestion", width: 200 },
          {
            title: "操作",
            width: 72,
            render: (_, r) => {
              const action = r.quick_action;
              if (!action || !(r.action_op_id || r.op_id)) return "—";
              const label =
                action === "defer" ? "后移" : action === "reassign" ? "改派" : "调整";
              return (
                <Tooltip title={label}>
                  <Button
                    type="link"
                    size="small"
                    aria-label={label}
                    icon={action === "defer" ? <FieldTimeOutlined /> : <SwapOutlined />}
                    onClick={() => void handleConflictAction(r)}
                  />
                </Tooltip>
              );
            },
          },
        ]}
      />
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e6eaf0",
          borderRadius: 12,
          padding: 16,
          marginTop: 16,
          marginBottom: 16,
          overflow: "auto",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>人员负荷热力图</div>
        <div style={{ fontSize: 12, color: "#718096", marginBottom: 12 }}>
          {data?.heatmap?.summary || "按人×日查看占用；绿空闲 / 蓝正常 / 红超载"}
        </div>
        <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 640 }}>
          <thead>
            <tr>
              <th
                style={{
                  position: "sticky",
                  left: 0,
                  background: "#fff",
                  padding: "4px 8px",
                  textAlign: "left",
                  borderBottom: "1px solid #e6eaf0",
                }}
              >
                人员
              </th>
              {(data?.heatmap?.dates ?? []).map((d) => (
                <th
                  key={d}
                  style={{
                    padding: "4px 6px",
                    borderBottom: "1px solid #e6eaf0",
                    fontWeight: 500,
                    color: "#718096",
                  }}
                >
                  {d.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.heatmap?.rows ?? []).map((row) => (
              <tr key={row.person_id}>
                <td
                  style={{
                    position: "sticky",
                    left: 0,
                    background: "#fff",
                    padding: "4px 8px",
                    whiteSpace: "nowrap",
                    borderBottom: "1px solid #f0f2f5",
                  }}
                >
                  {row.person_name}
                </td>
                {row.cells.map((cell) => {
                  const bg =
                    cell.level === "overload"
                      ? "rgba(220,38,38,0.75)"
                      : cell.level === "ok"
                        ? "rgba(37,99,235,0.55)"
                        : "rgba(34,197,94,0.2)";
                  const title = cell.ops?.length
                    ? `${cell.date} · 负荷 ${cell.load}\n${cell.ops.join("、")}`
                    : `${cell.date} · 空闲`;
                  return (
                    <td key={cell.date} title={title} style={{ padding: 2, borderBottom: "1px solid #f0f2f5" }}>
                      <div
                        style={{
                          width: 28,
                          height: 22,
                          borderRadius: 4,
                          background: bg,
                          color: cell.level === "free" ? "#64748b" : "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 10,
                        }}
                      >
                        {cell.load > 0 ? cell.load : ""}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        title="一键重排"
        open={replanOpen}
        confirmLoading={replanPreviewing}
        onCancel={() => setReplanOpen(false)}
        onOk={() => void runReplanPreview()}
        okText="预览影响"
        width={520}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="默认：仅甘特当前 · 保交期"
          description="今天以前已排/已开工的工序自动冻结，不会被挪动。"
        />
        <Collapse
          ghost
          activeKey={replanAdvanced ? ["more"] : []}
          onChange={(keys) => {
            const list = Array.isArray(keys) ? keys : [keys];
            setReplanAdvanced(list.includes("more"));
          }}
          items={[
            {
              key: "more",
              label: "更多选项（范围 / 策略）",
              children: (
                <>
                  <div style={{ marginBottom: 8, fontWeight: 600 }}>重排范围</div>
                  <Radio.Group
                    value={replanScope}
                    onChange={(e) => setReplanScope(e.target.value)}
                    style={{ width: "100%", marginBottom: 16 }}
                  >
                    <Space direction="vertical" style={{ width: "100%" }}>
                      {REPLAN_SCOPE_OPTIONS.map((opt) => (
                        <Radio
                          key={opt.value}
                          value={opt.value}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            whiteSpace: "normal",
                            height: "auto",
                            padding: "6px 0",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600 }}>{opt.label}</div>
                            <div style={{ color: "#718096", fontSize: 12 }}>{opt.description}</div>
                          </div>
                        </Radio>
                      ))}
                    </Space>
                  </Radio.Group>

                  <div style={{ marginBottom: 8, fontWeight: 600 }}>抢资源策略</div>
                  <Radio.Group
                    value={replanStrategy}
                    onChange={(e) => setReplanStrategy(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    <Space direction="vertical" style={{ width: "100%" }}>
                      {REPLAN_STRATEGY_OPTIONS.map((opt) => (
                        <Radio
                          key={opt.value}
                          value={opt.value}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            whiteSpace: "normal",
                            height: "auto",
                            padding: "6px 0",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600 }}>{opt.label}</div>
                            <div style={{ color: "#718096", fontSize: 12 }}>{opt.description}</div>
                          </div>
                        </Radio>
                      ))}
                    </Space>
                  </Radio.Group>
                </>
              ),
            },
          ]}
        />
      </Modal>

      <OrderDetailDrawer
        open={!!detailRow}
        row={detailRow}
        nameById={personNameById}
        onClose={() => setDetailRow(null)}
      />

      <FleetStatsDrawer
        open={fleetStatsOpen}
        planRows={statsPlanRows}
        conflicts={data?.conflicts ?? []}
        onClose={() => setFleetStatsOpen(false)}
        onOpenOrder={(row) => {
          setFleetStatsOpen(false);
          setDetailRow(row);
        }}
      />

      <Modal
        title="如何调整这块排产？"
        open={!!dragChoice}
        onCancel={() => setDragChoice(null)}
        footer={
          <Space wrap>
            <Button onClick={() => setDragChoice(null)}>取消</Button>
            <Button onClick={() => void confirmDragChoice("day")}>只挪本日（拆开）</Button>
            <Button type="primary" onClick={() => void confirmDragChoice("whole")}>
              整段一起移
            </Button>
          </Space>
        }
        destroyOnHidden
      >
        {dragChoice ? (
          <div style={{ lineHeight: 1.7 }}>
            <div>
              工序「<b>{dragChoice.opName}</b>」共 {dragChoice.dayCount} 天
            </div>
            <div>
              从 <b>{dragChoice.fromDate}</b> 拖到 <b>{dragChoice.toDate}</b>
            </div>
            <ul style={{ margin: "12px 0 0", paddingLeft: 18, color: "#4a5568" }}>
              <li>
                <b>整段一起移</b>：连续天数不变，整体按抓取日平移（两天仍挨着）
              </li>
              <li>
                <b>只挪本日</b>：只把抓取的那一天拆开挪走，其余天留在原处（两天可拆开）
              </li>
            </ul>
          </div>
        ) : null}
      </Modal>

      <Modal
        title="影响预览（确认后才写入）"
        open={!!impact}
        confirmLoading={impactApplying}
        onCancel={() => {
          setImpact(null);
          pendingActionRef.current = null;
        }}
        onOk={() => void confirmImpact()}
        okText="确认应用"
        okButtonProps={{
          danger: impact?.risk_level === "high",
        }}
        width={640}
        destroyOnHidden
      >
        {impact ? (
          <div>
            <Alert
              type={
                impact.risk_level === "high"
                  ? "error"
                  : impact.risk_level === "medium"
                    ? "warning"
                    : "success"
              }
              showIcon
              style={{ marginBottom: 12 }}
              message={impact.summary}
              description={
                [impact.scope_description, impact.strategy_description]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            />
            {(impact.queue_preview?.length || 0) > 0 ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                  抢资源顺序（前 {impact.queue_preview!.length} 道
                  {impact.candidate_count
                    ? ` / 共 ${impact.candidate_count} 道`
                    : ""}
                  ）
                </div>
                <ol style={{ marginTop: 0, paddingLeft: 18, maxHeight: 140, overflow: "auto" }}>
                  {impact.queue_preview!.map((q, idx) => (
                    <li key={q.op_id} style={{ marginBottom: 4, fontSize: 13 }}>
                      <b>{idx + 1}. {q.name}</b>
                      <span style={{ color: "#718096" }}>
                        {" "}
                        · {q.reason || q.work_order_code || ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            <div style={{ fontWeight: 600, marginBottom: 8 }}>变更工序</div>
            {(impact.changed_ops?.length || 0) === 0 ? (
              <div style={{ color: "#718096", marginBottom: 12 }}>无明显工序窗口变化</div>
            ) : (
              <ul style={{ marginTop: 0, paddingLeft: 18, maxHeight: 200, overflow: "auto" }}>
                {impact.changed_ops.map((c) => (
                  <li key={c.op_id} style={{ marginBottom: 4 }}>
                    <b>{c.name}</b>：{c.change}
                    {(c.delay_days || 0) > 0 ? ` · 延期 ${c.delay_days} 天` : ""}
                    {(c.staffing_gap || 0) > 0 ? ` · 缺 ${c.staffing_gap} 人` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        title={editing ? `调整工序 · ${editing.name}` : "调整工序"}
        open={!!editing}
        confirmLoading={saving}
        width={720}
        onCancel={() => setEditing(null)}
        footer={[
          editing?.status === "running" ? (
            <Popconfirm
              key="force-del"
              title="强制从甘特撤下？"
              description="该工序进行中。强制撤下会清空计划并退回待排，现场报工状态将中断。"
              okText="确认强制撤下"
              okButtonProps={{ danger: true }}
              onConfirm={() => editing && void doDelete({ opId: editing.id, force: true })}
            >
              <Button danger loading={deleting}>
                强制撤下
              </Button>
            </Popconfirm>
          ) : (
            <Popconfirm
              key="del"
              title="从甘特撤下该工序？"
              description="仅清空计划日期，工序仍保留在工单中，可再次排产。"
              okText="撤下"
              onConfirm={() => editing && void doDelete({ opId: editing.id })}
            >
              <Button danger loading={deleting}>
                撤下
              </Button>
            </Popconfirm>
          ),
          <Button key="cancel" onClick={() => setEditing(null)}>
            取消
          </Button>,
          <Button
            key="ok"
            type="primary"
            loading={saving}
            onClick={async () => {
              const values = await form.validateFields();
              await saveEdit(values);
            }}
          >
            预览并保存
          </Button>,
        ]}
        destroyOnHidden
      >
        {editing?.status === "running" ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="该工序进行中"
            description="默认不可直接撤下，避免现场报工中断。如确需调整计划，请使用「强制撤下」，或先到报工页暂停/完工。"
          />
        ) : null}
        {editing?.plan_vs_actual?.has_actual || editing?.plan_vs_actual?.has_variance ? (
          <Alert
            type={editing.plan_vs_actual?.needs_action ? "warning" : "info"}
            showIcon
            style={{ marginBottom: 12 }}
            message={
              editing.plan_vs_actual?.needs_action
                ? "计划与实绩有偏差"
                : editing.plan_vs_actual?.variance_ack
                  ? "偏差已确认"
                  : "计划 / 实绩"
            }
            description={
              <div>
                <div>
                  计划：{formatDateLabel(editing.plan_vs_actual?.plan_start || editing.plan_start)} ~{" "}
                  {formatDateLabel(editing.plan_vs_actual?.plan_end || editing.plan_end)}
                </div>
                <div>
                  实绩：
                  {editing.plan_vs_actual?.actual_start
                    ? `${formatDateLabel(editing.plan_vs_actual.actual_start)}${
                        editing.plan_vs_actual.actual_end
                          ? ` ~ ${formatDateLabel(editing.plan_vs_actual.actual_end)}`
                          : ""
                      }`
                    : "尚未开工"}
                  {editing.status === "running" || editing.status === "paused" ? "（进行中）" : ""}
                </div>
                {editing.plan_vs_actual?.original_plan_start ? (
                  <div>原计划开始：{formatDateLabel(editing.plan_vs_actual.original_plan_start)}</div>
                ) : null}
                {editing.plan_vs_actual?.summary ? (
                  <div style={{ marginTop: 4 }}>{editing.plan_vs_actual.summary}</div>
                ) : null}
                {editing.plan_vs_actual?.needs_action ? (
                  <Space wrap style={{ marginTop: 10 }}>
                    <Button
                      size="small"
                      loading={resolvingVariance}
                      onClick={() => void resolveVariance("keep")}
                    >
                      保持计划
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      loading={resolvingVariance}
                      disabled={!editing.plan_vs_actual?.has_actual}
                      onClick={() => {
                        Modal.confirm({
                          title: "计划跟实现？",
                          content:
                            "将把本工序计划窗对齐实绩，并顺延未开工后置。已发生的报工记录不会被删除。",
                          okText: "跟实现并顺延",
                          onOk: () => resolveVariance("adopt_actual"),
                        });
                      }}
                    >
                      计划跟实现
                    </Button>
                    <Button
                      size="small"
                      loading={resolvingVariance}
                      onClick={() => {
                        Modal.confirm({
                          title: "仅顺延后置？",
                          content:
                            "不改写本工序计划形状（若已完工且实绩更晚，会把计划结束锚到实绩结束），只重排未开工后置。",
                          okText: "顺延后置",
                          onOk: () => resolveVariance("cascade_successors"),
                        });
                      }}
                    >
                      顺延后置
                    </Button>
                  </Space>
                ) : null}
                <div style={{ marginTop: 8, color: "#718096", fontSize: 12 }}>
                  甘特色块始终是现行计划；底线表示实绩覆盖日。改未来用上方表单或拖拽，不要用拖拽涂抹历史实绩。
                </div>
              </div>
            }
          />
        ) : null}
        {editing?.busy_hints?.length ? (
          <Alert
            type={activeBusyHints(editing).length ? "warning" : "info"}
            showIcon
            style={{ marginBottom: 12 }}
            message={
              activeBusyHints(editing).length
                ? "当前人员当天已有其他订单任务"
                : "同人多单已确认并行"
            }
            description={
              <div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {editing.busy_hints.map((h, i) => (
                    <li key={`${h.person_id}-${i}`}>{h.message}</li>
                  ))}
                </ul>
                {activeBusyHints(editing).length ? (
                  <div style={{ marginTop: 8 }}>
                    <Button size="small" loading={ackingBusy} onClick={() => void ackBusy()}>
                      确认并行（合理）
                    </Button>
                    <span style={{ marginLeft: 8, color: "#718096", fontSize: 12 }}>
                      确认后黄框提示降级；改计划会自动作废
                    </span>
                  </div>
                ) : null}
              </div>
            }
          />
        ) : null}
        {(editing?.staffing_gap || 0) > 0 ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message={`人力缺编：需 ${editing?.required_headcount || 1} 人/天，缺 ${editing?.staffing_gap} 人`}
            description="可在下方补齐责任人；人数仍不足时甘特会继续标注缺编。"
          />
        ) : null}
        <Form form={form} layout="vertical">
          <Form.Item
            name="hours_per_day"
            label="日工时（小时）"
            rules={[{ required: true, message: "请填写日工时" }]}
            extra="默认 8。有时间段时：计划工时 = 各段日历天合计 × 日工时"
          >
            <InputNumber min={1} max={24} step={0.5} style={{ width: "100%" }} />
          </Form.Item>
          <Form.List name="plan_segments">
            {(fields, { add, remove }) => (
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>时间段（可选，可多人多段）</span>
                  <Button
                    type="dashed"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() =>
                      add({
                        person_id: undefined,
                        range: [dayjs(), dayjs()],
                      })
                    }
                  >
                    加一段
                  </Button>
                </div>
                <div style={{ fontSize: 12, color: "#718096", marginBottom: 8 }}>
                  非连续则甘特断开。不填则仍用下方「开始日期 + 耗时」连续排。
                </div>
                {fields.map((field) => (
                  <Space
                    key={field.key}
                    align="start"
                    style={{ display: "flex", marginBottom: 8 }}
                    wrap
                  >
                    <Form.Item
                      {...field}
                      name={[field.name, "person_id"]}
                      rules={[{ required: true, message: "选人" }]}
                      style={{ marginBottom: 0, width: 140 }}
                    >
                      <Select
                        placeholder="人员"
                        options={(data?.persons ?? []).map((p) => ({
                          value: p.id,
                          label: p.name,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, "range"]}
                      rules={[{ required: true, message: "选日期" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <DatePicker.RangePicker
                        allowClear={false}
                        cellRender={pastDateCellRender}
                      />
                    </Form.Item>
                    <Button
                      type="text"
                      danger
                      icon={<MinusOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  </Space>
                ))}
              </div>
            )}
          </Form.List>
          <Form.Item
            name="plan_start"
            label="开始日期（无时间段时）"
            rules={[{ required: true, message: "请选择开始日期" }]}
            extra={
              editing?.plan_start && editing.plan_start.slice(0, 10) < TODAY_ISO()
                ? "历史开始日已冻结，仅可改派人员或调整耗时"
                : "有时间段时此项会被段最早日覆盖"
            }
          >
            <DatePicker
              style={{ width: "100%" }}
              allowClear={false}
              cellRender={pastDateCellRender}
              disabledDate={disablePastDate}
              disabled={
                !!(editing?.plan_start && editing.plan_start.slice(0, 10) < TODAY_ISO())
              }
              placeholder="选择开始日期"
            />
          </Form.Item>
          <Form.Item
            name="duration_days"
            label="耗时（天，无时间段时）"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={30} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="shift_id" label="班次" rules={[{ required: true, message: "请选择班次" }]}>
            <Select
              options={(data?.shift_options ?? []).map((s) => ({
                value: s.id,
                label: `${s.name}（${s.time_label || `${s.start_time}–${s.end_time}`} · v${s.version}）`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="assignee_ids"
            label={`责任人兜底（建议 ${editing?.required_headcount || 1} 人；有时间段时以段上人员为准）`}
          >
            <Select
              mode="multiple"
              allowClear
              placeholder="按技能选人；人数不足会标缺编"
              optionFilterProp="label"
              options={(data?.persons ?? []).map((p) => {
                const skills = p.skill_names?.length ? p.skill_names.join("、") : "";
                const leave = p.status === "leave" ? " · 请假中" : "";
                return {
                  value: p.id,
                  label: `${p.name}${skills ? `（${skills}）` : ""}${leave}`,
                };
              })}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="从工单排产（滚动细排）"
        open={addOpen}
        confirmLoading={scheduling}
        onCancel={() => {
          setAddOpen(false);
        }}
        onOk={async () => {
          const values = await addForm.validateFields();
          await doSchedule(values);
        }}
        destroyOnHidden
        okText="释放本窗并排产"
        okButtonProps={{ disabled: !releasePreview.release.length }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="长周期订单不必一次排满"
          description="填写释放天数，或用本周/两周/本月快捷填入；窗口外工序留待下周期。系统按预计天数自动排期派人。"
        />
        <Form form={addForm} layout="vertical" initialValues={{ horizon_days: 14 }}>
          <Form.Item name="order_id" label="订单" rules={[{ required: true, message: "请选择订单" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={schedulableOrders.length ? "选择有待排产工序的订单" : "暂无待排产订单"}
              options={schedulableOrders.map((o) => ({
                value: o.id,
                label: `${o.label}（待排 ${o.unscheduled_count}）`,
              }))}
            />
          </Form.Item>
          <Form.Item
            label="本窗释放范围"
            required
            extra="可直接改天数；右侧本周/两周等为快捷填入"
          >
            <Space wrap align="center" size={8}>
              <Form.Item
                name="horizon_days"
                noStyle
                rules={[
                  { required: true, message: "请填写释放天数" },
                  {
                    validator: async (_, v) => {
                      if (v === null || v === undefined || Number.isNaN(Number(v))) {
                        throw new Error("请填写释放天数，或点「全部释放」");
                      }
                      const n = Number(v);
                      if (n < 0 || n > 365) throw new Error("天数需在 0～365");
                    },
                  },
                ]}
                getValueProps={(v) => ({ value: v === 0 ? null : v })}
              >
                <InputNumber
                  min={1}
                  max={365}
                  precision={0}
                  style={{ width: 110 }}
                  placeholder={scheduleHorizon === 0 ? "全部" : "天数"}
                  addonAfter="天"
                />
              </Form.Item>
              <Space.Compact>
                {(
                  data?.schedule_horizons ?? [
                    { value: 7, label: "本周" },
                    { value: 14, label: "两周" },
                    { value: 30, label: "本月" },
                    { value: 0, label: "全部释放" },
                  ]
                ).map((h) => (
                  <Button
                    key={h.value}
                    type={scheduleHorizon === h.value ? "primary" : "default"}
                    onClick={() => addForm.setFieldsValue({ horizon_days: h.value })}
                  >
                    {h.label}
                  </Button>
                ))}
              </Space.Compact>
            </Space>
          </Form.Item>
          {selectedOrder?.unscheduled_ops?.length ? (
            <div
              style={{
                marginBottom: 12,
                padding: "8px 12px",
                background: "#f7fafc",
                borderRadius: 8,
                border: "1px solid #e6eaf0",
                fontSize: 13,
                lineHeight: 1.7,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                本窗将释放 {releasePreview.release.length} 道
                {releasePreview.hold.length
                  ? ` · 留待下周期 ${releasePreview.hold.length} 道`
                  : ""}
              </div>
              {releasePreview.release.map((op) => (
                <div key={op.id}>
                  {op.seq != null ? `${op.seq}. ` : ""}
                  {op.name}
                  <span style={{ color: "#718096" }}> · {op.duration_days ?? 2} 天</span>
                </div>
              ))}
              {releasePreview.hold.length ? (
                <div style={{ marginTop: 8, color: "#718096" }}>
                  下周期：
                  {releasePreview.hold.map((op) => op.name).join("、")}
                </div>
              ) : null}
            </div>
          ) : selectedOrderId ? (
            <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="该订单没有待排产工序" />
          ) : null}
          <Form.Item name="plan_start" label="首道释放开始日">
            <DatePicker
              style={{ width: "100%" }}
              allowClear
              cellRender={pastDateCellRender}
              disabledDate={disablePastDate}
              placeholder="默认今天起排，后续按前置顺延"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
