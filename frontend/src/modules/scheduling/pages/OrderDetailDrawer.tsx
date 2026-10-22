import { Drawer, Space, Table, Tabs, Tag, Typography } from "antd";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { PieChart } from "@/charts";
import { KpiRow } from "@/components/blocks";
import type { GanttOrderRow, OperationItem } from "@/modules/scheduling/api/scheduling";
import {
  collectActualDayShiftStats,
  collectOpActualDayShiftStats,
  collectOpPlanDayShiftStats,
  collectPlanDayShiftStats,
  formatDateRangeFull,
  formatDayShiftBrief,
  formatDayShiftProgress,
  type DayShiftStats,
} from "@/modules/scheduling/dayShiftStats";

function shortDate(iso?: string | null) {
  if (!iso) return "—";
  return iso.slice(0, 10);
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
  plan_days: number;
  plan_shifts: number;
  plan_persons: number;
  plan_brief: string;
  actual_start: string;
  actual_end: string;
  actual_days: number;
  actual_shifts: number;
  actual_persons: number;
  actual_brief: string;
  delta_persons: number | null;
  drift: string;
};

type DayPersonRow = {
  key: string;
  kind: "计划" | "实绩";
  op_name: string;
  person: string;
  date: string;
  shift: string;
  /** 人次权重，旭日图用 */
  slots: number;
};

type SunNode = { name: string; value?: number; children?: SunNode[] };

function shiftLabelOf(op: OperationItem): string {
  return op.shift_name || op.shift_time_label || op.slot_label || "班次";
}

function buildCompareRows(
  ops: OperationItem[],
  actualRow?: GanttOrderRow | null,
): OpCompareRow[] {
  return [...ops]
    .sort((a, b) => (a.seq || 0) - (b.seq || 0))
    .map((o) => {
      const plan = collectOpPlanDayShiftStats(o);
      const actual = collectOpActualDayShiftStats(o.id, actualRow);
      const delta =
        plan.personCount > 0 || actual.personCount > 0
          ? actual.personCount - plan.personCount
          : null;

      let drift = "—";
      if (o.plan_drift_label) drift = o.plan_drift_label;
      else if (delta != null && delta > 0) drift = `实绩多 ${delta} 人`;
      else if (delta != null && delta < 0) drift = `实绩少 ${-delta} 人`;
      else if (delta === 0 && plan.personCount > 0) drift = "人次一致";

      return {
        key: o.id,
        name: o.name,
        status: opStatusLabel(o.status),
        plan_start: plan.start || o.plan_start?.slice(0, 10) || "—",
        plan_end: plan.end || o.plan_end?.slice(0, 10) || "—",
        plan_days: plan.dayCount,
        plan_shifts: plan.shiftCount,
        plan_persons: plan.personCount,
        plan_brief: formatDayShiftBrief(plan),
        actual_start: actual.start || "—",
        actual_end: actual.end || "—",
        actual_days: actual.dayCount,
        actual_shifts: actual.shiftCount,
        actual_persons: actual.personCount,
        actual_brief: formatDayShiftBrief(actual),
        delta_persons: delta,
        drift,
      };
    });
}

/** 计划：工序 → 人 → 日×班（每条=1人次） */
function collectPlanDayPerson(
  ops: OperationItem[],
  nameById: Map<string, string>,
): DayPersonRow[] {
  const rows: DayPersonRow[] = [];
  for (const o of ops) {
    const shift = shiftLabelOf(o);
    const family = o.shift_family_id || "sh-day";
    const segs = (o.plan_segments ?? []).filter((s) => s.start);
    if (segs.length) {
      for (const s of segs) {
        const pids = [
          ...(s.person_ids?.length
            ? s.person_ids
            : s.person_id
              ? [s.person_id]
              : o.assignee_ids?.length
                ? o.assignee_ids
                : o.assignee_id
                  ? [o.assignee_id]
                  : []),
        ].filter(Boolean) as string[];
        const names = pids.length
          ? pids.map((id) => nameById.get(id) || id)
          : o.assignee_names?.length
            ? o.assignee_names
            : o.assignee_name
              ? [o.assignee_name]
              : ["未派人"];
        const hc = Math.max(
          1,
          Number(s.required_headcount || o.required_headcount || names.length || 1),
        );
        // 无名额时按人数需求铺开占位
        const people =
          names.length >= hc
            ? names
            : [
                ...names,
                ...Array.from({ length: hc - names.length }, (_, i) => `待派${i + 1}`),
              ];
        for (const d of eachDay(s.start, s.end || s.start)) {
          for (const person of people) {
            rows.push({
              key: `plan-${o.id}-${family}-${person}-${d}`,
              kind: "计划",
              op_name: o.name,
              person,
              date: d,
              shift,
              slots: 1,
            });
          }
        }
      }
      continue;
    }
    const ps = o.plan_start?.slice(0, 10);
    const pe = (o.plan_end || o.plan_start || "").slice(0, 10);
    if (!ps || !pe) continue;
    const pids = [
      ...(o.assignee_ids?.length
        ? o.assignee_ids
        : o.assignee_id
          ? [o.assignee_id]
          : []),
    ].filter(Boolean) as string[];
    const names = pids.length
      ? pids.map((id) => nameById.get(id) || id)
      : o.assignee_names?.length
        ? o.assignee_names
        : o.assignee_name
          ? [o.assignee_name]
          : ["未派人"];
    const hc = Math.max(1, Number(o.required_headcount || names.length || 1));
    const people =
      names.length >= hc
        ? names
        : [
            ...names,
            ...Array.from({ length: hc - names.length }, (_, i) => `待派${i + 1}`),
          ];
    for (const d of eachDay(ps, pe)) {
      for (const person of people) {
        rows.push({
          key: `plan-${o.id}-${family}-${person}-${d}`,
          kind: "计划",
          op_name: o.name,
          person,
          date: d,
          shift,
          slots: 1,
        });
      }
    }
  }
  return rows;
}

/** 实绩：来自签字 cells */
function collectActualDayPerson(
  actualRow?: GanttOrderRow | null,
  nameById?: Map<string, string>,
): DayPersonRow[] {
  const rows: DayPersonRow[] = [];
  if (!actualRow?.cells) return rows;
  for (const [date, list] of Object.entries(actualRow.cells)) {
    for (const o of list || []) {
      const shift = shiftLabelOf(o);
      const family = o.shift_family_id || "sh-day";
      const pids = [
        ...(o.assignee_ids?.length
          ? o.assignee_ids
          : o.assignee_id
            ? [o.assignee_id]
            : []),
      ].filter(Boolean) as string[];
      const names = pids.length
        ? pids.map((id) => nameById?.get(id) || id)
        : o.assignee_names?.length
          ? o.assignee_names
          : o.assignee_name
            ? [o.assignee_name]
            : ["未派人"];
      for (const person of names) {
        rows.push({
          key: `act-${o.id}-${family}-${person}-${date}`,
          kind: "实绩",
          op_name: o.name,
          person,
          date: date.slice(0, 10),
          shift,
          slots: 1,
        });
      }
    }
  }
  return rows;
}

function toSunburst(rows: DayPersonRow[]): SunNode[] {
  // 工序 → 人 → 日（值=人次）
  const byOp = new Map<string, Map<string, Map<string, number>>>();
  for (const r of rows) {
    if (!byOp.has(r.op_name)) byOp.set(r.op_name, new Map());
    const byPerson = byOp.get(r.op_name)!;
    if (!byPerson.has(r.person)) byPerson.set(r.person, new Map());
    const byDay = byPerson.get(r.person)!;
    const dayKey = `${r.date.slice(5)}·${r.shift}`;
    byDay.set(dayKey, (byDay.get(dayKey) || 0) + r.slots);
  }
  const nodes: SunNode[] = [];
  for (const [op, byPerson] of byOp) {
    const peopleNodes: SunNode[] = [];
    let opVal = 0;
    for (const [person, byDay] of byPerson) {
      const dayNodes: SunNode[] = [];
      let pVal = 0;
      for (const [date, slots] of [...byDay.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        dayNodes.push({ name: date, value: slots });
        pVal += slots;
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
    yAxis: { type: "value", name: "人次", minInterval: 1 },
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
        return `${path || x.name}<br/>${x.value ?? 0}人次`;
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
        label: { show: false },
        labelLayout: { hideOverlap: true },
        levels: [
          {},
          {
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
        日期层不标字以免重叠；鼠标悬停看「工序 / 人 / 日·班」，单位为人次
      </div>
    </div>
  );
}

export default function OrderDetailDrawer({
  open,
  row,
  actualRow,
  nameById,
  onClose,
}: {
  open: boolean;
  row: GanttOrderRow | null;
  actualRow?: GanttOrderRow | null;
  nameById: Map<string, string>;
  onClose: () => void;
}) {
  const [sunTab, setSunTab] = useState<"plan" | "actual">("plan");
  const ops = row?.operations ?? [];
  const compareRows = useMemo(
    () => buildCompareRows(ops, actualRow),
    [ops, actualRow],
  );

  const planDayRows = useMemo(
    () => collectPlanDayPerson(ops, nameById),
    [ops, nameById],
  );
  const actualDayRows = useMemo(
    () => collectActualDayPerson(actualRow, nameById),
    [actualRow, nameById],
  );
  const planSun = useMemo(() => toSunburst(planDayRows), [planDayRows]);
  const actualSun = useMemo(() => toSunburst(actualDayRows), [actualDayRows]);

  const planStats: DayShiftStats = useMemo(
    () => collectPlanDayShiftStats(ops),
    [ops],
  );
  const actualStats: DayShiftStats = useMemo(
    () => collectActualDayShiftStats(actualRow),
    [actualRow],
  );
  const pct =
    planStats.personCount > 0
      ? Math.round((actualStats.personCount / planStats.personCount) * 100)
      : 0;
  const progressText = formatDayShiftProgress(actualStats, planStats);

  const due = row?.due_date?.slice(0, 10);
  const planEnd = planStats.end || row?.estimated_end?.slice(0, 10);
  const actualEnd = actualStats.end;

  let dueTag: { color: string; text: string } = { color: "default", text: "交期对照 —" };
  if (due && planEnd) {
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
  const planBar = compareRows.map((r) => r.plan_persons);
  const actualBar = compareRows.map((r) => r.actual_persons);

  const personPie = compareRows
    .filter((r) => r.plan_persons > 0)
    .map((r) => ({ label: r.name, value: r.plan_persons }));

  const detailTableRows = sunTab === "plan" ? planDayRows : actualDayRows;

  return (
    <Drawer title={title} open={open} onClose={onClose} width={820} destroyOnHidden>
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
            <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55 }}>
              <div>计划 {formatDateRangeFull(planStats.start, planStats.end)}</div>
              <div>{formatDayShiftBrief(planStats)}</div>
              <div style={{ marginTop: 4 }}>
                实际{" "}
                {actualStats.personCount > 0
                  ? formatDateRangeFull(actualStats.start, actualStats.end)
                  : "—"}
              </div>
              {actualStats.personCount > 0 ? (
                <div>{formatDayShiftBrief(actualStats)}</div>
              ) : null}
              <div style={{ marginTop: 4 }}>进度 {progressText}</div>
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
                title: "计划",
                value: formatDayShiftBrief(planStats),
              },
              {
                title: "实绩",
                value:
                  actualStats.personCount > 0
                    ? formatDayShiftBrief(actualStats)
                    : "—",
              },
              { title: "进度（人次）", value: pct, unit: "%" },
              {
                title: "班次进度",
                value: `${actualStats.shiftCount}/${planStats.shiftCount} 个班次`,
              },
            ]}
          />

          <div>
            <Typography.Text strong>工序计划 vs 实绩（人次）</Typography.Text>
            <div style={{ fontSize: 12, color: "#718096", marginBottom: 4 }}>
              同一工序下蓝=计划、绿=实绩；口径为人次（日×班×人）
            </div>
            <GroupedPlanActualBar
              categories={categories}
              plan={planBar}
              actual={actualBar}
            />
          </div>

          <div>
            <Typography.Text strong>谁在哪天哪班（工序 → 人 → 日·班）</Typography.Text>
            <div style={{ fontSize: 12, color: "#718096", margin: "4px 0 8px" }}>
              单位为人次；计划按排产段展开，实绩按签字日×班。
            </div>
            <Tabs
              size="small"
              activeKey={sunTab}
              onChange={(k) => setSunTab(k as "plan" | "actual")}
              items={[
                {
                  key: "plan",
                  label: `计划（${planDayRows.length} 人次）`,
                  children: (
                    <PersonDaySunburst data={planSun} emptyText="暂无计划人次" />
                  ),
                },
                {
                  key: "actual",
                  label: `实绩（${actualDayRows.length} 人次）`,
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
                  width: 110,
                  render: (v: string) => shortDate(v),
                },
                { title: "班次", dataIndex: "shift", width: 88 },
                {
                  title: "人次",
                  dataIndex: "slots",
                  width: 56,
                },
              ]}
            />
          </div>

          <div>
            <Typography.Text strong>计划人次构成</Typography.Text>
            {personPie.length ? (
              <PieChart data={personPie} height={300} legendPosition="right" />
            ) : (
              <div style={{ color: "#a0aec0", padding: 24 }}>暂无计划人次</div>
            )}
          </div>

          <div>
            <Typography.Text strong>工序时间对照表</Typography.Text>
            <Table<OpCompareRow>
              size="small"
              pagination={false}
              rowKey="key"
              style={{ marginTop: 8 }}
              scroll={{ x: 960 }}
              dataSource={compareRows}
              columns={[
                { title: "工序", dataIndex: "name", fixed: "left", width: 120 },
                { title: "状态", dataIndex: "status", width: 80 },
                { title: "计划起", dataIndex: "plan_start", width: 110 },
                { title: "计划止", dataIndex: "plan_end", width: 110 },
                {
                  title: "计划",
                  dataIndex: "plan_brief",
                  width: 120,
                },
                { title: "实绩起", dataIndex: "actual_start", width: 110 },
                { title: "实绩止", dataIndex: "actual_end", width: 110 },
                {
                  title: "实绩",
                  dataIndex: "actual_brief",
                  width: 120,
                },
                {
                  title: "人次差",
                  dataIndex: "delta_persons",
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
