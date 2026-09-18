import { useCallback, useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Segmented } from "antd";
import type { FleetStatusTrendPeriod, FleetTypeTrends } from "@/api/equipmentAnalysis";
import { CockpitPanel } from "@/pages/equipment-analysis/CockpitPanel";
import {
  buildFleetChartTitle,
  buildFleetScrollLegend,
  buildFleetTrendGrid,
  buildFleetYAxis,
  buildTrendDataZoom,
  buildTrendXAxis,
  resolveTrendAxis,
} from "@/pages/equipment-analysis/fleetTrendAxis";

const PERIOD_OPTIONS: { label: string; value: FleetStatusTrendPeriod }[] = [
  { label: "周", value: "week" },
  { label: "月", value: "month" },
  { label: "季", value: "quarter" },
  { label: "年", value: "year" },
];

const TYPE_PALETTE = ["#1677ff", "#36cfc9", "#9254de", "#fa8c16", "#eb2f96", "#52c41a", "#13c2c2"];
const TOP_N = 5;

export function FleetTypeTrendChart({
  trends,
  loading,
  height = 320,
}: {
  trends?: FleetTypeTrends;
  loading?: boolean;
  height?: number;
}) {
  const [period, setPeriod] = useState<FleetStatusTrendPeriod>("week");
  const [activeKeys, setActiveKeys] = useState<Set<string>>(() => new Set());
  const data = trends?.[period];
  const series = data?.series ?? [];

  const typeColor = useCallback(
    (index: number, active: boolean) =>
      active ? TYPE_PALETTE[index % TYPE_PALETTE.length] : "#bfbfbf",
    [],
  );

  useEffect(() => {
    const items = trends?.[period]?.series;
    if (!items?.length) {
      setActiveKeys(new Set());
      return;
    }
    setActiveKeys(new Set(items.slice(0, TOP_N).map((s) => s.key)));
  }, [period, trends]);

  const toggleActive = useCallback((key: string) => {
    setActiveKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const onEvents = useMemo(
    () => ({
      legendselectchanged: (params: { name: string }) => {
        const item = series.find((s) => s.name === params.name);
        if (item) toggleActive(item.key);
      },
    }),
    [series, toggleActive],
  );

  const option: EChartsOption = useMemo(() => {
    if (!data || !series.length) return {};
    const axis = resolveTrendAxis(data);
    const zoom = buildTrendDataZoom(axis.categories.length);
    const hasSummary = Boolean(data.summary);
    return {
      title: buildFleetChartTitle(data.summary),
      grid: buildFleetTrendGrid(zoom.gridBottom, hasSummary),
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
      },
      legend: buildFleetScrollLegend(series, activeKeys, typeColor, hasSummary),
      dataZoom: zoom.dataZoom,
      xAxis: buildTrendXAxis(axis),
      yAxis: buildFleetYAxis(),
      series: series.map((s, i) => {
        const active = activeKeys.has(s.key);
        const color = typeColor(i, active);
        return {
          name: s.name,
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: active ? 5 : 0,
          showSymbol: active && axis.categories.length <= 31,
          lineStyle: { width: active ? 2.5 : 1, color, opacity: active ? 1 : 0.45 },
          itemStyle: { color },
          emphasis: { focus: "series" },
          data: s.values,
        };
      }),
    };
  }, [data, series, activeKeys, typeColor]);

  return (
    <CockpitPanel
      title="设备类型分布"
      loading={loading}
      bodyMinHeight={height + 16}
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
        <div style={{ flex: 1, minHeight: 0, height: "100%", overflow: "visible" }}>
          <ReactECharts
            option={option}
            onEvents={onEvents}
            showLoading={loading}
            style={{ height: h, width: "100%" }}
            notMerge
            lazyUpdate
          />
        </div>
      )}
    </CockpitPanel>
  );
}
