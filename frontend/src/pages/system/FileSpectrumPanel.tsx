import { BorderOutlined, CompressOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Select, Space, Typography, message } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileAnalyzeResult } from "@/api/files";
import { usePlotly } from "./usePlotly";

const COLORS = Array.from({ length: 36 }, (_, i) => `hsl(${Math.round((i * 360) / 36)}, 70%, 42%)`);

function fmtVal(v: unknown) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-3 || a >= 1e4)) return v.toExponential(3);
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 1e6) / 1e6);
  }
  return String(v);
}

function buildHover(
  metaCols: string[],
  meta: Record<string, string | number | null>,
  xLabel: string,
  y: number | null,
) {
  const lines = metaCols.map((c) => `<b>${c}</b>: ${fmtVal(meta[c])}`);
  lines.push(`<b>X</b>: ${xLabel}`);
  lines.push(`<b>Y</b>: ${fmtVal(y)}`);
  return lines.join("<br>");
}

function parseFilter(text: string): Set<number> | null {
  const t = (text || "").trim();
  if (!t) return null;
  const set = new Set<number>();
  for (const part of t.split(/[,，\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)\s*[-~～]\s*(\d+)$/);
    if (m) {
      let a = +m[1];
      let b = +m[2];
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) set.add(i);
    } else if (/^\d+$/.test(part)) {
      set.add(+part);
    }
  }
  return set.size ? set : null;
}

function rowLabel(data: FileAnalyzeResult, row: FileAnalyzeResult["rows"][0], groupKey: string) {
  if (!groupKey || groupKey === "__excel_row__") {
    return `第${row.excel_row}行`;
  }
  const v = row.meta[groupKey];
  if (v === null || v === undefined || v === "") {
    return `第${row.excel_row}行（空）`;
  }
  return String(v);
}

/** 按分组着色：同 label 同色；图例只出现唯一组名（不聚合曲线） */
function buildGroupedSeries(
  data: FileAnalyzeResult,
  groupKey: string,
  filterSet: Set<number> | null,
  xValues: Array<number | string>,
) {
  const useRowLegend = !groupKey || groupKey === "__excel_row__";
  const visible = data.rows.filter((r) => !filterSet || filterSet.has(r.excel_row));
  const seenLegend = new Set<string>();
  const colorOf = new Map<string, string>();
  let colorIdx = 0;

  return visible.map((r) => {
    const name = rowLabel(data, r, groupKey);
    if (!colorOf.has(name)) {
      colorOf.set(name, COLORS[colorIdx % COLORS.length]);
      colorIdx += 1;
    }
    const color = colorOf.get(name)!;
    const firstOfGroup = !seenLegend.has(name);
    if (firstOfGroup) seenLegend.add(name);

    return {
      type: "scatter" as const,
      mode: "lines" as const,
      name,
      legendgroup: name,
      showlegend: useRowLegend ? true : firstOfGroup,
      x: xValues,
      y: r.y,
      line: { color, width: 1.6 },
      hovertemplate: "%{hovertext}<extra></extra>",
      hovertext: xValues.map((x, j) =>
        buildHover(data.meta_cols, r.meta, fmtVal(x), r.y[j] ?? null),
      ),
    };
  });
}

interface Props {
  data: FileAnalyzeResult;
  active: boolean;
}

/** 原「按行/分组多曲线」对照：滚轮缩放、框选放大、平移、重置、导出 PNG */
export default function FileSpectrumPanel({ data, active }: Props) {
  const { plotly, error: plotlyError } = usePlotly();
  const chartRef = useRef<HTMLDivElement>(null);
  const [groupKey, setGroupKey] = useState("__excel_row__");
  const [filterText, setFilterText] = useState("");
  const [filterSet, setFilterSet] = useState<Set<number> | null>(null);
  const [dragMode, setDragMode] = useState<"zoom" | "pan">("zoom");
  const [maximized, setMaximized] = useState(false);

  const xValues = useMemo(() => {
    if (data.x_labels?.length) return data.x_labels;
    return data.waves;
  }, [data]);

  const hasCurves = (data.rows?.length || 0) > 0 && (data.series_count || 0) > 0;

  const resetZoom = () => {
    if (!plotly || !chartRef.current) return;
    void plotly.relayout(chartRef.current, {
      "xaxis.autorange": true,
      "yaxis.autorange": true,
    }).then(() => message.success("已重置坐标范围"));
  };

  const setChartDragMode = (mode: "zoom" | "pan") => {
    setDragMode(mode);
    if (plotly && chartRef.current) {
      void plotly.relayout(chartRef.current, { dragmode: mode }).then(() => {
        message.info(mode === "zoom" ? "已切换：在图内拖框放大" : "已切换：在图内拖动平移", 1.5);
      });
    }
  };

  const showAllRows = () => {
    setFilterText("");
    setFilterSet(null);
    if (plotly && chartRef.current) {
      void plotly.restyle(chartRef.current, { visible: true });
      void plotly.relayout(chartRef.current, {
        "xaxis.autorange": true,
        "yaxis.autorange": true,
      });
    }
    message.success("已显示全部曲线（清除行号筛选，并恢复图例隐藏）");
  };

  useEffect(() => {
    if (!active || !plotly || !chartRef.current) return;
    const t = window.setTimeout(() => {
      try {
        plotly.Plots.resize(chartRef.current!);
      } catch {
        /* ignore */
      }
    }, 80);
    return () => window.clearTimeout(t);
  }, [maximized, active, plotly, data, hasCurves]);

  useEffect(() => {
    if (!active || !plotly || !hasCurves || !chartRef.current) return;

    const traces = buildGroupedSeries(data, groupKey, filterSet, xValues);
    const grouped = groupKey && groupKey !== "__excel_row__";
    const legendTitle = grouped
      ? data.label_options.find((o) => o.key === groupKey)?.label || "分组"
      : "Excel 行";

    const layout = {
      margin: { l: 64, r: 24, t: 36, b: 56 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "#fafcfe",
      font: { family: "Segoe UI, Microsoft YaHei, sans-serif", color: "#1a2b3c", size: 12 },
      xaxis: {
        title: { text: data.x_labels?.length ? "列（数值列）" : "波长 / 数值列头", standoff: 8 },
        showgrid: true,
        gridcolor: "#e6edf5",
        zeroline: false,
      },
      yaxis: {
        title: { text: "数值", standoff: 8 },
        showgrid: true,
        gridcolor: "#e6edf5",
        zeroline: false,
      },
      legend: {
        title: { text: legendTitle },
        orientation: "v",
        bgcolor: "rgba(255,255,255,0.92)",
        bordercolor: "#d5dee8",
        borderwidth: 1,
        tracegroupgap: 4,
      },
      hovermode: "closest",
      dragmode: dragMode,
    };

    const config = {
      responsive: true,
      displaylogo: false,
      scrollZoom: true,
      modeBarButtonsToRemove: ["lasso2d", "select2d"],
      toImageButtonOptions: {
        format: "png",
        filename: (data.source || "analyze").replace(/\.[^.]+$/, ""),
      },
    };

    void plotly.react(chartRef.current, traces, layout, config);
  }, [active, plotly, data, groupKey, filterSet, xValues, dragMode, hasCurves]);

  if (!hasCurves) {
    return (
      <Alert
        type="info"
        showIcon
        message="当前文件未识别到自动多曲线列"
        description="光谱/宽表对照需要数值列头或成组数值列。一般业务表请用「图表构建」自选行列。"
      />
    );
  }

  return (
    <div>
      {plotlyError ? (
        <Alert type="error" showIcon message={plotlyError} style={{ marginBottom: 12 }} />
      ) : null}

      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {data.sheet} · 共 {data.row_count} 条曲线 · {data.series_count} 个数值点
        {data.x_labels?.length ? "（按数值列自动适配）" : "（数值列头作 X）"}
      </Typography.Paragraph>

      <Space wrap style={{ marginBottom: 12 }}>
        <span style={{ color: "#5a6b7c", fontSize: 13 }}>分组（图例）</span>
        <Select
          style={{ width: 220 }}
          value={groupKey}
          options={(data.label_options ?? []).map((o) => ({
            value: o.key,
            label: o.label,
          }))}
          onChange={setGroupKey}
        />
        <span style={{ color: "#5a6b7c", fontSize: 13 }}>筛选行号</span>
        <Input
          style={{ width: 180 }}
          allowClear
          placeholder="如 2,5 或 2-10"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          onPressEnter={() => setFilterSet(parseFilter(filterText))}
        />
        <Button type="primary" onClick={() => setFilterSet(parseFilter(filterText))}>
          应用
        </Button>
        <Button onClick={showAllRows}>显示全部</Button>
        <Button
          type={dragMode === "zoom" ? "primary" : "default"}
          onClick={() => setChartDragMode("zoom")}
        >
          框选放大
        </Button>
        <Button
          type={dragMode === "pan" ? "primary" : "default"}
          onClick={() => setChartDragMode("pan")}
        >
          平移
        </Button>
        <Button onClick={resetZoom}>重置缩放</Button>
        <Button
          icon={maximized ? <CompressOutlined /> : <BorderOutlined />}
          onClick={() => setMaximized((v) => !v)}
        >
          {maximized ? "退出放大" : "图表放大"}
        </Button>
      </Space>

      <div
        ref={chartRef}
        style={{
          height: maximized ? "min(78vh, 720px)" : "min(62vh, 560px)",
          minHeight: maximized ? 520 : 420,
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #d5dee8",
        }}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0, fontSize: 12 }}>
        滚轮缩放 · 拖框放大 / 平移 · 双击坐标或「重置缩放」还原 · 悬停看 meta · 点击图例显隐 ·
        工具栏可导出 PNG
      </Typography.Paragraph>
    </div>
  );
}
