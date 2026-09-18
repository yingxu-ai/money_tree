import { useCallback, useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import type { FleetStatusTrendData, IssueViewTab } from "@/api/equipmentAnalysis";
import {
  buildFleetChartTitle,
  buildFleetDeviceStateYAxis,
  buildFleetScrollLegend,
  buildFleetTrendGrid,
  buildTrendDataZoom,
  buildTrendXAxis,
  resolveTrendAxis,
} from "@/pages/equipment-analysis/fleetTrendAxis";

const TAB_LABELS: Record<IssueViewTab, string> = {
  abnormal: "异常",
  watch: "关注",
  fault: "故障",
  all: "有问题",
};

const DEVICE_PALETTE = ["#1677ff", "#36cfc9", "#9254de", "#fa8c16", "#eb2f96", "#52c41a", "#13c2c2"];
const TOP_N = 5;

export function FleetIssueDeviceTrendChart({
  data,
  tab,
  loading,
  height = 300,
  onActiveKeysChange,
}: {
  data?: FleetStatusTrendData;
  tab: IssueViewTab;
  loading?: boolean;
  height?: number;
  onActiveKeysChange?: (keys: string[]) => void;
}) {
  const series = data?.series ?? [];
  const stateLabel = TAB_LABELS[tab];
  const [activeKeys, setActiveKeys] = useState<Set<string>>(() => new Set());

  const deviceColor = useCallback(
    (index: number, active: boolean) =>
      active ? DEVICE_PALETTE[index % DEVICE_PALETTE.length] : "#bfbfbf",
    [],
  );

  useEffect(() => {
    const items = data?.series;
    if (!items?.length) {
      setActiveKeys(new Set());
      return;
    }
    setActiveKeys(new Set(items.slice(0, TOP_N).map((s) => s.key)));
  }, [data]);

  useEffect(() => {
    onActiveKeysChange?.([...activeKeys]);
  }, [activeKeys, onActiveKeysChange]);

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
        valueFormatter: (v) => (Number(v) >= 1 ? stateLabel : "正常"),
      },
      legend: buildFleetScrollLegend(series, activeKeys, deviceColor, hasSummary),
      dataZoom: zoom.dataZoom,
      xAxis: buildTrendXAxis(axis),
      yAxis: buildFleetDeviceStateYAxis(stateLabel),
      series: series.map((s, i) => {
        const active = activeKeys.has(s.key);
        const color = deviceColor(i, active);
        return {
          name: s.name,
          type: "line",
          step: "end",
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
  }, [data, series, activeKeys, stateLabel, deviceColor]);

  return (
    <ReactECharts
      option={option}
      onEvents={onEvents}
      showLoading={loading}
      style={{ height, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}
