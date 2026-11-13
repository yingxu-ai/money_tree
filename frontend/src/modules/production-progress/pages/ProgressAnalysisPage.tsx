import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Drawer,
  InputNumber,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  fetchProgressProcesses,
  fetchShopFloorProgress,
  fetchShopFloorProgressDetail,
  type ProgressDetailScope,
  type ProgressProcessItem,
  type ShopFloorOrderProgressItem,
  type ShopFloorProgressDetailLine,
  type ShopFloorProgressDetailResponse,
  type ShopFloorProgressDetailSummary,
  type ShopFloorProgressItem,
} from "@/modules/production-progress/api/progress";
import { LineChart, type ChartPoint } from "@/charts";
import { KpiRow } from "@/components/blocks";
import { DataTable, PageHeader } from "@/components/kit";
import { useRequest } from "@/hooks/useRequest";

type TimeGrain = "day" | "week" | "month" | "custom";
/** 详情分析 Tab：完成率 | 单位耗时 | 小时产量 */
type StatsTab = "completion" | "unit_time" | "hourly";

type TimeBucket = { key: string; label: string; start: string; end: string };
type QtyHours = { qty: number; hours: number };

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function lineHours(row: ShopFloorProgressDetailLine): number {
  const h = Number(row.hours || 0);
  if (h > 0) return h;
  const st = (row.start_time || "").slice(0, 5);
  const et = (row.end_time || "").slice(0, 5);
  if (!st || !et) return 0;
  const [sh, sm] = st.split(":").map(Number);
  const [eh, em] = et.split(":").map(Number);
  if ([sh, sm, eh, em].some((x) => Number.isNaN(x))) return 0;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return round3(mins / 60);
}

function addQtyHours(map: Map<string, QtyHours>, key: string, qty: number, hours: number) {
  const cur = map.get(key) || { qty: 0, hours: 0 };
  cur.qty += qty;
  cur.hours += hours;
  map.set(key, cur);
}

function cycleDays(periodStart?: string | null, periodEnd?: string | null): number | null {
  if (!periodStart || !periodEnd) return null;
  const a = dayjs(periodStart);
  const b = dayjs(periodEnd);
  if (!a.isValid() || !b.isValid()) return null;
  return Math.max(0, b.diff(a, "day")) + 1;
}

type FocusTarget = {
  scope: ProgressDetailScope;
  id: string;
  title?: string;
};

type LineFilters = {
  dateRange: [Dayjs, Dayjs] | null;
  shift: string | undefined;
  equipment: string | undefined;
  person: string | undefined;
  process: string | undefined;
  status: string | undefined;
};

const EMPTY_FILTERS: LineFilters = {
  dateRange: null,
  shift: undefined,
  equipment: undefined,
  person: undefined,
  process: undefined,
  status: undefined,
};

function dueTag(days: number | null | undefined, due?: string | null) {
  return (
    <span>
      {due || "—"}
      {typeof days === "number" ? (
        <Tag
          color={days < 0 ? "red" : days <= 3 ? "orange" : "default"}
          style={{ marginLeft: 6 }}
        >
          {days < 0 ? `逾 ${-days} 天` : `剩 ${days} 天`}
        </Tag>
      ) : null}
    </span>
  );
}

function uniqOptions(
  lines: ShopFloorProgressDetailLine[],
  key: keyof ShopFloorProgressDetailLine,
  fallback = "—",
) {
  const seen = new Set<string>();
  const opts: { value: string; label: string }[] = [];
  for (const row of lines) {
    const raw = row[key];
    const value = (raw == null || raw === "" ? fallback : String(raw)).trim() || fallback;
    if (seen.has(value)) continue;
    seen.add(value);
    opts.push({ value, label: value });
  }
  opts.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  return opts;
}

/**
 * 自然周：周一～周日。
 * 依赖全局 dayjs.locale("zh-cn")（weekStart=1）；不用手算 day()，避免和「按周日开头」搞混。
 */
function weekMonday(d: Dayjs): Dayjs {
  return d.startOf("week").startOf("day");
}

function weekSunday(d: Dayjs): Dayjs {
  return d.endOf("week").startOf("day");
}

function resolvePeriod(
  periodStart?: string | null,
  periodEnd?: string | null,
  fallbackDays?: string[],
): { start: string; end: string } | null {
  const keys = [...(fallbackDays || [])].sort();
  let start = (periodStart || keys[0] || "").slice(0, 10);
  let end = (periodEnd || keys[keys.length - 1] || "").slice(0, 10);
  if (!start || !end) return null;
  if (start > end) [start, end] = [end, start];
  return { start, end };
}

/** 按日/周/月/自定义天数生成连续时间桶 */
function buildTimeBuckets(
  periodStart: string,
  periodEnd: string,
  grain: TimeGrain,
  customDays: number,
): TimeBucket[] {
  const start = dayjs(periodStart).startOf("day");
  const end = dayjs(periodEnd).startOf("day");
  if (!start.isValid() || !end.isValid()) return [];
  const buckets: TimeBucket[] = [];
  const span = Math.max(1, customDays || 7);
  let guard = 0;

  if (grain === "day") {
    let cur = start;
    while ((cur.isBefore(end, "day") || cur.isSame(end, "day")) && guard < 800) {
      const iso = cur.format("YYYY-MM-DD");
      buckets.push({ key: iso, label: iso.slice(5), start: iso, end: iso });
      cur = cur.add(1, "day");
      guard += 1;
    }
    return buckets;
  }

  if (grain === "week") {
    // 从 period 所在周的周一起，到结束日所在周的周日，按完整自然周推进
    let cur = weekMonday(start);
    const lastMonday = weekMonday(end);
    while ((cur.isBefore(lastMonday, "day") || cur.isSame(lastMonday, "day")) && guard < 400) {
      const sun = weekSunday(cur);
      const key = cur.format("YYYY-MM-DD");
      buckets.push({
        key,
        label: `${cur.format("MM-DD")}~${sun.format("MM-DD")}`,
        start: key,
        end: sun.format("YYYY-MM-DD"),
      });
      cur = cur.add(1, "week");
      guard += 1;
    }
    return buckets;
  }

  if (grain === "month") {
    let cur = start.startOf("month");
    while (cur.isBefore(end, "month") || cur.isSame(end, "month")) {
      if (guard >= 120) break;
      const key = cur.format("YYYY-MM");
      buckets.push({
        key,
        label: key,
        start: cur.format("YYYY-MM-DD"),
        end: cur.endOf("month").format("YYYY-MM-DD"),
      });
      cur = cur.add(1, "month");
      guard += 1;
    }
    return buckets;
  }

  // custom N 天：从 periodStart 起切段（滚动窗，不是自然周）
  let cur = start;
  while (cur.isBefore(end, "day") || cur.isSame(end, "day")) {
    if (guard >= 400) break;
    const bEnd = cur.add(span - 1, "day");
    const key = cur.format("YYYY-MM-DD");
    buckets.push({
      key,
      label: `${cur.format("MM-DD")}~${(bEnd.isAfter(end) ? end : bEnd).format("MM-DD")}`,
      start: key,
      end: (bEnd.isAfter(end) ? end : bEnd).format("YYYY-MM-DD"),
    });
    cur = cur.add(span, "day");
    guard += 1;
  }
  return buckets;
}

function dayToBucketKey(
  iso: string,
  grain: TimeGrain,
  customDays: number,
  periodStart: string,
): string {
  const d = dayjs(iso);
  if (grain === "day") return iso;
  // 归到该日所在自然周的周一
  if (grain === "week") return weekMonday(d).format("YYYY-MM-DD");
  if (grain === "month") return d.format("YYYY-MM");
  const start = dayjs(periodStart).startOf("day");
  const span = Math.max(1, customDays || 7);
  const idx = Math.max(0, Math.floor(d.diff(start, "day") / span));
  return start.add(idx * span, "day").format("YYYY-MM-DD");
}

function bucketQtyHours(
  lines: ShopFloorProgressDetailLine[],
  grain: TimeGrain,
  customDays: number,
  periodStart: string,
): Map<string, QtyHours> {
  const map = new Map<string, QtyHours>();
  for (const row of lines) {
    const day = (row.work_date || "").slice(0, 10);
    if (!day) continue;
    const key = dayToBucketKey(day, grain, customDays, periodStart);
    addQtyHours(map, key, Number(row.qty || 0), lineHours(row));
  }
  return map;
}

function sumQtyHours(lines: ShopFloorProgressDetailLine[]): QtyHours {
  let qty = 0;
  let hours = 0;
  for (const row of lines) {
    qty += Number(row.qty || 0);
    hours += lineHours(row);
  }
  return { qty: round3(qty), hours: round3(hours) };
}

/** 累计完成率折线（相对计划产量） */
function buildCompletionPoints(
  lines: ShopFloorProgressDetailLine[],
  buckets: TimeBucket[],
  grain: TimeGrain,
  customDays: number,
  periodStart: string,
  planQty: number | null | undefined,
): ChartPoint[] {
  const map = bucketQtyHours(lines, grain, customDays, periodStart);
  let cum = 0;
  return buckets.map((b) => {
    cum += map.get(b.key)?.qty || 0;
    const rate =
      planQty && planQty > 0 ? round3(Math.min(100, (cum / planQty) * 100)) : round3(cum);
    return { label: b.label, value: rate };
  });
}

/** 单位耗时 = 工时÷产量；小时产量 = 产量÷工时 */
function buildEfficiencyPoints(
  lines: ShopFloorProgressDetailLine[],
  buckets: TimeBucket[],
  grain: TimeGrain,
  customDays: number,
  periodStart: string,
  mode: "unit_time" | "hourly",
): ChartPoint[] {
  const map = bucketQtyHours(lines, grain, customDays, periodStart);
  return buckets.map((b) => {
    const cell = map.get(b.key) || { qty: 0, hours: 0 };
    let value = 0;
    if (mode === "unit_time") {
      value = cell.qty > 0 ? round3(cell.hours / cell.qty) : 0;
    } else {
      value = cell.hours > 0 ? round3(cell.qty / cell.hours) : 0;
    }
    return { label: b.label, value };
  });
}

function GrainToolbar({
  grain,
  customDays,
  onGrain,
  onCustomDays,
}: {
  grain: TimeGrain;
  customDays: number;
  onGrain: (g: TimeGrain) => void;
  onCustomDays: (n: number) => void;
}) {
  return (
    <Space wrap size={8} style={{ marginBottom: 8 }}>
      <Typography.Text type="secondary">时间粒度</Typography.Text>
      <Segmented
        size="small"
        value={grain}
        onChange={(v) => onGrain(v as TimeGrain)}
        options={[
          { value: "day", label: "按日" },
          { value: "week", label: "按周(一至日)" },
          { value: "month", label: "按月" },
          { value: "custom", label: "自定义" },
        ]}
      />
      {grain === "custom" ? (
        <Space size={4}>
          <InputNumber
            size="small"
            min={2}
            max={90}
            value={customDays}
            onChange={(v) => onCustomDays(Number(v) || 7)}
          />
          <Typography.Text type="secondary">天一段</Typography.Text>
        </Space>
      ) : null}
    </Space>
  );
}

function BasicMetricsIntro({
  summary,
  lines,
}: {
  summary?: ShopFloorProgressDetailSummary | null;
  lines: ShopFloorProgressDetailLine[];
}) {
  const tot = useMemo(() => sumQtyHours(lines), [lines]);
  const plan = summary?.plan_qty ?? null;
  const actual = tot.qty;
  const completion =
    plan != null && plan > 0 ? round3(Math.min(100, (actual / plan) * 100)) : null;
  const unitTime = actual > 0 ? round3(tot.hours / actual) : null;
  const hourly = tot.hours > 0 ? round3(actual / tot.hours) : null;
  const cycle = cycleDays(summary?.period_start, summary?.period_end);

  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 12 }}
      message="基础生产指标"
      description={
        <div style={{ lineHeight: 1.7 }}>
          <div>
            实际产量 <b>{actual}</b>
            {plan != null ? (
              <>
                {" "}
                / 计划 <b>{plan}</b> · 完成率{" "}
                <b>{completion != null ? `${completion}%` : "—"}</b>
              </>
            ) : (
              <> · 暂无计划量</>
            )}
            {" · "}
            生产工时 <b>{tot.hours}</b> 小时
            {" · "}
            单位耗时{" "}
            <b>{unitTime != null ? unitTime : "—"}</b> 小时/件
            {unitTime != null ? `（${tot.hours}÷${actual}）` : ""}
            {" · "}
            小时产量{" "}
            <b>{hourly != null ? hourly : "—"}</b> 件/小时
            {hourly != null ? `（${actual}÷${tot.hours}）` : ""}
            {" · "}
            工单周期 <b>{cycle != null ? `${cycle} 天` : "—"}</b>
            {summary?.period_start && summary?.period_end
              ? `（${summary.period_start}～${summary.period_end}）`
              : ""}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            口径区分：生产工时=报工实际投入（hours/起止）；工单周期=开工至结束日历跨度；等待/停机尚未采集，不计入生产工时。
          </Typography.Text>
        </div>
      }
    />
  );
}

function DetailStatsPanel({
  lines,
  filters,
  summary,
  loading,
}: {
  lines: ShopFloorProgressDetailLine[];
  filters: LineFilters;
  summary?: ShopFloorProgressDetailSummary | null;
  loading?: boolean;
}) {
  const [tab, setTab] = useState<StatsTab>("completion");
  const [grain, setGrain] = useState<TimeGrain>("day");
  const [customDays, setCustomDays] = useState(7);

  useEffect(() => {
    setTab("completion");
    setGrain("day");
    setCustomDays(7);
  }, [summary?.id, summary?.scope]);

  useEffect(() => {
    const ps = summary?.period_start;
    const pe = summary?.period_end;
    if (!ps || !pe) return;
    const days = dayjs(pe).diff(dayjs(ps), "day");
    if (days > 120) setGrain("month");
    else if (days > 45) setGrain("week");
    else setGrain("day");
  }, [summary?.period_start, summary?.period_end, summary?.id]);

  const chartLines = useMemo(
    () => (filters.status ? lines : lines.filter((r) => r.status === "confirmed")),
    [lines, filters.status],
  );

  const tot = useMemo(() => sumQtyHours(chartLines), [chartLines]);
  const plan = summary?.plan_qty ?? null;
  const completionPct =
    plan != null && plan > 0 ? round3(Math.min(100, (tot.qty / plan) * 100)) : null;
  const unitTime = tot.qty > 0 ? round3(tot.hours / tot.qty) : null;
  const hourly = tot.hours > 0 ? round3(tot.qty / tot.hours) : null;

  const period = useMemo(() => {
    const days = chartLines.map((r) => (r.work_date || "").slice(0, 10)).filter(Boolean);
    return resolvePeriod(summary?.period_start, summary?.period_end, days);
  }, [summary?.period_start, summary?.period_end, chartLines]);

  const buckets = useMemo(() => {
    if (!period) return [] as TimeBucket[];
    return buildTimeBuckets(period.start, period.end, grain, customDays);
  }, [period, grain, customDays]);

  const completionPoints = useMemo(() => {
    if (!period || !buckets.length) return [] as ChartPoint[];
    return buildCompletionPoints(
      chartLines,
      buckets,
      grain,
      customDays,
      period.start,
      plan,
    );
  }, [chartLines, buckets, grain, customDays, period, plan]);

  const unitTimePoints = useMemo(() => {
    if (!period || !buckets.length) return [] as ChartPoint[];
    return buildEfficiencyPoints(
      chartLines,
      buckets,
      grain,
      customDays,
      period.start,
      "unit_time",
    );
  }, [chartLines, buckets, grain, customDays, period]);

  const hourlyPoints = useMemo(() => {
    if (!period || !buckets.length) return [] as ChartPoint[];
    return buildEfficiencyPoints(
      chartLines,
      buckets,
      grain,
      customDays,
      period.start,
      "hourly",
    );
  }, [chartLines, buckets, grain, customDays, period]);

  const periodText = period ? `${period.start} ~ ${period.end}` : "全量周期";
  const grainText =
    grain === "day"
      ? "按日"
      : grain === "week"
        ? "按周"
        : grain === "month"
          ? "按月"
          : `每 ${customDays} 天`;

  const tab1Label =
    completionPct != null
      ? `完成率 ${completionPct}% · ${tot.qty}/${plan ?? "—"}`
      : `实际产量 ${tot.qty}${plan != null ? `/${plan}` : ""}`;
  const tab2Label =
    unitTime != null
      ? `单位耗时 ${unitTime} 小时/件（${tot.hours}÷${tot.qty}）`
      : "单位生产耗时";
  const tab3Label =
    hourly != null
      ? `小时产量 ${hourly} 件/小时（${tot.qty}÷${tot.hours}）`
      : "小时产量";

  return (
    <Card size="small" styles={{ body: { paddingTop: 8 } }}>
      <BasicMetricsIntro summary={summary} lines={chartLines} />
      <GrainToolbar
        grain={grain}
        customDays={customDays}
        onGrain={setGrain}
        onCustomDays={setCustomDays}
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as StatsTab)}
        items={[
          {
            key: "completion",
            label: tab1Label,
            children: (
              <>
                <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                  累计完成率走势（实际÷计划
                  {plan != null ? `，计划 ${plan}` : "；暂无计划量时纵轴为累计产量"}
                  ）· {grainText} · {periodText}
                  {!filters.status ? " · 默认已确认产量" : ""}
                </Typography.Text>
                {completionPoints.length ? (
                  <LineChart data={completionPoints} height={260} loading={loading} />
                ) : (
                  <Typography.Text type="secondary">暂无数据</Typography.Text>
                )}
              </>
            ),
          },
          {
            key: "unit_time",
            label: tab2Label,
            children: (
              <>
                <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                  单位生产耗时 = 生产工时 ÷ 产量
                  {unitTime != null
                    ? `：${unitTime} 小时/件（${tot.hours}÷${tot.qty}）`
                    : "（小时/件）"}
                  · {grainText} · {periodText}。无产量时段为 0。
                </Typography.Text>
                {unitTimePoints.length ? (
                  <LineChart data={unitTimePoints} height={260} loading={loading} />
                ) : (
                  <Typography.Text type="secondary">暂无数据</Typography.Text>
                )}
              </>
            ),
          },
          {
            key: "hourly",
            label: tab3Label,
            children: (
              <>
                <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                  小时产量 = 产量 ÷ 生产工时
                  {hourly != null
                    ? `：${hourly} 件/小时（${tot.qty}÷${tot.hours}）`
                    : "（件/小时）"}
                  · {grainText} · {periodText}。无工时段为 0。
                </Typography.Text>
                {hourlyPoints.length ? (
                  <LineChart data={hourlyPoints} height={260} loading={loading} />
                ) : (
                  <Typography.Text type="secondary">暂无数据</Typography.Text>
                )}
              </>
            ),
          },
        ]}
      />
    </Card>
  );
}

type PersonEffRow = {
  key: string;
  rank: number;
  person_name: string;
  qty: number;
  hours: number;
  unit_time: number | null;
  hourly: number | null;
  wo_count: number;
  process_count: number;
  vs_avg_pct: number | null;
  avg_qty: number | null;
  avg_hours: number | null;
  avg_unit_time: number | null;
  avg_hourly: number | null;
};

type TeamEffRow = {
  key: string;
  rank: number;
  team_name: string;
  qty: number;
  hours: number;
  person_count: number;
  per_capita: number | null;
  unit_time: number | null;
  hourly: number | null;
  wo_count: number;
  vs_avg_pct: number | null;
  avg_qty: number | null;
  avg_hours: number | null;
  avg_per_capita: number | null;
  avg_unit_time: number | null;
  avg_hourly: number | null;
};

type EquipmentEffRow = {
  key: string;
  rank: number;
  equipment_name: string;
  qty: number;
  hours: number;
  person_count: number;
  unit_time: number | null;
  hourly: number | null;
  wo_count: number;
  report_count: number;
  vs_avg_pct: number | null;
  avg_qty: number | null;
  avg_hours: number | null;
  avg_unit_time: number | null;
  avg_hourly: number | null;
};

type EffYMetric = "hourly" | "unit_time" | "achieve";

type ProcessEffRow = {
  key: string;
  rank: number;
  process_name: string;
  qty: number;
  hours: number;
  /** 小时/件 */
  unit_time: number | null;
  /** 分钟/件（与标准同口径） */
  unit_minutes: number | null;
  /** 件/小时 */
  hourly: number | null;
  /** 标准分钟/件（工艺主数据） */
  std_minutes: number | null;
  /** 达成率 % = 标准 ÷ 实际单位耗时 */
  achieve_pct: number | null;
  person_count: number;
  wo_count: number;
  report_count: number;
  /** 等待/异常尚未采集 */
  wait_hours: null;
  exception_hours: null;
  is_bottleneck: boolean;
};

function buildProcessEffRows(
  lines: ShopFloorProgressDetailLine[],
  stdByName: Record<string, number>,
): ProcessEffRow[] {
  type Acc = {
    qty: number;
    hours: number;
    persons: Set<string>;
    wos: Set<string>;
    count: number;
  };
  const byProc = new Map<string, Acc>();
  for (const row of lines) {
    const name = (row.process_name || "未命名工序").trim() || "未命名工序";
    let acc = byProc.get(name);
    if (!acc) {
      acc = { qty: 0, hours: 0, persons: new Set(), wos: new Set(), count: 0 };
      byProc.set(name, acc);
    }
    acc.qty += Number(row.qty || 0);
    acc.hours += lineHours(row);
    acc.count += 1;
    const pn = (row.person_name || row.person_id || "").trim();
    if (pn) acc.persons.add(pn);
    const wid = (row.work_order_id || row.work_order_label || "").trim();
    if (wid) acc.wos.add(wid);
  }

  const raw = [...byProc.entries()].map(([process_name, acc]) => {
    const qty = round3(acc.qty);
    const hours = round3(acc.hours);
    const unit_time = qty > 0 ? round3(hours / qty) : null;
    const unit_minutes = unit_time != null ? round3(unit_time * 60) : null;
    const hourly = hours > 0 ? round3(qty / hours) : null;
    const std_minutes =
      stdByName[process_name] != null && stdByName[process_name] > 0
        ? round3(stdByName[process_name])
        : null;
    const achieve_pct =
      std_minutes != null && unit_minutes != null && unit_minutes > 0
        ? round3((std_minutes / unit_minutes) * 100)
        : null;
    return {
      key: process_name,
      process_name,
      qty,
      hours,
      unit_time,
      unit_minutes,
      hourly,
      std_minutes,
      achieve_pct,
      person_count: acc.persons.size,
      wo_count: acc.wos.size,
      report_count: acc.count,
      wait_hours: null as null,
      exception_hours: null as null,
      is_bottleneck: false,
      rank: 0,
    };
  });

  // 有达成率的按达成率升序（低的是改善重点）；无标准的排后按小时产量降序
  raw.sort((a, b) => {
    const aa = a.achieve_pct;
    const bb = b.achieve_pct;
    if (aa != null && bb != null) return aa - bb;
    if (aa != null) return -1;
    if (bb != null) return 1;
    return (b.hourly || 0) - (a.hourly || 0);
  });

  const withRate = raw.filter((r) => r.achieve_pct != null);
  if (withRate.length) {
    const worst = withRate[0]?.process_name;
    for (const r of raw) {
      if (r.process_name === worst && (r.achieve_pct ?? 100) < 100) {
        r.is_bottleneck = true;
      }
    }
  }

  return raw.map((r, i) => ({ ...r, rank: i + 1 }));
}

function buildPersonEffRows(
  processLines: ShopFloorProgressDetailLine[],
  allConfirmed: ShopFloorProgressDetailLine[],
): PersonEffRow[] {
  type Acc = {
    qty: number;
    hours: number;
    wos: Set<string>;
  };
  const byPerson = new Map<string, Acc>();
  for (const row of processLines) {
    const name = (row.person_name || row.person_id || "未知").trim() || "未知";
    let acc = byPerson.get(name);
    if (!acc) {
      acc = { qty: 0, hours: 0, wos: new Set() };
      byPerson.set(name, acc);
    }
    acc.qty += Number(row.qty || 0);
    acc.hours += lineHours(row);
    const wid = (row.work_order_id || row.work_order_label || "").trim();
    if (wid) acc.wos.add(wid);
  }

  const processCountByPerson = new Map<string, Set<string>>();
  for (const row of allConfirmed) {
    const name = (row.person_name || row.person_id || "未知").trim() || "未知";
    if (!byPerson.has(name)) continue;
    const proc = (row.process_name || "未命名工序").trim();
    let set = processCountByPerson.get(name);
    if (!set) {
      set = new Set();
      processCountByPerson.set(name, set);
    }
    set.add(proc);
  }

  const raw = [...byPerson.entries()].map(([person_name, acc]) => {
    const qty = round3(acc.qty);
    const hours = round3(acc.hours);
    return {
      person_name,
      qty,
      hours,
      unit_time: qty > 0 ? round3(hours / qty) : null,
      hourly: hours > 0 ? round3(qty / hours) : null,
      wo_count: acc.wos.size,
      process_count: processCountByPerson.get(person_name)?.size || 1,
    };
  });

  const n = raw.length || 1;
  const avgQty = raw.length ? round3(raw.reduce((s, r) => s + r.qty, 0) / n) : null;
  const avgHours = raw.length ? round3(raw.reduce((s, r) => s + r.hours, 0) / n) : null;
  const withUnit = raw.filter((r) => r.unit_time != null);
  const avgUnit =
    withUnit.length > 0
      ? round3(withUnit.reduce((s, r) => s + (r.unit_time as number), 0) / withUnit.length)
      : null;
  const withHourly = raw.filter((r) => r.hourly != null && (r.hourly as number) > 0);
  const avgHourly =
    withHourly.length > 0
      ? round3(withHourly.reduce((s, r) => s + (r.hourly as number), 0) / withHourly.length)
      : null;

  const sorted = [...raw].sort((a, b) => {
    const ha = a.hourly ?? -1;
    const hb = b.hourly ?? -1;
    if (hb !== ha) return hb - ha;
    return b.qty - a.qty;
  });

  return sorted.map((r, i) => ({
    key: r.person_name,
    rank: i + 1,
    ...r,
    avg_qty: avgQty,
    avg_hours: avgHours,
    avg_unit_time: avgUnit,
    avg_hourly: avgHourly,
    vs_avg_pct:
      avgHourly != null && r.hourly != null && avgHourly > 0
        ? round3(((r.hourly - avgHourly) / avgHourly) * 100)
        : null,
  }));
}

function buildTeamEffRows(processLines: ShopFloorProgressDetailLine[]): TeamEffRow[] {
  type Acc = {
    qty: number;
    hours: number;
    persons: Set<string>;
    wos: Set<string>;
  };
  const byTeam = new Map<string, Acc>();
  for (const row of processLines) {
    const team = (row.shift_name || "未排班").trim() || "未排班";
    let acc = byTeam.get(team);
    if (!acc) {
      acc = { qty: 0, hours: 0, persons: new Set(), wos: new Set() };
      byTeam.set(team, acc);
    }
    acc.qty += Number(row.qty || 0);
    acc.hours += lineHours(row);
    const who = (row.person_name || row.person_id || "").trim();
    if (who) acc.persons.add(who);
    const wid = (row.work_order_id || row.work_order_label || "").trim();
    if (wid) acc.wos.add(wid);
  }

  const raw = [...byTeam.entries()].map(([team_name, acc]) => {
    const qty = round3(acc.qty);
    const hours = round3(acc.hours);
    const person_count = acc.persons.size || 0;
    return {
      team_name,
      qty,
      hours,
      person_count,
      per_capita: person_count > 0 ? round3(qty / person_count) : null,
      unit_time: qty > 0 ? round3(hours / qty) : null,
      hourly: hours > 0 ? round3(qty / hours) : null,
      wo_count: acc.wos.size,
    };
  });

  const n = raw.length || 1;
  const avgQty = raw.length ? round3(raw.reduce((s, r) => s + r.qty, 0) / n) : null;
  const avgHours = raw.length ? round3(raw.reduce((s, r) => s + r.hours, 0) / n) : null;
  const withPc = raw.filter((r) => r.per_capita != null);
  const avgPc =
    withPc.length > 0
      ? round3(withPc.reduce((s, r) => s + (r.per_capita as number), 0) / withPc.length)
      : null;
  const withUnit = raw.filter((r) => r.unit_time != null);
  const avgUnit =
    withUnit.length > 0
      ? round3(withUnit.reduce((s, r) => s + (r.unit_time as number), 0) / withUnit.length)
      : null;
  const withHourly = raw.filter((r) => r.hourly != null && (r.hourly as number) > 0);
  const avgHourly =
    withHourly.length > 0
      ? round3(withHourly.reduce((s, r) => s + (r.hourly as number), 0) / withHourly.length)
      : null;

  const sorted = [...raw].sort((a, b) => {
    const ha = a.hourly ?? -1;
    const hb = b.hourly ?? -1;
    if (hb !== ha) return hb - ha;
    return b.qty - a.qty;
  });

  return sorted.map((r, i) => ({
    key: r.team_name,
    rank: i + 1,
    ...r,
    avg_qty: avgQty,
    avg_hours: avgHours,
    avg_per_capita: avgPc,
    avg_unit_time: avgUnit,
    avg_hourly: avgHourly,
    vs_avg_pct:
      avgHourly != null && r.hourly != null && avgHourly > 0
        ? round3(((r.hourly - avgHourly) / avgHourly) * 100)
        : null,
  }));
}

function buildEquipmentEffRows(processLines: ShopFloorProgressDetailLine[]): EquipmentEffRow[] {
  type Acc = {
    qty: number;
    hours: number;
    persons: Set<string>;
    wos: Set<string>;
    report_count: number;
  };
  const byEq = new Map<string, Acc>();
  for (const row of processLines) {
    const eq = (row.equipment_name || "未挂设备").trim() || "未挂设备";
    let acc = byEq.get(eq);
    if (!acc) {
      acc = { qty: 0, hours: 0, persons: new Set(), wos: new Set(), report_count: 0 };
      byEq.set(eq, acc);
    }
    acc.qty += Number(row.qty || 0);
    acc.hours += lineHours(row);
    acc.report_count += 1;
    const who = (row.person_name || row.person_id || "").trim();
    if (who) acc.persons.add(who);
    const wid = (row.work_order_id || row.work_order_label || "").trim();
    if (wid) acc.wos.add(wid);
  }

  const raw = [...byEq.entries()].map(([equipment_name, acc]) => {
    const qty = round3(acc.qty);
    const hours = round3(acc.hours);
    return {
      equipment_name,
      qty,
      hours,
      person_count: acc.persons.size,
      unit_time: qty > 0 ? round3(hours / qty) : null,
      hourly: hours > 0 ? round3(qty / hours) : null,
      wo_count: acc.wos.size,
      report_count: acc.report_count,
    };
  });

  const n = raw.length || 1;
  const avgQty = raw.length ? round3(raw.reduce((s, r) => s + r.qty, 0) / n) : null;
  const avgHours = raw.length ? round3(raw.reduce((s, r) => s + r.hours, 0) / n) : null;
  const withUnit = raw.filter((r) => r.unit_time != null);
  const avgUnit =
    withUnit.length > 0
      ? round3(withUnit.reduce((s, r) => s + (r.unit_time as number), 0) / withUnit.length)
      : null;
  const withHourly = raw.filter((r) => r.hourly != null && (r.hourly as number) > 0);
  const avgHourly =
    withHourly.length > 0
      ? round3(withHourly.reduce((s, r) => s + (r.hourly as number), 0) / withHourly.length)
      : null;

  const sorted = [...raw].sort((a, b) => {
    const ha = a.hourly ?? -1;
    const hb = b.hourly ?? -1;
    if (hb !== ha) return hb - ha;
    return b.qty - a.qty;
  });

  return sorted.map((r, i) => ({
    key: r.equipment_name,
    rank: i + 1,
    ...r,
    avg_qty: avgQty,
    avg_hours: avgHours,
    avg_unit_time: avgUnit,
    avg_hourly: avgHourly,
    vs_avg_pct:
      avgHourly != null && r.hourly != null && avgHourly > 0
        ? round3(((r.hourly - avgHourly) / avgHourly) * 100)
        : null,
  }));
}

function PersonCompareChart({
  rows,
  yMetric,
  loading,
}: {
  rows: PersonEffRow[];
  yMetric: EffYMetric;
  loading?: boolean;
}) {
  const option: EChartsOption = useMemo(() => {
    const names = rows.map((r) => r.person_name);
    const values = rows.map((r) =>
      yMetric === "hourly" ? r.hourly ?? 0 : r.unit_time ?? 0,
    );
    const yName = yMetric === "hourly" ? "小时产量（件/小时）" : "单位耗时（小时/件）";
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 56, right: 24, top: 36, bottom: names.length > 6 ? 64 : 40 },
      xAxis: {
        type: "category",
        data: names,
        axisLabel: { rotate: names.length > 5 ? 30 : 0, fontSize: 11 },
      },
      yAxis: { type: "value", name: yName, nameTextStyle: { fontSize: 11 } },
      series: [
        {
          type: "line",
          smooth: true,
          data: values,
          symbolSize: 8,
          label: { show: rows.length <= 12, formatter: "{c}", fontSize: 10 },
          areaStyle: { opacity: 0.08 },
        },
      ],
    };
  }, [rows, yMetric]);

  if (!rows.length) {
    return <Typography.Text type="secondary">暂无人效对比数据</Typography.Text>;
  }
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height: 280, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}

function PersonTrendChart({
  processLines,
  selected,
  yMetric,
  loading,
}: {
  processLines: ShopFloorProgressDetailLine[];
  selected: string[];
  yMetric: EffYMetric;
  loading?: boolean;
}) {
  const option: EChartsOption = useMemo(() => {
    const daySet = new Set<string>();
    for (const row of processLines) {
      const d = (row.work_date || "").slice(0, 10);
      if (d) daySet.add(d);
    }
    const days = [...daySet].sort();
    const labels = days.map((d) => d.slice(5));

    const series = selected.map((name) => {
      const byDay = new Map<string, QtyHours>();
      for (const row of processLines) {
        const pn = (row.person_name || row.person_id || "未知").trim() || "未知";
        if (pn !== name) continue;
        const d = (row.work_date || "").slice(0, 10);
        if (!d) continue;
        addQtyHours(byDay, d, Number(row.qty || 0), lineHours(row));
      }
      return {
        name,
        type: "line" as const,
        smooth: true,
        symbolSize: 6,
        data: days.map((d) => {
          const cell = byDay.get(d) || { qty: 0, hours: 0 };
          if (yMetric === "hourly") {
            return cell.hours > 0 ? round3(cell.qty / cell.hours) : null;
          }
          return cell.qty > 0 ? round3(cell.hours / cell.qty) : null;
        }),
      };
    });

    const yName = yMetric === "hourly" ? "小时产量" : "单位耗时";
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, type: "scroll" },
      grid: { left: 56, right: 24, top: 40, bottom: 40 },
      xAxis: { type: "category", data: labels },
      yAxis: { type: "value", name: yName, nameTextStyle: { fontSize: 11 } },
      series,
    };
  }, [processLines, selected, yMetric]);

  if (!selected.length) {
    return <Typography.Text type="secondary">请勾选人员查看每日效率趋势</Typography.Text>;
  }
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height: 280, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}

function PersonEfficiencyPanel({
  lines,
  loading,
}: {
  lines: ShopFloorProgressDetailLine[];
  loading?: boolean;
}) {
  const confirmed = useMemo(
    () => lines.filter((r) => r.status === "confirmed"),
    [lines],
  );
  const processOptions = useMemo(
    () => uniqOptions(confirmed, "process_name", "未命名工序"),
    [confirmed],
  );
  const [processName, setProcessName] = useState<string | undefined>();
  const [yMetric, setYMetric] = useState<EffYMetric>("hourly");
  const [trendPeople, setTrendPeople] = useState<string[]>([]);

  useEffect(() => {
    if (!processOptions.length) {
      setProcessName(undefined);
      return;
    }
    if (!processName || !processOptions.some((o) => o.value === processName)) {
      setProcessName(processOptions[0]?.value);
    }
  }, [processOptions, processName]);

  const processLines = useMemo(
    () =>
      processName
        ? confirmed.filter((r) => (r.process_name || "未命名工序") === processName)
        : [],
    [confirmed, processName],
  );

  const rows = useMemo(
    () => buildPersonEffRows(processLines, confirmed),
    [processLines, confirmed],
  );

  const personKey = rows.map((r) => r.person_name).join("|");
  useEffect(() => {
    // 工序或人员集合变化时，默认勾选效率 Top3 做趋势对比
    setTrendPeople(rows.slice(0, 3).map((r) => r.person_name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processName, personKey]);

  const personOptions = useMemo(
    () => rows.map((r) => ({ value: r.person_name, label: `${r.rank}. ${r.person_name}` })),
    [rows],
  );

  return (
    <div>
      <Space wrap style={{ marginBottom: 10 }} size={8}>
        <Typography.Text type="secondary">工序</Typography.Text>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="选择工序（必选，同工序对比）"
          style={{ width: 200 }}
          value={processName}
          onChange={setProcessName}
          options={processOptions}
        />
        <Typography.Text type="secondary">纵轴</Typography.Text>
        <Segmented
          size="small"
          value={yMetric}
          onChange={(v) => setYMetric(v as EffYMetric)}
          options={[
            { value: "hourly", label: "小时产量" },
            { value: "unit_time", label: "单位耗时" },
          ]}
        />
      </Space>

      <Typography.Paragraph type="secondary" style={{ marginBottom: 10, fontSize: 12 }}>
        同工序「{processName || "—"}」内对比：人员总产量、生产工时、小时产量（产量÷工时）、单位耗时（工时÷产量）、参与工单数、涉及工序数。
        排名默认按小时产量；与均值差异相对同工序平均小时产量。
      </Typography.Paragraph>

      <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
        1. 人员效率排名
      </Typography.Text>
      <Table<PersonEffRow>
        size="small"
        rowKey="key"
        loading={loading}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 1100 }}
        style={{ marginBottom: 16 }}
        columns={[
          { title: "排名", dataIndex: "rank", width: 64 },
          { title: "姓名", dataIndex: "person_name", width: 90 },
          {
            title: "工序产量",
            width: 110,
            render: (_: unknown, r) =>
              `${r.qty}${r.avg_qty != null ? ` /均${r.avg_qty}` : ""}`,
          },
          {
            title: "实际工时",
            width: 110,
            render: (_: unknown, r) =>
              `${r.hours}${r.avg_hours != null ? ` /均${r.avg_hours}` : ""}`,
          },
          {
            title: "单位耗时",
            width: 150,
            render: (_: unknown, r) =>
              r.unit_time != null
                ? `${r.unit_time}（${r.hours}÷${r.qty}）${r.avg_unit_time != null ? ` /均${r.avg_unit_time}` : ""}`
                : "—",
          },
          {
            title: "小时产量",
            width: 150,
            render: (_: unknown, r) =>
              r.hourly != null
                ? `${r.hourly}（${r.qty}÷${r.hours}）${r.avg_hourly != null ? ` /均${r.avg_hourly}` : ""}`
                : "—",
          },
          {
            title: "较均值",
            width: 80,
            render: (_: unknown, r) => {
              if (r.vs_avg_pct == null) return "—";
              const color = r.vs_avg_pct >= 0 ? "#16a34a" : "#dc2626";
              return (
                <span style={{ color }}>
                  {r.vs_avg_pct >= 0 ? "+" : ""}
                  {r.vs_avg_pct}%
                </span>
              );
            },
          },
          { title: "工单数", dataIndex: "wo_count", width: 72 },
          { title: "工序数", dataIndex: "process_count", width: 72 },
        ]}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="2. 人员效率对比（同工序）">
            <PersonCompareChart rows={rows} yMetric={yMetric} loading={loading} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title="3. 人员效率趋势（每日）"
            extra={
              <Select
                mode="multiple"
                allowClear
                placeholder="选人对比"
                style={{ minWidth: 180, maxWidth: 280 }}
                value={trendPeople}
                onChange={setTrendPeople}
                options={personOptions}
                maxTagCount={2}
              />
            }
          >
            <PersonTrendChart
              processLines={processLines}
              selected={trendPeople}
              yMetric={yMetric}
              loading={loading}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function TeamCompareChart({
  rows,
  loading,
}: {
  rows: TeamEffRow[];
  loading?: boolean;
}) {
  const option: EChartsOption = useMemo(() => {
    const names = rows.map((r) => r.team_name);
    const values = rows.map((r) => r.hourly ?? 0);
    return {
      tooltip: {
        trigger: "axis",
        formatter: (params) => {
          const list = Array.isArray(params) ? params : [params];
          const p = list[0] as { dataIndex?: number; name?: string; value?: number };
          const row = rows[p.dataIndex ?? 0];
          if (!row) return "";
          return `${row.team_name}<br/>小时产量：<b>${row.hourly ?? "—"}</b> 件/小时（${row.qty}÷${row.hours}）`;
        },
      },
      grid: { left: 56, right: 24, top: 36, bottom: 40 },
      xAxis: {
        type: "category",
        data: names,
        name: "班组",
        nameLocation: "middle",
        nameGap: 28,
      },
      yAxis: {
        type: "value",
        name: "件/工时",
        nameTextStyle: { fontSize: 11 },
      },
      series: [
        {
          type: "bar",
          data: values,
          barMaxWidth: 36,
          label: { show: true, position: "top", fontSize: 10 },
          itemStyle: { color: "#2563eb" },
        },
      ],
    };
  }, [rows]);

  if (!rows.length) {
    return <Typography.Text type="secondary">暂无班组对比数据</Typography.Text>;
  }
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height: 280, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}

function TeamTrendChart({
  processLines,
  selected,
  loading,
}: {
  processLines: ShopFloorProgressDetailLine[];
  selected: string[];
  loading?: boolean;
}) {
  const option: EChartsOption = useMemo(() => {
    const daySet = new Set<string>();
    for (const row of processLines) {
      const d = (row.work_date || "").slice(0, 10);
      if (d) daySet.add(d);
    }
    const days = [...daySet].sort();
    const labels = days.map((d) => d.slice(5));
    const series = selected.map((team) => {
      const byDay = new Map<string, QtyHours>();
      for (const row of processLines) {
        const tn = (row.shift_name || "未排班").trim() || "未排班";
        if (tn !== team) continue;
        const d = (row.work_date || "").slice(0, 10);
        if (!d) continue;
        addQtyHours(byDay, d, Number(row.qty || 0), lineHours(row));
      }
      return {
        name: team,
        type: "line" as const,
        smooth: true,
        symbolSize: 6,
        data: days.map((d) => {
          const cell = byDay.get(d) || { qty: 0, hours: 0 };
          return cell.hours > 0 ? round3(cell.qty / cell.hours) : null;
        }),
      };
    });
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, type: "scroll" },
      grid: { left: 56, right: 24, top: 40, bottom: 40 },
      xAxis: { type: "category", data: labels },
      yAxis: { type: "value", name: "件/工时", nameTextStyle: { fontSize: 11 } },
      series,
    };
  }, [processLines, selected]);

  if (!selected.length) {
    return <Typography.Text type="secondary">请勾选班组查看纵向趋势</Typography.Text>;
  }
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height: 280, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}

function TeamEfficiencyPanel({
  lines,
  loading,
}: {
  lines: ShopFloorProgressDetailLine[];
  loading?: boolean;
}) {
  const confirmed = useMemo(
    () => lines.filter((r) => r.status === "confirmed"),
    [lines],
  );
  const processOptions = useMemo(
    () => uniqOptions(confirmed, "process_name", "未命名工序"),
    [confirmed],
  );
  const [processName, setProcessName] = useState<string | undefined>();
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [trendTeams, setTrendTeams] = useState<string[]>([]);

  useEffect(() => {
    if (!processOptions.length) {
      setProcessName(undefined);
      return;
    }
    if (!processName || !processOptions.some((o) => o.value === processName)) {
      setProcessName(processOptions[0]?.value);
    }
  }, [processOptions, processName]);

  const scopedLines = useMemo(() => {
    let rows = confirmed;
    if (processName) {
      rows = rows.filter((r) => (r.process_name || "未命名工序") === processName);
    }
    if (dateRange?.[0] && dateRange?.[1]) {
      const from = dateRange[0].format("YYYY-MM-DD");
      const to = dateRange[1].format("YYYY-MM-DD");
      rows = rows.filter((r) => {
        const d = (r.work_date || "").slice(0, 10);
        return d && d >= from && d <= to;
      });
    }
    return rows;
  }, [confirmed, processName, dateRange]);

  const rows = useMemo(() => buildTeamEffRows(scopedLines), [scopedLines]);

  const teamKey = rows.map((r) => r.team_name).join("|");
  useEffect(() => {
    setTrendTeams(rows.map((r) => r.team_name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processName, dateRange?.[0]?.format("YYYY-MM-DD"), dateRange?.[1]?.format("YYYY-MM-DD"), teamKey]);

  const tot = useMemo(() => sumQtyHours(scopedLines), [scopedLines]);
  const personSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of scopedLines) {
      const who = (r.person_name || r.person_id || "").trim();
      if (who) s.add(who);
    }
    return s;
  }, [scopedLines]);
  const personN = personSet.size || 0;
  const perCapita = personN > 0 ? round3(tot.qty / personN) : null;
  const hourly = tot.hours > 0 ? round3(tot.qty / tot.hours) : null;
  const unitTime = tot.qty > 0 ? round3(tot.hours / tot.qty) : null;
  const avgRow = rows[0];

  const teamOptions = useMemo(
    () => rows.map((r) => ({ value: r.team_name, label: `${r.rank}. ${r.team_name}` })),
    [rows],
  );

  return (
    <div>
      <Space wrap style={{ marginBottom: 10 }} size={8}>
        <Typography.Text type="secondary">时间</Typography.Text>
        <DatePicker.RangePicker
          allowClear
          value={dateRange}
          onChange={(v) =>
            setDateRange(v && v[0] && v[1] ? [v[0], v[1]] : null)
          }
          style={{ width: 260 }}
        />
        <Typography.Text type="secondary">工序</Typography.Text>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="选择工序（必选）"
          style={{ width: 200 }}
          value={processName}
          onChange={setProcessName}
          options={processOptions}
        />
      </Space>

      <Space wrap size={[16, 6]} style={{ marginBottom: 12 }}>
        <Typography.Text>
          班组总产量 <Typography.Text strong>{tot.qty}</Typography.Text> 件
          {avgRow?.avg_qty != null ? (
            <Typography.Text type="secondary">（班均 {avgRow.avg_qty}）</Typography.Text>
          ) : null}
        </Typography.Text>
        <Typography.Text>
          人均产量{" "}
          <Typography.Text strong>{perCapita != null ? perCapita : "—"}</Typography.Text>{" "}
          件/人
          {personN ? `（${tot.qty}÷${personN}人）` : ""}
          {avgRow?.avg_per_capita != null ? (
            <Typography.Text type="secondary">（班均 {avgRow.avg_per_capita}）</Typography.Text>
          ) : null}
        </Typography.Text>
        <Typography.Text>
          小时产量{" "}
          <Typography.Text strong>{hourly != null ? hourly : "—"}</Typography.Text>{" "}
          件/小时
          {hourly != null ? `（${tot.qty}÷${tot.hours}）` : ""}
          {avgRow?.avg_hourly != null ? (
            <Typography.Text type="secondary">（班均 {avgRow.avg_hourly}）</Typography.Text>
          ) : null}
        </Typography.Text>
        <Typography.Text>
          单位耗时{" "}
          <Typography.Text strong>{unitTime != null ? unitTime : "—"}</Typography.Text>{" "}
          小时/件
          {unitTime != null ? `（${tot.hours}÷${tot.qty}）` : ""}
          {avgRow?.avg_unit_time != null ? (
            <Typography.Text type="secondary">（班均 {avgRow.avg_unit_time}）</Typography.Text>
          ) : null}
        </Typography.Text>
        <Typography.Text>
          生产工时 <Typography.Text strong>{tot.hours}</Typography.Text> 小时
        </Typography.Text>
      </Space>

      <Typography.Paragraph type="secondary" style={{ marginBottom: 10, fontSize: 12 }}>
        同工序「{processName || "—"}」内按班组（班次）聚合；当前以报工班次作为班组。均值=各班组指标算术平均。
      </Typography.Paragraph>

      <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
        1. 班组效率排名
      </Typography.Text>
      <Table<TeamEffRow>
        size="small"
        rowKey="key"
        loading={loading}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 1100 }}
        style={{ marginBottom: 16 }}
        columns={[
          { title: "排名", dataIndex: "rank", width: 64 },
          { title: "班组", dataIndex: "team_name", width: 90 },
          {
            title: "总产量",
            width: 110,
            render: (_: unknown, r) =>
              `${r.qty}${r.avg_qty != null ? ` /均${r.avg_qty}` : ""}`,
          },
          {
            title: "人数",
            dataIndex: "person_count",
            width: 64,
          },
          {
            title: "人均产量",
            width: 120,
            render: (_: unknown, r) =>
              r.per_capita != null
                ? `${r.per_capita}${r.avg_per_capita != null ? ` /均${r.avg_per_capita}` : ""}`
                : "—",
          },
          {
            title: "工时",
            width: 110,
            render: (_: unknown, r) =>
              `${r.hours}${r.avg_hours != null ? ` /均${r.avg_hours}` : ""}`,
          },
          {
            title: "单位耗时",
            width: 150,
            render: (_: unknown, r) =>
              r.unit_time != null
                ? `${r.unit_time}（${r.hours}÷${r.qty}）${r.avg_unit_time != null ? ` /均${r.avg_unit_time}` : ""}`
                : "—",
          },
          {
            title: "小时产量",
            width: 150,
            render: (_: unknown, r) =>
              r.hourly != null
                ? `${r.hourly}（${r.qty}÷${r.hours}）${r.avg_hourly != null ? ` /均${r.avg_hourly}` : ""}`
                : "—",
          },
          {
            title: "较均值",
            width: 80,
            render: (_: unknown, r) => {
              if (r.vs_avg_pct == null) return "—";
              const color = r.vs_avg_pct >= 0 ? "#16a34a" : "#dc2626";
              return (
                <span style={{ color }}>
                  {r.vs_avg_pct >= 0 ? "+" : ""}
                  {r.vs_avg_pct}%
                </span>
              );
            },
          },
          { title: "工单数", dataIndex: "wo_count", width: 72 },
        ]}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="2. 班组效率横向对比（件/工时）">
            <TeamCompareChart rows={rows} loading={loading} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title="3. 班组效率纵向趋势（件/工时）"
            extra={
              <Select
                mode="multiple"
                allowClear
                placeholder="图例选班"
                style={{ minWidth: 160, maxWidth: 260 }}
                value={trendTeams}
                onChange={setTrendTeams}
                options={teamOptions}
                maxTagCount={2}
              />
            }
          >
            <TeamTrendChart
              processLines={scopedLines}
              selected={trendTeams}
              loading={loading}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function EquipmentCompareChart({
  rows,
  loading,
}: {
  rows: EquipmentEffRow[];
  loading?: boolean;
}) {
  const option: EChartsOption = useMemo(() => {
    const names = rows.map((r) => r.equipment_name);
    const values = rows.map((r) => r.hourly ?? 0);
    return {
      tooltip: {
        trigger: "axis",
        formatter: (params) => {
          const list = Array.isArray(params) ? params : [params];
          const p = list[0] as { dataIndex?: number };
          const row = rows[p.dataIndex ?? 0];
          if (!row) return "";
          return `${row.equipment_name}<br/>小时产量：<b>${row.hourly ?? "—"}</b> 件/小时（${row.qty}÷${row.hours}）`;
        },
      },
      grid: { left: 56, right: 24, top: 36, bottom: names.length > 5 ? 56 : 40 },
      xAxis: {
        type: "category",
        data: names,
        name: "设备",
        nameLocation: "middle",
        nameGap: 28,
        axisLabel: { rotate: names.length > 4 ? 25 : 0, fontSize: 11 },
      },
      yAxis: {
        type: "value",
        name: "件/工时",
        nameTextStyle: { fontSize: 11 },
      },
      series: [
        {
          type: "bar",
          data: values,
          barMaxWidth: 36,
          label: { show: true, position: "top", fontSize: 10 },
          itemStyle: { color: "#0d9488" },
        },
      ],
    };
  }, [rows]);

  if (!rows.length) {
    return <Typography.Text type="secondary">暂无设备对比数据</Typography.Text>;
  }
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height: 280, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}

function EquipmentTrendChart({
  processLines,
  selected,
  loading,
}: {
  processLines: ShopFloorProgressDetailLine[];
  selected: string[];
  loading?: boolean;
}) {
  const option: EChartsOption = useMemo(() => {
    const daySet = new Set<string>();
    for (const row of processLines) {
      const d = (row.work_date || "").slice(0, 10);
      if (d) daySet.add(d);
    }
    const days = [...daySet].sort();
    const labels = days.map((d) => d.slice(5));
    const series = selected.map((eq) => {
      const byDay = new Map<string, QtyHours>();
      for (const row of processLines) {
        const name = (row.equipment_name || "未挂设备").trim() || "未挂设备";
        if (name !== eq) continue;
        const d = (row.work_date || "").slice(0, 10);
        if (!d) continue;
        addQtyHours(byDay, d, Number(row.qty || 0), lineHours(row));
      }
      return {
        name: eq,
        type: "line" as const,
        smooth: true,
        symbolSize: 6,
        data: days.map((d) => {
          const cell = byDay.get(d) || { qty: 0, hours: 0 };
          return cell.hours > 0 ? round3(cell.qty / cell.hours) : null;
        }),
      };
    });
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, type: "scroll" },
      grid: { left: 56, right: 24, top: 40, bottom: 40 },
      xAxis: { type: "category", data: labels },
      yAxis: { type: "value", name: "件/工时", nameTextStyle: { fontSize: 11 } },
      series,
    };
  }, [processLines, selected]);

  if (!selected.length) {
    return <Typography.Text type="secondary">请勾选设备查看纵向趋势</Typography.Text>;
  }
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height: 280, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}

function EquipmentEfficiencyPanel({
  lines,
  loading,
}: {
  lines: ShopFloorProgressDetailLine[];
  loading?: boolean;
}) {
  const confirmed = useMemo(
    () => lines.filter((r) => r.status === "confirmed"),
    [lines],
  );
  const processOptions = useMemo(
    () => uniqOptions(confirmed, "process_name", "未命名工序"),
    [confirmed],
  );
  const [processName, setProcessName] = useState<string | undefined>();
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [trendEqs, setTrendEqs] = useState<string[]>([]);

  useEffect(() => {
    if (!processOptions.length) {
      setProcessName(undefined);
      return;
    }
    if (!processName || !processOptions.some((o) => o.value === processName)) {
      setProcessName(processOptions[0]?.value);
    }
  }, [processOptions, processName]);

  const scopedLines = useMemo(() => {
    let rows = confirmed;
    if (processName) {
      rows = rows.filter((r) => (r.process_name || "未命名工序") === processName);
    }
    if (dateRange?.[0] && dateRange?.[1]) {
      const from = dateRange[0].format("YYYY-MM-DD");
      const to = dateRange[1].format("YYYY-MM-DD");
      rows = rows.filter((r) => {
        const d = (r.work_date || "").slice(0, 10);
        return d && d >= from && d <= to;
      });
    }
    return rows;
  }, [confirmed, processName, dateRange]);

  const rows = useMemo(() => buildEquipmentEffRows(scopedLines), [scopedLines]);

  const eqKey = rows.map((r) => r.equipment_name).join("|");
  useEffect(() => {
    setTrendEqs(rows.slice(0, 5).map((r) => r.equipment_name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processName, dateRange?.[0]?.format("YYYY-MM-DD"), dateRange?.[1]?.format("YYYY-MM-DD"), eqKey]);

  const tot = useMemo(() => sumQtyHours(scopedLines), [scopedLines]);
  const hourly = tot.hours > 0 ? round3(tot.qty / tot.hours) : null;
  const unitTime = tot.qty > 0 ? round3(tot.hours / tot.qty) : null;
  const avgRow = rows[0];
  const eqOptions = useMemo(
    () =>
      rows.map((r) => ({
        value: r.equipment_name,
        label: `${r.rank}. ${r.equipment_name}`,
      })),
    [rows],
  );

  return (
    <div>
      <Space wrap style={{ marginBottom: 10 }} size={8}>
        <Typography.Text type="secondary">时间</Typography.Text>
        <DatePicker.RangePicker
          allowClear
          value={dateRange}
          onChange={(v) =>
            setDateRange(v && v[0] && v[1] ? [v[0], v[1]] : null)
          }
          style={{ width: 260 }}
        />
        <Typography.Text type="secondary">工序</Typography.Text>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="选择工序（必选）"
          style={{ width: 200 }}
          value={processName}
          onChange={setProcessName}
          options={processOptions}
        />
      </Space>

      <Space wrap size={[16, 6]} style={{ marginBottom: 12 }}>
        <Typography.Text>
          设备总产量 <Typography.Text strong>{tot.qty}</Typography.Text> 件
          {avgRow?.avg_qty != null ? (
            <Typography.Text type="secondary">（台均 {avgRow.avg_qty}）</Typography.Text>
          ) : null}
        </Typography.Text>
        <Typography.Text>
          运行工时 <Typography.Text strong>{tot.hours}</Typography.Text> 小时
          {avgRow?.avg_hours != null ? (
            <Typography.Text type="secondary">（台均 {avgRow.avg_hours}）</Typography.Text>
          ) : null}
        </Typography.Text>
        <Typography.Text>
          小时产量{" "}
          <Typography.Text strong>{hourly != null ? hourly : "—"}</Typography.Text>{" "}
          件/小时
          {hourly != null ? `（${tot.qty}÷${tot.hours}）` : ""}
          {avgRow?.avg_hourly != null ? (
            <Typography.Text type="secondary">（台均 {avgRow.avg_hourly}）</Typography.Text>
          ) : null}
        </Typography.Text>
        <Typography.Text>
          单位耗时{" "}
          <Typography.Text strong>{unitTime != null ? unitTime : "—"}</Typography.Text>{" "}
          小时/件
          {unitTime != null ? `（${tot.hours}÷${tot.qty}）` : ""}
          {avgRow?.avg_unit_time != null ? (
            <Typography.Text type="secondary">（台均 {avgRow.avg_unit_time}）</Typography.Text>
          ) : null}
        </Typography.Text>
        <Typography.Text>
          设备数 <Typography.Text strong>{rows.length}</Typography.Text>
        </Typography.Text>
      </Space>

      <Typography.Paragraph type="secondary" style={{ marginBottom: 10, fontSize: 12 }}>
        同工序「{processName || "—"}」内按设备聚合；运行工时取报工工时/起止。
        利用率、停机原因需设备状态采集，当前不做。未挂设备单独成行。
      </Typography.Paragraph>

      <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
        1. 设备效率排名
      </Typography.Text>
      <Table<EquipmentEffRow>
        size="small"
        rowKey="key"
        loading={loading}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 1100 }}
        style={{ marginBottom: 16 }}
        columns={[
          { title: "排名", dataIndex: "rank", width: 64 },
          { title: "设备", dataIndex: "equipment_name", width: 120 },
          {
            title: "总产量",
            width: 110,
            render: (_: unknown, r) =>
              `${r.qty}${r.avg_qty != null ? ` /均${r.avg_qty}` : ""}`,
          },
          {
            title: "运行工时",
            width: 110,
            render: (_: unknown, r) =>
              `${r.hours}${r.avg_hours != null ? ` /均${r.avg_hours}` : ""}`,
          },
          {
            title: "单位耗时",
            width: 150,
            render: (_: unknown, r) =>
              r.unit_time != null
                ? `${r.unit_time}（${r.hours}÷${r.qty}）${r.avg_unit_time != null ? ` /均${r.avg_unit_time}` : ""}`
                : "—",
          },
          {
            title: "小时产量",
            width: 150,
            render: (_: unknown, r) =>
              r.hourly != null
                ? `${r.hourly}（${r.qty}÷${r.hours}）${r.avg_hourly != null ? ` /均${r.avg_hourly}` : ""}`
                : "—",
          },
          {
            title: "较均值",
            width: 80,
            render: (_: unknown, r) => {
              if (r.vs_avg_pct == null) return "—";
              const color = r.vs_avg_pct >= 0 ? "#16a34a" : "#dc2626";
              return (
                <span style={{ color }}>
                  {r.vs_avg_pct >= 0 ? "+" : ""}
                  {r.vs_avg_pct}%
                </span>
              );
            },
          },
          { title: "操作人数", dataIndex: "person_count", width: 80 },
          { title: "报工条数", dataIndex: "report_count", width: 80 },
          { title: "工单数", dataIndex: "wo_count", width: 72 },
        ]}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="2. 设备效率横向对比（件/工时）">
            <EquipmentCompareChart rows={rows} loading={loading} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title="3. 设备效率纵向趋势（件/工时）"
            extra={
              <Select
                mode="multiple"
                allowClear
                placeholder="图例选设备"
                style={{ minWidth: 160, maxWidth: 280 }}
                value={trendEqs}
                onChange={setTrendEqs}
                options={eqOptions}
                maxTagCount={2}
              />
            }
          >
            <EquipmentTrendChart
              processLines={scopedLines}
              selected={trendEqs}
              loading={loading}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function ProcessCompareChart({
  rows,
  yMetric,
  loading,
}: {
  rows: ProcessEffRow[];
  yMetric: EffYMetric;
  loading?: boolean;
}) {
  const option: EChartsOption = useMemo(() => {
    const names = rows.map((r) => r.process_name);
    const values = rows.map((r) => {
      if (yMetric === "achieve") return r.achieve_pct ?? 0;
      if (yMetric === "unit_time") return r.unit_minutes ?? 0;
      return r.hourly ?? 0;
    });
    const yName =
      yMetric === "achieve"
        ? "效率达成率（%）"
        : yMetric === "unit_time"
          ? "实际单位耗时（分钟/件）"
          : "小时产量（件/小时）";
    return {
      tooltip: {
        trigger: "axis",
        formatter: (params) => {
          const list = Array.isArray(params) ? params : [params];
          const p = list[0] as { dataIndex?: number };
          const row = rows[p.dataIndex ?? 0];
          if (!row) return "";
          const achieve =
            row.achieve_pct != null ? `${row.achieve_pct}%` : "无标准";
          return [
            `<b>${row.process_name}</b>${row.is_bottleneck ? "（改善重点）" : ""}`,
            `产量：${row.qty} · 工时：${row.hours}`,
            `标准：${row.std_minutes != null ? `${row.std_minutes} 分/件` : "—"}`,
            `实际：${row.unit_minutes != null ? `${row.unit_minutes} 分/件` : "—"}`,
            `达成率：${achieve}`,
            `小时产量：${row.hourly ?? "—"}`,
          ].join("<br/>");
        },
      },
      grid: { left: 56, right: 24, top: 36, bottom: 48 },
      xAxis: {
        type: "category",
        data: names,
        axisLabel: { interval: 0, rotate: names.length > 5 ? 30 : 0, fontSize: 11 },
      },
      yAxis: {
        type: "value",
        name: yName,
        nameTextStyle: { fontSize: 11 },
        ...(yMetric === "achieve"
          ? {
              axisLabel: { formatter: "{value}%" },
            }
          : {}),
      },
      series: [
        {
          type: "bar",
          data: values.map((v, i) => ({
            value: v,
            itemStyle: {
              color: rows[i]?.is_bottleneck
                ? "#dc2626"
                : yMetric === "achieve" && (rows[i]?.achieve_pct ?? 100) >= 100
                  ? "#16a34a"
                  : "#2563eb",
            },
          })),
          barMaxWidth: 36,
          markLine:
            yMetric === "achieve"
              ? {
                  symbol: "none",
                  data: [{ yAxis: 100, name: "100%" }],
                  lineStyle: { type: "dashed", color: "#94a3b8" },
                  label: { formatter: "100%" },
                }
              : undefined,
        },
      ],
    };
  }, [rows, yMetric]);

  if (!rows.length) {
    return <Typography.Text type="secondary">暂无已确认工序数据</Typography.Text>;
  }
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height: 280, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}

function ProcessTrendChart({
  lines,
  selected,
  yMetric,
  loading,
}: {
  lines: ShopFloorProgressDetailLine[];
  selected: string[];
  yMetric: EffYMetric;
  loading?: boolean;
}) {
  const option: EChartsOption = useMemo(() => {
    const days = [
      ...new Set(
        lines
          .map((r) => (r.work_date || "").slice(0, 10))
          .filter(Boolean)
          .sort(),
      ),
    ];
    const labels = days;
    const series = selected.map((proc) => {
      const scoped = lines.filter((r) => (r.process_name || "未命名工序") === proc);
      const byDay = new Map<string, QtyHours>();
      for (const row of scoped) {
        const d = (row.work_date || "").slice(0, 10);
        if (!d) continue;
        addQtyHours(byDay, d, Number(row.qty || 0), lineHours(row));
      }
      return {
        name: proc,
        type: "line" as const,
        smooth: true,
        data: days.map((d) => {
          const cell = byDay.get(d) || { qty: 0, hours: 0 };
          if (yMetric === "unit_time") {
            return cell.qty > 0 ? round3((cell.hours * 60) / cell.qty) : null;
          }
          if (yMetric === "achieve") {
            return null;
          }
          return cell.hours > 0 ? round3(cell.qty / cell.hours) : null;
        }),
      };
    });
    const yName =
      yMetric === "unit_time" ? "单位耗时（分钟/件）" : "小时产量（件/小时）";
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, type: "scroll" },
      grid: { left: 56, right: 24, top: 40, bottom: 40 },
      xAxis: { type: "category", data: labels },
      yAxis: { type: "value", name: yName, nameTextStyle: { fontSize: 11 } },
      series,
    };
  }, [lines, selected, yMetric]);

  if (yMetric === "achieve") {
    return (
      <Typography.Text type="secondary">
        达成率按区间汇总展示（见左图/表）；日趋势请切换「小时产量」或「单位耗时」。
      </Typography.Text>
    );
  }
  if (!selected.length) {
    return <Typography.Text type="secondary">请勾选工序查看每日趋势</Typography.Text>;
  }
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height: 280, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}

function ProcessEfficiencyPanel({
  lines,
  loading,
}: {
  lines: ShopFloorProgressDetailLine[];
  loading?: boolean;
}) {
  const confirmed = useMemo(
    () => lines.filter((r) => r.status === "confirmed"),
    [lines],
  );
  const { data: processCatalog, loading: catalogLoading } = useRequest(fetchProgressProcesses, {
    immediate: true,
  });
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [yMetric, setYMetric] = useState<EffYMetric>("achieve");
  const [trendProcs, setTrendProcs] = useState<string[]>([]);

  const stdByName = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of (processCatalog?.items ?? []) as ProgressProcessItem[]) {
      if ((p.status || "active") === "disabled") continue;
      const name = (p.name || "").trim();
      const mins = Number(p.unit_minutes || 0);
      if (name && mins > 0) map[name] = mins;
    }
    return map;
  }, [processCatalog?.items]);

  const scopedLines = useMemo(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) return confirmed;
    const from = dateRange[0].format("YYYY-MM-DD");
    const to = dateRange[1].format("YYYY-MM-DD");
    return confirmed.filter((r) => {
      const d = (r.work_date || "").slice(0, 10);
      return d && d >= from && d <= to;
    });
  }, [confirmed, dateRange]);

  const rows = useMemo(
    () => buildProcessEffRows(scopedLines, stdByName),
    [scopedLines, stdByName],
  );

  const procKey = rows.map((r) => r.process_name).join("|");
  useEffect(() => {
    setTrendProcs(rows.slice(0, 4).map((r) => r.process_name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange?.[0]?.format("YYYY-MM-DD"), dateRange?.[1]?.format("YYYY-MM-DD"), procKey]);

  const tot = useMemo(() => sumQtyHours(scopedLines), [scopedLines]);
  const withStd = rows.filter((r) => r.std_minutes != null).length;
  const bottleneck = rows.find((r) => r.is_bottleneck);

  const procOptions = useMemo(
    () =>
      rows.map((r) => ({
        value: r.process_name,
        label: `${r.rank}. ${r.process_name}`,
      })),
    [rows],
  );

  return (
    <div>
      <Space wrap style={{ marginBottom: 10 }} size={8}>
        <Typography.Text type="secondary">时间</Typography.Text>
        <DatePicker.RangePicker
          allowClear
          value={dateRange}
          onChange={(v) => {
            if (v?.[0] && v?.[1]) setDateRange([v[0], v[1]]);
            else setDateRange(null);
          }}
        />
        <Typography.Text type="secondary">对比指标</Typography.Text>
        <Segmented
          size="small"
          value={yMetric}
          onChange={(v) => setYMetric(v as EffYMetric)}
          options={[
            { value: "achieve", label: "效率达成率" },
            { value: "unit_time", label: "单位耗时" },
            { value: "hourly", label: "小时产量" },
          ]}
        />
      </Space>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 10 }}
        message={
          bottleneck
            ? `改善重点：${bottleneck.process_name}（达成率 ${bottleneck.achieve_pct}%：标准 ${bottleneck.std_minutes} 分/件 vs 实际 ${bottleneck.unit_minutes} 分/件）`
            : "达成率 = 标准单位耗时 ÷ 实际单位耗时。标准来自「基础信息 → 工序列表」的单位时间，未维护标准的工序不算达成率。"
        }
      />

      <Typography.Paragraph type="secondary" style={{ marginBottom: 10, fontSize: 12 }}>
        工序总产量 / 总耗时取已确认报工；单位耗时=工时÷产量；小时产量=产量÷工时；
        效率达成率=标准分钟/件 ÷ 实际分钟/件。等待时间、异常时间尚未采集，表中暂显「—」。
        已匹配标准 {withStd}/{rows.length} 道工序 · 合计产量 {tot.qty}、工时 {tot.hours}。
      </Typography.Paragraph>

      <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
        1. 工序效率一览（按达成率升序，低者为改善重点）
      </Typography.Text>
      <Table<ProcessEffRow>
        size="small"
        rowKey="key"
        loading={loading || catalogLoading}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 1280 }}
        style={{ marginBottom: 16 }}
        rowClassName={(r) => (r.is_bottleneck ? "ant-table-row-selected" : "")}
        columns={[
          { title: "序", dataIndex: "rank", width: 48 },
          {
            title: "工序",
            width: 110,
            render: (_: unknown, r) => (
              <Space size={4}>
                <span>{r.process_name}</span>
                {r.is_bottleneck ? <Tag color="red">重点</Tag> : null}
              </Space>
            ),
          },
          { title: "总产量", dataIndex: "qty", width: 80 },
          { title: "总耗时(h)", dataIndex: "hours", width: 90 },
          {
            title: "标准耗时",
            width: 110,
            render: (_: unknown, r) =>
              r.std_minutes != null ? `${r.std_minutes} 分/件` : "未维护",
          },
          {
            title: "实际单位耗时",
            width: 120,
            render: (_: unknown, r) =>
              r.unit_minutes != null ? `${r.unit_minutes} 分/件` : "—",
          },
          {
            title: "效率达成率",
            width: 110,
            render: (_: unknown, r) => {
              if (r.achieve_pct == null) return "—";
              const color = r.achieve_pct >= 100 ? "#16a34a" : "#dc2626";
              return <span style={{ color, fontWeight: 600 }}>{r.achieve_pct}%</span>;
            },
          },
          {
            title: "小时产量",
            width: 90,
            render: (_: unknown, r) => (r.hourly != null ? r.hourly : "—"),
          },
          {
            title: "等待时间",
            width: 88,
            render: () => <Typography.Text type="secondary">—</Typography.Text>,
          },
          {
            title: "异常时间",
            width: 88,
            render: () => <Typography.Text type="secondary">—</Typography.Text>,
          },
          { title: "人数", dataIndex: "person_count", width: 64 },
          { title: "报工条", dataIndex: "report_count", width: 72 },
        ]}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="2. 工序效率对比">
            <ProcessCompareChart rows={rows} yMetric={yMetric} loading={loading} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title="3. 工序效率趋势（每日）"
            extra={
              <Select
                mode="multiple"
                allowClear
                placeholder="选工序"
                style={{ minWidth: 160, maxWidth: 280 }}
                value={trendProcs}
                onChange={setTrendProcs}
                options={procOptions}
                maxTagCount={2}
              />
            }
          >
            <ProcessTrendChart
              lines={scopedLines}
              selected={trendProcs}
              yMetric={yMetric === "achieve" ? "unit_time" : yMetric}
              loading={loading}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function EfficiencyLayerTabs({
  lines,
  loading,
}: {
  lines: ShopFloorProgressDetailLine[];
  loading?: boolean;
}) {
  return (
    <Card size="small" title="效率分析" style={{ marginBottom: 12 }}>
      <Tabs
        items={[
          {
            key: "person",
            label: "人员效率分析",
            children: <PersonEfficiencyPanel lines={lines} loading={loading} />,
          },
          {
            key: "team",
            label: "班组效率分析",
            children: <TeamEfficiencyPanel lines={lines} loading={loading} />,
          },
          {
            key: "equipment",
            label: "设备效率分析",
            children: <EquipmentEfficiencyPanel lines={lines} loading={loading} />,
          },
          {
            key: "process",
            label: "工序效率分析",
            children: <ProcessEfficiencyPanel lines={lines} loading={loading} />,
          },
        ]}
      />
    </Card>
  );
}

function DetailDrawer({
  target,
  onClose,
}: {
  target: FocusTarget | null;
  onClose: () => void;
}) {
  const [filters, setFilters] = useState<LineFilters>(EMPTY_FILTERS);
  const open = Boolean(target);
  const { data, loading } = useRequest(
    () =>
      target
        ? fetchShopFloorProgressDetail({
            scope: target.scope,
            id: target.id,
          })
        : Promise.resolve(null as ShopFloorProgressDetailResponse | null),
    {
      immediate: open,
      deps: [open, target?.scope, target?.id],
    },
  );

  useEffect(() => {
    setFilters(EMPTY_FILTERS);
  }, [target?.scope, target?.id]);

  const summary = data?.summary;
  const allLines = data?.lines ?? [];

  const shiftOptions = useMemo(() => uniqOptions(allLines, "shift_name", "未排班"), [allLines]);
  const equipmentOptions = useMemo(
    () => uniqOptions(allLines, "equipment_name", "未挂设备"),
    [allLines],
  );
  const personOptions = useMemo(() => uniqOptions(allLines, "person_name", "未知"), [allLines]);
  const processOptions = useMemo(() => uniqOptions(allLines, "process_name", "未命名工序"), [allLines]);

  const matchDimFilters = (row: ShopFloorProgressDetailLine) => {
    if (filters.shift && (row.shift_name || "未排班") !== filters.shift) return false;
    if (filters.equipment && (row.equipment_name || "未挂设备") !== filters.equipment) {
      return false;
    }
    if (filters.person && (row.person_name || "未知") !== filters.person) return false;
    if (filters.process && (row.process_name || "未命名工序") !== filters.process) {
      return false;
    }
    if (filters.status && row.status !== filters.status) return false;
    return true;
  };

  /** 图表用：保留全量周期，不受日期框压缩 */
  const chartSourceLines = useMemo(
    () => allLines.filter(matchDimFilters),
    [allLines, filters.shift, filters.equipment, filters.person, filters.process, filters.status],
  );

  const filteredLines = useMemo(() => {
    const [d0, d1] = filters.dateRange || [null, null];
    const from = d0 ? d0.format("YYYY-MM-DD") : null;
    const to = d1 ? d1.format("YYYY-MM-DD") : null;
    return chartSourceLines.filter((row) => {
      const day = (row.work_date || "").slice(0, 10);
      if (from && (!day || day < from)) return false;
      if (to && (!day || day > to)) return false;
      return true;
    });
  }, [chartSourceLines, filters.dateRange]);

  const filterActive = Boolean(
    filters.dateRange ||
      filters.shift ||
      filters.equipment ||
      filters.person ||
      filters.process ||
      filters.status,
  );

  const kpiItems = useMemo(() => {
    if (!summary) return [];
    const confirmedLines = chartSourceLines.filter((r) => r.status === "confirmed");
    const tot = sumQtyHours(confirmedLines);
    const plan = summary.plan_qty;
    const completion =
      plan != null && plan > 0
        ? `${round3(Math.min(100, (tot.qty / plan) * 100))}%`
        : "无计划";
    const unitTime = tot.qty > 0 ? round3(tot.hours / tot.qty) : null;
    const hourly = tot.hours > 0 ? round3(tot.qty / tot.hours) : null;
    const cycle = cycleDays(summary.period_start, summary.period_end);
    return [
      {
        title: "完成率",
        value: completion,
        ratio:
          plan != null
            ? `实际 ${tot.qty} / 计划 ${plan}`
            : `实际 ${tot.qty}`,
      },
      {
        title: "生产工时",
        value: tot.hours,
        ratio: "报工投入 · 不含等待",
      },
      {
        title: "单位耗时",
        value: unitTime != null ? unitTime : "—",
        ratio:
          unitTime != null
            ? `${tot.hours}÷${tot.qty} 小时/件`
            : "小时/件",
      },
      {
        title: "小时产量",
        value: hourly != null ? hourly : "—",
        ratio:
          hourly != null ? `${tot.qty}÷${tot.hours} 件/小时` : "件/小时",
      },
      {
        title: "工单周期",
        value: cycle != null ? `${cycle}天` : "—",
        ratio:
          summary.period_start && summary.period_end
            ? `${summary.period_start}～${summary.period_end}`
            : "开工→结束",
      },
    ];
  }, [summary, chartSourceLines]);

  return (
    <Drawer
      title={summary?.title || target?.title || "进度详情"}
      open={open}
      onClose={onClose}
      width="92vw"
      styles={{
        body: { paddingTop: 12, display: "flex", flexDirection: "column", height: "100%" },
        wrapper: { maxWidth: 1400 },
      }}
      destroyOnHidden
    >
      {summary ? (
        <>
          <Space wrap style={{ marginBottom: 12 }}>
            <Typography.Text type="secondary">
              {summary.scope === "order"
                ? "订单"
                : summary.scope === "work_order"
                  ? "工单"
                  : "产品"}
              {summary.code ? ` ${summary.code}` : ""}
              {summary.product ? ` · ${summary.product}` : ""}
            </Typography.Text>
            {dueTag(summary.days_to_due, summary.due_date)}
            {summary.silent_hours != null && summary.silent_hours >= 8 ? (
              <Tag color="orange">静默 {summary.silent_hours}h</Tag>
            ) : null}
            {summary.current_process || summary.current_holder ? (
              <Typography.Text type="secondary">
                最近 {summary.current_process || "—"} / {summary.current_holder || "—"}
              </Typography.Text>
            ) : null}
            <Link to="/production-progress/daily">去每日报工</Link>
          </Space>

          {data?.note ? (
            <Alert type="info" showIcon style={{ marginBottom: 12 }} message={data.note} />
          ) : null}

          <KpiRow items={kpiItems} loading={loading} />

          {summary.processes?.length ? (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              工序累计（已确认）：
              {summary.processes.map((p) => `${p.process_name} ${p.qty}`).join(" · ")}
            </Typography.Paragraph>
          ) : null}

          {summary.work_orders?.length ? (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              下属工单：
              {summary.work_orders
                .map((w) => w.code || w.name)
                .filter(Boolean)
                .join("、")}
            </Typography.Paragraph>
          ) : null}

          <div style={{ marginBottom: 12 }}>
            <DetailStatsPanel
              lines={chartSourceLines}
              filters={filters}
              summary={summary}
              loading={loading}
            />
          </div>

          <EfficiencyLayerTabs lines={chartSourceLines} loading={loading} />

          <Space wrap style={{ marginBottom: 12 }} size={[8, 8]}>
            <DatePicker.RangePicker
              allowClear
              value={filters.dateRange}
              onChange={(v) =>
                setFilters((f) => ({
                  ...f,
                  dateRange: v && v[0] && v[1] ? [v[0], v[1]] : null,
                }))
              }
              style={{ width: 260 }}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="班次"
              style={{ width: 120 }}
              value={filters.shift}
              onChange={(v) => setFilters((f) => ({ ...f, shift: v }))}
              options={shiftOptions}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="设备"
              style={{ width: 140 }}
              value={filters.equipment}
              onChange={(v) => setFilters((f) => ({ ...f, equipment: v }))}
              options={equipmentOptions}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="人员"
              style={{ width: 120 }}
              value={filters.person}
              onChange={(v) => setFilters((f) => ({ ...f, person: v }))}
              options={personOptions}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="工序"
              style={{ width: 120 }}
              value={filters.process}
              onChange={(v) => setFilters((f) => ({ ...f, process: v }))}
              options={processOptions}
            />
            <Select
              allowClear
              placeholder="状态"
              style={{ width: 110 }}
              value={filters.status}
              onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
              options={[
                { value: "confirmed", label: "已确认" },
                { value: "pending", label: "待确认" },
                { value: "rejected", label: "已驳回" },
              ]}
            />
            {filterActive ? (
              <Button type="link" onClick={() => setFilters(EMPTY_FILTERS)}>
                清空筛选
              </Button>
            ) : null}
            <Typography.Text type="secondary">
              {filterActive
                ? `筛选后 ${filteredLines.length} / ${allLines.length} 条`
                : `共 ${allLines.length} 条明细`}
            </Typography.Text>
          </Space>

          <Table<ShopFloorProgressDetailLine>
            size="small"
            rowKey={(r) =>
              r.id || `${r.work_date}-${r.person_id}-${r.process_name}-${r.submitted_at}`
            }
            loading={loading}
            dataSource={filteredLines}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            scroll={{ x: 1100 }}
            style={{ width: "100%" }}
            columns={[
              { title: "日", dataIndex: "work_date", width: 100, fixed: "left" },
              { title: "班", dataIndex: "shift_name", width: 80 },
              { title: "设备", dataIndex: "equipment_name", width: 110 },
              { title: "人", dataIndex: "person_name", width: 90 },
              { title: "工序", dataIndex: "process_name", width: 100 },
              {
                title: "产量",
                dataIndex: "qty",
                width: 70,
                render: (v: number) => v ?? "—",
              },
              {
                title: "状态",
                width: 90,
                render: (_: unknown, row) => (
                  <Tag
                    color={
                      row.status === "confirmed"
                        ? "success"
                        : row.status === "rejected"
                          ? "error"
                          : "processing"
                    }
                  >
                    {row.status_label || row.status}
                  </Tag>
                ),
              },
              {
                title: "时段",
                width: 110,
                render: (_: unknown, row) =>
                  row.start_time || row.end_time
                    ? `${row.start_time || "—"}~${row.end_time || "—"}`
                    : "—",
              },
              {
                title: "提交",
                dataIndex: "submitted_at",
                width: 150,
                render: (v: string) => (v ? v.replace("T", " ").slice(0, 16) : "—"),
              },
              {
                title: "挂接",
                width: 140,
                render: (_: unknown, row) => row.work_order_label || row.product || "—",
              },
              {
                title: "备注",
                dataIndex: "note",
                ellipsis: true,
                render: (v: string, row) => v || row.review_note || "—",
              },
            ]}
          />
        </>
      ) : (
        <Typography.Text type="secondary">{loading ? "加载中…" : "暂无数据"}</Typography.Text>
      )}
    </Drawer>
  );
}

/**
 * 进度分析：多维汇总（订单 / 工单·产品）+ 详情抽屉。
 */
export default function ProgressAnalysisPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<"order" | "work_order">("order");
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const { data: progress, loading } = useRequest(fetchShopFloorProgress, { immediate: true });

  useEffect(() => {
    const scope = (searchParams.get("focus") || searchParams.get("scope") || "").trim();
    const id = (searchParams.get("id") || "").trim();
    if (!id) return;
    if (scope === "order" || scope === "work_order" || scope === "product") {
      setView(scope === "work_order" ? "work_order" : "order");
      setFocus({ scope, id });
    } else if (searchParams.get("focus") === "order" || (!scope && id)) {
      setView("order");
      setFocus({ scope: "order", id });
    }
  }, [searchParams]);

  const openOrder = (row: ShopFloorOrderProgressItem) => {
    const id = row.order_id || String(row.id || "").replace(/^order:/, "");
    if (!id) return;
    setFocus({
      scope: "order",
      id,
      title: `${row.order_code || ""} · ${row.product || row.order_name || ""}`.replace(/^ · | · $/g, ""),
    });
    setSearchParams({ focus: "order", id });
  };

  const openWorkOrderOrProduct = (row: ShopFloorProgressItem) => {
    if (row.link_type === "product") {
      const id = row.product || String(row.id || "").replace(/^product:/, "");
      if (!id) return;
      setFocus({ scope: "product", id, title: id });
      setSearchParams({ focus: "product", id });
      return;
    }
    const id = row.work_order_id || String(row.id || "").replace(/^wo:/, "");
    if (!id) return;
    setFocus({
      scope: "work_order",
      id,
      title: row.work_order_label || row.work_order_code || row.product || id,
    });
    setSearchParams({ focus: "work_order", id });
  };

  const closeFocus = () => {
    setFocus(null);
    const next = new URLSearchParams(searchParams);
    next.delete("focus");
    next.delete("scope");
    next.delete("id");
    setSearchParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="进度分析"
        subtitle="按订单或工单/产品看交期与累计；点行看详情（日–班–设备–人）。自由交叉下钻见「多维分析」（高级）。作业确认请到「每日报工」。"
      />

      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          value={view}
          style={{ width: 160 }}
          onChange={(v) => setView(v as "order" | "work_order")}
          options={[
            { value: "order", label: "按订单" },
            { value: "work_order", label: "按工单 / 产品" },
          ]}
        />
      </Space>

      {progress?.note ? (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={progress.note} />
      ) : null}

      {view === "order" && (progress?.unlinked_product_reports ?? 0) > 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`另有 ${progress?.unlinked_product_reports} 条已确认报工未挂到订单，请切换「按工单 / 产品」查看。`}
        />
      ) : null}

      {view === "order" ? (
        <DataTable<ShopFloorOrderProgressItem>
          rowKey="id"
          loading={loading}
          dataSource={progress?.orders ?? []}
          onRow={(row) => ({
            onClick: () => openOrder(row),
            style: { cursor: "pointer" },
          })}
          columns={[
            { title: "订单号", dataIndex: "order_code", width: 130 },
            { title: "名称", dataIndex: "order_name" },
            { title: "产品", dataIndex: "product", width: 120 },
            {
              title: "下属工单",
              width: 160,
              render: (_: unknown, row) =>
                row.work_order_codes?.length
                  ? row.work_order_codes.join("、")
                  : row.work_order_count
                    ? `${row.work_order_count} 个`
                    : "—",
            },
            {
              title: "交期",
              dataIndex: "due_date",
              width: 130,
              render: (v: string, row) => dueTag(row.days_to_due, v),
            },
            {
              title: "已确认产量",
              dataIndex: "total_confirmed_qty",
              width: 110,
              render: (v: number) => (v ? v : "—"),
            },
            {
              title: "工序累计",
              render: (_: unknown, row) =>
                row.processes?.length
                  ? row.processes.map((p) => `${p.process_name} ${p.qty}`).join(" · ")
                  : "暂无已确认报工",
            },
            {
              title: "最近工序 / 人",
              width: 160,
              render: (_: unknown, row) =>
                row.current_process || row.current_holder
                  ? `${row.current_process || "—"} / ${row.current_holder || "—"}`
                  : "—",
            },
            {
              title: "操作",
              width: 80,
              render: (_: unknown, row) => (
                <Typography.Link
                  onClick={(e) => {
                    e.stopPropagation();
                    openOrder(row);
                  }}
                >
                  详情
                </Typography.Link>
              ),
            },
          ]}
        />
      ) : (
        <DataTable<ShopFloorProgressItem>
          rowKey="id"
          loading={loading}
          dataSource={progress?.work_orders ?? progress?.items ?? []}
          onRow={(row) => ({
            onClick: () => openWorkOrderOrProduct(row),
            style: { cursor: "pointer" },
          })}
          columns={[
            {
              title: "挂接",
              width: 80,
              render: (_: unknown, row) => <Tag>{row.link_type_label || row.link_type}</Tag>,
            },
            {
              title: "工单 / 产品",
              render: (_: unknown, row) =>
                row.link_type === "product"
                  ? row.product || "—"
                  : row.work_order_label ||
                    [row.work_order_code, row.work_order_name].filter(Boolean).join(" · ") ||
                    row.product ||
                    "—",
            },
            {
              title: "产品",
              dataIndex: "product",
              width: 120,
              render: (v: string, row) => (row.link_type === "product" ? "—" : v || "—"),
            },
            {
              title: "交期",
              dataIndex: "due_date",
              width: 130,
              render: (v: string, row) => dueTag(row.days_to_due, v),
            },
            {
              title: "已确认产量",
              dataIndex: "total_confirmed_qty",
              width: 110,
              render: (v: number) => (v ? v : "—"),
            },
            {
              title: "工序累计",
              render: (_: unknown, row) =>
                row.processes?.length
                  ? row.processes.map((p) => `${p.process_name} ${p.qty}`).join(" · ")
                  : "暂无已确认报工",
            },
            {
              title: "最近工序 / 人",
              width: 160,
              render: (_: unknown, row) =>
                row.current_process || row.current_holder
                  ? `${row.current_process || "—"} / ${row.current_holder || "—"}`
                  : "—",
            },
            {
              title: "操作",
              width: 80,
              render: (_: unknown, row) => (
                <Typography.Link
                  onClick={(e) => {
                    e.stopPropagation();
                    openWorkOrderOrProduct(row);
                  }}
                >
                  详情
                </Typography.Link>
              ),
            },
          ]}
        />
      )}

      <DetailDrawer target={focus} onClose={closeFocus} />
    </div>
  );
}
