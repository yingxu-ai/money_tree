import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Segmented } from "antd";
import type { FleetStatusTrendPeriod, FleetStatusTrends } from "@/modules/equipment-analysis/api/equipmentAnalysis";
import { CockpitPanel } from "@/modules/equipment-analysis/ui/CockpitPanel";
import {
  buildTrendDataZoom,
  buildTrendXAxis,
  resolveTrendAxis,
} from "@/modules/equipment-analysis/ui/fleetTrendAxis";

const PERIOD_OPTIONS: { label: string; value: FleetStatusTrendPeriod }[] = [
  { label: "周", value: "week" },
  { label: "月", value: "month" },
  { label: "季", value: "quarter" },
  { label: "年", value: "year" },
];

const SERIES_COLORS: Record<string, string> = {
  total: "#8c8c8c",
  online: "#1677ff",
  running: "#36cfc9",
  abnormal: "#ff4d4f",
  watch: "#faad14",
  fault: "#cf1322",
};

export function FleetStatusTrendChart({
  trends,
  loading,
  height = 320,
}: {
  trends?: FleetStatusTrends;
  loading?: boolean;
  height?: number;
}) {
  const [period, setPeriod] = useState<FleetStatusTrendPeriod>("week");
  const data = trends?.[period];

  const option: EChartsOption = useMemo(() => {
    if (!data) return {};
    const axis = resolveTrendAxis(data);
    const zoom = buildTrendDataZoom(axis.categories.length);
    return {
      grid: { left: 48, right: 24, top: 48, bottom: zoom.gridBottom },
      tooltip: { trigger: "axis" },
      legend: {
        type: "scroll",
        top: 0,
        data: data.series.map((s) => s.name),
      },
      dataZoom: zoom.dataZoom,
      xAxis: buildTrendXAxis(axis),
      yAxis: {
        type: "value",
        name: "台",
        nameGap: 12,
        minInterval: 1,
        splitLine: { lineStyle: { type: "dashed", opacity: 0.35 } },
      },
      series: data.series.map((s) => ({
        name: s.name,
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        showSymbol: axis.categories.length <= 31,
        lineStyle: { width: 2.5 },
        emphasis: { focus: "series" },
        data: s.values,
        itemStyle: { color: SERIES_COLORS[s.key] ?? "#1677ff" },
      })),
    };
  }, [data]);

  return (
    <CockpitPanel
      title="设备状态趋势"
      loading={loading}
      bodyMinHeight={height}
      fullscreenable
      extra={
        <Segmented
          size="small"
          options={PERIOD_OPTIONS}
          value={period}
          onChange={(v) => setPeriod(v as FleetStatusTrendPeriod)}
        />
      }
    >
      {({ height: h }) => (
        <ReactECharts
          option={option}
          showLoading={loading}
          style={{ height: h, width: "100%" }}
          notMerge
          lazyUpdate
        />
      )}
    </CockpitPanel>
  );
}
