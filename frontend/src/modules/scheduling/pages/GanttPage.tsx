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
  Spin,
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
  scheduleGanttOrder,
  undoGantt,
  type DaySegment,
  type GanttConflict,
  type GanttOption,
  type GanttOrderRow,
  type ImpactPreview,
  type OperationItem,
  type PersonItem,
  type EquipmentItem,
} from "@/modules/scheduling/api/scheduling";
import {
  collectActualDayShiftStats,
  collectPlanDayShiftStats,
  formatDateRangeFull,
  formatDayShiftBrief,
  formatDayShiftProgress,
} from "@/modules/scheduling/dayShiftStats";
import OrderDetailDrawer from "@/modules/scheduling/pages/OrderDetailDrawer";
import FleetStatsDrawer from "@/modules/scheduling/pages/FleetStatsDrawer";
import { KpiRow } from "@/components/blocks";
import { DataTable, DeleteAction, PageHeader, StatusTag } from "@/components/kit";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";

type EditSegForm = {
  start_date?: Dayjs | string;
  end_date?: Dayjs | string;
  /** @deprecated 兼容旧 range */
  range?: [Dayjs, Dayjs] | Dayjs[];
  required_headcount?: number;
  required_equipment?: number;
  person_ids?: string[];
  equipment_ids?: string[];
  /** 内部：日期+班次指纹，变了才用预览覆盖人机 */
  _dateKey?: string;
};

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

function segStartEnd(row: EditSegForm | undefined): { start: string; end: string } {
  if (!row) return { start: "", end: "" };
  if (row.start_date || row.end_date) {
    const start = (row.start_date ? toDateStr(row.start_date) : "") || "";
    const end = (row.end_date ? toDateStr(row.end_date) : start) || start;
    return { start, end: end || start };
  }
  const r = row.range;
  const start = (r?.[0] ? toDateStr(r[0]) : "") || "";
  const end = (r?.[1] ? toDateStr(r[1]) : start) || start;
  return { start, end: end || start };
}

/** 打开编辑：按日历连续日合并为表单段，并带上人数/设备/已派人机。 */
function collapseOpToEditFormSegments(op: OperationItem): EditSegForm[] {
  type DayNeed = {
    date: string;
    hc: number;
    eq: number;
    pids: string[];
    eids: string[];
  };
  const dayMap = new Map<string, DayNeed>();
  const segs = (op.plan_segments ?? []).filter((s) => s.start);
  if (segs.length) {
    for (const s of segs) {
      let cur = dayjs(s.start.slice(0, 10));
      const end = dayjs((s.end || s.start).slice(0, 10));
      const pids = [
        ...(s.person_ids?.length
          ? s.person_ids
          : s.person_id
            ? [s.person_id]
            : []),
      ];
      const eids = [...(s.equipment_ids || [])];
      const hc = Math.max(
        1,
        Number(s.required_headcount || op.required_headcount || pids.length || 1),
      );
      const eq = Math.max(
        1,
        Number(s.required_equipment || eids.length || 1),
      );
      while (cur.isBefore(end, "day") || cur.isSame(end, "day")) {
        const d = cur.format("YYYY-MM-DD");
        dayMap.set(d, { date: d, hc, eq, pids, eids });
        cur = cur.add(1, "day");
      }
    }
  } else if (op.plan_start) {
    let cur = dayjs(op.plan_start.slice(0, 10));
    const end = dayjs((op.plan_end || op.plan_start).slice(0, 10));
    const pids = [...(op.assignee_ids || (op.assignee_id ? [op.assignee_id] : []))];
    const eids = [
      ...(op.equipment_ids || (op.equipment_id ? [op.equipment_id] : [])),
    ];
    const hc = Math.max(1, Number(op.required_headcount || pids.length || 1));
    const eq = Math.max(1, Number(eids.length || 1));
    while (cur.isBefore(end, "day") || cur.isSame(end, "day")) {
      const d = cur.format("YYYY-MM-DD");
      dayMap.set(d, { date: d, hc, eq, pids, eids });
      cur = cur.add(1, "day");
    }
  }
  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length) {
    const today = dayjs();
    return [
      {
        start_date: today,
        end_date: today,
        required_headcount: 1,
        required_equipment: 1,
        person_ids: [],
        equipment_ids: [],
      },
    ];
  }
  const out: EditSegForm[] = [];
  for (const d of days) {
    const last = out[out.length - 1];
    const lastEnd = last?.end_date ? toDateStr(last.end_date) : "";
    const contiguous =
      last &&
      last.required_headcount === d.hc &&
      last.required_equipment === d.eq &&
      dayjs(lastEnd).add(1, "day").format("YYYY-MM-DD") === d.date;
    if (contiguous && last) {
      last.end_date = dayjs(d.date);
      const pset = new Set([...(last.person_ids || []), ...d.pids]);
      const eset = new Set([...(last.equipment_ids || []), ...d.eids]);
      last.person_ids = [...pset];
      last.equipment_ids = [...eset];
    } else {
      out.push({
        start_date: dayjs(d.date),
        end_date: dayjs(d.date),
        required_headcount: d.hc,
        required_equipment: d.eq,
        person_ids: [...d.pids],
        equipment_ids: [...d.eids],
      });
    }
  }
  return out;
}

function rangesOverlap(a0: string, a1: string, b0: string, b1: string) {
  return a0 <= b1 && b0 <= a1;
}

/** 多选标签过多时折叠，悬停看全部 */
function collapsedTagsPlaceholder(omitted: { label?: ReactNode }[], labels: string[]) {
  const text = labels.filter(Boolean).join("、");
  return (
    <Tooltip title={text || `另有 ${omitted.length} 项`}>
      <span
        style={{
          cursor: "default",
          color: "#4a5568",
          background: "#edf2f7",
          borderRadius: 4,
          padding: "0 6px",
        }}
      >
        +{omitted.length}
      </span>
    </Tooltip>
  );
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
    // 挪到新日：人不跟着抄，交给后端按目标日排班解析
    rest.push({ date: toDate, person_id: null });
  }
  return compressDaysToSegments(rest);
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

function buildOrderHoverTip(
  row: GanttOrderRow,
  opts: {
    actualRow?: GanttOrderRow | null;
  },
): ReactNode {
  const ops = [...(row.operations || [])].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const status = orderRollupStatus(ops);
  const source = row.source_type_label || (row.source_type === "customer" ? "客户订单" : "内部生产");
  const title = [row.order_code, source].filter(Boolean).join(" · ");
  const subtitle = [row.work_order_name || row.work_order_code, status]
    .filter(Boolean)
    .join(" · ");

  const planStats = collectPlanDayShiftStats(ops);
  const planStart =
    planStats.start ||
    row.plan_start ||
    ops.map((o) => o.plan_start).filter(Boolean).sort()[0];
  const planEnd =
    planStats.end ||
    row.estimated_end ||
    [...ops.map((o) => o.plan_end || o.plan_start).filter(Boolean)].sort().slice(-1)[0];

  const actualStats = collectActualDayShiftStats(opts.actualRow);
  const hasActual = actualStats.shiftCount > 0 || actualStats.personCount > 0;

  return (
    <div style={{ lineHeight: 1.55, maxWidth: 400, fontSize: 12 }}>
      <div style={{ fontSize: 13 }}>
        <b>{title}</b>
      </div>
      <div>{subtitle}</div>
      <div style={{ marginTop: 6 }}>
        计划 {formatDateRangeFull(planStart, planEnd)}
        <br />
        {formatDayShiftBrief(planStats)}
      </div>
      <div style={{ marginTop: 4 }}>
        实际{" "}
        {hasActual ? (
          <>
            {formatDateRangeFull(actualStats.start, actualStats.end)}
            <br />
            {formatDayShiftBrief(actualStats)}
          </>
        ) : (
          "—"
        )}
      </div>
      <div style={{ marginTop: 4 }}>
        进度 {formatDayShiftProgress(actualStats, planStats)}
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
          拖动改期；改时长请点开工序编辑
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
  const { data, loading, refresh, setData } = useRequest(() => fetchGantt("all"), {
    immediate: true,
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const [sourceFilter, setSourceFilter] = useState<string | undefined>();
  const [opNameFilter, setOpNameFilter] = useState<string | undefined>();
  const [personFilter, setPersonFilter] = useState<string | undefined>();
  const [dateRangeFilter, setDateRangeFilter] = useState<[Dayjs, Dayjs] | null>(null);
  /** 排序条件；「当天有任务」时升降序置灰 */
  const [sortField, setSortField] = useState<
    "default" | "plan_start" | "plan_end" | "duration"
  >("default");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
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
    shiftId?: string;
  } | null>(null);
  const [detailRow, setDetailRow] = useState<GanttOrderRow | null>(null);
  const [fleetStatsOpen, setFleetStatsOpen] = useState(false);
  const [editing, setEditing] = useState<OperationItem | null>(null);
  const [resolvePreview, setResolvePreview] = useState<ImpactPreview | null>(null);
  const [resolvePreviewLoading, setResolvePreviewLoading] = useState(false);
  const resolvePreviewSeq = useRef(0);
  const [addOpen, setAddOpen] = useState(false);
  const [impact, setImpact] = useState<ImpactPreview | null>(null);
  const [impactApplying, setImpactApplying] = useState(false);
  const [replanOpen, setReplanOpen] = useState(false);
  const [replanStrategy, setReplanStrategy] = useState<string>("protect_due");
  const [replanScope, setReplanScope] = useState<string>("gantt");
  const [replanPreviewing, setReplanPreviewing] = useState(false);
  const [replanAdvanced, setReplanAdvanced] = useState(false);
  const [ganttFullscreen, setGanttFullscreen] = useState(false);
  /** null = 默认全部展开；Set 为用户显式展开集合（可为空=全折叠） */
  const [expandedOrders, setExpandedOrders] = useState<Set<string> | null>(null);
  /** 普通 / 全屏分页尺寸分开记 */
  const [pageSizeNormal, setPageSizeNormal] = useState(20);
  const [pageSizeFs, setPageSizeFs] = useState(50);
  const [ganttPage, setGanttPage] = useState(1);
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

  /** 默认滚到「昨天」左缘，视口里是昨天+今天；固定列不计入 scrollLeft */
  const scrollGanttToToday = () => {
    const today = axis?.scroll_to || TODAY_ISO();
    const yesterday = dayjs(today).subtract(1, "day").format("YYYY-MM-DD");
    const root = ganttScrollRef.current;
    if (!root) return;
    const body =
      root.querySelector<HTMLElement>(".ant-table-body") ||
      root.querySelector<HTMLElement>(".ant-table-content");
    if (!body) return;

    const segs = data?.day_segments ?? [];
    const multi = segs.length > 1;
    // 与表头日列宽一致（相对旧版加宽一倍）
    const oneSegW = multi ? Math.max(144, Math.floor(400 / Math.max(segs.length, 1))) : 256;
    const dayW = multi ? oneSegW * segs.length : 256;
    const anchorIso = dates.includes(yesterday) ? yesterday : today;
    const anchor = dates.indexOf(anchorIso);
    if (anchor < 0) return;

    // 优先按表头实测对齐，避免多班/实际列宽偏差滚到空白历史
    const th = body
      .closest(".ant-table")
      ?.querySelector<HTMLElement>(
        `.ant-table-thead th[data-gantt-date="${anchorIso}"]`,
      );
    if (th) {
      const bodyRect = body.getBoundingClientRect();
      const thRect = th.getBoundingClientRect();
      body.scrollLeft = Math.max(0, body.scrollLeft + (thRect.left - bodyRect.left));
      return;
    }
    body.scrollLeft = Math.max(0, anchor * dayW);
  };

  useEffect(() => {
    if (!dates.length || !axis?.scroll_to) return;
    const t = window.setTimeout(() => scrollGanttToToday(), 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 数据刷新后滚到昨天/今天
  }, [axis?.scroll_to, dates.length, ganttFullscreen, data?.day_segments?.length]);

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

  const isOrderExpanded = (orderId: string | undefined | null) => {
    if (!orderId) return false;
    if (expandedOrders === null) return true;
    return expandedOrders.has(orderId);
  };

  const toggleOrderExpand = (orderId: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev === null ? allOrderIds : prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const expandAllOrders = () => setExpandedOrders(null);
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

  const filterRange = useMemo(() => {
    if (!dateRangeFilter?.[0] || !dateRangeFilter?.[1]) return null;
    return {
      start: dateRangeFilter[0].format("YYYY-MM-DD"),
      end: dateRangeFilter[1].format("YYYY-MM-DD"),
    };
  }, [dateRangeFilter]);

  const opMatchesFilters = (op: OperationItem) => {
    if (opNameFilter && op.name !== opNameFilter) return false;
    if (personFilter) {
      const ids = op.assignee_ids?.length
        ? op.assignee_ids
        : op.assignee_id
          ? [op.assignee_id]
          : [];
      const inSeg = (op.plan_segments ?? []).some(
        (s) =>
          s.person_id === personFilter ||
          (s.person_ids || []).includes(personFilter),
      );
      if (!ids.includes(personFilter) && !inSeg) return false;
    }
    if (filterRange) {
      const ps = (op.plan_start || op.bar_start || "").slice(0, 10);
      const pe = (op.plan_end || op.bar_end || ps).slice(0, 10);
      if (!ps || !rangesOverlap(ps, pe, filterRange.start, filterRange.end)) {
        return false;
      }
    }
    return true;
  };

  const opNameOptions = useMemo(() => {
    const names = new Set<string>();
    for (const r of data?.rows ?? []) {
      for (const o of r.operations ?? []) {
        if (o.name) names.add(o.name);
      }
      for (const cells of Object.values(r.cells || {})) {
        for (const o of cells) if (o.name) names.add(o.name);
      }
    }
    return [...names]
      .sort((a, b) => a.localeCompare(b, "zh"))
      .map((n) => ({ value: n, label: n }));
  }, [data?.rows]);

  const personFilterOptions = useMemo(() => {
    return [...(data?.persons ?? [])]
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh"))
      .map((p) => ({
        value: p.id,
        label: `${p.name}${p.code ? `（${p.code}）` : ""}`,
      }));
  }, [data?.persons]);

  /** 日期轴：有时间段筛选则只显示该区间内的列 */
  const visibleDates = useMemo(() => {
    const all = data?.dates ?? [];
    if (!filterRange) return all;
    return all.filter((d) => d >= filterRange.start && d <= filterRange.end);
  }, [data?.dates, filterRange]);

  const ganttPageSize = ganttFullscreen ? pageSizeFs : pageSizeNormal;
  const ganttPageSizeOptions = ganttFullscreen ? [50, 100, 200] : [20, 50, 100];

  /** 筛选 + 排序后的计划行（分页按订单计） */
  const sortedPlanRows = useMemo(() => {
    let list = data?.rows ?? [];
    if (sourceFilter) list = list.filter((r) => r.source_type === sourceFilter);
    const hasOpFilters = !!(opNameFilter || personFilter || filterRange);
    if (hasOpFilters) {
      list = list.filter((r) => {
        const ops = r.operations ?? [];
        const cellOps = Object.values(r.cells || {}).flat();
        const pool = ops.length ? ops : cellOps;
        if (!pool.length) return !opNameFilter && !personFilter;
        return pool.some((o) => opMatchesFilters(o));
      });
    }

    const today = axis?.today || TODAY_ISO();
    const plans = list.filter((r) => r.row_kind !== "actual");

    const metaOf = (row: GanttOrderRow) => {
      const ops = row.operations ?? [];
      let planStart = (row.plan_start || "").slice(0, 10);
      let planEnd = (row.estimated_end || "").slice(0, 10);
      let duration = 0;
      let todayCount = (row.cells?.[today] || []).length;
      let coverToday = 0;
      for (const o of ops) {
        const ps = (o.plan_start || "").slice(0, 10);
        const pe = (o.plan_end || ps).slice(0, 10);
        if (ps && (!planStart || ps < planStart)) planStart = ps;
        if (pe && (!planEnd || pe > planEnd)) planEnd = pe;
        duration += o.segment_day_sum || o.duration_days || 0;
        if (ps && pe && ps <= today && today <= pe) coverToday += 1;
      }
      if (!todayCount) todayCount = coverToday;
      return {
        planStart: planStart || "9999-99-99",
        planEnd: planEnd || "9999-99-99",
        duration,
        todayCount,
        due: (row.due_date || "").slice(0, 10) || "9999-99-99",
        code: row.order_code || row.order_id || "",
      };
    };

    const cmpStr = (a: string, b: string, dir: 1 | -1) =>
      a === b ? 0 : a < b ? -dir : dir;
    const cmpNum = (a: number, b: number, dir: 1 | -1) =>
      a === b ? 0 : a < b ? -dir : dir;

    return [...plans].sort((ra, rb) => {
      const a = metaOf(ra);
      const b = metaOf(rb);
      if (sortField === "default") {
        const t = cmpNum(a.todayCount, b.todayCount, -1);
        if (t) return t;
        const d = cmpStr(a.due, b.due, 1);
        if (d) return d;
        return cmpStr(a.code, b.code, 1);
      }
      const dir: 1 | -1 = sortDir === "asc" ? 1 : -1;
      if (sortField === "plan_start") {
        const s = cmpStr(a.planStart, b.planStart, dir);
        if (s) return s;
        return cmpStr(a.code, b.code, 1);
      }
      if (sortField === "plan_end") {
        const s = cmpStr(a.planEnd, b.planEnd, dir);
        if (s) return s;
        return cmpStr(a.code, b.code, 1);
      }
      if (sortField === "duration") {
        const s = cmpNum(a.duration, b.duration, dir);
        if (s) return s;
        return cmpStr(a.code, b.code, 1);
      }
      return cmpStr(a.code, b.code, 1);
    });
  }, [
    data?.rows,
    sourceFilter,
    opNameFilter,
    personFilter,
    filterRange,
    sortField,
    sortDir,
    axis?.today,
  ]);

  // 筛排序变化回到第 1 页；切全屏保留页码但校正越界
  useEffect(() => {
    setGanttPage(1);
  }, [sourceFilter, opNameFilter, personFilter, filterRange, sortField, sortDir]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(sortedPlanRows.length / ganttPageSize) || 1);
    if (ganttPage > maxPage) setGanttPage(maxPage);
  }, [sortedPlanRows.length, ganttPageSize, ganttPage, ganttFullscreen]);

  useEffect(() => {
    const root = ganttScrollRef.current;
    if (!root) return;
    root.scrollTop = 0;
    const body = root.querySelector(".ant-table-body");
    if (body) (body as HTMLElement).scrollTop = 0;
  }, [ganttPage, ganttPageSize, ganttFullscreen]);

  const rows = useMemo(() => {
    const start = (ganttPage - 1) * ganttPageSize;
    const pagePlans = sortedPlanRows.slice(start, start + ganttPageSize);
    const actualMap = new Map<string, GanttOrderRow>();
    for (const r of data?.rows ?? []) {
      if (r.row_kind === "actual" && r.order_id) actualMap.set(r.order_id, r);
    }
    const out: GanttOrderRow[] = [];
    for (const p of pagePlans) {
      out.push(p);
      const oid = p.order_id;
      if (oid && isOrderExpanded(oid)) {
        const act = actualMap.get(oid);
        const hasActual =
          !!act &&
          ((act.operations?.length ?? 0) > 0 ||
            Object.values(act.cells || {}).some((c) => (c?.length ?? 0) > 0));
        if (hasActual) out.push(act);
      }
    }
    return out;
  }, [
    sortedPlanRows,
    ganttPage,
    ganttPageSize,
    expandedOrders,
    data?.rows,
  ]);

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

  const history = data?.history;

  const applyWholeShift = async (
    op: OperationItem,
    fromDate: string,
    toDate: string,
    shiftId?: string,
  ) => {
    const today = TODAY_ISO();
    const oldStart = (op.plan_start || fromDate).slice(0, 10);
    if (oldStart < today) {
      message.warning(
        "该工序已在今天之前开始，不可整段改开始日；可拖未来日并在弹窗选「只挪本日」",
      );
      return;
    }
    const delta = dayjs(toDate).diff(dayjs(fromDate), "day");
    const shiftChanged = !!(shiftId && shiftId !== op.shift_id);
    if (delta === 0 && !shiftChanged) return;
    const newStart = dayjs(oldStart).add(delta, "day").format("YYYY-MM-DD");
    if (newStart < today) {
      message.warning("整段平移后会落到今天之前，已取消");
      return;
    }
    const payload = {
      plan_start: newStart,
      cascade: true as const,
      resolve_roster: true as const,
      ...(shiftId ? { shift_id: shiftId } : {}),
    };
    const preview = await previewMoveGanttTask(op.id, payload);
    openImpact(preview, async () => {
      const result = await moveGanttTask(op.id, payload);
      const active = activeBusyHints(result);
      if (active.length) {
        message.warning(active.map((h) => h.message).join("；"));
      } else if (delta === 0 && shiftChanged) {
        message.success("已换到目标班段，并按排班重派责任人");
      } else {
        message.success(
          delta > 0
            ? `整段后移 ${delta} 天，已按排班重派，后置已顺延`
            : `整段前移 ${-delta} 天，已按排班重派，后置已顺延`,
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
      only_fill_empty: true,
    });
    openImpact(preview, async () => {
      const result = await moveGanttTask(op.id, {
        plan_start: planStart,
        plan_segments: segs,
        cascade: true,
        only_fill_empty: true,
      });
      const active = activeBusyHints(result);
      if (active.length) {
        message.warning(active.map((h) => h.message).join("；"));
      } else {
        message.success(
          fromDate === toDate
            ? "日期未变"
            : `已把 ${fromDate.slice(5)} 拆开挪到 ${toDate.slice(5)}，新日已按排班派人`,
        );
      }
      await refresh();
    });
  };

  const onDropToDate = async (
    opId: string,
    toDate: string,
    fromDate: string,
    shiftId?: string,
  ) => {
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
    const shiftChanged = !!(shiftId && shiftId !== op.shift_id);
    try {
      if (dayCount <= 1 || fromDate === toDate || shiftChanged) {
        await applyWholeShift(
          op,
          fromDate || op.plan_start?.slice(0, 10) || toDate,
          toDate,
          shiftId,
        );
      } else {
        // 连续多天：先问整段一起移，还是只挪抓取日
        setDragChoice({
          opId,
          opName: op.name,
          fromDate,
          toDate,
          dayCount,
          shiftId,
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
        await applyWholeShift(op, choice.fromDate, choice.toDate, choice.shiftId);
      } else {
        await applySingleDayMove(op, choice.fromDate, choice.toDate);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "预览失败");
    }
  };

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

  const buildEditPayload = (
    values: {
      shift_id?: string;
      plan_segments?: EditSegForm[];
    },
    opts?: { forSuggest?: boolean },
  ) => {
    const forSuggest = !!opts?.forSuggest;
    const segs = (values.plan_segments ?? [])
      .map((s, i) => {
        const { start, end } = segStartEnd(s);
        if (!start) return null;
        const pids = forSuggest ? [] : [...(s.person_ids || [])];
        const eids = forSuggest ? [] : [...(s.equipment_ids || [])];
        const hc = Math.max(
          1,
          Math.min(8, Number(s.required_headcount) || pids.length || 1),
        );
        const eq = Math.max(
          1,
          Math.min(8, Number(s.required_equipment) || eids.length || 1),
        );
        return {
          id: `seg-${i + 1}`,
          person_id: (pids[0] || null) as string | null,
          person_ids: pids,
          equipment_ids: eids,
          required_headcount: hc,
          required_equipment: eq,
          start,
          end: end || start,
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      person_id: string | null;
      person_ids: string[];
      equipment_ids: string[];
      required_headcount: number;
      required_equipment: number;
      start: string;
      end: string;
    }>;
    if (!segs.length) return null;
    const maxHc = Math.max(...segs.map((s) => s.required_headcount));
    const allPids = [...new Set(segs.flatMap((s) => s.person_ids))];
    const allEids = [...new Set(segs.flatMap((s) => s.equipment_ids))];
    const needResolve =
      forSuggest || segs.some((s) => s.person_ids.length < s.required_headcount);
    const needAutoEq =
      forSuggest || segs.some((s) => s.equipment_ids.length < s.required_equipment);
    return {
      plan_start: segs.map((s) => s.start).sort()[0],
      shift_id: values.shift_id,
      required_headcount: maxHc,
      plan_segments: segs,
      assignee_ids: !needResolve && allPids.length ? allPids : undefined,
      equipment_id: !needAutoEq && allEids.length ? allEids[0] : undefined,
      resolve_roster: needResolve,
      auto_equipment: needAutoEq,
      cascade: true,
    };
  };

  const openEdit = (op: OperationItem) => {
    // 先清表单错误/旧值，避免弹窗刚打开时 Form.List 红字或上一次缺口闪一下
    resolvePreviewSeq.current += 1;
    setResolvePreview(null);
    setResolvePreviewLoading(false);
    form.resetFields();
    form.setFieldsValue({
      shift_id: op.shift_id || undefined,
      plan_segments: collapseOpToEditFormSegments(op),
    });
    setEditing(op);
  };

  const watchShiftId = Form.useWatch("shift_id", form);
  const watchPlanSegs = Form.useWatch("plan_segments", form) as EditSegForm[] | undefined;

  /** 仅日期/人数/设备数/班次变化才触发自动预览（改人手选不重跑） */
  const suggestDeps = useMemo(
    () =>
      JSON.stringify({
        shift: watchShiftId || "",
        rows: (watchPlanSegs || []).map((s) => {
          const { start, end } = segStartEnd(s);
          return {
            start,
            end,
            hc: Number(s.required_headcount) || 1,
            eq: Number(s.required_equipment) || 1,
          };
        }),
      }),
    [watchShiftId, watchPlanSegs],
  );

  const openLeaves = useMemo(
    () => (data?.leaves ?? []).filter((lv) => (lv.status || "open") !== "closed"),
    [data?.leaves],
  );

  /** 按计划段日期标注请假；11 号请假不应在 12–13 段上显示「请假」或禁用。 */
  const personOptionsForRange = (start: string, end: string) => {
    const skillId = editing?.skill_id;
    const list = [...(data?.persons ?? [])].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "zh"),
    );
    const leaveHint = (personId: string) => {
      if (!start || !end) return "";
      const hits = openLeaves.filter(
        (lv) =>
          lv.person_id === personId &&
          lv.start_date &&
          lv.end_date &&
          rangesOverlap(start, end, lv.start_date.slice(0, 10), lv.end_date.slice(0, 10)),
      );
      if (!hits.length) return "";
      const win = hits
        .map((lv) => {
          const a = lv.start_date.slice(5, 10);
          const b = lv.end_date.slice(5, 10);
          return a === b ? a : `${a}~${b}`;
        })
        .join("、");
      const coversAll = hits.some(
        (lv) =>
          lv.start_date.slice(0, 10) <= start && lv.end_date.slice(0, 10) >= end,
      );
      return coversAll ? ` · 请假(${win})` : ` · 部分日请假(${win})`;
    };
    const toOpt = (p: PersonItem) => {
      const hint = leaveHint(p.id);
      const coversAll = hint.startsWith(" · 请假(");
      return {
        value: p.id,
        label: `${p.name}${p.skill_names?.length ? `（${p.skill_names.join("、")}）` : ""}${hint}`,
        // 仅当请假覆盖本段全部日期才禁用；部分重叠仍可选（派非请假日）
        disabled: coversAll,
      };
    };
    if (!skillId) return list.map(toOpt);
    const matched = list.filter((p) => (p.skill_ids || []).includes(skillId));
    const others = list.filter((p) => !(p.skill_ids || []).includes(skillId));
    return [
      {
        label: `符合技能${editing?.skill_name ? ` · ${editing.skill_name}` : ""}`,
        options: matched.map(toOpt),
      },
      ...(others.length
        ? [{ label: "其他人员", options: others.map(toOpt) }]
        : []),
    ];
  };

  const equipmentOptions = useMemo(() => {
    const pool = new Set(editing?.equipment_pool_ids || []);
    const list = [...(data?.equipments ?? [])].filter((e) => e.status !== "disabled");
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh"));
    const toOpt = (e: EquipmentItem) => ({
      value: e.id,
      label: `${e.name}${e.code ? `（${e.code}）` : ""}`,
    });
    if (!pool.size) return list.map(toOpt);
    const inPool = list.filter((e) => pool.has(e.id));
    const outPool = list.filter((e) => !pool.has(e.id));
    return [
      { label: "模板设备池", options: inPool.map(toOpt) },
      ...(outPool.length
        ? [{ label: "其他设备", options: outPool.map(toOpt) }]
        : []),
    ];
  }, [data?.equipments, editing?.equipment_pool_ids]);

  const equipmentNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of data?.equipments ?? []) m.set(e.id, e.name);
    return m;
  }, [data?.equipments]);

  useEffect(() => {
    if (!editing) {
      setResolvePreview(null);
      return;
    }
    const values = {
      shift_id: watchShiftId as string | undefined,
      plan_segments: watchPlanSegs,
    };
    const payload = buildEditPayload(values, { forSuggest: true });
    if (!payload || !payload.shift_id) {
      setResolvePreview(null);
      return;
    }
    const seq = ++resolvePreviewSeq.current;
    setResolvePreviewLoading(true);
    const timer = window.setTimeout(() => {
      void previewMoveGanttTask(editing.id, payload)
        .then((preview) => {
          if (seq !== resolvePreviewSeq.current) return;
          setResolvePreview(preview);
          const resolved = preview.resolved_op?.plan_segments ?? [];
          const cur = (form.getFieldValue("plan_segments") || []) as EditSegForm[];
          let dirty = false;
          const next = cur.map((row) => {
            const { start, end } = segStartEnd(row);
            if (!start) return row;
            const dateKey = `${start}|${end}|${payload.shift_id}`;
            const hc = Math.max(1, Number(row.required_headcount) || 1);
            const eq = Math.max(1, Number(row.required_equipment) || 1);
            const matched = resolved.filter((s) =>
              rangesOverlap(
                start,
                end,
                s.start.slice(0, 10),
                (s.end || s.start).slice(0, 10),
              ),
            );
            const suggestedPids = [
              ...new Set(matched.flatMap((s) => s.person_ids || []).filter(Boolean)),
            ] as string[];
            const suggestedEids = [
              ...new Set(
                matched.flatMap((s) => s.equipment_ids || []).filter(Boolean),
              ),
            ] as string[];
            let pids = [...(row.person_ids || [])];
            let eids = [...(row.equipment_ids || [])];
            const dateChanged = row._dateKey !== dateKey;
            if (dateChanged || !pids.length) {
              pids = suggestedPids.slice(0, hc);
            } else if (pids.length < hc) {
              for (const id of suggestedPids) {
                if (pids.length >= hc) break;
                if (!pids.includes(id)) pids.push(id);
              }
            } else if (pids.length > hc) {
              pids = pids.slice(0, hc);
            }
            if (dateChanged || !eids.length) {
              eids = suggestedEids.slice(0, eq);
            } else if (eids.length < eq) {
              for (const id of suggestedEids) {
                if (eids.length >= eq) break;
                if (!eids.includes(id)) eids.push(id);
              }
            } else if (eids.length > eq) {
              eids = eids.slice(0, eq);
            }
            const same =
              row._dateKey === dateKey &&
              JSON.stringify(row.person_ids || []) === JSON.stringify(pids) &&
              JSON.stringify(row.equipment_ids || []) === JSON.stringify(eids);
            if (same) return row;
            dirty = true;
            return {
              ...row,
              start_date: dayjs(start),
              end_date: dayjs(end),
              person_ids: pids,
              equipment_ids: eids,
              _dateKey: dateKey,
            };
          });
          if (dirty) form.setFieldsValue({ plan_segments: next });
        })
        .catch(() => {
          if (seq !== resolvePreviewSeq.current) return;
          setResolvePreview(null);
        })
        .finally(() => {
          if (seq === resolvePreviewSeq.current) setResolvePreviewLoading(false);
        });
    }, 380);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- suggestDeps 已概括关键字段
  }, [editing, suggestDeps]);

  const { mutate: saveEdit, loading: saving } = useMutation(
    async (values: { shift_id?: string; plan_segments?: EditSegForm[] }) => {
      if (!editing) return undefined;
      const payload = buildEditPayload(values);
      if (!payload) throw new Error("请至少选择一段日期");
      if (payload.required_headcount > 5) {
        message.warning("人数偏多，请确认班次产能是否够用");
      }
      if (payload.plan_segments.some((s) => s.required_equipment > 3)) {
        message.warning("设备数偏多，请确认模板设备池是否够用");
      }
      const preview = await previewMoveGanttTask(editing.id, payload);
      openImpact(preview, async () => {
        const result = await moveGanttTask(editing.id, payload);
        const active = activeBusyHints(result);
        const gap = result?.staffing_gap || 0;
        const eqGap = result?.equipment_gap || 0;
        if (active.length) {
          message.warning(active.map((h) => h.message).join("；"));
        } else if (gap > 0) {
          message.warning(
            `已保存，但仍缺 ${gap} 人/天（技能或排班不足），甘特会标缺编`,
          );
        } else if (eqGap > 0 || !result?.equipment_id) {
          message.warning("已保存并派好人员，但设备不足（请检查模板设备池）");
        } else {
          const eqLabel =
            result.equipment_names?.join("、") || result.equipment_name || "设备";
          message.success(
            `已保存：${result.assignee_name || "责任人"} · ${eqLabel}`,
          );
        }
        setEditing(null);
        setResolvePreview(null);
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

  const daySegments: DaySegment[] = data?.day_segments ?? [];
  const multiSeg = daySegments.length > 1;
  /** 日列宽为旧版 2 倍；工序条高度为旧版一半 */
  const DAY_COL_W = 256;
  const OP_BAR_H = 22;
  const segColWidth = multiSeg
    ? Math.max(144, Math.floor(400 / Math.max(daySegments.length, 1)))
    : DAY_COL_W;

  const columns = [
    {
      title: "订单 / 交货日期",
      key: "meta",
      fixed: "left" as const,
      width: 280,
      render: (_: unknown, row: GanttOrderRow) => {
        const isActual = row.row_kind === "actual";
        const tip = buildOrderHoverTip(row, {
          actualRow: row.order_id ? actualRowByOrder.get(row.order_id) : null,
        });
        const expanded = isOrderExpanded(row.order_id);
        const stripe = orderStripeIndex.get(row.order_id || "") ?? 0;
        const accent = stripe % 2 === 0 ? "#2563eb" : "#0f766e";
        if (isActual) {
          return (
            <div
              style={{
                paddingLeft: 32,
                color: "#64748b",
                fontSize: 12,
                lineHeight: `${OP_BAR_H + 8}px`,
                borderLeft: `3px solid ${accent}`,
              }}
            >
              └ 实绩
            </div>
          );
        }
        const titleText = row.order_code || row.order_name || "-";
        const subText = row.work_order_name || row.work_order_code || "";
        const due = (row.due_date || "").slice(0, 10);
        const overdue = !!due && due < (axis?.today || TODAY_ISO());
        const canAct = row.editable !== false && !!row.order_id;
        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              minHeight: expanded ? OP_BAR_H + 12 : 36,
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
                <div
                  style={{
                    fontSize: 12,
                    fontVariantNumeric: "tabular-nums",
                    color: due ? (overdue ? "#c53030" : "#2d3748") : "#a0aec0",
                    fontWeight: overdue ? 600 : 400,
                    marginTop: 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {due || "—"}
                </div>
              </div>
            </Tooltip>
            {canAct ? (
              <Space size={0} wrap style={{ flexShrink: 0 }}>
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
            ) : null}
          </div>
        );
      },
    },
    ...visibleDates.map((d) => {
      const headerHasDue = (data?.due_markers ?? []).some((m) => m.due_date?.slice(0, 10) === d);
      const isPastCol = d < TODAY_ISO();
      const isTodayCol = d === (axis?.today || TODAY_ISO());

      const buildSegLeaf = (seg: DaySegment | null, segIndex = 0) => {
      const familyId = seg?.family_id;
      const dropShiftId = seg?.shift_id;
      // 交期竖线只画在当日最后一班，避免白/中/夜各画一条且长短不一
      const isLastSegOfDay =
        !multiSeg || !seg || segIndex === daySegments.length - 1;
      const matchFamily = (op: OperationItem) =>
        !familyId || (op.shift_family_id || "sh-day") === familyId;
      const matchFilters = (op: OperationItem) => opMatchesFilters(op);
      return {
        title: multiSeg && seg ? (
          <div
            style={{
              textAlign: "center",
              fontSize: 11,
              fontWeight: 600,
              color: isPastCol ? "#a0aec0" : "#4a5568",
              lineHeight: 1.2,
            }}
            title={[
              seg.time_label,
              seg.belong_day_label ||
                (seg.belong_day_rule === "previous_day" ? "归属前一日" : "归属开班日"),
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            {seg.name}
            {seg.crosses_midnight ? "·跨" : ""}
            {seg.belong_day_rule === "previous_day" ? "·前" : ""}
          </div>
        ) : (
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
        key: familyId ? `${d}__${familyId}` : d,
        width: segColWidth,
        className: isLastSegOfDay ? "gantt-day-end" : undefined,
        onHeaderCell: () => ({
          "data-gantt-date": d,
          className: isLastSegOfDay ? "gantt-day-end" : undefined,
        }),
        onCell: () => ({
          "data-gantt-date": d,
          className: isLastSegOfDay ? "gantt-day-end" : undefined,
          onDragOver: (e: React.DragEvent) => {
            if (!isPastCol) e.preventDefault();
          },
          style: {
            // top：同行各日/班列顶对齐，避免 middle 把矮单元格里的工序条顶到中间显得高低不一
            verticalAlign: "top" as const,
            position: "relative" as const,
            padding: "2px 0",
            background: isTodayCol ? "#e6f4ff" : isPastCol ? "#f7f8fa" : undefined,
          },
        }),
        render: (_: unknown, row: GanttOrderRow) => {
          const isActualRow = row.row_kind === "actual" || row.editable === false;
          const orderExpanded = isOrderExpanded(row.order_id);
          const isOrderDue = !!row.due_date && row.due_date.slice(0, 10) === d;
          const showDueMark = isOrderDue && isLastSegOfDay;
          const DUE_GAP = 7;
          const COLLAPSED_H = Math.max(28, OP_BAR_H + 8);

          // —— 折叠：一单一行高度，工序画细线（计划虚线 / 实绩实线）——
          if (!orderExpanded && !isActualRow) {
            const planCells = (row.cells?.[d] || [])
              .filter(matchFamily)
              .filter(matchFilters);
            const actualCells = (
              (row.order_id && actualRowByOrder.get(row.order_id)?.cells?.[d]) ||
              []
            )
              .filter(matchFamily)
              .filter(matchFilters);
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
                  padding: showDueMark ? `0 ${DUE_GAP + 2}px 0 2px` : "0 2px",
                }}
                onClick={() => {
                  if (row.order_id) toggleOrderExpand(row.order_id);
                }}
              >
                {showDueMark ? (
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
                          left: 2,
                          right: showDueMark ? DUE_GAP : 2,
                          height: lineH,
                          boxSizing: "border-box",
                          borderRadius: 2,
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

          let cells = (row.cells?.[d] || [])
            .filter(matchFamily)
            .filter(matchFilters);
          const BAR_H = OP_BAR_H;
          const LANE_GAP = 2;
          // 与 rowLanes 键一致（不按班拆），同工序跨天同一泳道，避免高低错位
          const laneKey = `${row.order_id || row.work_order_id || ""}:${row.row_kind || "plan"}`;
          const { laneOf, laneCount } = rowLanes.get(laneKey) ?? {
            laneOf: new Map<string, number>(),
            laneCount: Math.max(cells.length, 1),
          };
          const stackH = Math.max(1, laneCount) * BAR_H + Math.max(0, laneCount - 1) * LANE_GAP;
          const showStack = cells.length > 0;
          return (
            <div
              style={{
                position: "relative",
                height: "100%",
                minHeight: showStack ? stackH + 6 : 28,
                padding: showDueMark ? `0 ${DUE_GAP + 2}px 0 2px` : "0 2px",
                background: isActualRow ? "rgba(148,163,184,0.08)" : undefined,
              }}
              onDragOver={(e) => {
                if (!isActualRow && !isPastCol) e.preventDefault();
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
                  void onDropToDate(dragState.opId, d, dragState.fromDate, dropShiftId);
                }
              }}
            >
              {showDueMark && !isActualRow ? (
                <Tooltip title={`交货日 ${formatDateLabel(row.due_date)} · ${row.order_code}`}>
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
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
                  {cells.map((op) => {
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
                    const canDrag =
                      !isActualRow &&
                      op.status !== "done" &&
                      !(
                        op.plan_start &&
                        op.plan_start.slice(0, 10) < TODAY_ISO() &&
                        d < TODAY_ISO()
                      );
                    const needsVariance = !isActualRow && !!op.plan_vs_actual?.needs_action;
                    const dayTip = buildDayCellTip(
                      op,
                      d,
                      personNameById,
                      isActualRow ? "actual" : "plan",
                      !isActualRow && canDrag,
                    );
                    const dayAssignee =
                      dayAssigneeNames(op, d, personNameById).join("、") ||
                      op.assignee_name ||
                      "未派人";
                    return (
                      <Tooltip
                        key={`${op.id}-${d}-${familyId || "all"}`}
                        title={dayTip}
                      >
                        <div
                          draggable={canDrag}
                          onDragStart={(e) => {
                            if (!canDrag) return;
                            e.dataTransfer.effectAllowed = "move";
                            setDragState({ opId: op.id, fromDate: d });
                          }}
                          onDragEnd={() => setDragState(null)}
                          onClick={() => {
                            if (!isActualRow) openEdit(op);
                          }}
                          style={{
                            position: "absolute",
                            top: lane * (BAR_H + LANE_GAP),
                            left: 2,
                            right: showDueMark ? DUE_GAP : 2,
                            cursor: canDrag ? "grab" : isActualRow ? "default" : "pointer",
                            height: BAR_H,
                            padding: "0 8px",
                            background: barColor,
                            color: "#fff",
                            borderRadius: 4,
                            border: activeBusyHints(op).length
                              ? "1px solid #f59e0b"
                              : needsVariance
                                ? "1px dashed #fbbf24"
                                : dragState?.opId === op.id
                                  ? "1px solid #fff"
                                  : "none",
                            opacity: dragState?.opId === op.id ? 0.85 : 1,
                            boxSizing: "border-box",
                            display: "flex",
                            alignItems: "center",
                            overflow: "hidden",
                            zIndex: 1,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: 11,
                              lineHeight: 1.2,
                              whiteSpace: "nowrap",
                              textOverflow: "ellipsis",
                              overflow: "hidden",
                            }}
                          >
                            {op.name}
                            <span style={{ fontWeight: 400, opacity: 0.95, marginLeft: 6 }}>
                              {isActualRow
                                ? "已签字"
                                : (op.staffing_gap || 0) > 0
                                  ? `缺${op.staffing_gap}人`
                                  : dayAssignee}
                            </span>
                          </div>
                        </div>
                      </Tooltip>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        },
      };
      };

      if (!multiSeg) {
        return buildSegLeaf(null);
      }

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
            ) : null}
          </div>
        ),
        key: `day-${d}`,
        // 日期表头分组右缘与当日最后一班对齐
        onHeaderCell: () => ({ className: "gantt-day-end" }),
        children: daySegments.map((seg, i) => buildSegLeaf(seg, i)),
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
          {(digest.capacity_overload_count || 0) > 0 ? (
            <Tag color="volcano">超载 {digest.capacity_overload_count}</Tag>
          ) : null}
          {digest.delay_count > 0 ? (
            <Tag color="orange">延期 {digest.delay_count}</Tag>
          ) : null}
          {digest.overload_day_count > 0 ? (
            <Tag color="red">
              人日满载 {digest.overload_day_count} 日
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
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 12,
            width: "100%",
          }}
        >
          <Space wrap size={8} style={{ justifyContent: "flex-start" }}>
            {ganttFullscreen ? (
              <span style={{ fontWeight: 700, fontSize: 16 }}>排产甘特 · 全屏</span>
            ) : null}
            <Select
              allowClear
              placeholder="来源：客户/内部"
              style={{ width: 140 }}
              value={sourceFilter}
              onChange={setSourceFilter}
              options={[
                { value: "customer", label: "客户订单" },
                { value: "internal", label: "内部生产" },
              ]}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="工序"
              style={{ width: 140 }}
              value={opNameFilter}
              onChange={setOpNameFilter}
              options={opNameOptions}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="人员"
              style={{ width: 150 }}
              value={personFilter}
              onChange={setPersonFilter}
              options={personFilterOptions}
            />
            <DatePicker.RangePicker
              allowClear
              value={dateRangeFilter}
              onChange={(v) =>
                setDateRangeFilter(
                  v && v[0] && v[1] ? [v[0], v[1]] : null,
                )
              }
              placeholder={["开始日期", "结束日期"]}
              style={{ width: 260 }}
            />
          </Space>
          <Space wrap size={8} style={{ justifyContent: "flex-end", marginLeft: "auto" }}>
            <Select
              value={sortField}
              style={{ width: 130 }}
              onChange={(v) => {
                setSortField(v);
                if (v !== "default" && sortField === "default") {
                  setSortDir(v === "duration" ? "desc" : "asc");
                }
              }}
              options={[
                { value: "default", label: "当天有任务" },
                { value: "plan_start", label: "开始日期" },
                { value: "plan_end", label: "结束日期" },
                { value: "duration", label: "总时长" },
              ]}
            />
            <Radio.Group
              optionType="button"
              size="small"
              disabled={sortField === "default"}
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value)}
              options={[
                { value: "asc", label: "↑" },
                { value: "desc", label: "↓" },
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
            {axis?.hint ? (
              <span style={{ fontSize: 12, color: "#718096" }}>{axis.hint}</span>
            ) : null}
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
        </div>
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
            size="small"
            sticky
            scroll={{
              x: Math.max(
                280 +
                  visibleDates.length *
                    (multiSeg
                      ? segColWidth * Math.max(daySegments.length, 1)
                      : DAY_COL_W),
                960,
              ),
              y: ganttTableScrollY,
            }}
            dataSource={rows}
            columns={columns}
            pagination={{
              current: ganttPage,
              pageSize: ganttPageSize,
              total: sortedPlanRows.length,
              showSizeChanger: true,
              pageSizeOptions: ganttPageSizeOptions.map(String),
              showTotal: (t) => `共 ${t} 单`,
              size: "small",
              onChange: (p, ps) => {
                setGanttPage(p);
                if (ps !== ganttPageSize) {
                  if (ganttFullscreen) setPageSizeFs(ps);
                  else setPageSizeNormal(ps);
                  setGanttPage(1);
                }
              },
            }}
            rowClassName={(row, index) => {
              const stripe = orderStripeIndex.get(row.order_id || "") ?? 0;
              const next = rows[index + 1];
              const sameOrderNext = !!(next && next.order_id && next.order_id === row.order_id);
              // 计划→实绩：细分割线；订单末行：粗边界（与订单间区分）
              const planActualSplit =
                row.row_kind === "plan" && sameOrderNext && next?.row_kind === "actual";
              const orderBoundary = !sameOrderNext;
              return [
                stripe % 2 === 1 ? "gantt-order-odd" : "gantt-order-even",
                planActualSplit ? "gantt-plan-actual-split" : "",
                orderBoundary ? "gantt-order-boundary" : "",
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
            .gantt-plan-actual-split > td {
              border-bottom: 1px dashed #cbd5e1 !important;
            }
            .gantt-order-boundary > td {
              border-bottom: 2px solid #64748b !important;
            }
            /* 自然日右缘：inset 不占列宽，表头/表体与班列对齐 */
            th.gantt-day-end,
            td.gantt-day-end {
              box-shadow: inset -1px 0 0 #64748b !important;
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
                  overload: "超载",
                  delay: "延期",
                  risk: "风险",
                }}
                colorMap={{
                  conflict: "red",
                  staffing: "magenta",
                  leave: "purple",
                  overload: "volcano",
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
        actualRow={
          detailRow?.order_id ? actualRowByOrder.get(detailRow.order_id) ?? null : null
        }
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
        width={980}
        destroyOnHidden
        onCancel={() => {
          setEditing(null);
          setResolvePreview(null);
          setResolvePreviewLoading(false);
          form.resetFields();
        }}
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
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="表格里改日期与数量；人/设备会默认填好，也可下拉增删改"
          description="人数、设备数与右侧下拉联动。冲突汇总在表格下方。"
        />
        <Form form={form} layout="vertical">
          <Form.Item name="shift_id" label="班次" rules={[{ required: true, message: "请选择班次" }]}>
            <Select
              options={(data?.shift_options ?? []).map((s) => ({
                value: s.id,
                label: `${s.name}（${s.time_label || `${s.start_time}–${s.end_time}`} · v${s.version}）`,
              }))}
            />
          </Form.Item>
          <Form.List name="plan_segments">
            {(fields, { add, remove }) => {
              // 预览未完成前不展示缺口/冲突，避免打开瞬间「缺人」红块闪一下
              const previewSettled = !!resolvePreview && !resolvePreviewLoading;
              const opConflicts = previewSettled
                ? (
                    resolvePreview?.op_conflicts ??
                    resolvePreview?.conflicts_after ??
                    []
                  ).filter(
                    (c) =>
                      c.status === "conflict" ||
                      c.status === "overload" ||
                      c.status === "leave" ||
                      c.status === "staffing",
                  )
                : [];
              const shortageLines: string[] = [];
              if (previewSettled) {
                for (const row of watchPlanSegs || []) {
                  const { start, end } = segStartEnd(row);
                  if (!start) continue;
                  const hc = Number(row.required_headcount) || 1;
                  const eq = Number(row.required_equipment) || 1;
                  const pids = row.person_ids || [];
                  const eids = row.equipment_ids || [];
                  const label =
                    start === end
                      ? start.slice(5)
                      : `${start.slice(5)}~${end.slice(5)}`;
                  if (pids.length < hc) {
                    shortageLines.push(
                      `${label} 缺人：需 ${hc}，已选 ${pids.length}`,
                    );
                  }
                  if (eids.length < eq) {
                    shortageLines.push(
                      `${label} 缺设备：需 ${eq}，已选 ${eids.length}`,
                    );
                  }
                }
              }
              return (
                <div style={{ marginBottom: 8 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                      gap: 8,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      计划段
                      {resolvePreviewLoading ? (
                        <Spin size="small" style={{ marginLeft: 8 }} />
                      ) : null}
                    </span>
                    <Button
                      type="dashed"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() =>
                        add({
                          start_date: dayjs(),
                          end_date: dayjs(),
                          required_headcount: 1,
                          required_equipment: 1,
                          person_ids: [],
                          equipment_ids: [],
                          _dateKey: "",
                        })
                      }
                    >
                      再加一段
                    </Button>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: 13,
                        minWidth: 860,
                      }}
                    >
                      <thead>
                        <tr style={{ background: "#f7fafc", textAlign: "left" }}>
                          {[
                            "开始日期",
                            "结束日期",
                            "人数",
                            "设备",
                            "人",
                            "设备",
                            "",
                          ].map((h) => (
                            <th
                              key={h || "act"}
                              style={{
                                padding: "8px 6px",
                                borderBottom: "1px solid #e2e8f0",
                                whiteSpace: "nowrap",
                                fontWeight: 600,
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((field, idx) => {
                          const row = (watchPlanSegs?.[field.name] ||
                            watchPlanSegs?.[idx]) as EditSegForm | undefined;
                          const { start: rowStart, end: rowEnd } = segStartEnd(row);
                          const pids = row?.person_ids || [];
                          const eids = row?.equipment_ids || [];
                          const personLabels = pids.map(
                            (id) => personNameById.get(id) || id,
                          );
                          const equipLabels = eids.map(
                            (id) => equipmentNameById.get(id) || id,
                          );
                          const rowPersonOptions = personOptionsForRange(
                            rowStart,
                            rowEnd,
                          );
                          return (
                            <tr key={field.key}>
                              <td
                                style={{
                                  padding: "6px 4px",
                                  borderBottom: "1px solid #edf2f7",
                                  verticalAlign: "top",
                                  width: 128,
                                }}
                              >
                                <Form.Item
                                  name={[field.name, "start_date"]}
                                  rules={[{ required: true, message: "开始" }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <DatePicker
                                    allowClear={false}
                                    style={{ width: 120 }}
                                    cellRender={pastDateCellRender}
                                    disabledDate={disablePastDate}
                                    onChange={() => {
                                      form.setFieldValue(
                                        ["plan_segments", field.name, "_dateKey"],
                                        "",
                                      );
                                    }}
                                  />
                                </Form.Item>
                              </td>
                              <td
                                style={{
                                  padding: "6px 4px",
                                  borderBottom: "1px solid #edf2f7",
                                  verticalAlign: "top",
                                  width: 128,
                                }}
                              >
                                <Form.Item
                                  name={[field.name, "end_date"]}
                                  rules={[{ required: true, message: "结束" }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <DatePicker
                                    allowClear={false}
                                    style={{ width: 120 }}
                                    cellRender={pastDateCellRender}
                                    disabledDate={disablePastDate}
                                    onChange={() => {
                                      form.setFieldValue(
                                        ["plan_segments", field.name, "_dateKey"],
                                        "",
                                      );
                                    }}
                                  />
                                </Form.Item>
                              </td>
                              <td
                                style={{
                                  padding: "6px 4px",
                                  borderBottom: "1px solid #edf2f7",
                                  verticalAlign: "top",
                                  width: 72,
                                }}
                              >
                                <Form.Item
                                  name={[field.name, "required_headcount"]}
                                  rules={[{ required: true, message: "人数" }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <InputNumber
                                    min={1}
                                    max={8}
                                    style={{ width: 64 }}
                                    onChange={(n) => {
                                      const next = Math.max(1, Number(n) || 1);
                                      const cur =
                                        (form.getFieldValue([
                                          "plan_segments",
                                          field.name,
                                          "person_ids",
                                        ]) as string[]) || [];
                                      if (cur.length > next) {
                                        form.setFieldValue(
                                          ["plan_segments", field.name, "person_ids"],
                                          cur.slice(0, next),
                                        );
                                      }
                                    }}
                                  />
                                </Form.Item>
                              </td>
                              <td
                                style={{
                                  padding: "6px 4px",
                                  borderBottom: "1px solid #edf2f7",
                                  verticalAlign: "top",
                                  width: 72,
                                }}
                              >
                                <Form.Item
                                  name={[field.name, "required_equipment"]}
                                  rules={[{ required: true, message: "设备数" }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <InputNumber
                                    min={1}
                                    max={8}
                                    style={{ width: 64 }}
                                    onChange={(n) => {
                                      const next = Math.max(1, Number(n) || 1);
                                      const cur =
                                        (form.getFieldValue([
                                          "plan_segments",
                                          field.name,
                                          "equipment_ids",
                                        ]) as string[]) || [];
                                      if (cur.length > next) {
                                        form.setFieldValue(
                                          [
                                            "plan_segments",
                                            field.name,
                                            "equipment_ids",
                                          ],
                                          cur.slice(0, next),
                                        );
                                      }
                                    }}
                                  />
                                </Form.Item>
                              </td>
                              <td
                                style={{
                                  padding: "6px 4px",
                                  borderBottom: "1px solid #edf2f7",
                                  verticalAlign: "top",
                                  minWidth: 180,
                                }}
                              >
                                <Form.Item
                                  name={[field.name, "person_ids"]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Select
                                    mode="multiple"
                                    allowClear
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder="自动填充，可改"
                                    options={
                                      rowPersonOptions as {
                                        label: string;
                                        options?: {
                                          value: string;
                                          label: string;
                                          disabled?: boolean;
                                        }[];
                                        value?: string;
                                        disabled?: boolean;
                                      }[]
                                    }
                                    maxTagCount={1}
                                    maxTagPlaceholder={(omitted) =>
                                      collapsedTagsPlaceholder(omitted, personLabels)
                                    }
                                    style={{ width: "100%", minWidth: 160 }}
                                    onChange={(ids: string[]) => {
                                      form.setFieldValue(
                                        [
                                          "plan_segments",
                                          field.name,
                                          "required_headcount",
                                        ],
                                        Math.max(1, ids.length || 1),
                                      );
                                    }}
                                  />
                                </Form.Item>
                              </td>
                              <td
                                style={{
                                  padding: "6px 4px",
                                  borderBottom: "1px solid #edf2f7",
                                  verticalAlign: "top",
                                  minWidth: 160,
                                }}
                              >
                                <Form.Item
                                  name={[field.name, "equipment_ids"]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Select
                                    mode="multiple"
                                    allowClear
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder="自动填充，可改"
                                    options={equipmentOptions as { label: string; options?: { value: string; label: string }[]; value?: string }[]}
                                    maxTagCount={1}
                                    maxTagPlaceholder={(omitted) =>
                                      collapsedTagsPlaceholder(omitted, equipLabels)
                                    }
                                    style={{ width: "100%", minWidth: 140 }}
                                    onChange={(ids: string[]) => {
                                      form.setFieldValue(
                                        [
                                          "plan_segments",
                                          field.name,
                                          "required_equipment",
                                        ],
                                        Math.max(1, ids.length || 1),
                                      );
                                    }}
                                  />
                                </Form.Item>
                              </td>
                              <td
                                style={{
                                  padding: "6px 4px",
                                  borderBottom: "1px solid #edf2f7",
                                  verticalAlign: "top",
                                  width: 40,
                                }}
                              >
                                <Button
                                  type="text"
                                  danger
                                  disabled={fields.length <= 1}
                                  icon={<MinusOutlined />}
                                  onClick={() => remove(field.name)}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {(shortageLines.length > 0 || opConflicts.length > 0) && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: "10px 12px",
                        borderRadius: 8,
                        background: "#fff5f5",
                        border: "1px solid #feb2b2",
                      }}
                    >
                      <div style={{ fontWeight: 600, color: "#c53030", marginBottom: 6 }}>
                        冲突与缺口
                      </div>
                      {shortageLines.map((line) => (
                        <div key={line} style={{ color: "#e53e3e", fontSize: 13 }}>
                          {line}
                        </div>
                      ))}
                      {opConflicts.slice(0, 8).map((c, i) => (
                        <div
                          key={`${c.reason}-${i}`}
                          style={{ color: "#e53e3e", fontSize: 13 }}
                        >
                          {c.status === "overload"
                            ? "超载："
                            : c.status === "leave"
                              ? "请假："
                              : c.status === "staffing"
                                ? "缺编："
                                : "冲突："}
                          {c.reason}
                          {c.assignee_name ? `（${c.assignee_name}）` : ""}
                          {c.equipment_name ? ` · ${c.equipment_name}` : ""}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }}
          </Form.List>
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
