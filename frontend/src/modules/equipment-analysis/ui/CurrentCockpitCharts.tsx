import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Col, Row } from "antd";
import type { ChartBlockItem } from "@/components/blocks";
import { CockpitPanel, stretchCol, stretchWrap } from "@/modules/equipment-analysis/ui/CockpitPanel";

const RUN_COLORS = ["#36cfc9", "#597ef7", "#8c8c8c", "#ff4d4f"];
const HEALTH_COLORS = ["#52c41a", "#faad14", "#ff4d4f"];
const TYPE_GRADIENT = ["#1677ff", "#36cfc9", "#9254de", "#fa8c16", "#eb2f96", "#13c2c2"];

function RunRoseChart({
  points,
  total,
  loading,
  height = 260,
}: {
  points: ChartBlockItem["points"];
  total: number;
  loading?: boolean;
  height?: number;
}) {
  const data = points.filter((p) => p.value > 0);
  const option: EChartsOption = useMemo(
    () => ({
      color: RUN_COLORS,
      tooltip: { trigger: "item", formatter: "{b}: {c} 台 ({d}%)" },
      legend: { bottom: 0, type: "scroll" },
      series: [
        {
          type: "pie",
          radius: ["42%", "68%"],
          center: ["50%", "46%"],
          roseType: "radius",
          itemStyle: {
            borderRadius: 6,
            borderColor: "#fff",
            borderWidth: 2,
            shadowBlur: 12,
            shadowColor: "rgba(22, 119, 255, 0.25)",
          },
          label: { formatter: "{b}\n{c}" },
          data: data.map((p) => ({ name: p.label, value: p.value })),
        },
      ],
      graphic: [
        {
          type: "text",
          left: "center",
          top: "40%",
          style: {
            text: `${total}`,
            fill: "#262626",
            fontSize: 22,
            fontWeight: 700,
            align: "center",
          },
        },
        {
          type: "text",
          left: "center",
          top: "50%",
          style: { text: "设备总数", fill: "#8c8c8c", fontSize: 12, align: "center" },
        },
      ],
    }),
    [data, total],
  );
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}

function HealthPolarChart({
  points,
  loading,
  height = 260,
}: {
  points: ChartBlockItem["points"];
  loading?: boolean;
  height?: number;
}) {
  const maxVal = Math.max(...points.map((p) => p.value), 1);
  const option: EChartsOption = useMemo(
    () => ({
      color: HEALTH_COLORS,
      angleAxis: { max: maxVal * 1.15, show: false },
      radiusAxis: {
        type: "category",
        data: points.map((p) => p.label),
        z: 10,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { margin: 8 },
      },
      polar: { radius: ["18%", "82%"] },
      tooltip: { trigger: "item" },
      series: [
        {
          type: "bar",
          data: points.map((p, i) => ({
            value: p.value,
            itemStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 1,
                y2: 0,
                colorStops: [
                  { offset: 0, color: HEALTH_COLORS[i] },
                  { offset: 1, color: `${HEALTH_COLORS[i]}88` },
                ],
              },
              borderRadius: [0, 8, 8, 0],
            },
          })),
          coordinateSystem: "polar",
          barWidth: 14,
          label: { show: true, position: "end", formatter: "{c} 台" },
        },
      ],
    }),
    [points, maxVal],
  );
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}

function TypeGradientBar({
  points,
  loading,
  height = 260,
}: {
  points: ChartBlockItem["points"];
  loading?: boolean;
  height?: number;
}) {
  const sorted = useMemo(() => [...points].sort((a, b) => a.value - b.value), [points]);
  const option: EChartsOption = useMemo(
    () => ({
      grid: { left: 72, right: 24, top: 16, bottom: 16 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: {
        type: "value",
        splitLine: { lineStyle: { type: "dashed" } },
      },
      yAxis: {
        type: "category",
        data: sorted.map((p) => p.label),
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar",
          data: sorted.map((p, i) => ({
            value: p.value,
            itemStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 1,
                y2: 0,
                colorStops: [
                  { offset: 0, color: TYPE_GRADIENT[i % TYPE_GRADIENT.length] },
                  { offset: 1, color: "#69b1ff" },
                ],
              },
              borderRadius: [0, 8, 8, 0],
            },
          })),
          barWidth: 16,
          label: { show: true, position: "right" },
        },
      ],
    }),
    [sorted],
  );
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}

function DeptPictorialBar({
  points,
  loading,
  height = 260,
}: {
  points: ChartBlockItem["points"];
  loading?: boolean;
  height?: number;
}) {
  const option: EChartsOption = useMemo(
    () => ({
      grid: { left: 40, right: 16, top: 28, bottom: 40 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: points.map((p) => p.label),
        axisLabel: {
          interval: 0,
          rotate: points.length > 4 ? 18 : 0,
        },
      },
      yAxis: {
        type: "value",
        name: "台",
      },
      series: [
        {
          type: "pictorialBar",
          symbol: "roundRect",
          symbolRepeat: true,
          symbolSize: [18, 6],
          symbolMargin: 2,
          data: points.map((p) => ({
            value: p.value,
            itemStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 1,
                x2: 0,
                y2: 0,
                colorStops: [
                  { offset: 0, color: "#ff7875" },
                  { offset: 1, color: "#ff4d4f" },
                ],
              },
            },
          })),
        },
      ],
    }),
    [points],
  );
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}

function TrendGlowLine({
  points,
  loading,
  height = 260,
}: {
  points: ChartBlockItem["points"];
  loading?: boolean;
  height?: number;
}) {
  const values = points.map((p) => p.value);
  const peak = values.length ? Math.max(...values) : 0;
  const peakIdx = values.indexOf(peak);
  const option: EChartsOption = useMemo(
    () => ({
      grid: { left: 44, right: 20, top: 32, bottom: 28 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: points.map((p) => p.label),
      },
      yAxis: {
        type: "value",
        name: "台",
        splitLine: { lineStyle: { type: "dashed" } },
      },
      series: [
        {
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 8,
          data: values,
          lineStyle: {
            width: 3,
            color: "#1677ff",
            shadowColor: "rgba(22,119,255,0.45)",
            shadowBlur: 12,
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(22, 119, 255, 0.45)" },
                { offset: 1, color: "rgba(22, 119, 255, 0.02)" },
              ],
            },
          },
          markPoint:
            peakIdx >= 0
              ? {
                  data: [{ name: "峰值", coord: [peakIdx, peak], value: peak }],
                  symbolSize: 48,
                  itemStyle: { color: "#ff4d4f" },
                  label: { color: "#fff" },
                }
              : undefined,
        },
      ],
    }),
    [points, values, peak, peakIdx],
  );
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}

function renderChart(item: ChartBlockItem, total: number, loading?: boolean, height?: number) {
  switch (item.id) {
    case "run_pie":
      return <RunRoseChart points={item.points} total={total} loading={loading} height={height} />;
    case "health_pie":
      return <HealthPolarChart points={item.points} loading={loading} height={height} />;
    case "type_bar":
      return <TypeGradientBar points={item.points} loading={loading} height={height} />;
    case "dept_issue_bar":
      return <DeptPictorialBar points={item.points} loading={loading} height={height} />;
    case "abnormal_trend_7d":
      return <TrendGlowLine points={item.points} loading={loading} height={height} />;
    default:
      return null;
  }
}

export function CockpitChartRow({
  items,
  total,
  loading,
  height = 260,
}: {
  items: ChartBlockItem[];
  total: number;
  loading?: boolean;
  height?: number;
}) {
  if (!items.length) return null;

  return (
    <Row gutter={[16, 16]} align="stretch" style={{ marginBottom: 16 }}>
      {items.map((item) => (
        <Col key={item.id} xs={24} lg={item.span ?? 12} style={stretchCol}>
          <div style={stretchWrap}>
            <CockpitPanel title={item.title} loading={loading} bodyMinHeight={height}>
              {renderChart(item, total, loading, height)}
            </CockpitPanel>
          </div>
        </Col>
      ))}
    </Row>
  );
}
