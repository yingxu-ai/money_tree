import type { CSSProperties } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

export interface ChartPoint {
  label: string;
  value: number;
}

export interface BaseChartProps {
  height?: number | string;
  loading?: boolean;
  style?: CSSProperties;
  className?: string;
}

function toPairs(data: ChartPoint[] | { labels: string[]; values: number[] }): ChartPoint[] {
  if (Array.isArray(data)) return data;
  return data.labels.map((label, i) => ({ label, value: data.values[i] ?? 0 }));
}

export function LineChart({
  data,
  unit = "",
  height = 220,
  loading,
  style,
  className,
}: BaseChartProps & {
  data: ChartPoint[] | { labels: string[]; values: number[] };
  unit?: string;
}) {
  const points = toPairs(data);
  const option: EChartsOption = {
    grid: { left: 40, right: 16, top: 28, bottom: 28 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: points.map((p) => p.label),
      boundaryGap: false,
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: unit ? `{value}${unit}` : "{value}" },
    },
    series: [
      {
        type: "line",
        smooth: true,
        data: points.map((p) => p.value),
        areaStyle: { opacity: 0.12 },
        symbolSize: 6,
      },
    ],
  };
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height, width: "100%", ...style }}
      className={className}
      notMerge
      lazyUpdate
    />
  );
}

export function BarChart({
  data,
  unit = "",
  height = 220,
  loading,
  style,
  className,
}: BaseChartProps & {
  data: ChartPoint[] | { labels: string[]; values: number[] };
  unit?: string;
}) {
  const points = toPairs(data);
  const option: EChartsOption = {
    grid: { left: 40, right: 16, top: 28, bottom: 28 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: points.map((p) => p.label) },
    yAxis: {
      type: "value",
      axisLabel: { formatter: unit ? `{value}${unit}` : "{value}" },
    },
    series: [
      {
        type: "bar",
        data: points.map((p) => p.value),
        barMaxWidth: 36,
      },
    ],
  };
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height, width: "100%", ...style }}
      className={className}
      notMerge
      lazyUpdate
    />
  );
}

export function PieChart({
  data,
  height = 220,
  loading,
  style,
  className,
  legendPosition = "bottom",
}: BaseChartProps & {
  data: ChartPoint[];
  /** bottom=底栏；right=右侧（条目多、易重叠时更合适） */
  legendPosition?: "bottom" | "right";
}) {
  const legendRight = legendPosition === "right";
  const option: EChartsOption = {
    tooltip: { trigger: "item", formatter: "{b}<br/>{c}（{d}%）" },
    legend: legendRight
      ? {
          type: "scroll",
          orient: "vertical",
          right: 8,
          top: "middle",
          itemWidth: 10,
          itemHeight: 10,
          textStyle: { fontSize: 12 },
        }
      : { bottom: 0, type: "scroll" },
    series: [
      {
        type: "pie",
        radius: legendRight ? ["38%", "62%"] : ["40%", "65%"],
        center: legendRight ? ["38%", "50%"] : ["50%", "46%"],
        avoidLabelOverlap: true,
        data: data.map((p) => ({ name: p.label, value: p.value })),
        label: legendRight
          ? {
              show: true,
              formatter: "{d}%",
              fontSize: 11,
            }
          : {
              show: true,
              formatter: "{b}\n{d}%",
              fontSize: 11,
            },
        labelLine: { length: 12, length2: 8 },
        emphasis: {
          itemStyle: { shadowBlur: 8, shadowOffsetX: 0, shadowColor: "rgba(0,0,0,0.15)" },
        },
      },
    ],
  };
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height, width: "100%", ...style }}
      className={className}
      notMerge
      lazyUpdate
    />
  );
}
