import { useMemo } from "react";
import type { RosterAnalysisResponse } from "@/modules/scheduling/api/scheduling";
import type { PlotlyFigure } from "@/pages/system/fileChartBuilder";
import PlotlyChartWorkbench from "@/pages/system/PlotlyChartWorkbench";

/** 排班人数分析：同日堆叠柱（各班）+ 折线（当日有班）；交互与文件中心「数据分析」一致 */
export default function RosterAnalysisChart({
  data,
  active = true,
  fullscreen = false,
}: {
  data?: RosterAnalysisResponse | null;
  loading?: boolean;
  height?: number;
  active?: boolean;
  fullscreen?: boolean;
}) {
  const figure: PlotlyFigure | null = useMemo(() => {
    if (!data?.day_labels?.length) return null;
    const x = data.day_labels;
    // x unified 悬停时日期只在顶部出现一次，各系列勿再写 %{x}
    const traces: object[] = (data.series ?? []).map((s) => ({
      type: "bar",
      name: s.name,
      x,
      y: s.values,
      marker: { color: s.color },
      hovertemplate: `${s.name}: %{y} 人<extra></extra>`,
    }));
    traces.push({
      type: "scatter",
      mode: "lines+markers",
      name: "当日有班",
      x,
      y: data.totals ?? [],
      line: { width: 2.2, color: "#1677ff" },
      marker: { size: 6, color: "#1677ff" },
      hovertemplate: "当日有班: %{y} 人<extra></extra>",
    });
    return {
      traces,
      cartesian: true,
      layout: {
        margin: { l: 64, r: 24, t: 40, b: 56 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "#fafcfe",
        font: {
          family: "Segoe UI, Microsoft YaHei, sans-serif",
          color: "#1a2b3c",
          size: 12,
        },
        legend: {
          bgcolor: "rgba(255,255,255,0.92)",
          bordercolor: "#d5dee8",
          borderwidth: 1,
          orientation: "h",
          yanchor: "bottom",
          y: 1.02,
          x: 0,
        },
        hovermode: "x unified",
        barmode: "stack",
        bargap: 0.25,
        xaxis: {
          title: { text: "日期", standoff: 8 },
          showgrid: true,
          gridcolor: "#e6edf5",
          zeroline: false,
          type: "category",
        },
        yaxis: {
          title: { text: "人数", standoff: 8 },
          showgrid: true,
          gridcolor: "#e6edf5",
          zeroline: false,
          rangemode: "tozero",
        },
      },
    };
  }, [data]);

  return (
    <PlotlyChartWorkbench
      figure={figure}
      exportName={`排班人数分析_${data?.start_date || ""}_${data?.end_date || ""}`}
      active={active}
      fullscreen={fullscreen}
      emptyText="暂无排班数据"
    />
  );
}
