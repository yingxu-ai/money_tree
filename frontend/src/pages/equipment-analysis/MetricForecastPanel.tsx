import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Card, Col, Row, Segmented, Space, Tag, Typography } from "antd";
import { CockpitPanel } from "@/pages/equipment-analysis/CockpitPanel";

export type MetricPeriod = "week" | "month" | "quarter" | "year";

export interface MetricForecastPoint {
  label: string;
  value: number | null;
  kind?: string;
}

export interface MetricForecastItem {
  code: string;
  label: string;
  unit: string;
  status: string;
  actual: MetricForecastPoint[];
  forecast_7d: MetricForecastPoint[];
  forecast_long?: MetricForecastPoint[];
  band_low?: number;
  band_high?: number;
  judgment: string;
  horizon_note?: string;
  risk_hint?: string | null;
  actual_n?: number;
  extend_n?: number;
  total_n?: number;
}

export interface MetricChartMeta {
  title?: string;
  note?: string;
  default_period?: MetricPeriod | string;
  period_options?: Array<{ value: string; label: string }>;
}

const STATUS_TAG: Record<string, { color: string; text: string }> = {
  normal: { color: "green", text: "正常" },
  watch: { color: "orange", text: "关注" },
  abnormal: { color: "red", text: "异常" },
};

const METRIC_COLORS: Record<string, string> = {
  vib_host: "#1677ff",
  bearing_temp: "#cf1322",
  motor_i: "#389e0d",
  exhaust_temp: "#d48806",
};

const METRIC_ORDER = ["vib_host", "bearing_temp", "motor_i", "exhaust_temp"];

const DEFAULT_PERIOD_OPTS = [
  { value: "week", label: "周" },
  { value: "month", label: "月" },
  { value: "quarter", label: "季" },
  { value: "year", label: "年" },
];

function MultiYMetricChart({
  items,
  height,
  width,
}: {
  items: MetricForecastItem[];
  height: number;
  width?: number;
}) {
  const ordered = useMemo(() => {
    const byCode = new Map(items.map((i) => [i.code, i]));
    const list = METRIC_ORDER.map((c) => byCode.get(c)).filter(Boolean) as MetricForecastItem[];
    return list.length ? list : items.slice(0, 4);
  }, [items]);

  const option: EChartsOption = useMemo(() => {
    const labels =
      ordered[0]?.forecast_7d?.map((p) => p.label) ??
      ordered[0]?.actual.map((p) => p.label) ??
      [];
    const actualN = ordered[0]?.actual_n ?? labels.length;
    const legendNames = ordered.map((m) => m.label);

    const yAxis = ordered.map((m, idx) => {
      const offset = Math.floor(idx / 2) * 56;
      return {
        type: "value" as const,
        name: `${m.label}\n(${m.unit})`,
        position: idx % 2 === 0 ? ("left" as const) : ("right" as const),
        offset,
        scale: true,
        alignTicks: true,
        axisLine: { show: true, lineStyle: { color: METRIC_COLORS[m.code] || "#1677ff" } },
        axisLabel: { color: METRIC_COLORS[m.code] || "#1677ff", fontSize: 10 },
        nameTextStyle: { fontSize: 10, color: METRIC_COLORS[m.code] || "#1677ff" },
        splitLine: { show: idx === 0 },
      };
    });

    // 同 name → 图例合并；点一次同时显隐实测+预测
    const series = ordered.flatMap((m, yi) => {
      const color = METRIC_COLORS[m.code] || "#1677ff";
      const forecast = m.forecast_7d?.length ? m.forecast_7d : m.actual;
      return [
        {
          name: m.label,
          type: "line" as const,
          yAxisIndex: yi,
          showSymbol: false,
          data: m.actual.map((p) => p.value),
          connectNulls: false,
          lineStyle: { width: 2.2, type: "solid" as const, color },
          itemStyle: { color },
        },
        {
          name: m.label,
          type: "line" as const,
          yAxisIndex: yi,
          showSymbol: false,
          data: forecast.map((p) => p.value),
          lineStyle: { width: 2, type: "dashed" as const, color },
          itemStyle: { color },
        },
      ];
    });

    const leftAxes = Math.ceil(ordered.length / 2);
    const rightAxes = Math.floor(ordered.length / 2);
    return {
      animation: false,
      color: ordered.map((m) => METRIC_COLORS[m.code] || "#1677ff"),
      legend: {
        type: "scroll",
        top: 0,
        data: legendNames,
        selectedMode: true,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        formatter: (params: unknown) => {
          const list = params as Array<{
            seriesName?: string;
            seriesIndex?: number;
            axisValueLabel?: string;
            marker?: string;
            data?: number | null;
          }>;
          if (!Array.isArray(list) || !list.length) return "";
          const head = list[0]?.axisValueLabel ?? "";
          const lines = [head];
          for (const p of list) {
            const isForecast = (p.seriesIndex ?? 0) % 2 === 1;
            const kind = isForecast ? "预测" : "实测";
            const v = p.data == null ? "—" : p.data;
            lines.push(`${p.marker ?? ""}${p.seriesName}·${kind}: ${v}`);
          }
          return lines.join("<br/>");
        },
      },
      grid: {
        left: 24 + leftAxes * 52,
        right: 24 + rightAxes * 52,
        top: 48,
        bottom: 48,
      },
      dataZoom: [
        { type: "inside", xAxisIndex: 0 },
        { type: "slider", xAxisIndex: 0, height: 18, bottom: 8 },
      ],
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
        axisLabel: { fontSize: 10 },
        axisPointer: { label: { show: true } },
      },
      series: [
        ...series.map((s, idx) =>
          idx === 0 && actualN > 0 && actualN < labels.length
            ? {
                ...s,
                markLine: {
                  silent: true,
                  symbol: "none" as const,
                  label: { formatter: "实测结束 / 仅预测", position: "insideEndTop" as const, fontSize: 10 },
                  lineStyle: { type: "dotted" as const, color: "#8c8c8c", width: 1.2 },
                  data: [{ xAxis: labels[actualN - 1] }],
                },
              }
            : s,
        ),
      ],
      yAxis,
    };
  }, [ordered]);

  return (
    <ReactECharts
      option={option}
      style={{ height, width: width ? width : "100%" }}
      notMerge
      lazyUpdate
    />
  );
}

export function MetricForecastPanel({
  items,
  itemsByPeriod,
  chartMeta,
  loading,
  onOpenEvidence,
  onOpenFuture,
  schematic,
}: {
  items?: MetricForecastItem[] | null;
  itemsByPeriod?: Partial<Record<MetricPeriod, MetricForecastItem[]>> | null;
  chartMeta?: MetricChartMeta | null;
  loading?: boolean;
  onOpenEvidence?: () => void;
  onOpenFuture?: () => void;
  schematic?: ReactNode;
}) {
  const periodOptions = chartMeta?.period_options?.length
    ? chartMeta.period_options
    : DEFAULT_PERIOD_OPTS;
  const defaultPeriod = (chartMeta?.default_period as MetricPeriod) || "month";
  const [period, setPeriod] = useState<MetricPeriod>(defaultPeriod);

  const activeItems = useMemo(() => {
    const fromPeriod = itemsByPeriod?.[period];
    if (fromPeriod?.length) return fromPeriod;
    return items ?? [];
  }, [items, itemsByPeriod, period]);

  if (!activeItems.length && !schematic) return null;

  const sample = activeItems[0];
  const periodHint =
    sample?.actual_n != null && sample?.extend_n != null
      ? `实测窗 ${sample.actual_n} 点 · 预测后延 ${sample.extend_n} 点（约 1/3）· 轴共 ${sample.total_n} 点`
      : chartMeta?.note;

  return (
    <div>
      {schematic}

      {activeItems.length ? (
        <>
          <CockpitPanel
            title={chartMeta?.title ?? "关键参数 · 实测 vs 预测（多 Y 轴）"}
            loading={loading}
            fullscreenable
            bodyMinHeight={420}
            extra={
              <Space wrap>
                <Segmented
                  size="small"
                  value={period}
                  onChange={(v) => setPeriod(v as MetricPeriod)}
                  options={periodOptions.map((o) => ({ value: o.value, label: o.label }))}
                />
                {onOpenEvidence ? (
                  <Typography.Link onClick={onOpenEvidence}>证据 →</Typography.Link>
                ) : null}
                {onOpenFuture ? (
                  <Typography.Link onClick={onOpenFuture}>处置 →</Typography.Link>
                ) : null}
              </Space>
            }
          >
            {({ height, width }) => (
              <MultiYMetricChart
                items={activeItems}
                height={typeof height === "number" ? height : 400}
                width={width}
              />
            )}
          </CockpitPanel>

          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
            图例仅四个参数（点击显隐该参数的实测+预测）。实线=实测，虚线=预测。
            {periodHint ? ` ${periodHint}` : ""}
            {" "}竖虚线右侧为仅预测段（实测无数据）。
          </Typography.Paragraph>

          <Row gutter={[12, 12]} style={{ marginTop: 8 }}>
            {activeItems.map((item) => {
              const st = STATUS_TAG[item.status] ?? { color: "default", text: item.status };
              return (
                <Col xs={24} md={12} key={item.code}>
                  <Card
                    size="small"
                    title={
                      <Space>
                        <span>{item.label}</span>
                        <Tag color={st.color}>{st.text}</Tag>
                      </Space>
                    }
                  >
                    <Typography.Paragraph style={{ marginBottom: 0 }}>{item.judgment}</Typography.Paragraph>
                    {item.risk_hint ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        关联：{item.risk_hint}
                      </Typography.Text>
                    ) : null}
                  </Card>
                </Col>
              );
            })}
          </Row>
        </>
      ) : null}
    </div>
  );
}
