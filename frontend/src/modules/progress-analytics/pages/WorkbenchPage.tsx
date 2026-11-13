import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Col,
  DatePicker,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchAnalyticsMeta,
  queryAnalytics,
  type AnalyticsDimKey,
  type AnalyticsFilters,
  type AnalyticsMetricKey,
  type AnalyticsQueryResponse,
} from "@/modules/progress-analytics/api/analytics";
import { KpiRow } from "@/components/blocks";
import { PageHeader } from "@/components/kit";
import { useRequest } from "@/hooks/useRequest";

const { RangePicker } = DatePicker;

type ChartKind = "bar" | "line" | "table";

type DrillStep = {
  label: string;
  filters: AnalyticsFilters;
  dateFrom?: string;
  dateTo?: string;
};

const QUICK_RANGES: Array<{ key: string; label: string; range: () => [Dayjs, Dayjs] }> = [
  {
    key: "today",
    label: "今天",
    range: () => [dayjs().startOf("day"), dayjs().endOf("day")],
  },
  {
    key: "week",
    label: "本周",
    range: () => [dayjs().startOf("week"), dayjs().endOf("week")],
  },
  {
    key: "month",
    label: "本月",
    range: () => [dayjs().startOf("month"), dayjs().endOf("month")],
  },
  {
    key: "30d",
    label: "近30天",
    range: () => [dayjs().subtract(29, "day"), dayjs()],
  },
];

const NEXT_DRILL: Partial<Record<AnalyticsDimKey, AnalyticsDimKey>> = {
  team: "process",
  process: "equipment",
  equipment: "person",
  person: "work_date",
  shift: "team",
  product: "process",
  work_order: "process",
  order: "work_order",
  work_date: "shift",
};

function mergeFilters(a: AnalyticsFilters, b: AnalyticsFilters): AnalyticsFilters {
  const out: AnalyticsFilters = { ...a };
  (Object.keys(b) as Array<keyof AnalyticsFilters>).forEach((k) => {
    const v = b[k];
    if (v && v.length) out[k] = v;
  });
  return out;
}

function dimLabelOf(row: Record<string, unknown>, dim: AnalyticsDimKey): string {
  const v = row[dim];
  return v != null && String(v) !== "" ? String(v) : "—";
}

export default function WorkbenchPage() {
  const { data: meta, loading: metaLoading } = useRequest(fetchAnalyticsMeta, {
    immediate: true,
  });

  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [
    dayjs().subtract(29, "day"),
    dayjs(),
  ]);
  const [groupBy, setGroupBy] = useState<AnalyticsDimKey[]>(["team"]);
  const [metrics, setMetrics] = useState<AnalyticsMetricKey[]>([
    "output_qty",
    "production_hours",
    "hourly_output",
    "unit_minutes",
    "achieve_pct",
  ]);
  const [filters, setFilters] = useState<AnalyticsFilters>({});
  const [chartKind, setChartKind] = useState<ChartKind>("bar");
  const [sortField, setSortField] = useState<string>("hourly_output");
  const [drillPath, setDrillPath] = useState<DrillStep[]>([]);
  const [result, setResult] = useState<AnalyticsQueryResponse | null>(null);
  const [querying, setQuerying] = useState(false);

  useEffect(() => {
    if (!meta) return;
    if (meta.default_date_from && meta.default_date_to) {
      setRange([dayjs(meta.default_date_from), dayjs(meta.default_date_to)]);
    }
  }, [meta]);

  const dimOptions = useMemo(
    () => (meta?.dimensions ?? []).map((d) => ({ value: d.key, label: d.label })),
    [meta],
  );
  const metricOptions = useMemo(
    () =>
      (meta?.metrics ?? []).map((m) => ({
        value: m.key,
        label: `${m.label}${m.unit ? `（${m.unit}）` : ""}`,
      })),
    [meta],
  );

  const activeFilters = useMemo(() => {
    let f: AnalyticsFilters = { ...filters };
    for (const step of drillPath) {
      f = mergeFilters(f, step.filters);
    }
    return f;
  }, [filters, drillPath]);

  const activeRange = useMemo(() => {
    let from = range[0];
    let to = range[1];
    for (const step of drillPath) {
      if (step.dateFrom) from = dayjs(step.dateFrom);
      if (step.dateTo) to = dayjs(step.dateTo);
    }
    return [from, to] as [Dayjs, Dayjs];
  }, [range, drillPath]);

  const runQuery = async (overrideGroupBy?: AnalyticsDimKey[]) => {
    if (!groupBy.length && !overrideGroupBy?.length) {
      message.warning("请至少选择一个分析维度");
      return;
    }
    if (!metrics.length) {
      message.warning("请至少选择一个指标");
      return;
    }
    const gb = overrideGroupBy?.length ? overrideGroupBy : groupBy;
    setQuerying(true);
    try {
      const data = await queryAnalytics({
        date_from: activeRange[0].format("YYYY-MM-DD"),
        date_to: activeRange[1].format("YYYY-MM-DD"),
        filters: activeFilters,
        group_by: gb,
        metrics,
        sort: { field: sortField, order: "desc" },
        limit: 200,
      });
      setResult(data);
      if (overrideGroupBy) setGroupBy(overrideGroupBy);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "查询失败");
    } finally {
      setQuerying(false);
    }
  };

  useEffect(() => {
    if (meta) void runQuery();
    // 仅 meta 就绪后首查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  const chartMetric = useMemo(() => {
    if (metrics.includes(sortField as AnalyticsMetricKey)) {
      return sortField as AnalyticsMetricKey;
    }
    return metrics.find((m) => m === "hourly_output") || metrics[0];
  }, [metrics, sortField]);

  const chartOption: EChartsOption = useMemo(() => {
    const rows = result?.rows ?? [];
    const dim0 = (result?.group_by?.[0] || groupBy[0]) as AnalyticsDimKey;
    const names = rows.map((r) => dimLabelOf(r, dim0));
    const values = rows.map((r) => {
      const v = r[chartMetric];
      return typeof v === "number" ? v : 0;
    });
    const metaM = meta?.metrics.find((m) => m.key === chartMetric);
    const yName = metaM ? `${metaM.label}${metaM.unit ? `（${metaM.unit}）` : ""}` : chartMetric;
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 56, right: 24, top: 40, bottom: names.length > 8 ? 64 : 40 },
      xAxis: {
        type: "category",
        data: names,
        axisLabel: { interval: 0, rotate: names.length > 6 ? 28 : 0, fontSize: 11 },
      },
      yAxis: { type: "value", name: yName, nameTextStyle: { fontSize: 11 } },
      series: [
        {
          type: chartKind === "line" ? "line" : "bar",
          data: values,
          smooth: chartKind === "line",
          barMaxWidth: 36,
        },
      ],
    };
  }, [result, groupBy, chartMetric, chartKind, meta]);

  const kpis = useMemo(() => {
    const t = result?.totals || {};
    return [
      { title: "总产量", value: t.output_qty ?? "—" },
      { title: "生产工时", value: t.production_hours ?? "—" },
      { title: "小时产量", value: t.hourly_output ?? "—" },
      {
        title: "单位耗时(分/件)",
        value: t.unit_minutes ?? "—",
      },
    ];
  }, [result]);

  const tableColumns = useMemo(() => {
    const cols = result?.columns ?? [];
    return [
      ...cols.map((c) => ({
        title: c.unit ? `${c.label}（${c.unit}）` : c.label,
        dataIndex: c.key,
        key: c.key,
        width: c.role === "dimension" ? 120 : 110,
        render: (v: unknown) => (v == null || v === "" ? "—" : String(v)),
      })),
      {
        title: "下钻",
        key: "_drill",
        width: 88,
        fixed: "right" as const,
        render: (_: unknown, row: Record<string, unknown>) => (
          <Button type="link" size="small" onClick={() => onDrill(row)}>
            下钻
          </Button>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const onDrill = (row: Record<string, unknown>) => {
    const drill = (row._drill_filters || {}) as AnalyticsFilters & {
      date_from?: string;
      date_to?: string;
    };
    const currentDim = groupBy[0];
    const nextDim = NEXT_DRILL[currentDim] || "process";
    if (groupBy.includes(nextDim) && groupBy.length === 1) {
      // ok
    }
    const labelParts = groupBy.map((d) => dimLabelOf(row, d));
    const step: DrillStep = {
      label: labelParts.join(" · "),
      filters: { ...drill },
      dateFrom: drill.date_from,
      dateTo: drill.date_to,
    };
    delete (step.filters as Record<string, unknown>).date_from;
    delete (step.filters as Record<string, unknown>).date_to;
    setDrillPath((prev) => [...prev, step]);
    const nextGroup: AnalyticsDimKey[] = [nextDim];
    void (async () => {
      setGroupBy(nextGroup);
      // 等 state 更新后用显式参数查询
      setQuerying(true);
      try {
        const merged = mergeFilters(activeFilters, step.filters);
        let from = activeRange[0];
        let to = activeRange[1];
        if (step.dateFrom) from = dayjs(step.dateFrom);
        if (step.dateTo) to = dayjs(step.dateTo);
        const data = await queryAnalytics({
          date_from: from.format("YYYY-MM-DD"),
          date_to: to.format("YYYY-MM-DD"),
          filters: merged,
          group_by: nextGroup,
          metrics,
          sort: { field: sortField, order: "desc" },
          limit: 200,
        });
        setResult(data);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "下钻失败");
      } finally {
        setQuerying(false);
      }
    })();
  };

  const resetDrill = () => {
    setDrillPath([]);
  };

  const popDrill = (idx: number) => {
    setDrillPath((prev) => prev.slice(0, idx));
  };

  return (
    <div>
      <PageHeader
        title="多维生产分析"
        subtitle="高级能力：任意组合时间 / 班组 / 人员 / 设备 / 工序 / 工单，先汇总再算效率。"
        extra={
          <Space wrap>
            <Segmented
              options={QUICK_RANGES.map((q) => ({ value: q.key, label: q.label }))}
              onChange={(key) => {
                const q = QUICK_RANGES.find((x) => x.key === key);
                if (q) setRange(q.range());
              }}
            />
            <RangePicker
              value={range}
              allowClear={false}
              onChange={(v) => {
                if (v?.[0] && v?.[1]) {
                  setRange([v[0], v[1]]);
                  setDrillPath([]);
                }
              }}
            />
            <Button type="primary" loading={querying || metaLoading} onClick={() => runQuery()}>
              查询
            </Button>
          </Space>
        }
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={
          meta?.note ||
          "仅已确认报工；小时产量/单位耗时先 SUM 产量与工时再相除。达成率依赖工序标准耗时。"
        }
      />

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space direction="vertical" style={{ width: "100%" }} size={10}>
          <Space wrap>
            <Typography.Text type="secondary">分析维度</Typography.Text>
            <Select
              mode="multiple"
              allowClear={false}
              style={{ minWidth: 280 }}
              placeholder="最多 3 个"
              value={groupBy}
              options={dimOptions}
              onChange={(v: AnalyticsDimKey[]) => setGroupBy(v.slice(0, 3))}
            />
            <Typography.Text type="secondary">指标</Typography.Text>
            <Select
              mode="multiple"
              style={{ minWidth: 360 }}
              value={metrics}
              options={metricOptions}
              onChange={(v: AnalyticsMetricKey[]) => setMetrics(v)}
            />
            <Typography.Text type="secondary">排序</Typography.Text>
            <Select
              style={{ width: 160 }}
              value={sortField}
              options={metrics.map((m) => ({
                value: m,
                label: meta?.metrics.find((x) => x.key === m)?.label || m,
              }))}
              onChange={setSortField}
            />
            <Typography.Text type="secondary">图</Typography.Text>
            <Segmented
              value={chartKind}
              onChange={(v) => setChartKind(v as ChartKind)}
              options={[
                { value: "bar", label: "柱状" },
                { value: "line", label: "折线" },
                { value: "table", label: "仅表" },
              ]}
            />
          </Space>
          <Space wrap>
            <Select
              mode="multiple"
              allowClear
              placeholder="班组"
              style={{ minWidth: 140 }}
              options={meta?.filters.teams}
              value={filters.team_ids}
              onChange={(v) => setFilters((f) => ({ ...f, team_ids: v }))}
            />
            <Select
              mode="multiple"
              allowClear
              placeholder="班次"
              style={{ minWidth: 120 }}
              options={meta?.filters.shifts}
              value={filters.shift_family_ids}
              onChange={(v) => setFilters((f) => ({ ...f, shift_family_ids: v }))}
            />
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="工序"
              style={{ minWidth: 140 }}
              options={meta?.filters.processes}
              value={filters.process_names}
              onChange={(v) => setFilters((f) => ({ ...f, process_names: v }))}
            />
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="人员"
              style={{ minWidth: 140 }}
              options={meta?.filters.persons}
              value={filters.person_ids}
              onChange={(v) => setFilters((f) => ({ ...f, person_ids: v }))}
            />
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="设备"
              style={{ minWidth: 140 }}
              options={meta?.filters.equipments}
              value={filters.equipment_ids}
              onChange={(v) => setFilters((f) => ({ ...f, equipment_ids: v }))}
            />
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="产品"
              style={{ minWidth: 140 }}
              options={meta?.filters.products}
              value={filters.products}
              onChange={(v) => setFilters((f) => ({ ...f, products: v }))}
            />
          </Space>
        </Space>
      </Card>

      {drillPath.length ? (
        <Space style={{ marginBottom: 12 }} wrap>
          <Breadcrumb
            items={[
              {
                title: (
                  <a
                    onClick={() => {
                      resetDrill();
                      void runQuery(groupBy);
                    }}
                  >
                    全部
                  </a>
                ),
              },
              ...drillPath.map((s, i) => ({
                title:
                  i === drillPath.length - 1 ? (
                    s.label
                  ) : (
                    <a onClick={() => popDrill(i + 1)}>{s.label}</a>
                  ),
              })),
            ]}
          />
          <Tag color="blue">已下钻 {drillPath.length} 层</Tag>
          <Button size="small" onClick={() => { resetDrill(); void runQuery(); }}>
            清除下钻
          </Button>
        </Space>
      ) : null}

      <KpiRow items={kpis} loading={querying && !result} />

      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        当前：{activeRange[0].format("YYYY-MM-DD")} ~ {activeRange[1].format("YYYY-MM-DD")}
        {" · "}维度 {groupBy.join(" × ") || "—"}
        {" · "}事实行 {result?.fact_count ?? 0}
        {result?.truncated ? "（结果已截断）" : ""}
        {meta?.std_process_count != null
          ? ` · 已维护标准工序 ${meta.std_process_count}`
          : ""}
      </Typography.Paragraph>

      <Row gutter={[16, 16]}>
        {chartKind !== "table" ? (
          <Col xs={24} lg={12}>
            <Card size="small" title="图表" loading={querying && !result}>
              {(result?.rows.length ?? 0) > 0 ? (
                <ReactECharts
                  option={chartOption}
                  style={{ height: 320, width: "100%" }}
                  notMerge
                  lazyUpdate
                />
              ) : (
                <Typography.Text type="secondary">暂无数据</Typography.Text>
              )}
            </Card>
          </Col>
        ) : null}
        <Col xs={24} lg={chartKind === "table" ? 24 : 12}>
          <Card size="small" title="明细" loading={querying && !result}>
            <Table
              size="small"
              rowKey={(_, i) => String(i)}
              dataSource={result?.rows ?? []}
              columns={tableColumns}
              scroll={{ x: 960 }}
              pagination={{ pageSize: 20 }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
