import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import type { FleetSankeyData } from "@/api/equipmentAnalysis";
import { CockpitPanel } from "@/pages/equipment-analysis/CockpitPanel";

function buildSankeyOption(data: FleetSankeyData, viewScale: number): EChartsOption {
  const fs = Math.max(1, viewScale);
  return {
    tooltip: {
      trigger: "item",
      triggerOn: "mousemove",
    },
    series: [
      {
        type: "sankey",
        data: data.nodes,
        links: data.links,
        emphasis: { focus: "adjacency" },
        nodeAlign: "justify",
        nodeGap: Math.round(8 + fs * 4),
        nodeWidth: Math.round(14 + fs * 4),
        layoutIterations: 32,
        label: {
          fontSize: Math.round(11 * (0.9 + fs * 0.25)),
          color: "rgba(0,0,0,0.75)",
        },
        lineStyle: {
          color: "gradient",
          curveness: 0.5,
          opacity: 0.35,
        },
      },
    ],
  };
}

export function DeviceFleetSankeyChart({
  data,
  loading,
  height = 420,
}: {
  data?: FleetSankeyData;
  loading?: boolean;
  height?: number;
}) {
  const hasData = Boolean(data?.nodes?.length && data?.links?.length);

  return (
    <CockpitPanel
      title="设备组织归属"
      loading={loading}
      bodyMinHeight={height}
      fullscreenable
      extra={<span style={{ color: "rgba(0,0,0,0.45)", fontSize: 12 }}>设备类型 → 上级 → … → 顶级</span>}
    >
      {({ height: h, width, viewScale = 1 }) => {
        if (!hasData || !data) {
          return <div style={{ color: "rgba(0,0,0,0.45)", padding: 24 }}>当前范围内无设备</div>;
        }
        return <SankeyChartBody data={data} height={h} width={width} viewScale={viewScale} />;
      }}
    </CockpitPanel>
  );
}

function SankeyChartBody({
  data,
  height,
  width,
  viewScale,
}: {
  data: FleetSankeyData;
  height: number | string;
  width?: number;
  viewScale: number;
}) {
  const option = useMemo(() => buildSankeyOption(data, viewScale), [data, viewScale]);
  const chartKey = `sankey-${viewScale.toFixed(2)}-${typeof height === "number" ? height : "auto"}`;
  return (
    <ReactECharts
      key={chartKey}
      option={option}
      style={{ height, width: width ?? "100%" }}
      opts={{ renderer: "canvas" }}
      notMerge
      lazyUpdate
    />
  );
}
