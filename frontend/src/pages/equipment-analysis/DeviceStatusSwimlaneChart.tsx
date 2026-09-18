import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { CustomSeriesRenderItemAPI, CustomSeriesRenderItemParams, EChartsOption } from "echarts";
import type { CompareAxisMeta, CompareDeviceRow, StatusLegendItem } from "@/api/equipmentAnalysis";
import {
  buildFleetTrendGrid,
  buildTrendDataZoom,
  buildTrendXAxis,
  resolveTrendAxis,
} from "@/pages/equipment-analysis/fleetTrendAxis";

const DEFAULT_STATUS_COLORS: Record<string, string> = {
  normal: "#52c41a",
  watch: "#faad14",
  abnormal: "#ff4d4f",
  fault: "#cf1322",
};

type SegmentDatum = [number, number, number, string];

function colorMap(legend: StatusLegendItem[]) {
  const map = { ...DEFAULT_STATUS_COLORS };
  for (const item of legend) {
    map[item.key] = item.color;
  }
  return map;
}

function labelMap(legend: StatusLegendItem[]) {
  const map: Record<string, string> = {};
  for (const item of legend) {
    map[item.key] = item.label;
  }
  return map;
}

export function DeviceStatusSwimlaneChart({
  devices,
  axis,
  legend,
  loading,
  height,
  onDeviceClick,
}: {
  devices: CompareDeviceRow[];
  axis: CompareAxisMeta;
  legend: StatusLegendItem[];
  loading?: boolean;
  height?: number;
  onDeviceClick?: (deviceId: string) => void;
}) {
  const colors = useMemo(() => colorMap(legend), [legend]);
  const labels = useMemo(() => labelMap(legend), [legend]);
  const chartHeight = height ?? Math.max(280, devices.length * 52 + 120);
  const clickable = Boolean(onDeviceClick);

  const option: EChartsOption = useMemo(() => {
    if (!devices.length) return {};

    const axisInput = {
      labels: axis.labels,
      day_labels: axis.day_labels,
      tick_indices: axis.tick_indices,
    };
    const resolved = resolveTrendAxis(axisInput);
    const zoom = buildTrendDataZoom(resolved.categories.length);
    const deviceNames = devices.map((d) => `${d.name}（${d.dept_name}）`);

    const segmentData: SegmentDatum[] = [];
    devices.forEach((device, deviceIndex) => {
      for (const seg of device.segments) {
        segmentData.push([deviceIndex, seg.start_index, seg.end_index + 1, seg.status]);
      }
    });

    const renderItem = (
      _params: CustomSeriesRenderItemParams,
      api: CustomSeriesRenderItemAPI,
    ) => {
      const deviceIndex = api.value(0) as number;
      const start = api.value(1) as number;
      const end = api.value(2) as number;
      const status = api.value(3) as string;
      const startCoord = api.coord([start, deviceIndex]);
      const endCoord = api.coord([end, deviceIndex]);
      const bandHeight = (api.size?.([0, 1]) as number[] | undefined)?.[1] ?? 24;
      const heightPx = bandHeight * 0.62;
      return {
        type: "rect" as const,
        shape: {
          x: startCoord[0],
          y: startCoord[1] - heightPx / 2,
          width: Math.max(endCoord[0] - startCoord[0], 2),
          height: heightPx,
        },
        style: {
          fill: colors[status] ?? "#8c8c8c",
          opacity: clickable ? 0.95 : 0.92,
          cursor: clickable ? "pointer" : "default",
        },
      };
    };

    return {
      grid: buildFleetTrendGrid(zoom.gridBottom, false),
      tooltip: {
        trigger: "item" as const,
        formatter: (p) => {
          const row = (Array.isArray(p) ? p[0] : p)?.data as SegmentDatum | undefined;
          if (!row) return "";
          const device = devices[row[0]];
          const status = row[3];
          const seg = device.segments.find(
            (s) => s.start_index === row[1] && s.end_index + 1 === row[2],
          );
          if (!seg) return "";
          const lines = [
            `<b>${device.name}</b>`,
            `${labels[status] ?? status}`,
            `${seg.start_date} ~ ${seg.end_date}`,
            `持续 ${seg.days} 天`,
          ];
          if (clickable) {
            lines.push(`<span style="color:#1677ff">点击查看详情</span>`);
          }
          return lines.join("<br/>");
        },
      },
      legend: {
        top: 8,
        left: 56,
        data: legend.map((l) => ({
          name: l.label,
          icon: "roundRect",
          itemStyle: { color: l.color },
        })),
      },
      dataZoom: zoom.dataZoom,
      xAxis: buildTrendXAxis(resolved, { name: "时间" }),
      yAxis: {
        type: "category" as const,
        data: deviceNames,
        inverse: true,
        triggerEvent: clickable,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          width: 140,
          overflow: "truncate" as const,
          color: clickable ? "#1677ff" : "rgba(0,0,0,0.88)",
        },
      },
      series: [
        {
          type: "custom" as const,
          renderItem,
          encode: { x: [1, 2], y: 0 },
          data: segmentData,
          cursor: clickable ? "pointer" : "default",
        },
      ],
    };
  }, [devices, axis, legend, colors, labels, clickable]);

  const onEvents = useMemo(() => {
    if (!onDeviceClick) return undefined;
    return {
      click: (params: {
        componentType?: string;
        data?: SegmentDatum;
        value?: string | number;
      }) => {
        if (params.componentType === "series" && params.data) {
          const device = devices[params.data[0]];
          if (device) onDeviceClick(device.id);
          return;
        }
        if (params.componentType === "yAxis" && params.value != null) {
          const label = String(params.value);
          const device = devices.find((d) => label.startsWith(`${d.name}（`));
          if (device) onDeviceClick(device.id);
        }
      },
    };
  }, [devices, onDeviceClick]);

  return (
    <ReactECharts
      option={option}
      onEvents={onEvents}
      showLoading={loading}
      style={{ height: chartHeight, width: "100%", cursor: clickable ? "pointer" : undefined }}
      notMerge
      lazyUpdate
    />
  );
}
