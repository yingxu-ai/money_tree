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
  RightOutlined,
  SwapOutlined,
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
} from "@/api/scheduling";
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
  const [draggingId, setDraggingId] = useState<string | null>(null);
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
    const leftCol = 168;
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

  const onDropToDate = async (opId: string, dateIso: string) => {
    const today = TODAY_ISO();
    if (dateIso < today) {
      message.warning("历史日期已冻结，不能拖到今天之前");
      setDraggingId(null);
      return;
    }
    const op = data?.tasks?.find((t) => t.id === opId);
    if (op?.plan_start && op.plan_start.slice(0, 10) < today) {
      message.warning("该工序已在今天之前开始，不可改开始日；可点开改派人员");
      setDraggingId(null);
      return;
    }
    try {
      const preview = await previewMoveGanttTask(opId, { plan_start: dateIso, cascade: true });
      openImpact(preview, async () => {
        const result = await moveGanttTask(opId, { plan_start: dateIso, cascade: true });
        const active = activeBusyHints(result);
        if (active.length) {
          message.warning(active.map((h) => h.message).join("；"));
        } else {
          message.success("已调整开始日；跨天耗时保留，后置工序已顺延");
        }
        await refresh();
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "预览失败");
    } finally {
      setDraggingId(null);
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
      width: 168,
      render: (_: unknown, row: GanttOrderRow) => {
        const isActual = row.row_kind === "actual";
        const tip = (
          <div style={{ lineHeight: 1.7 }}>
            <div>
              <b>{row.order_code}</b> · {row.order_name}
            </div>
            <div>
              {row.source_type_label}
              {row.customer_name ? ` · ${row.customer_name}` : ""}
            </div>
            <div>产品：{row.product || "-"}</div>
            <div>工单：{row.work_order_code || "-"}</div>
            {row.wo_kind_labels?.length ? (
              <div>工单类型：{row.wo_kind_labels.join("、")}</div>
            ) : null}
            <div>开始时间：{formatDateLabel(row.plan_start)}</div>
            <div>
              耗时：{row.duration_days ?? "-"} 工序天
              {row.span_days ? `（跨度 ${row.span_days} 天）` : ""}
            </div>
            <div>订单交付时间：{formatDateLabel(row.due_date)}</div>
            <div>预计交付时间：{formatDateLabel(row.estimated_end)}</div>
            {(row.unreleased_count || 0) > 0 ? (
              <div>待释放工序：{row.unreleased_count} 道（下周期再排）</div>
            ) : null}
          </div>
        );
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
        const titleText = [row.order_code, row.order_name].filter(Boolean).join(" · ");
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
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "default",
                }}
              >
                {row.is_insert_row ? (
                  <Tag color="red" style={{ marginInlineEnd: 4 }}>
                    插
                  </Tag>
                ) : null}
                {titleText}
              </div>
            </Tooltip>
            {expanded && row.order_id ? (
              <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
                <DeleteAction
                  title="删除 / 作废该订单？"
                  content="无完工实绩则整单删除（含工单与工序）；若有进行中或已完工则作废并撤出甘特，实绩保留。"
                  successMessage={false}
                  onConfirm={() => doRemoveOrder(row.order_id!)}
                  buttonProps={{ size: "small", type: "link" }}
                >
                  删
                </DeleteAction>
              </div>
            ) : null}
          </div>
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
                  const tip = (
                    <div style={{ lineHeight: 1.7 }}>
                      <div>
                        <b>{op.name}</b>
                        {line.kind === "plan" ? " · 计划" : " · 实绩"}
                      </div>
                      <div>
                        {formatDateLabel(op.bar_start || op.plan_start)} ~{" "}
                        {formatDateLabel(op.bar_end || op.plan_end)}
                      </div>
                      <div>责任人：{op.assignee_name || "未派人"}</div>
                      <div>点击展开看工序块</div>
                    </div>
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
          return (
            <div
              style={{
                position: "relative",
                minHeight: cells.length ? stackH + 8 : 40,
                padding: isOrderDue ? `0 ${DUE_GAP + 2}px 0 2px` : "0 2px",
                background: isActualRow ? "rgba(148,163,184,0.08)" : undefined,
              }}
              onDragOver={(e) => {
                if (!isActualRow && !isPastCol) e.preventDefault();
              }}
              onDrop={() => {
                if (isActualRow) {
                  message.warning("实绩行不可改，请调整上方计划行");
                  setDraggingId(null);
                  return;
                }
                if (isPastCol) {
                  message.warning("历史日期已冻结");
                  setDraggingId(null);
                  return;
                }
                if (draggingId) void onDropToDate(draggingId, d);
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
              {cells.length ? (
                <div style={{ position: "relative", height: stackH }}>
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
                      !(op.plan_start && op.plan_start.slice(0, 10) < TODAY_ISO());
                    const needsVariance = !isActualRow && !!op.plan_vs_actual?.needs_action;
                    return (
                      <Tooltip key={`${op.id}-${op.bar_start || ""}-${d}`} title={tip}>
                        <div
                          draggable={canDrag}
                          onDragStart={() => {
                            if (canDrag) setDraggingId(op.id);
                          }}
                          onDragEnd={() => setDraggingId(null)}
                          onClick={() => {
                            if (!isActualRow) openEdit(op);
                          }}
                          style={{
                            position: "absolute",
                            top: lane * (BAR_H + LANE_GAP),
                            left: isStart ? 0 : -2,
                            right: isOrderDue ? 0 : isEnd ? 0 : -2,
                            cursor: canDrag ? "grab" : isActualRow ? "default" : "pointer",
                            height: BAR_H,
                            padding: "0 6px",
                            background: barColor,
                            color: "#fff",
                            borderTopLeftRadius: isStart ? 6 : 0,
                            borderBottomLeftRadius: isStart ? 6 : 0,
                            borderTopRightRadius: isEnd || isOrderDue ? 6 : 0,
                            borderBottomRightRadius: isEnd || isOrderDue ? 6 : 0,
                            border: activeBusyHints(op).length
                              ? "1px solid #f59e0b"
                              : needsVariance
                                ? "1px dashed #fbbf24"
                                : "none",
                            boxSizing: "border-box",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                            overflow: "hidden",
                            zIndex: 1,
                          }}
                        >
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
                                }}
                              >
                                {isActualRow
                                  ? "已签字"
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
        subtitle="每单两行：上计划可调，下实绩签字后写入且只读。宽窄样式后期再收。"
        extra={
          <Space wrap>
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
            <Button
              disabled={!history?.can_undo}
              loading={undoing}
              onClick={() => void doUndo()}
              title={history ? `可回退 ${history.undo_steps}/${history.limit} 步` : "回退"}
            >
              回退
            </Button>
            <Button
              disabled={!history?.can_redo}
              loading={redoing}
              onClick={() => void doRedo()}
              title={history ? `可前进 ${history.redo_steps}/${history.limit} 步` : "前进"}
            >
              前进
            </Button>
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
            <Button onClick={() => void refresh()} loading={loading}>
              刷新
            </Button>
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
              {axis?.hint || "折叠：一行看全盘（虚线=计划，实线=实绩）；展开看工序块"}
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
