import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import type { FleetSunburstNode } from "@/modules/equipment-analysis/api/equipmentAnalysis";
import { CockpitPanel } from "@/modules/equipment-analysis/ui/CockpitPanel";

const COLORS = ["#FFAE57", "#FF7853", "#EA5151", "#CC3F57", "#9A2555", "#5470c6", "#91cc75"];
const BG = "#2E2733";

function buildSunburstOption(data: FleetSunburstNode[], viewScale: number): EChartsOption {
  const fs = Math.max(1, viewScale);
  const font = (n: number) => Math.round(n * (0.85 + fs * 0.35));
  return {
    backgroundColor: BG,
    color: COLORS,
    tooltip: {
      trigger: "item",
      formatter: (p: unknown) => {
        const item = p as { name?: string; value?: number; treePathInfo?: { name: string }[] };
        const path = (item.treePathInfo ?? [])
          .slice(1)
          .map((n) => n.name)
          .join(" / ");
        const v = item.value ?? 0;
        return `${path || item.name}<br/>台数：${v}`;
      },
    },
    series: [
      {
        type: "sunburst",
        center: ["50%", "50%"],
        radius: ["0%", "92%"],
        data,
        sort: (a, b) => {
          if (a.depth === 1) return b.getValue() - a.getValue();
          return a.dataIndex - b.dataIndex;
        },
        label: {
          rotate: "radial",
          color: BG,
          minAngle: fs >= 2 ? 1 : 4,
        },
        itemStyle: {
          borderColor: BG,
          borderWidth: Math.max(1, Math.round(2 * Math.min(fs, 2))),
        },
        levels: [
          {},
          {
            // 百分比半径：随画布放大而放大，避免写死像素导致全屏仍看不清
            r0: "0%",
            r: "16%",
            label: { rotate: 0, color: "#fff", fontSize: font(14), fontWeight: 600 },
          },
          {
            r0: "16%",
            r: "40%",
            label: { rotate: "radial", color: BG, fontSize: font(12) },
          },
          {
            // 组织树多为 3 层：部门→末级→设备类型，最外圈实际是这一级
            r0: "42%",
            r: "62%",
            label: {
              rotate: "radial",
              position: "outside",
              fontSize: font(11),
              color: COLORS[0],
              distance: Math.round(6 + fs * 3),
            },
            itemStyle: {
              shadowBlur: 2,
              shadowColor: COLORS[2],
            },
          },
          {
            r0: "62%",
            r: "72%",
            label: {
              rotate: "radial",
              position: "outside",
              fontSize: font(11),
              color: "#f5e6d3",
              textShadowBlur: 4,
              textShadowColor: "#333",
              distance: Math.round(6 + fs * 3),
            },
          },
        ],
      },
    ],
  };
}

export function DeviceFleetSunburstChart({
  data,
  loading,
  height = 420,
}: {
  data?: FleetSunburstNode[];
  loading?: boolean;
  height?: number;
}) {
  return (
    <CockpitPanel
      title="设备结构分布"
      loading={loading}
      bodyMinHeight={height}
      fullscreenable
      extra={<span style={{ color: "rgba(0,0,0,0.45)", fontSize: 12 }}>组织层级 → 设备类型</span>}
    >
      {({ height: h, width, viewScale = 1 }) => {
        if (!data?.length) {
          return <div style={{ color: "rgba(0,0,0,0.45)", padding: 24 }}>当前范围内无设备</div>;
        }
        return (
          <SunburstChartBody
            data={data}
            height={h}
            width={width}
            viewScale={viewScale}
          />
        );
      }}
    </CockpitPanel>
  );
}

function SunburstChartBody({
  data,
  height,
  width,
  viewScale,
}: {
  data: FleetSunburstNode[];
  height: number | string;
  width?: number;
  viewScale: number;
}) {
  const option = useMemo(
    () => buildSunburstOption(data, viewScale),
    [data, viewScale],
  );
  const h = typeof height === "number" ? height : height;
  const w = width ?? "100%";
  // scale 变化时强制重挂载，保证按新尺寸/字号重新渲染
  const chartKey = `sunburst-${viewScale.toFixed(2)}-${typeof height === "number" ? height : "auto"}`;

  return (
    <ReactECharts
      key={chartKey}
      option={option}
      style={{ height: h, width: w }}
      opts={{ renderer: "canvas" }}
      notMerge
      lazyUpdate
    />
  );
}
