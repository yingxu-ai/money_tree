import { Button, DatePicker, Drawer, Select, Space, Table, Tag, Typography } from "antd";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { PieChart } from "@/charts";
import { KpiRow } from "@/components/blocks";
import type {
  GanttConflict,
  GanttOrderRow,
  OperationItem,
} from "@/modules/scheduling/api/scheduling";

function shortDate(iso?: string | null) {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function daysBetween(a?: string | null, b?: string | null) {
  if (!a || !b) return null;
  return dayjs(b.slice(0, 10)).diff(dayjs(a.slice(0, 10)), "day") + 1;
}

function orderRollupStatus(ops: OperationItem[]) {
  if (!ops.length) return "未排产";
  if (ops.every((o) => o.status === "done")) return "已完成";
  if (ops.some((o) => o.status === "exception")) return "异常";
  if (ops.some((o) => o.status === "running" || o.status === "paused")) return "进行中";
  return "未开始";
}

type DueBucket = "延期" | "按期" | "提前" | "未排满";

const OP_PALETTE = [
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
  "#4f46e5",
  "#c026d3",
  "#dc2626",
];

type OrderAgg = {
  key: string;
  row: GanttOrderRow;
  code: string;
  name: string;
  wo_name: string;
  source_type?: string;
  status: string;
  due: string;
  plan_start: string;
  plan_end: string;
  actual_end: string;
  plan_days: number;
  actual_days: number;
  plan_hours: number;
  actual_hours: number;
  progress: number;
  due_bucket: DueBucket;
  due_delta: number | null;
  staffing_gap: number;
  conflict_count: number;
  /** 工序 → 计划天 */
  op_plan: Record<string, number>;
  /** 工序 → 实绩天 */
  op_actual: Record<string, number>;
};

function buildOrderAgg(
  row: GanttOrderRow,
  today: string,
  conflictCount: number,
): OrderAgg {
  const ops = row.operations || [];
  let planDays = 0;
  let actualDays = 0;
  let planHours = 0;
  let actualHours = 0;
  let planStart = row.plan_start?.slice(0, 10) || "";
  let planEnd = row.estimated_end?.slice(0, 10) || "";
  let actualEnd = "";
  const op_plan: Record<string, number> = {};
  const op_actual: Record<string, number> = {};

  for (const o of ops) {
    const hpd = o.hours_per_day ?? 8;
    const ps = o.plan_start?.slice(0, 10);
    const pe = (o.plan_end || o.plan_start || "").slice(0, 10);
    const pd =
      o.segment_day_sum || o.duration_days || daysBetween(ps || null, pe || null) || 0;
    planDays += pd;
    planHours += o.planned_hours || pd * hpd;
    if (pd > 0) op_plan[o.name] = (op_plan[o.name] || 0) + pd;
    if (ps && (!planStart || ps < planStart)) planStart = ps;
    if (pe && (!planEnd || pe > planEnd)) planEnd = pe;

    const a0 = o.actual_start?.slice(0, 10);
    if (!a0) continue;
    const a1 =
      o.actual_end?.slice(0, 10) ||
      (o.status === "running" || o.status === "paused" ? today : a0);
    const ad = daysBetween(a0, a1) || 0;
    actualDays += ad;
    actualHours += ad * hpd;
    if (ad > 0) op_actual[o.name] = (op_actual[o.name] || 0) + ad;
    if (!actualEnd || a1 > actualEnd) actualEnd = a1;
  }

  const due = row.due_date?.slice(0, 10) || "";
  let due_bucket: DueBucket = "未排满";
  let due_delta: number | null = null;
  const refEnd = actualEnd || planEnd;
  if (due && refEnd) {
    due_delta = dayjs(refEnd).diff(dayjs(due), "day");
    if (due_delta > 0) due_bucket = "延期";
    else if (due_delta < 0) due_bucket = "提前";
    else due_bucket = "按期";
  }

  const progress =
    planHours > 0 ? Math.min(100, Math.round((actualHours / planHours) * 100)) : 0;
  const staffing_gap = ops.reduce((n, o) => n + (o.staffing_gap || 0), 0);

  return {
    key: row.order_id || row.order_code,
    row,
    code: row.order_code,
    name: row.order_name || row.product || "—",
    wo_name: row.work_order_name || row.work_order_code || "—",
    source_type: row.source_type,
    status: orderRollupStatus(ops),
    due,
    plan_start: planStart,
    plan_end: planEnd,
    actual_end: actualEnd,
    plan_days: planDays,
    actual_days: actualDays,
    plan_hours: Math.round(planHours * 10) / 10,
    actual_hours: Math.round(actualHours * 10) / 10,
    progress,
    due_bucket,
    due_delta,
    staffing_gap,
    conflict_count: conflictCount,
    op_plan,
    op_actual,
  };
}

/** 成对堆叠：每单两根柱（计划堆叠 / 实绩堆叠），同工序同色 */
function ProcessStackedPlanActualBar({
  categories,
  opNames,
  planByOp,
  actualByOp,
}: {
  categories: string[];
  opNames: string[];
  planByOp: Record<string, number[]>;
  actualByOp: Record<string, number[]>;
}) {
  const colorOf = (i: number) => OP_PALETTE[i % OP_PALETTE.length];
  const series: EChartsOption["series"] = [];
  // 先铺齐 plan 堆叠，再铺 actual，保证每单只出左右两根柱
  opNames.forEach((op, i) => {
    series!.push({
      name: op,
      type: "bar",
      stack: "plan",
      emphasis: { focus: "series" },
      data: planByOp[op] || categories.map(() => 0),
      barMaxWidth: 28,
      barGap: i === 0 ? "30%" : undefined,
      itemStyle: { color: colorOf(i) },
    });
  });
  opNames.forEach((op, i) => {
    series!.push({
      name: op,
      type: "bar",
      stack: "actual",
      emphasis: { focus: "series" },
      data: actualByOp[op] || categories.map(() => 0),
      barMaxWidth: 28,
      itemStyle: { color: colorOf(i), opacity: 0.55 },
    });
  });

  const option: EChartsOption = {
    legend: { type: "scroll", top: 0, data: opNames },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: unknown) => {
        const list = params as Array<{
          seriesName: string;
          seriesIndex: number;
          value: number;
          axisValue: string;
          color: string;
          dataIndex: number;
        }>;
        if (!list?.length) return "";
        const order = list[0].axisValue;
        const planParts: string[] = [];
        const actParts: string[] = [];
        let planSum = 0;
        let actSum = 0;
        const n = opNames.length;
        for (const p of list) {
          if (!p.value) continue;
          const isPlan = p.seriesIndex < n;
          const line = `${p.seriesName}: ${p.value}天`;
          if (isPlan) {
            planParts.push(line);
            planSum += p.value;
          } else {
            actParts.push(line);
            actSum += p.value;
          }
        }
        return [
          `<b>${order}</b>`,
          `计划合计 ${planSum}天`,
          ...planParts,
          `实绩合计 ${actSum}天`,
          ...actParts,
        ].join("<br/>");
      },
    },
    grid: { left: 48, right: 16, top: 40, bottom: 56 },
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: { interval: 0, rotate: categories.length > 5 ? 30 : 0, fontSize: 11 },
    },
    yAxis: { type: "value", name: "天", minInterval: 1 },
    series,
  };
  return (
    <div>
      <ReactECharts option={option} style={{ height: 300, width: "100%" }} notMerge lazyUpdate />
      <div style={{ fontSize: 12, color: "#718096", textAlign: "center" }}>
        每单左柱=计划（实色堆叠）、右柱=实绩（同色半透明）；图例为工序
      </div>
    </div>
  );
}

const TOP_N = 10;

export default function FleetStatsDrawer({
  open,
  planRows,
  conflicts,
  onClose,
  onOpenOrder,
}: {
  open: boolean;
  planRows: GanttOrderRow[];
  conflicts: GanttConflict[];
  onClose: () => void;
  onOpenOrder: (row: GanttOrderRow) => void;
}) {
  const today = dayjs().format("YYYY-MM-DD");
  const [sourceFilter, setSourceFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [dueFilter, setDueFilter] = useState<DueBucket | undefined>();
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);

  const conflictByCode = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of conflicts) {
      if (!c.order_code) continue;
      map.set(c.order_code, (map.get(c.order_code) || 0) + 1);
    }
    return map;
  }, [conflicts]);

  const allAggs = useMemo(
    () =>
      planRows.map((r) =>
        buildOrderAgg(r, today, conflictByCode.get(r.order_code) || 0),
      ),
    [planRows, today, conflictByCode],
  );

  const aggs = useMemo(() => {
    const rs = dateRange?.[0]?.format("YYYY-MM-DD");
    const re = dateRange?.[1]?.format("YYYY-MM-DD");
    return allAggs.filter((a) => {
      if (sourceFilter && a.source_type !== sourceFilter) return false;
      if (statusFilter && a.status !== statusFilter) return false;
      if (dueFilter && a.due_bucket !== dueFilter) return false;
      if (rs && re) {
        const ps = a.plan_start || "";
        const pe = a.plan_end || ps;
        if (!ps || pe < rs || ps > re) return false;
      }
      return true;
    });
  }, [allAggs, sourceFilter, statusFilter, dueFilter, dateRange]);

  const kpis = useMemo(() => {
    const total = aggs.length;
    const running = aggs.filter((a) => a.status === "进行中").length;
    const done = aggs.filter((a) => a.status === "已完成").length;
    const unscheduled = aggs.filter((a) => a.status === "未排产").length;
    const planH = aggs.reduce((n, a) => n + a.plan_hours, 0);
    const actH = aggs.reduce((n, a) => n + a.actual_hours, 0);
    const pct = planH > 0 ? Math.min(100, Math.round((actH / planH) * 100)) : 0;
    const delayed = aggs.filter((a) => a.due_bucket === "延期").length;
    const early = aggs.filter((a) => a.due_bucket === "提前").length;
    const ontime = aggs.filter((a) => a.due_bucket === "按期").length;
    const gap = aggs.reduce((n, a) => n + a.staffing_gap, 0);
    const conf = aggs.reduce((n, a) => n + a.conflict_count, 0);
    return {
      total,
      running,
      done,
      unscheduled,
      planH,
      actH,
      pct,
      delayed,
      early,
      ontime,
      gap,
      conf,
    };
  }, [aggs]);

  const stackedBar = useMemo(() => {
    const sorted = [...aggs].sort((a, b) => b.plan_days - a.plan_days);
    const top = sorted.slice(0, TOP_N);
    const rest = sorted.slice(TOP_N);
    const categories = top.map((a) => a.code);
    const opSet = new Set<string>();
    for (const a of top) {
      Object.keys(a.op_plan).forEach((k) => opSet.add(k));
      Object.keys(a.op_actual).forEach((k) => opSet.add(k));
    }
    if (rest.length) {
      categories.push(`其他(${rest.length})`);
      for (const a of rest) {
        Object.keys(a.op_plan).forEach((k) => opSet.add(k));
        Object.keys(a.op_actual).forEach((k) => opSet.add(k));
      }
    }
    const opNames = [...opSet];
    const planByOp: Record<string, number[]> = {};
    const actualByOp: Record<string, number[]> = {};
    for (const op of opNames) {
      planByOp[op] = top.map((a) => a.op_plan[op] || 0);
      actualByOp[op] = top.map((a) => a.op_actual[op] || 0);
      if (rest.length) {
        planByOp[op].push(rest.reduce((n, a) => n + (a.op_plan[op] || 0), 0));
        actualByOp[op].push(rest.reduce((n, a) => n + (a.op_actual[op] || 0), 0));
      }
    }
    return { categories, opNames, planByOp, actualByOp };
  }, [aggs]);

  const duePie = useMemo(() => {
    const buckets: DueBucket[] = ["延期", "按期", "提前", "未排满"];
    return buckets
      .map((b) => ({
        label: b,
        value: aggs.filter((a) => a.due_bucket === b).length,
      }))
      .filter((x) => x.value > 0);
  }, [aggs]);

  const riskRows = useMemo(() => {
    const score = (a: OrderAgg) => {
      let s = 0;
      if (a.due_bucket === "延期") s += 100 + (a.due_delta || 0);
      s += a.conflict_count * 10;
      s += a.staffing_gap * 5;
      if (a.status === "进行中" && a.progress < 50) s += 3;
      return s;
    };
    return [...aggs].sort((a, b) => score(b) - score(a));
  }, [aggs]);

  return (
    <Drawer title="汇总统计" open={open} onClose={onClose} width={860} destroyOnHidden>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Space wrap>
          <DatePicker.RangePicker
            allowClear
            value={dateRange}
            onChange={(v) =>
              setDateRange(v && v[0] && v[1] ? [v[0], v[1]] : null)
            }
            placeholder={["开始日期", "结束日期"]}
            style={{ width: 260 }}
          />
          <Select
            allowClear
            placeholder="来源"
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
            placeholder="状态"
            style={{ width: 120 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "进行中", label: "进行中" },
              { value: "未开始", label: "未开始" },
              { value: "已完成", label: "已完成" },
              { value: "未排产", label: "未排产" },
              { value: "异常", label: "异常" },
            ]}
          />
          <Select
            allowClear
            placeholder="交期结论"
            style={{ width: 120 }}
            value={dueFilter}
            onChange={(v) => setDueFilter(v as DueBucket | undefined)}
            options={[
              { value: "延期", label: "延期" },
              { value: "按期", label: "按期" },
              { value: "提前", label: "提前" },
              { value: "未排满", label: "未排满" },
            ]}
          />
          <span style={{ fontSize: 12, color: "#718096" }}>
            当前 {aggs.length} / {allAggs.length} 单
            {dateRange ? "（按计划日期与所选区间有交集）" : ""}
          </span>
        </Space>

        <KpiRow
          items={[
            { title: "订单数", value: kpis.total },
            { title: "进行中", value: kpis.running },
            { title: "已完成", value: kpis.done },
            { title: "未排产", value: kpis.unscheduled },
          ]}
        />
        <KpiRow
          items={[
            {
              title: "计划工时",
              value: Math.round(kpis.planH * 10) / 10,
              unit: "h",
            },
            {
              title: "实绩工时",
              value: Math.round(kpis.actH * 10) / 10,
              unit: "h",
            },
            { title: "整体进度", value: kpis.pct, unit: "%" },
            {
              title: "延期/提前/按期",
              value: `${kpis.delayed}/${kpis.early}/${kpis.ontime}`,
            },
          ]}
        />
        <KpiRow
          items={[
            { title: "缺编合计", value: kpis.gap },
            { title: "冲突合计", value: kpis.conf },
          ]}
        />

        <div>
          <Typography.Text strong>各订单计划 vs 实绩（天）</Typography.Text>
          <div style={{ fontSize: 12, color: "#718096", marginBottom: 4 }}>
            Top {TOP_N} 按计划天数；柱内按工序分色堆叠
          </div>
          {stackedBar.categories.length && stackedBar.opNames.length ? (
            <ProcessStackedPlanActualBar
              categories={stackedBar.categories}
              opNames={stackedBar.opNames}
              planByOp={stackedBar.planByOp}
              actualByOp={stackedBar.actualByOp}
            />
          ) : (
            <div style={{ color: "#a0aec0", padding: 24 }}>暂无订单</div>
          )}
        </div>

        <div>
          <Typography.Text strong>交期状态分布</Typography.Text>
          {duePie.length ? (
            <PieChart data={duePie} height={280} legendPosition="right" />
          ) : (
            <div style={{ color: "#a0aec0", padding: 24 }}>暂无数据</div>
          )}
        </div>

        <div>
          <Typography.Text strong>风险清单</Typography.Text>
          <div style={{ fontSize: 12, color: "#718096", marginBottom: 8 }}>
            按延期、冲突、缺编排序；点「详情」打开单订单抽屉
          </div>
          <Table<OrderAgg>
            size="small"
            rowKey="key"
            pagination={{ pageSize: 8, size: "small" }}
            scroll={{ x: 900 }}
            dataSource={riskRows}
            columns={[
              {
                title: "订单",
                dataIndex: "code",
                fixed: "left",
                width: 130,
                render: (_: string, r) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{r.code}</div>
                    <div style={{ fontSize: 12, color: "#718096" }}>{r.wo_name}</div>
                  </div>
                ),
              },
              { title: "状态", dataIndex: "status", width: 80 },
              {
                title: "交期",
                dataIndex: "due",
                width: 100,
                render: (v: string) => shortDate(v),
              },
              {
                title: "交期结论",
                dataIndex: "due_bucket",
                width: 88,
                render: (v: DueBucket, r) => (
                  <Tag
                    color={
                      v === "延期"
                        ? "error"
                        : v === "提前"
                          ? "success"
                          : v === "按期"
                            ? "processing"
                            : "default"
                    }
                  >
                    {v}
                    {r.due_delta != null && r.due_delta !== 0
                      ? ` ${r.due_delta > 0 ? "+" : ""}${r.due_delta}d`
                      : ""}
                  </Tag>
                ),
              },
              {
                title: "计划窗",
                width: 120,
                render: (_: unknown, r) =>
                  `${shortDate(r.plan_start)}～${shortDate(r.plan_end)}`,
              },
              {
                title: "进度",
                dataIndex: "progress",
                width: 72,
                render: (v: number) => `${v}%`,
              },
              { title: "缺编", dataIndex: "staffing_gap", width: 64 },
              { title: "冲突", dataIndex: "conflict_count", width: 64 },
              {
                title: "操作",
                fixed: "right",
                width: 72,
                render: (_: unknown, r) => (
                  <Button
                    type="link"
                    size="small"
                    style={{ paddingInline: 0 }}
                    onClick={() => onOpenOrder(r.row)}
                  >
                    详情
                  </Button>
                ),
              },
            ]}
          />
        </div>
      </Space>
    </Drawer>
  );
}
