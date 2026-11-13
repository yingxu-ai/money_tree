import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Col,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  TimePicker,
  Typography,
  message,
} from "antd";
import { CheckOutlined, CloseOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import {
  confirmShopFloorFinished,
  deleteShopFloorReport,
  fetchShopFloorReports,
  fetchShopFloorShiftHint,
  fetchShopFloorStats,
  reviewShopFloorReport,
  reviewShopFloorReportsBatch,
  submitShopFloorReportsBatch,
  updateShopFloorSettings,
  type ShopFloorReportItem,
} from "@/modules/production-progress/api/progress";
import { BarChart, PieChart } from "@/charts";
import { KpiRow } from "@/components/blocks";
import { AuthButton, DataTable, FormModal, PageHeader, StatusTag } from "@/components/kit";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";
import { usePermission } from "@/permissions";
import { useAuthStore } from "@/stores/authStore";

const PERM_REPORT = "production_progress:report";
const PERM_REVIEW = "production_progress:review";

type FinishedRow = {
  work_date: string;
  product: string;
  suggested_qty: number;
  day_suggested_qty?: number;
  last_process?: string;
  confirmed_qty?: number | null;
  day_confirmed_qty?: number | null;
  status?: string | null;
  shift_name?: string;
  shift_family_id?: string | null;
  shift_count?: number;
  applicant_names?: string | null;
  submitted_by?: string | null;
  submitted_at?: string | null;
  first_submitted_at?: string | null;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
  reject_note?: string | null;
  confirm_id?: string | null;
};

type FinishAction = "apply" | "confirm" | "modify";

function formatDateTime(v?: string | null) {
  if (!v) return "—";
  return v.length >= 16 ? `${v.slice(0, 10)} ${v.slice(11, 16)}` : v;
}

/** 同日同产品合并：返回每行 rowSpan（后续同行 0） */
function buildDateProductRowSpans(rows: FinishedRow[]) {
  const dateSpan = Array(rows.length).fill(0);
  const productSpan = Array(rows.length).fill(0);
  const dayQtySpan = Array(rows.length).fill(0);
  let i = 0;
  while (i < rows.length) {
    const date = rows[i]?.work_date || "";
    let j = i + 1;
    while (j < rows.length && (rows[j]?.work_date || "") === date) j += 1;
    dateSpan[i] = j - i;
    let k = i;
    while (k < j) {
      const product = rows[k]?.product || "";
      let m = k + 1;
      while (m < j && (rows[m]?.product || "") === product) m += 1;
      productSpan[k] = m - k;
      dayQtySpan[k] = m - k;
      k = m;
    }
    i = j;
  }
  return { dateSpan, productSpan, dayQtySpan };
}

const { RangePicker } = DatePicker;

const STATUS_LABEL: Record<string, string> = {
  pending: "待确认",
  confirmed: "已确认",
  rejected: "已驳回",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "orange",
  confirmed: "green",
  rejected: "default",
};

type LinkType = "work_order" | "product";

type BatchRow = {
  link_type: LinkType;
  link_value?: string;
  process_name?: string;
  template_id?: string;
  equipment_value?: string;
  qty?: number;
  start_time?: Dayjs | null;
  end_time?: Dayjs | null;
  note?: string;
};

function emptyRow(defaults?: { start?: Dayjs | null; end?: Dayjs | null }): BatchRow {
  return {
    link_type: "work_order",
    link_value: undefined,
    process_name: undefined,
    template_id: undefined,
    equipment_value: undefined,
    qty: 1,
    start_time: defaults?.start ?? null,
    end_time: defaults?.end ?? null,
    note: undefined,
  };
}

function parseHm(v?: string | null): Dayjs | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  return dayjs().hour(Number(m[1])).minute(Number(m[2])).second(0).millisecond(0);
}

/**
 * 每日报工：筛选 + 应报/未报 + 工序/设备图 + 成品确认；下班提交与主任审明细。
 */
export default function DailyReportPage() {
  const today = dayjs();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([today, today]);
  const [statusFilter, setStatusFilter] = useState<string | undefined>("pending");
  const [resourceId, setResourceId] = useState<string | undefined>();
  const [processName, setProcessName] = useState<string | undefined>();
  const [equipmentKey, setEquipmentKey] = useState<string | undefined>();
  const [shiftFamilyId, setShiftFamilyId] = useState<string | undefined>();
  const [submitOpen, setSubmitOpen] = useState(false);
  const [unreportedOpen, setUnreportedOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectIds, setRejectIds] = useState<string[]>([]);
  const [rejectNote, setRejectNote] = useState("");
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishAction, setFinishAction] = useState<FinishAction>("confirm");
  const [finishRow, setFinishRow] = useState<FinishedRow | null>(null);
  const [finishQty, setFinishQty] = useState<number>(0);
  const [finishDate, setFinishDate] = useState<Dayjs>(() => dayjs());
  const [finishProduct, setFinishProduct] = useState<string | undefined>();
  const [finishShiftFamilyId, setFinishShiftFamilyId] = useState<string | undefined>();
  const [finishRejectOpen, setFinishRejectOpen] = useState(false);
  const [finishRejectRow, setFinishRejectRow] = useState<FinishedRow | null>(null);
  const [finishRejectNote, setFinishRejectNote] = useState("");
  const [shiftHintText, setShiftHintText] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [graceMinutes, setGraceMinutes] = useState(30);
  const [backfillDays, setBackfillDays] = useState(7);
  const [submitWorkDate, setSubmitWorkDate] = useState<Dayjs>(() => dayjs());
  const [form] = Form.useForm<{ person_id?: string; rows: BatchRow[] }>();
  const { hasPermission } = usePermission();
  const canReview = hasPermission(PERM_REVIEW);
  const authUser = useAuthStore((s) => s.user);
  const actorName =
    (authUser?.display_name || "").trim() ||
    (authUser?.username || "").trim() ||
    "现场";

  const dateFrom = range[0].format("YYYY-MM-DD");
  const dateTo = range[1].format("YYYY-MM-DD");
  const submitDateStr = submitWorkDate.format("YYYY-MM-DD");
  const isSingleDay = dateFrom === dateTo;

  const { data, loading, refresh } = useRequest(
    () => fetchShopFloorReports({ date_from: dateFrom, date_to: dateTo }),
    { immediate: true, deps: [dateFrom, dateTo] },
  );

  const {
    data: stats,
    loading: statsLoading,
    refresh: refreshStats,
  } = useRequest(
    () =>
      fetchShopFloorStats({
        date_from: dateFrom,
        date_to: dateTo,
        resource_id: resourceId,
        process_name: processName,
        equipment_key: equipmentKey,
        shift_family_id: shiftFamilyId,
      }),
    {
      immediate: true,
      deps: [dateFrom, dateTo, resourceId, processName, equipmentKey, shiftFamilyId],
    },
  );

  const refreshAll = () => {
    refresh();
    refreshStats();
  };

  const todayStr = data?.today || dayjs().format("YYYY-MM-DD");
  const isToday = isSingleDay && dateFrom === todayStr;
  const submitIsToday = submitDateStr === todayStr;
  const settings = stats?.settings || data?.settings;
  const grace = settings?.off_shift_grace_minutes ?? 30;
  const historyDays = settings?.history_backfill_days ?? 7;

  const dayItems = data?.items ?? [];
  const items = useMemo(() => {
    let rows = dayItems;
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (processName) rows = rows.filter((r) => (r.process_name || "") === processName);
    if (equipmentKey) {
      rows = rows.filter(
        (r) =>
          (r.equipment_name || "") === equipmentKey || (r.equipment_id || "") === equipmentKey,
      );
    }
    if (resourceId) {
      const pids = new Set(
        (data?.persons ?? []).filter((p) => p.resource_id === resourceId).map((p) => p.id),
      );
      rows = rows.filter((r) => pids.has(r.person_id));
    }
    return rows;
  }, [dayItems, statusFilter, processName, equipmentKey, resourceId, data?.persons]);

  const att = stats?.attendance;
  const pendingN = dayItems.filter((r) => r.status === "pending").length;
  const confirmedN = dayItems.filter((r) => r.status === "confirmed").length;
  const rejectedN = dayItems.filter((r) => r.status === "rejected").length;
  const dayKpis = useMemo(() => {
    const expected = att?.expected ?? 0;
    const reported = att?.reported ?? 0;
    const unreported = att?.unreported ?? 0;
    const rate =
      expected > 0 ? `${Math.round((reported / expected) * 1000) / 10}%` : undefined;
    return [
      {
        title: "人日报工",
        value: reported,
        parts: [
          { label: "应报", value: expected },
          { label: "已报", value: reported },
          { label: "未报", value: unreported },
        ],
        ratio: rate
          ? `${reported}/${expected}（${rate}）· 宽限${grace}分后催`
          : `下班+宽限${grace}分后才计入应报`,
      },
      {
        title: "报工状态",
        value: pendingN,
        parts: [
          { label: "驳回", value: rejectedN },
          { label: "待确认", value: pendingN },
          { label: "已确认", value: confirmedN },
        ],
      },
      {
        title: "工序合计",
        value: stats?.process_total_qty ?? 0,
      },
      {
        title: "成品已确认",
        value: stats?.finished?.confirmed_qty ?? 0,
        ratio: stats?.finished?.note?.slice(0, 24),
      },
    ];
  }, [att, stats, pendingN, confirmedN, rejectedN]);

  const processChart = useMemo(
    () => (stats?.by_process ?? []).map((p) => ({ label: p.name, value: p.qty })),
    [stats?.by_process],
  );
  const equipmentChart = useMemo(
    () => (stats?.by_equipment ?? []).map((p) => ({ label: p.name, value: p.qty })),
    [stats?.by_equipment],
  );
  const shiftAttChart = useMemo(
    () =>
      (att?.by_shift ?? []).map((s) => ({
        label: s.shift_name || "班次",
        value: s.reported,
      })),
    [att?.by_shift],
  );

  const workOrderOptions = useMemo(
    () =>
      (data?.work_orders ?? []).map((w) => ({
        value: `${w.code} · ${w.name}`,
        label: `${w.code} · ${w.name}`,
        id: w.id,
      })),
    [data?.work_orders],
  );

  const productOptions = useMemo(
    () => (data?.product_options ?? []).map((p) => ({ value: p, label: p })),
    [data?.product_options],
  );

  const processOptions = useMemo(
    () =>
      (data?.templates ?? []).map((t) => ({
        value: t.name,
        label: t.name,
        id: t.id,
      })),
    [data?.templates],
  );

  const processFilterOptions = useMemo(() => {
    const names = new Set<string>();
    for (const t of data?.templates ?? []) if (t.name) names.add(t.name);
    for (const r of dayItems) if (r.process_name) names.add(r.process_name);
    for (const p of stats?.by_process ?? []) if (p.name) names.add(p.name);
    return [...names].sort().map((n) => ({ value: n, label: n }));
  }, [data?.templates, dayItems, stats?.by_process]);

  const equipmentOptions = useMemo(
    () =>
      (data?.equipments ?? [])
        .filter((e) => e.status !== "disabled")
        .map((e) => ({
          value: `${e.name}（${e.code}）`,
          label: `${e.name}（${e.code}）`,
          id: e.id,
          name: e.name,
        })),
    [data?.equipments],
  );

  const equipmentFilterOptions = useMemo(() => {
    const opts = (data?.equipments ?? [])
      .filter((e) => e.status !== "disabled")
      .map((e) => ({ value: e.name, label: `${e.name}（${e.code}）` }));
    const names = new Set(opts.map((o) => o.value));
    for (const r of dayItems) {
      const n = (r.equipment_name || "").trim();
      if (n && !names.has(n)) {
        names.add(n);
        opts.push({ value: n, label: n });
      }
    }
    return opts;
  }, [data?.equipments, dayItems]);

  const resourceOptions = useMemo(
    () =>
      (data?.resources ?? [])
        .filter((r) => r.status !== "disabled")
        .map((r) => ({ value: r.id, label: r.name })),
    [data?.resources],
  );

  const shiftOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: Array<{ value: string; label: string }> = [];
    for (const s of data?.shifts ?? []) {
      const fid = s.family_id;
      if (!fid || seen.has(fid)) continue;
      seen.add(fid);
      opts.push({ value: fid, label: s.name || fid });
    }
    return opts;
  }, [data?.shifts]);

  const applyShiftHint = async (personId: string, workDate?: string) => {
    if (!personId) {
      setShiftHintText(null);
      return { start: null as Dayjs | null, end: null as Dayjs | null };
    }
    try {
      const hint = await fetchShopFloorShiftHint(
        personId,
        workDate || submitWorkDate.format("YYYY-MM-DD"),
      );
      if (hint.found && hint.start_time && hint.end_time) {
        const start = parseHm(hint.start_time);
        const end = parseHm(hint.end_time);
        setShiftHintText(
          hint.shift_name
            ? `已带入班次「${hint.shift_name}」${hint.start_time}-${hint.end_time}，可改时分`
            : `已带入班次 ${hint.start_time}-${hint.end_time}，可改时分`,
        );
        return { start, end };
      }
      setShiftHintText(hint.message || "未找到当日班次，请自行填写起止时间");
      return { start: null, end: null };
    } catch {
      setShiftHintText("无法获取班次，请自行填写起止时间");
      return { start: null, end: null };
    }
  };

  const openSubmit = () => {
    form.resetFields();
    form.setFieldsValue({ person_id: undefined, rows: [emptyRow()] });
    setShiftHintText(null);
    setSubmitWorkDate(isSingleDay ? range[0] : dayjs(todayStr));
    setSubmitOpen(true);
  };

  const openSettings = () => {
    setGraceMinutes(grace);
    setBackfillDays(historyDays);
    setSettingsOpen(true);
  };

  const { mutate: doSaveSettings, loading: savingSettings } = useMutation(
    () =>
      updateShopFloorSettings({
        off_shift_grace_minutes: graceMinutes,
        history_backfill_days: backfillDays,
      }),
    {
      successMessage: "口径已保存",
      onSuccess: () => {
        setSettingsOpen(false);
        refreshAll();
      },
    },
  );

  const { mutate: doSubmit, loading: submitting } = useMutation(
    async (values: { person_id: string; rows: BatchRow[] }) => {
      const rows = (values.rows || []).map((row) => {
        const linkType = row.link_type || "work_order";
        const linkValue = (row.link_value || "").trim();
        const processNameRow = (row.process_name || "").trim();
        const tpl = processOptions.find(
          (t) => t.value === processNameRow || t.id === row.template_id,
        );
        const eqOpt = equipmentOptions.find(
          (e) => e.value === row.equipment_value || e.name === row.equipment_value,
        );
        const payload: {
          link_type: LinkType;
          process_name: string;
          template_id?: string;
          qty: number;
          start_time?: string;
          end_time?: string;
          work_order_id?: string;
          work_order_label?: string;
          product?: string;
          equipment_id?: string;
          equipment_name?: string;
          note?: string;
        } = {
          link_type: linkType,
          process_name: processNameRow,
          template_id: tpl?.id,
          qty: Number(row.qty) || 0,
          start_time: row.start_time ? row.start_time.format("HH:mm") : undefined,
          end_time: row.end_time ? row.end_time.format("HH:mm") : undefined,
          note: row.note,
        };
        if (linkType === "work_order") {
          const wo = workOrderOptions.find((w) => w.value === linkValue || w.id === linkValue);
          if (wo) payload.work_order_id = wo.id;
          else payload.work_order_label = linkValue;
        } else {
          payload.product = linkValue;
        }
        if (eqOpt) {
          payload.equipment_id = eqOpt.id;
          payload.equipment_name = eqOpt.name;
        } else if ((row.equipment_value || "").trim()) {
          payload.equipment_name = (row.equipment_value || "").trim();
        }
        return payload;
      });
      return submitShopFloorReportsBatch({
        person_id: values.person_id,
        work_date: submitDateStr,
        submitted_by: actorName,
        submitted_by_user_id: authUser?.id,
        rows,
      });
    },
    {
      successMessage: submitIsToday ? "已提交，等待确认" : "历史补报已提交，等待确认",
      onSuccess: () => {
        setSubmitOpen(false);
        form.resetFields();
        refreshAll();
      },
    },
  );

  const pendingIds = useMemo(
    () => items.filter((r) => r.status === "pending").map((r) => r.id),
    [items],
  );

  const { mutate: doReview, loading: reviewing } = useMutation(
    async (payload: {
      id?: string;
      ids?: string[];
      action: "confirm" | "reject";
      note?: string;
    }) => {
      const ids = payload.ids?.length
        ? payload.ids
        : payload.id
          ? [payload.id]
          : [];
      if (ids.length === 0) throw new Error("没有待处理的报工");
      if (ids.length === 1) {
        return reviewShopFloorReport(ids[0], {
          action: payload.action,
          reviewer: actorName,
          reviewer_user_id: authUser?.id,
          note: payload.note,
        });
      }
      return reviewShopFloorReportsBatch({
        ids,
        action: payload.action,
        reviewer: actorName,
        reviewer_user_id: authUser?.id,
        note: payload.note,
      });
    },
    {
      successMessage: "已处理",
      onSuccess: () => {
        setRejectOpen(false);
        setRejectIds([]);
        setRejectNote("");
        refreshAll();
      },
    },
  );

  const openReject = (id: string) => {
    setRejectIds([id]);
    setRejectNote("");
    setRejectOpen(true);
  };

  const openRejectAll = () => {
    if (!pendingIds.length) {
      message.info("当前筛选下没有待确认报工");
      return;
    }
    setRejectIds(pendingIds);
    setRejectNote("");
    setRejectOpen(true);
  };

  const confirmAllPending = () => {
    if (!pendingIds.length) {
      message.info("当前筛选下没有待确认报工");
      return;
    }
    Modal.confirm({
      title: `全部确认 ${pendingIds.length} 条？`,
      content: "仅处理当前筛选条件下的待确认报工，确认后会计入进度统计。",
      okText: "全部确认",
      onOk: () => doReview({ ids: pendingIds, action: "confirm" }),
    });
  };

  const { mutate: doDelete } = useMutation(
    (id: string) => deleteShopFloorReport(id),
    {
      successMessage: "已删除",
      onSuccess: () => refreshAll(),
    },
  );

  const finishProductOptions = useMemo(() => {
    const byValue = new Map<
      string,
      { value: string; label: string; last_process?: string }
    >();
    const push = (value?: string, label?: string, last_process?: string) => {
      const v = (value || "").trim();
      if (!v || byValue.has(v)) return;
      byValue.set(v, {
        value: v,
        label: (label || v).trim() || v,
        last_process: last_process || undefined,
      });
    };
    for (const p of stats?.finished?.product_options ?? []) {
      push(p.product, p.code ? `${p.product}（${p.code}）` : p.product, p.last_process);
    }
    for (const p of data?.product_options ?? []) {
      push(p, p);
    }
    for (const row of stats?.finished?.suggested ?? []) {
      push(row.product, row.product, row.last_process);
    }
    return Array.from(byValue.values());
  }, [stats?.finished?.product_options, stats?.finished?.suggested, data?.product_options]);

  const finishedRows = stats?.finished?.suggested ?? [];
  const finishedSpans = useMemo(
    () => buildDateProductRowSpans(finishedRows),
    [finishedRows],
  );

  const resolveFinishShift = (row?: FinishedRow | null) => {
    const shiftFamilyId =
      finishShiftFamilyId || row?.shift_family_id || undefined;
    const shiftName =
      shiftOptions.find((s) => s.value === shiftFamilyId)?.label ||
      (row?.shift_name && row.shift_name !== "—" ? row.shift_name : undefined);
    return { shiftFamilyId, shiftName };
  };

  const { mutate: doFinishConfirm, loading: finishing } = useMutation(
    async () => {
      const isApply = finishAction === "apply";
      const workDate = isApply
        ? finishDate.format("YYYY-MM-DD")
        : finishRow?.work_date;
      const product = isApply ? (finishProduct || "").trim() : finishRow?.product;
      if (!workDate || !product) throw new Error("请选择日期与产品");
      const { shiftFamilyId, shiftName } = resolveFinishShift(finishRow);
      if (!shiftFamilyId && !shiftName) {
        throw new Error("请选择班次");
      }
      const suggested = isApply ? 0 : Number(finishRow?.suggested_qty) || 0;
      const messages: Record<FinishAction, string> = {
        apply: "已提交本班成品申请",
        confirm: "本班成品已确认",
        modify: "本班数量已修改",
      };
      const result = await confirmShopFloorFinished({
        work_date: workDate,
        product,
        confirmed_qty: finishQty,
        suggested_qty: suggested,
        action: finishAction,
        confirmed_by: actorName,
        submitted_by:
          finishAction === "apply"
            ? actorName
            : finishRow?.submitted_by ||
              finishRow?.applicant_names?.split("、")[0] ||
              actorName,
        shift_name: shiftName || null,
        shift_family_id: shiftFamilyId || null,
      });
      return { result, tip: messages[finishAction] };
    },
    {
      successMessage: (data) => data.tip,
      onSuccess: () => {
        setFinishOpen(false);
        setFinishRow(null);
        setFinishShiftFamilyId(undefined);
        refreshAll();
      },
    },
  );

  const { mutate: doFinishReject, loading: finishRejecting } = useMutation(
    async () => {
      const row = finishRejectRow;
      if (!row) throw new Error("请选择要驳回的行");
      const note = finishRejectNote.trim();
      if (!note) throw new Error("请写明驳回原因");
      const fam =
        row.shift_family_id ||
        shiftOptions.find((s) => s.label === row.shift_name)?.value;
      const shiftName =
        row.shift_name && row.shift_name !== "—"
          ? row.shift_name
          : shiftOptions.find((s) => s.value === fam)?.label;
      if (!fam && !shiftName) throw new Error("缺少班次，无法驳回");
      return confirmShopFloorFinished({
        work_date: row.work_date,
        product: row.product,
        confirmed_qty: row.confirmed_qty ?? row.suggested_qty ?? 0,
        suggested_qty: Number(row.suggested_qty) || 0,
        action: "reject",
        confirmed_by: actorName,
        submitted_by: row.submitted_by || actorName,
        note,
        shift_name: shiftName || null,
        shift_family_id: fam || null,
      });
    },
    {
      successMessage: "已驳回本班成品",
      onSuccess: () => {
        setFinishRejectOpen(false);
        setFinishRejectRow(null);
        setFinishRejectNote("");
        refreshAll();
      },
    },
  );

  const openFinish = (row: FinishedRow, action: FinishAction) => {
    setFinishAction(action);
    setFinishRow(row);
    setFinishDate(dayjs(row.work_date));
    setFinishProduct(row.product);
    const fam =
      row.shift_family_id ||
      shiftOptions.find((s) => s.label === row.shift_name)?.value;
    setFinishShiftFamilyId(fam || undefined);
    const suggested = Number(row.suggested_qty);
    setFinishQty(
      row.confirmed_qty != null && row.confirmed_qty !== undefined
        ? Number(row.confirmed_qty)
        : Number.isFinite(suggested)
          ? suggested
          : 0,
    );
    setFinishOpen(true);
  };

  const openFinishCreate = () => {
    setFinishAction("apply");
    setFinishRow(null);
    setFinishDate(range[1] || dayjs());
    setFinishProduct(undefined);
    setFinishShiftFamilyId(undefined);
    setFinishQty(0);
    setFinishOpen(true);
  };

  const openFinishReject = (row: FinishedRow) => {
    setFinishRejectRow(row);
    setFinishRejectNote("");
    setFinishRejectOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="每日报工"
        subtitle={`应报=下班+宽限（${grace} 分钟）后才催；支持近 ${historyDays} 天历史补报。进度见同级菜单。`}
        extra={
          <Space wrap>
            <RangePicker
              value={range}
              allowClear={false}
              onChange={(v) => {
                if (v?.[0] && v?.[1]) setRange([v[0], v[1]]);
              }}
            />
            {canReview ? (
              <Button onClick={openSettings}>报工口径</Button>
            ) : null}
            <AuthButton
              type="primary"
              icon={<PlusOutlined />}
              permission={PERM_REPORT}
              onClick={openSubmit}
            >
              下班提交 / 补报
            </AuthButton>
          </Space>
        }
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={
          att?.note ||
          `应报仅统计有排班且已过下班+宽限的人×日；未开班不算欠报。产量归属班次日；申请人/确认人会写入报工记录。`
        }
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="班组"
            style={{ width: 140 }}
            value={resourceId}
            onChange={setResourceId}
            options={resourceOptions}
          />
          <Select
            allowClear
            placeholder="班次"
            style={{ width: 140 }}
            value={shiftFamilyId}
            onChange={setShiftFamilyId}
            options={shiftOptions}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="工序"
            style={{ width: 140 }}
            value={processName}
            onChange={setProcessName}
            options={processFilterOptions}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="设备"
            style={{ width: 160 }}
            value={equipmentKey}
            onChange={setEquipmentKey}
            options={equipmentFilterOptions}
          />
          {(att?.unreported ?? 0) > 0 ? (
            <Button onClick={() => setUnreportedOpen(true)}>
              未报名单（{att?.unreported}）
            </Button>
          ) : null}
        </Space>
      </Card>

      <KpiRow items={dayKpis} loading={(loading || statsLoading) && !data} />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card size="small" title="各工序产量" loading={statsLoading && !stats}>
            {processChart.length ? (
              <BarChart data={processChart} height={240} unit="件" />
            ) : (
              <Typography.Text type="secondary">暂无报工产量</Typography.Text>
            )}
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" title="设备产量" loading={statsLoading && !stats}>
            {equipmentChart.length ? (
              <PieChart data={equipmentChart} height={240} legendPosition="right" />
            ) : (
              <Typography.Text type="secondary">暂无设备数据</Typography.Text>
            )}
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" title="各班已报人日" loading={statsLoading && !stats}>
            {shiftAttChart.length ? (
              <BarChart data={shiftAttChart} height={240} unit="人日" />
            ) : (
              <Typography.Text type="secondary">区间内无排班应报</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title="成品确认"
        style={{ marginBottom: 16 }}
        extra={
          <Space wrap>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {stats?.finished?.note ||
                "同日同产品合并；按班确认/修改/驳回；日合计=各班已确认之和"}
            </Typography.Text>
            <AuthButton size="small" permission={PERM_REVIEW} onClick={openFinishCreate}>
              手工登记
            </AuthButton>
          </Space>
        }
      >
        <Table
          size="small"
          rowKey={(r) =>
            `${r.work_date}-${r.product}-${r.shift_family_id || r.shift_name || "na"}`
          }
          pagination={{ pageSize: 15, hideOnSinglePage: true }}
          loading={statsLoading && !stats}
          dataSource={finishedRows}
          scroll={{ x: 1180 }}
          locale={{ emptyText: "暂无产品；请先在基础信息维护，或点「手工登记」" }}
          columns={[
            {
              title: "归属日",
              dataIndex: "work_date",
              width: 110,
              onCell: (_: FinishedRow, index?: number) => ({
                rowSpan: index == null ? 1 : finishedSpans.dateSpan[index] || 0,
              }),
            },
            {
              title: "产品",
              dataIndex: "product",
              width: 140,
              onCell: (_: FinishedRow, index?: number) => ({
                rowSpan: index == null ? 1 : finishedSpans.productSpan[index] || 0,
              }),
            },
            {
              title: "班次",
              dataIndex: "shift_name",
              width: 90,
              render: (v: string) => (v && v !== "—" ? <Tag>{v}</Tag> : "—"),
            },
            {
              title: "末道工序",
              dataIndex: "last_process",
              width: 90,
              onCell: (_: FinishedRow, index?: number) => ({
                rowSpan: index == null ? 1 : finishedSpans.productSpan[index] || 0,
              }),
              render: (v: string) => v || "—",
            },
            {
              title: "本班数量",
              dataIndex: "confirmed_qty",
              width: 110,
              render: (v: number | null | undefined, row: FinishedRow) => {
                if (row.status === "rejected") {
                  return (
                    <Tag color="default" title={row.reject_note || undefined}>
                      已驳回
                    </Tag>
                  );
                }
                if (row.status === "pending" && v != null) {
                  return <Tag color="orange">{v}·待确认</Tag>;
                }
                if (row.status === "confirmed" && v != null) {
                  return <Tag color="green">{v}</Tag>;
                }
                if (v != null) return <Tag>{v}</Tag>;
                return <Tag>待确认</Tag>;
              },
            },
            {
              title: "日合计",
              dataIndex: "day_confirmed_qty",
              width: 90,
              onCell: (_: FinishedRow, index?: number) => ({
                rowSpan: index == null ? 1 : finishedSpans.dayQtySpan[index] || 0,
              }),
              render: (v: number | null | undefined) =>
                v != null ? (
                  <Typography.Text type="secondary">{v}</Typography.Text>
                ) : (
                  "—"
                ),
            },
            {
              title: "申请人",
              width: 100,
              ellipsis: true,
              render: (_: unknown, row: FinishedRow) =>
                row.submitted_by || row.applicant_names || "—",
            },
            {
              title: "申请时间",
              width: 140,
              render: (_: unknown, row: FinishedRow) =>
                formatDateTime(row.submitted_at || row.first_submitted_at),
            },
            {
              title: "确认人",
              width: 100,
              ellipsis: true,
              render: (_: unknown, row: FinishedRow) => row.confirmed_by || "—",
            },
            {
              title: "确认时间",
              width: 140,
              render: (_: unknown, row: FinishedRow) => formatDateTime(row.confirmed_at),
            },
            {
              title: "操作",
              width: 168,
              fixed: "right",
              render: (_: unknown, row: FinishedRow) => {
                if (!canReview) {
                  return (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      无确认权限
                    </Typography.Text>
                  );
                }
                const st = row.status;
                const noShift = !row.shift_name || row.shift_name === "—";
                if (noShift && !row.shift_family_id) {
                  return (
                    <Button type="link" size="small" onClick={openFinishCreate}>
                      去登记
                    </Button>
                  );
                }
                if (st === "confirmed") {
                  return (
                    <Space size={0}>
                      <Button type="link" size="small" onClick={() => openFinish(row, "modify")}>
                        修改
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        danger
                        onClick={() => openFinishReject(row)}
                      >
                        驳回
                      </Button>
                    </Space>
                  );
                }
                if (st === "pending") {
                  return (
                    <Space size={0}>
                      <Button type="link" size="small" onClick={() => openFinish(row, "confirm")}>
                        确认
                      </Button>
                      <Button type="link" size="small" onClick={() => openFinish(row, "modify")}>
                        修改
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        danger
                        onClick={() => openFinishReject(row)}
                      >
                        驳回
                      </Button>
                    </Space>
                  );
                }
                if (st === "rejected") {
                  return (
                    <Button type="link" size="small" onClick={() => openFinish(row, "confirm")}>
                      重新确认
                    </Button>
                  );
                }
                return (
                  <Button type="link" size="small" onClick={() => openFinish(row, "confirm")}>
                    确认
                  </Button>
                );
              },
            },
          ]}
        />
      </Card>

      <DataTable<ShopFloorReportItem>
        rowKey="id"
        loading={loading}
        dataSource={items}
        scroll={{ x: 1480 }}
        title={() => (
          <Space wrap>
            <span style={{ fontWeight: 600 }}>报工明细</span>
            <Select
              allowClear
              placeholder="状态"
              style={{ width: 120 }}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "pending", label: "待确认" },
                { value: "confirmed", label: "已确认" },
                { value: "rejected", label: "已驳回" },
              ]}
            />
            {canReview ? (
              <>
                <Button
                  type="primary"
                  size="small"
                  icon={<CheckOutlined />}
                  disabled={!pendingIds.length}
                  loading={reviewing}
                  onClick={confirmAllPending}
                >
                  全部确认{pendingIds.length ? `（${pendingIds.length}）` : ""}
                </Button>
                <Button
                  danger
                  size="small"
                  icon={<CloseOutlined />}
                  disabled={!pendingIds.length}
                  loading={reviewing}
                  onClick={openRejectAll}
                >
                  全部驳回{pendingIds.length ? `（${pendingIds.length}）` : ""}
                </Button>
              </>
            ) : null}
          </Space>
        )}
        columns={[
          { title: "作业人", dataIndex: "person_name", width: 90 },
          {
            title: "归属日",
            dataIndex: "work_date",
            width: 120,
            render: (v: string, row) => (
              <Space size={4}>
                <span>{v}</span>
                {row.is_backfill ? <Tag>补报</Tag> : null}
              </Space>
            ),
          },
          {
            title: "所属班",
            width: 90,
            render: (_: unknown, row) => row.shift_name || "—",
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 90,
            render: (v: string) => (
              <StatusTag value={v} labelMap={STATUS_LABEL} colorMap={STATUS_COLOR} />
            ),
          },
          {
            title: "申请人",
            width: 90,
            render: (_: unknown, row) => row.applicant_name || row.submitted_by || "—",
          },
          {
            title: "申请时间",
            width: 150,
            render: (_: unknown, row) => {
              const t = row.submitted_at;
              if (!t) return "—";
              return t.length >= 16 ? `${t.slice(0, 10)} ${t.slice(11, 16)}` : t;
            },
          },
          {
            title: "确认人",
            width: 90,
            render: (_: unknown, row) => {
              if (row.status === "pending") return "—";
              return row.confirmer_name || row.reviewed_by || "—";
            },
          },
          {
            title: "确认时间",
            width: 150,
            render: (_: unknown, row) => {
              if (row.status === "pending") return "—";
              const t = row.reviewed_at;
              if (!t) return "—";
              return t.length >= 16 ? `${t.slice(0, 10)} ${t.slice(11, 16)}` : t;
            },
          },
          {
            title: "工单 / 产品",
            width: 180,
            render: (_: unknown, row) => (
              <span>
                <Tag>{row.link_type_label || row.link_type}</Tag>
                {row.work_order_label || row.work_order_code || row.product_display || "—"}
              </span>
            ),
          },
          { title: "工序", dataIndex: "process_name", width: 100 },
          {
            title: "设备",
            dataIndex: "equipment_name",
            width: 100,
            render: (v) => v || "—",
          },
          {
            title: "数量",
            dataIndex: "qty",
            width: 80,
            render: (v: number) => <Typography.Text strong>{v}</Typography.Text>,
          },
          {
            title: "时段",
            width: 110,
            render: (_: unknown, row) =>
              row.start_time && row.end_time ? `${row.start_time}-${row.end_time}` : "—",
          },
          { title: "工时", dataIndex: "hours", width: 70 },
          {
            title: "报工备注",
            dataIndex: "note",
            width: 120,
            ellipsis: true,
            render: (v: string) => v || "—",
          },
          {
            title: "驳回原因",
            dataIndex: "review_note",
            width: 160,
            ellipsis: true,
            render: (v: string, row) => {
              if (row.status !== "rejected") {
                return v ? (
                  <Typography.Text type="secondary">{v}</Typography.Text>
                ) : (
                  "—"
                );
              }
              return v ? (
                <Typography.Text type="danger">{v}</Typography.Text>
              ) : (
                <Typography.Text type="secondary">未填写</Typography.Text>
              );
            },
          },
          {
            title: "操作",
            width: 200,
            fixed: "right",
            render: (_: unknown, row) => {
              const dayDiff = dayjs(todayStr).diff(dayjs(row.work_date), "day");
              const canDelete =
                dayDiff >= 0 &&
                dayDiff <= historyDays &&
                (row.status === "pending" || row.status === "rejected");
              return (
                <Space size={4}>
                  {row.status === "pending" ? (
                    <>
                      <AuthButton
                        type="link"
                        size="small"
                        icon={<CheckOutlined />}
                        permission={PERM_REVIEW}
                        loading={reviewing}
                        onClick={() => doReview({ id: row.id, action: "confirm" })}
                      >
                        确认
                      </AuthButton>
                      <AuthButton
                        type="link"
                        size="small"
                        danger
                        icon={<CloseOutlined />}
                        permission={PERM_REVIEW}
                        loading={reviewing}
                        onClick={() => openReject(row.id)}
                      >
                        驳回
                      </AuthButton>
                    </>
                  ) : null}
                  {canDelete ? (
                    <AuthButton
                      type="link"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      permission={PERM_REPORT}
                      onClick={() => doDelete(row.id)}
                    >
                      删除
                    </AuthButton>
                  ) : null}
                </Space>
              );
            },
          },
        ]}
      />

      <Drawer
        title="未报名单"
        open={unreportedOpen}
        onClose={() => setUnreportedOpen(false)}
        width={480}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`以下为人×日：有排班、已过下班+宽限（${grace} 分钟）且未提交任何报工（待确认/已确认均算已报）；未开班不在此列。`}
        />
        <Table
          size="small"
          rowKey={(r) => `${r.work_date}-${r.person_id}`}
          pagination={{ pageSize: 20 }}
          dataSource={att?.unreported_list ?? []}
          columns={[
            { title: "日期", dataIndex: "work_date", width: 110 },
            { title: "人员", dataIndex: "person_name" },
            { title: "班次", dataIndex: "shift_name", width: 100 },
          ]}
        />
      </Drawer>

      <Modal
        title={rejectIds.length > 1 ? `全部驳回（${rejectIds.length} 条）` : "驳回报工"}
        open={rejectOpen}
        destroyOnHidden
        confirmLoading={reviewing}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
        onCancel={() => {
          setRejectOpen(false);
          setRejectIds([]);
          setRejectNote("");
        }}
        onOk={async () => {
          const note = rejectNote.trim();
          if (!note) {
            message.warning("请填写驳回原因");
            return;
          }
          if (!rejectIds.length) return;
          await doReview({ ids: rejectIds, action: "reject", note });
        }}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          {rejectIds.length > 1
            ? "将使用同一原因驳回当前筛选下全部待确认报工，方便作业人改正后重报。"
            : "请说明哪里不对，方便作业人改正后重报。"}
        </Typography.Paragraph>
        <Input.TextArea
          rows={4}
          maxLength={200}
          showCount
          placeholder="例如：数量与实物不符、工序选错、设备填错…"
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
        />
      </Modal>

      <Modal
        title={
          finishAction === "apply"
            ? "手工登记本班成品"
            : finishAction === "modify"
              ? `修改本班数量 · ${finishRow?.product || ""} · ${finishRow?.shift_name || ""}`
              : `确认本班成品 · ${finishRow?.product || ""} · ${finishRow?.shift_name || ""}`
        }
        open={finishOpen}
        destroyOnHidden
        onCancel={() => {
          setFinishOpen(false);
          setFinishRow(null);
          setFinishShiftFamilyId(undefined);
        }}
        confirmLoading={finishing}
        okText={
          finishAction === "apply" ? "提交申请" : finishAction === "modify" ? "保存数量" : "确认"
        }
        onOk={async () => {
          if (!canReview) {
            message.warning("无成品确认权限");
            return;
          }
          if (finishAction === "apply") {
            if (!finishProduct) {
              message.warning("请选择产品");
              return;
            }
            if (!finishShiftFamilyId) {
              message.warning("请选择班次");
              return;
            }
          } else if (!finishRow) {
            return;
          }
          if (
            finishAction !== "apply" &&
            !finishShiftFamilyId &&
            !(finishRow?.shift_name && finishRow.shift_name !== "—")
          ) {
            message.warning("请选择班次");
            return;
          }
          if (finishQty < 0) {
            message.warning("成品数量不能为负");
            return;
          }
          await doFinishConfirm();
        }}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          {finishAction === "apply" ? (
            <>
              <div>
                <Typography.Text style={{ display: "block", marginBottom: 6 }}>日期</Typography.Text>
                <DatePicker
                  allowClear={false}
                  value={finishDate}
                  onChange={(d) => d && setFinishDate(d)}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <Typography.Text style={{ display: "block", marginBottom: 6 }}>产品</Typography.Text>
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder={
                    finishProductOptions.length
                      ? "选择或搜索产品"
                      : "暂无产品选项，请先维护基础信息"
                  }
                  style={{ width: "100%" }}
                  value={finishProduct}
                  onChange={setFinishProduct}
                  options={finishProductOptions}
                  notFoundContent="无匹配产品"
                />
              </div>
              <div>
                <Typography.Text style={{ display: "block", marginBottom: 6 }}>班次</Typography.Text>
                <Select
                  placeholder="选择白班/中班/夜班"
                  style={{ width: "100%" }}
                  value={finishShiftFamilyId}
                  onChange={setFinishShiftFamilyId}
                  options={shiftOptions}
                />
              </div>
              <Typography.Text type="secondary">
                提交后写入申请人「{actorName}」与申请时间，状态为待确认；确认后才计入日合计。
              </Typography.Text>
            </>
          ) : finishRow ? (
            <>
              <Typography.Text>
                日期 <Typography.Text strong>{finishRow.work_date}</Typography.Text>
                {" · "}
                产品 <Typography.Text strong>{finishRow.product}</Typography.Text>
                {" · "}
                班次{" "}
                <Typography.Text strong>
                  {shiftOptions.find((s) => s.value === finishShiftFamilyId)?.label ||
                    finishRow.shift_name ||
                    "—"}
                </Typography.Text>
              </Typography.Text>
              {finishAction === "modify" ? (
                <Typography.Text type="secondary">修改只能改数量，不变更申请人/确认人。</Typography.Text>
              ) : (
                <Typography.Text type="secondary">
                  本班报工参考 {Number(finishRow.suggested_qty) || 0}
                  {finishRow.submitted_by
                    ? ` · 申请人 ${finishRow.submitted_by}`
                    : ""}
                  （确认后写入确认人「{actorName}」）
                </Typography.Text>
              )}
            </>
          ) : null}
          <div>
            <Typography.Text style={{ display: "block", marginBottom: 6 }}>
              本班成品数
            </Typography.Text>
            <InputNumber
              min={0}
              step={0.5}
              style={{ width: "100%" }}
              value={finishQty}
              onChange={(v) => setFinishQty(v == null ? 0 : Number(v))}
            />
          </div>
        </Space>
      </Modal>

      <Modal
        title={`驳回本班成品 · ${finishRejectRow?.product || ""} · ${finishRejectRow?.shift_name || ""}`}
        open={finishRejectOpen}
        destroyOnHidden
        confirmLoading={finishRejecting}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
        onCancel={() => {
          setFinishRejectOpen(false);
          setFinishRejectRow(null);
          setFinishRejectNote("");
        }}
        onOk={async () => {
          if (!finishRejectNote.trim()) {
            message.warning("请写明驳回原因");
            return;
          }
          await doFinishReject();
        }}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          驳回后本班不计入日合计，请说明原因便于重新登记。
        </Typography.Paragraph>
        <Input.TextArea
          rows={4}
          maxLength={200}
          showCount
          placeholder="例如：与实物不符、班次填错、数量需重核…"
          value={finishRejectNote}
          onChange={(e) => setFinishRejectNote(e.target.value)}
        />
      </Modal>

      <Modal
        title="报工口径"
        open={settingsOpen}
        confirmLoading={savingSettings}
        okText="保存"
        onCancel={() => setSettingsOpen(false)}
        onOk={() => doSaveSettings()}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <div>
            <Typography.Text style={{ display: "block", marginBottom: 6 }}>
              下班宽限（分钟）
            </Typography.Text>
            <InputNumber
              min={0}
              max={240}
              style={{ width: "100%" }}
              value={graceMinutes}
              onChange={(v) => setGraceMinutes(v == null ? 30 : Number(v))}
            />
            <Typography.Text type="secondary">
              计划下班后宽限内不算「应报未报」，默认 30 分钟。
            </Typography.Text>
          </div>
          <div>
            <Typography.Text style={{ display: "block", marginBottom: 6 }}>
              历史补报窗口（天）
            </Typography.Text>
            <InputNumber
              min={0}
              max={31}
              style={{ width: "100%" }}
              value={backfillDays}
              onChange={(v) => setBackfillDays(v == null ? 7 : Number(v))}
            />
            <Typography.Text type="secondary">
              允许补报/删除未确认记录的最近天数，默认 7。
            </Typography.Text>
          </div>
          <Alert
            type="info"
            showIcon
            message="产量按班次归属日统计；未开班不催报。微信工号绑定为后期能力，本期申请人先记登录账号显示名。"
          />
        </Space>
      </Modal>

      <FormModal
        title={submitIsToday ? `下班提交 · ${submitDateStr}` : `历史补报 · ${submitDateStr}`}
        open={submitOpen}
        form={form}
        onCancel={() => setSubmitOpen(false)}
        confirmLoading={submitting}
        width={1080}
        onOk={async () => {
          const values = await form.validateFields();
          if (!values.person_id) {
            message.warning("请选择作业人员");
            return;
          }
          if (!(values.rows || []).length) {
            message.warning("请至少填写一行");
            return;
          }
          const dayDiff = dayjs(todayStr).diff(submitWorkDate, "day");
          if (dayDiff < 0) {
            message.warning("不能提交未来日期");
            return;
          }
          if (dayDiff > historyDays) {
            message.warning(`仅允许补报近 ${historyDays} 天`);
            return;
          }
          await doSubmit(values as { person_id: string; rows: BatchRow[] });
        }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`申请人：${actorName}（后期可与微信工号绑定）。作业人是实际干活的人，可与申请人不同。`}
        />
        <Form.Item label="归属日期" required style={{ marginBottom: 12 }}>
          <DatePicker
            allowClear={false}
            value={submitWorkDate}
            disabledDate={(d) => {
              if (!d) return false;
              const diff = dayjs(todayStr).diff(d.startOf("day"), "day");
              return diff < 0 || diff > historyDays;
            }}
            onChange={(d) => {
              if (!d) return;
              setSubmitWorkDate(d);
              const pid = form.getFieldValue("person_id") as string | undefined;
              if (pid) void applyShiftHint(pid, d.format("YYYY-MM-DD"));
            }}
            style={{ width: "100%" }}
          />
        </Form.Item>
        <Form.Item name="person_id" label="作业人员" rules={[{ required: true, message: "请选择人员" }]}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="一人一天可报多行"
            options={(data?.persons ?? [])
              .filter((p) => p.status !== "disabled")
              .map((p) => ({ value: p.id, label: `${p.name}（${p.code}）` }))}
            onChange={async (personId: string) => {
              const { start, end } = await applyShiftHint(personId);
              const rows = (form.getFieldValue("rows") as BatchRow[]) || [];
              form.setFieldsValue({
                rows: rows.map((r) => ({
                  ...r,
                  start_time: start,
                  end_time: end,
                })),
              });
            }}
          />
        </Form.Item>

        {shiftHintText ? (
          <Alert
            type={
              shiftHintText.includes("未找到") || shiftHintText.includes("无法")
                ? "warning"
                : "success"
            }
            showIcon
            style={{ marginBottom: 12 }}
            message={shiftHintText}
          />
        ) : null}

        <Form.List
          name="rows"
          rules={[
            {
              validator: async (_, rows) => {
                if (!rows || rows.length < 1) throw new Error("请至少添加一行报工");
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <div style={{ overflowX: "auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "88px 1fr 1fr 1fr 72px 88px 88px 1fr 40px",
                  gap: 8,
                  marginBottom: 6,
                  fontSize: 12,
                  color: "#718096",
                  minWidth: 920,
                }}
              >
                <span>挂接</span>
                <span>工单 / 产品</span>
                <span>工序</span>
                <span>设备</span>
                <span>数量</span>
                <span>开始</span>
                <span>结束</span>
                <span>备注</span>
                <span />
              </div>
              {fields.map((field) => (
                <div
                  key={field.key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "88px 1fr 1fr 1fr 72px 88px 88px 1fr 40px",
                    gap: 8,
                    marginBottom: 8,
                    minWidth: 920,
                    alignItems: "start",
                  }}
                >
                  <Form.Item
                    {...field}
                    name={[field.name, "link_type"]}
                    rules={[{ required: true }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Select
                      options={[
                        { value: "work_order", label: "工单" },
                        { value: "product", label: "产品" },
                      ]}
                      onChange={() => {
                        form.setFieldValue(["rows", field.name, "link_value"], undefined);
                      }}
                    />
                  </Form.Item>

                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, cur) => {
                      const a = prev?.rows?.[field.name]?.link_type;
                      const b = cur?.rows?.[field.name]?.link_type;
                      return a !== b;
                    }}
                  >
                    {() => {
                      const linkType =
                        (form.getFieldValue(["rows", field.name, "link_type"]) as LinkType) ||
                        "work_order";
                      return (
                        <Form.Item
                          {...field}
                          name={[field.name, "link_value"]}
                          rules={[
                            {
                              required: true,
                              message: linkType === "product" ? "填产品" : "填工单",
                            },
                          ]}
                          style={{ marginBottom: 0 }}
                        >
                          <AutoComplete
                            allowClear
                            placeholder={linkType === "product" ? "选或写产品" : "选或写工单"}
                            options={linkType === "product" ? productOptions : workOrderOptions}
                            filterOption={(input, option) =>
                              String(option?.value ?? "")
                                .toLowerCase()
                                .includes(input.toLowerCase())
                            }
                          />
                        </Form.Item>
                      );
                    }}
                  </Form.Item>

                  <Form.Item
                    {...field}
                    name={[field.name, "process_name"]}
                    rules={[{ required: true, message: "填工序" }]}
                    style={{ marginBottom: 0 }}
                  >
                    <AutoComplete
                      allowClear
                      placeholder="选模板或手写"
                      options={processOptions}
                      filterOption={(input, option) =>
                        String(option?.value ?? "")
                          .toLowerCase()
                          .includes(input.toLowerCase())
                      }
                      onSelect={(value) => {
                        const tpl = processOptions.find((t) => t.value === value);
                        if (tpl) {
                          form.setFieldValue(["rows", field.name, "template_id"], tpl.id);
                        }
                      }}
                      onChange={(value) => {
                        const tpl = processOptions.find((t) => t.value === value);
                        form.setFieldValue(["rows", field.name, "template_id"], tpl?.id);
                      }}
                    />
                  </Form.Item>

                  <Form.Item {...field} name={[field.name, "equipment_value"]} style={{ marginBottom: 0 }}>
                    <AutoComplete
                      allowClear
                      placeholder="选或写设备"
                      options={equipmentOptions}
                      filterOption={(input, option) =>
                        String(option?.value ?? "")
                          .toLowerCase()
                          .includes(input.toLowerCase())
                      }
                    />
                  </Form.Item>

                  <Form.Item
                    {...field}
                    name={[field.name, "qty"]}
                    rules={[{ required: true, message: "数量" }]}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber min={0.01} style={{ width: "100%" }} />
                  </Form.Item>

                  <Form.Item {...field} name={[field.name, "start_time"]} style={{ marginBottom: 0 }}>
                    <TimePicker format="HH:mm" style={{ width: "100%" }} placeholder="开始" />
                  </Form.Item>

                  <Form.Item {...field} name={[field.name, "end_time"]} style={{ marginBottom: 0 }}>
                    <TimePicker format="HH:mm" style={{ width: "100%" }} placeholder="结束" />
                  </Form.Item>

                  <Form.Item {...field} name={[field.name, "note"]} style={{ marginBottom: 0 }}>
                    <Input placeholder="可选" />
                  </Form.Item>

                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={fields.length <= 1}
                    onClick={() => remove(field.name)}
                  />
                </div>
              ))}
              <Button
                type="dashed"
                block
                icon={<PlusOutlined />}
                onClick={() => {
                  const rows = (form.getFieldValue("rows") as BatchRow[]) || [];
                  const last = rows[rows.length - 1];
                  add(
                    emptyRow({
                      start: last?.start_time ?? null,
                      end: last?.end_time ?? null,
                    }),
                  );
                }}
              >
                再加一行
              </Button>
              <Form.ErrorList errors={errors} />
            </div>
          )}
        </Form.List>
      </FormModal>
    </div>
  );
}
