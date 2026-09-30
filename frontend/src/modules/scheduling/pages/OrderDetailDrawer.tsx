import { Drawer, Space, Table, Tabs, Tag, Typography } from "antd";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { PieChart } from "@/charts";
import { KpiRow } from "@/components/blocks";
import type { GanttOrderRow, OperationItem } from "@/modules/scheduling/api/scheduling";

function shortDate(iso?: string | null) {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function daysBetween(a?: string | null, b?: string | null) {
  if (!a || !b) return null;
  return dayjs(b.slice(0, 10)).diff(dayjs(a.slice(0, 10)), "day") + 1;
}

function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = dayjs(start.slice(0, 10));
  const last = dayjs(end.slice(0, 10));
  if (!cur.isValid() || !last.isValid() || last.isBefore(cur, "day")) return out;
  while (cur.isBefore(last, "day") || cur.isSame(last, "day")) {
    out.push(cur.format("YYYY-MM-DD"));
    cur = cur.add(1, "day");
  }
  return out;
}

function opStatusLabel(status?: string) {
  switch (status) {
    case "running":
      return "进行中";
    case "paused":
      return "已暂停";
    case "done":
      return "已完成";
    case "exception":
      return "异常";
    default:
      return "未开始";
  }
}

function orderRollupStatus(ops: OperationItem[]) {
  if (!ops.length) return "未排产";
  if (ops.every((o) => o.status === "done")) return "已完成";
  if (ops.some((o) => o.status === "exception")) return "异常";
  if (ops.some((o) => o.status === "running" || o.status === "paused")) return "进行中";
  return "未开始";
}

type OpCompareRow = {
  key: string;
  name: string;
  status: string;
  plan_start: string;
  plan_end: string;
  plan_days: number | null;
  plan_hours: number;
  actual_start: string;
  actual_end: string;
  actual_days: number | null;
  actual_hours: number;
  delta_days: number | null;
  drift: string;
};

type DayPersonRow = {
  key: string;
  kind: "计划" | "实绩";
  op_name: string;
  person: string;
  date: string;
  hours: number;
};

type SunNode = { name: string; value?: number; children?: SunNode[] };

function buildCompareRows(ops: OperationItem[], today: string): OpCompareRow[] {
  return [...ops]
    .sort((a, b) => (a.seq || 0) - (b.seq || 0))
    .map((o) => {
      const hpd = o.hours_per_day ?? 8;
      const planStart = o.plan_start?.slice(0, 10) || "";
      const planEnd = (o.plan_end || o.plan_start || "").slice(0, 10);
      const planDays =
        o.segment_day_sum ||
        o.duration_days ||
        daysBetween(planStart || null, planEnd || null);
      const planHours = o.planned_hours || (planDays || 0) * hpd;

      const actStart = o.actual_start?.slice(0, 10) || "";
      const actEnd =
        o.actual_end?.slice(0, 10) ||
        (actStart && (o.status === "running" || o.status === "paused") ? today : "");
      const actualDays = daysBetween(actStart || null, actEnd || null);
      const actualHours = actualDays != null ? actualDays * hpd : 0;

      let delta: number | null = null;
      if (planDays != null && actualDays != null) delta = actualDays - planDays;

      let drift = "—";
      if (o.plan_drift_label) drift = o.plan_drift_label;
      else if (delta != null && delta > 0) drift = `超期 ${delta} 天`;
      else if (delta != null && delta < 0) drift = `提前 ${-delta} 天`;
      else if (delta === 0) drift = "按期";

      return {
        key: o.id,
        name: o.name,
        status: opStatusLabel(o.status),
        plan_start: planStart || "—",
        plan_end: planEnd || "—",
        plan_days: planDays,
        plan_hours: Math.round(planHours * 10) / 10,
        actual_start: actStart || "—",
        actual_end: actEnd || "—",
        actual_days: actualDays,
        actual_hours: Math.round(actualHours * 10) / 10,
        delta_days: delta,
        drift,
      };
    });
}

/** 计划：工序 → 人 → 日（优先 plan_segments） */
function collectPlanDayPerson(
  ops: OperationItem[],
  nameById: Map<string, string>,
): DayPersonRow[] {
  const rows: DayPersonRow[] = [];
  for (const o of ops) {
    const hpd = o.hours_per_day ?? 8;
    const segs = (o.plan_segments ?? []).filter((s) => s.start);
    if (segs.length) {
      for (const s of segs) {
        const person =
          (s.person_id && nameById.get(s.person_id)) ||
          o.assignee_name ||
          (o.assignee_names || []).join("、") ||
          "未派人";
        for (const d of eachDay(s.start, s.end || s.start)) {
          rows.push({
            key: `plan-${o.id}-${person}-${d}`,
            kind: "计划",
            op_name: o.name,
            person,
            date: d,
            hours: hpd,
          });
        }
      }
      continue;
    }
    const ps = o.plan_start?.slice(0, 10);
    const pe = (o.plan_end || o.plan_start || "").slice(0, 10);
    if (!ps || !pe) continue;
    const people =
      o.assignee_names?.length
        ? o.assignee_names
        : o.assignee_name
          ? [o.assignee_name]
          : ["未派人"];
    for (const d of eachDay(ps, pe)) {
      for (const person of people) {
        rows.push({
          key: `plan-${o.id}-${person}-${d}`,
          kind: "计划",
          op_name: o.name,
          person,
          date: d,
          hours: hpd,
        });
      }
    }
  }
  return rows;
}

/**
 * 实绩：目前只有签字窗，没有「哪天谁」明细。
 * 用 actual_start~actual_end 铺开，责任人按 assignee 均摊到每天（示意）。
 */
function collectActualDayPerson(ops: OperationItem[], today: string): DayPersonRow[] {
  const rows: DayPersonRow[] = [];
  for (const o of ops) {
    const a0 = o.actual_start?.slice(0, 10);
    if (!a0) continue;
    const a1 =
      o.actual_end?.slice(0, 10) ||
      (o.status === "running" || o.status === "paused" ? today : a0);
    const hpd = o.hours_per_day ?? 8;
    const people =
      o.assignee_names?.length
        ? o.assignee_names
        : o.assignee_name
          ? [o.assignee_name]
          : ["未派人"];
    for (const d of eachDay(a0, a1)) {
      for (const person of people) {
        rows.push({
          key: `act-${o.id}-${person}-${d}`,
          kind: "实绩",
          op_name: o.name,
          person,
          date: d,
          hours: hpd,
        });
      }
    }
  }
  return rows;
}

function toSunburst(rows: DayPersonRow[]): SunNode[] {
  // 工序 → 人 → 日
  const byOp = new Map<string, Map<string, Map<string, number>>>();
  for (const r of rows) {
    if (!byOp.has(r.op_name)) byOp.set(r.op_name, new Map());
    const byPerson = byOp.get(r.op_name)!;
    if (!byPerson.has(r.person)) byPerson.set(r.person, new Map());
    const byDay = byPerson.get(r.person)!;
    byDay.set(r.date, (byDay.get(r.date) || 0) + r.hours);
  }
  const nodes: SunNode[] = [];
  for (const [op, byPerson] of byOp) {
    const peopleNodes: SunNode[] = [];
    let opVal = 0;
    for (const [person, byDay] of byPerson) {
      const dayNodes: SunNode[] = [];
      let pVal = 0;
      for (const [date, hours] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        dayNodes.push({ name: date.slice(5), value: hours });
        pVal += hours;
      }
      peopleNodes.push({ name: person, value: pVal, children: dayNodes });
      opVal += pVal;
    }
    nodes.push({ name: op, value: opVal, children: peopleNodes });
  }
  return nodes;
}

function GroupedPlanActualBar({
  categories,
  plan,
  actual,
}: {
  categories: string[];
  plan: number[];
  actual: number[];
}) {
  const option: EChartsOption = {
    color: ["#2563eb", "#0f766e"],
    legend: { data: ["计划", "实绩"], top: 0 },
    tooltip: { trigger: "axis" },
    grid: { left: 44, right: 16, top: 36, bottom: 48 },
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: { interval: 0, rotate: categories.length > 4 ? 28 : 0 },
    },
    yAxis: { type: "value", name: "天", minInterval: 1 },
    series: [
      { name: "计划", type: "bar", data: plan, barMaxWidth: 28, barGap: "20%" },
      { name: "实绩", type: "bar", data: actual, barMaxWidth: 28 },
    ],
  };
  return <ReactECharts option={option} style={{ height: 240, width: "100%" }} notMerge lazyUpdate />;
}

function PersonDaySunburst({ data, emptyText }: { data: SunNode[]; emptyText: string }) {
  if (!data.length) {
    return <div style={{ color: "#a0aec0", padding: 32, textAlign: "center" }}>{emptyText}</div>;
  }

  const shortLabel = (name: string, max = 6) =>
    name.length > max ? `${name.slice(0, max)}…` : name;

  const option: EChartsOption = {
    tooltip: {
      trigger: "item",
      formatter: (p: unknown) => {
        const x = p as {
          name?: string;
          value?: number;
          treePathInfo?: Array<{ name: string }>;
        };
        const path = (x.treePathInfo || [])
          .map((n) => n.name)
          .filter(Boolean)
          .join(" / ");
        return `${path || x.name}<br/>${x.value ?? 0}h`;
      },
    },
    series: [
      {
        type: "sunburst",
        radius: ["8%", "78%"],
        sort: undefined,
        nodeClick: false,
        emphasis: { focus: "ancestor" },
        data,
        // 默认不画字，按层单独开，避免挤成一团
        label: { show: false },
        labelLayout: { hideOverlap: true },
        levels: [
          {},
          {
            // 工序：只显示够宽的扇区
            r0: "8%",
            r: "32%",
            itemStyle: { borderWidth: 2, borderColor: "#fff" },
            label: {
              show: true,
              rotate: "tangential",
              minAngle: 18,
              fontSize: 12,
              overflow: "truncate",
              formatter: (p: { name?: string }) => shortLabel(p.name || "", 8),
            },
          },
          {
            // 人员
            r0: "32%",
            r: "55%",
            itemStyle: { borderWidth: 1, borderColor: "#fff" },
            label: {
              show: true,
              rotate: "tangential",
              minAngle: 14,
              fontSize: 11,
              overflow: "truncate",
              formatter: (p: { name?: string }) => shortLabel(p.name || "", 5),
            },
          },
          {
            // 日期最容易重叠：默认不标字，悬停看完整路径
            r0: "55%",
            r: "78%",
            itemStyle: { borderWidth: 1, borderColor: "#fff" },
            label: { show: false },
          },
        ],
      },
    ],
  };
  return (
    <div>
      <ReactECharts
        option={option}
        style={{ height: 340, width: "100%" }}
        notMerge
        lazyUpdate
      />
      <div style={{ fontSize: 12, color: "#718096", textAlign: "center", marginTop: -4 }}>
        日期层不标字以免重叠；鼠标悬停看「工序 / 人 / 日」，明细见下方表格
      </div>
    </div>
  );
}

export default function OrderDetailDrawer({
  open,
  row,
  nameById,
  onClose,
}: {
  open: boolean;
  row: GanttOrderRow | null;
  nameById: Map<string, string>;
  onClose: () => void;
}) {
  const today = dayjs().format("YYYY-MM-DD");
  const [sunTab, setSunTab] = useState<"plan" | "actual">("plan");
  const ops = row?.operations ?? [];
  const compareRows = useMemo(() => buildCompareRows(ops, today), [ops, today]);

  const planDayRows = useMemo(
    () => collectPlanDayPerson(ops, nameById),
    [ops, nameById],
  );
  const actualDayRows = useMemo(
    () => collectActualDayPerson(ops, today),
    [ops, today],
  );
  const planSun = useMemo(() => toSunburst(planDayRows), [planDayRows]);
  const actualSun = useMemo(() => toSunburst(actualDayRows), [actualDayRows]);

  const planHours = compareRows.reduce((n, r) => n + r.plan_hours, 0);
  const actualHours = compareRows.reduce((n, r) => n + r.actual_hours, 0);
  const planDaysSum = compareRows.reduce((n, r) => n + (r.plan_days || 0), 0);
  const actualDaysSum = compareRows.reduce((n, r) => n + (r.actual_days || 0), 0);
  const pct = planHours > 0 ? Math.min(100, Math.round((actualHours / planHours) * 100)) : 0;

  const due = row?.due_date?.slice(0, 10);
  const planEnd =
    row?.estimated_end?.slice(0, 10) ||
    [...compareRows.map((r) => r.plan_end).filter((x) => x !== "—")].sort().slice(-1)[0];
  const actualEnd =
    [...compareRows.map((r) => r.actual_end).filter((x) => x !== "—")].sort().slice(-1)[0] ||
    undefined;

  let dueTag: { color: string; text: string } = { color: "default", text: "交期对照 —" };
  if (due && planEnd && planEnd !== "—") {
    const d = dayjs(planEnd).diff(dayjs(due), "day");
    if (d > 0) dueTag = { color: "error", text: `计划相对交期延期 ${d} 天` };
    else if (d < 0) dueTag = { color: "success", text: `计划相对交期提前 ${-d} 天` };
    else dueTag = { color: "processing", text: "计划对齐交期" };
  }
  if (due && actualEnd) {
    const d = dayjs(actualEnd).diff(dayjs(due), "day");
    if (d > 0) dueTag = { color: "error", text: `实绩相对交期延期 ${d} 天` };
    else if (d < 0) dueTag = { color: "success", text: `实绩相对交期提前 ${-d} 天` };
    else if (compareRows.every((r) => r.status === "已完成")) {
      dueTag = { color: "success", text: "实绩按期完成" };
    }
  }

  const status = orderRollupStatus(ops);
  const title = row
    ? `${row.order_code || ""} · ${row.source_type_label || ""}`
    : "订单详情";

  const categories = compareRows.map((r) => r.name);
  const planBar = compareRows.map((r) => r.plan_days || 0);
  const actualBar = compareRows.map((r) => r.actual_days || 0);

  const hourPie = compareRows
    .filter((r) => r.plan_hours > 0)
    .map((r) => ({ label: r.name, value: r.plan_hours }));

  const detailTableRows = sunTab === "plan" ? planDayRows : actualDayRows;

  return (
    <Drawer title={title} open={open} onClose={onClose} width={780} destroyOnHidden>
      {row ? (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>
              {row.order_name || row.product || "—"}
            </Typography.Title>
            <div style={{ color: "#718096", marginTop: 4 }}>
              工单：{row.work_order_name || row.work_order_code || "—"}
              {" · "}
              状态：{status}
              {" · "}
              交期：{shortDate(due)}
            </div>
            <div style={{ marginTop: 8 }}>
              <Tag color={dueTag.color}>{dueTag.text}</Tag>
              {(row.unreleased_count || 0) > 0 ? (
                <Tag>待释放 {row.unreleased_count} 道</Tag>
              ) : null}
            </div>
          </div>

          <KpiRow
            items={[
              {
                title: "计划工时",
                value: Math.round(planHours * 10) / 10,
                unit: "h",
              },
              {
                title: "实绩工时",
                value: Math.round(actualHours * 10) / 10,
                unit: "h",
              },
              { title: "进度", value: pct, unit: "%" },
              {
                title: "计划/实绩天",
                value: `${planDaysSum}/${actualDaysSum}`,
              },
            ]}
          />

          <div>
            <Typography.Text strong>工序计划 vs 实绩（天）</Typography.Text>
            <div style={{ fontSize: 12, color: "#718096", marginBottom: 4 }}>
              同一工序下蓝=计划、绿=实绩，成对对比
            </div>
            <GroupedPlanActualBar
              categories={categories}
              plan={planBar}
              actual={actualBar}
            />
          </div>

          <div>
            <Typography.Text strong>谁在哪天干（工序 → 人 → 日）</Typography.Text>
            <div style={{ fontSize: 12, color: "#718096", margin: "4px 0 8px" }}>
              计划与实绩数据粒度不同：计划可落到段/人/日；实绩目前按签字窗铺开（示意）。
              用 Tab 分开看，避免揉进一张图对不上。
            </div>
            <Tabs
              size="small"
              activeKey={sunTab}
              onChange={(k) => setSunTab(k as "plan" | "actual")}
              items={[
                {
                  key: "plan",
                  label: `计划（${planDayRows.length} 人日）`,
                  children: (
                    <PersonDaySunburst
                      data={planSun}
                      emptyText="暂无计划人日"
                    />
                  ),
                },
                {
                  key: "actual",
                  label: `实绩（${actualDayRows.length} 人日）`,
                  children: (
                    <PersonDaySunburst
                      data={actualSun}
                      emptyText="暂无实绩（未开工/未签字）"
                    />
                  ),
                },
              ]}
            />
            <Table<DayPersonRow>
              size="small"
              pagination={{ pageSize: 8, size: "small" }}
              rowKey="key"
              style={{ marginTop: 8 }}
              dataSource={detailTableRows}
              columns={[
                { title: "类型", dataIndex: "kind", width: 64 },
                { title: "工序", dataIndex: "op_name", width: 120 },
                { title: "人员", dataIndex: "person", width: 88 },
                {
                  title: "日期",
                  dataIndex: "date",
                  width: 100,
                  render: (v: string) => shortDate(v),
                },
                {
                  title: "工时",
                  dataIndex: "hours",
                  width: 64,
                  render: (v: number) => `${v}h`,
                },
              ]}
            />
          </div>

          <div>
            <Typography.Text strong>计划工时构成</Typography.Text>
            {hourPie.length ? (
              <PieChart data={hourPie} height={300} legendPosition="right" />
            ) : (
              <div style={{ color: "#a0aec0", padding: 24 }}>暂无计划工时</div>
            )}
          </div>

          <div>
            <Typography.Text strong>工序时间对照表</Typography.Text>
            <Table<OpCompareRow>
              size="small"
              pagination={false}
              rowKey="key"
              style={{ marginTop: 8 }}
              scroll={{ x: 720 }}
              dataSource={compareRows}
              columns={[
                { title: "工序", dataIndex: "name", fixed: "left", width: 120 },
                { title: "状态", dataIndex: "status", width: 80 },
                { title: "计划起", dataIndex: "plan_start", width: 100 },
                { title: "计划止", dataIndex: "plan_end", width: 100 },
                {
                  title: "计划天",
                  dataIndex: "plan_days",
                  width: 72,
                  render: (v: number | null) => v ?? "—",
                },
                { title: "计划h", dataIndex: "plan_hours", width: 72 },
                { title: "实绩起", dataIndex: "actual_start", width: 100 },
                { title: "实绩止", dataIndex: "actual_end", width: 100 },
                {
                  title: "实绩天",
                  dataIndex: "actual_days",
                  width: 72,
                  render: (v: number | null) => v ?? "—",
                },
                { title: "实绩h", dataIndex: "actual_hours", width: 72 },
                {
                  title: "偏差天",
                  dataIndex: "delta_days",
                  width: 80,
                  render: (v: number | null) =>
                    v == null ? "—" : v > 0 ? `+${v}` : String(v),
                },
                { title: "结论", dataIndex: "drift", width: 100 },
              ]}
            />
          </div>
        </Space>
      ) : null}
    </Drawer>
  );
}
