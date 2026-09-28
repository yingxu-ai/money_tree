import { Alert, Select, Space, Typography } from "antd";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { FileAnalyzeResult } from "@/api/files";
import {
  buildPlotlyFigure,
  CHART_KIND_OPTIONS,
  emptyMapping,
  mappingHint,
  NULL_POLICY_OPTIONS,
  suggestMapping,
  type ChartKind,
  type ChartMapping,
} from "./fileChartBuilder";
import FileSpectrumPanel from "./FileSpectrumPanel";
import PlotlyChartWorkbench from "./PlotlyChartWorkbench";

interface Props {
  data: FileAnalyzeResult;
  exportName: string;
  active: boolean;
  fullscreen?: boolean;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span style={{ color: "#5a6b7c", fontSize: 13 }}>{children}</span>;
}

/** 统一数据分析面板：图表类型含「多曲线对照」 */
export default function FileChartBuilderPanel({
  data,
  exportName,
  active,
  fullscreen = false,
}: Props) {
  const grid = data.grid!;
  const hasSpectrum = (data.rows?.length || 0) > 0 && (data.series_count || 0) > 0;

  const [m, setM] = useState<ChartMapping>(() =>
    suggestMapping(grid.columns, hasSpectrum),
  );

  useEffect(() => {
    const hs = (data.rows?.length || 0) > 0 && (data.series_count || 0) > 0;
    setM(suggestMapping(grid.columns, hs));
  }, [data, grid.columns]);

  const patch = (partial: Partial<ChartMapping>) =>
    setM((prev) => ({ ...prev, ...partial }));

  const switchKind = (kind: ChartKind) => {
    setM((prev) => {
      const base = emptyMapping(kind);
      const nums = grid.columns.filter((c) => c.type === "number");
      const next: ChartMapping = {
        ...base,
        nullPolicy: prev.nullPolicy,
        xKey: prev.xKey,
        yKeys: prev.yKeys,
        groupKey: prev.groupKey,
        categoryKey: prev.categoryKey,
        valueKey: prev.valueKey,
        dimKeys: prev.dimKeys.length ? prev.dimKeys : base.dimKeys,
        levelKeys: prev.levelKeys.length ? prev.levelKeys : base.levelKeys,
        histKey: prev.histKey || base.histKey,
        histBins: prev.histBins || base.histBins,
        chartKind: kind,
      };
      if (kind === "scatter") {
        const xCol = grid.columns.find((c) => c.key === next.xKey);
        if (!xCol || xCol.type !== "number") {
          next.xKey = nums[0]?.key;
          next.yKeys =
            next.yKeys.filter((k) => k !== next.xKey).length > 0
              ? next.yKeys.filter((k) => k !== next.xKey)
              : nums.slice(1, 3).map((c) => c.key);
        }
      }
      return next;
    });
  };

  const isMulticurve = m.chartKind === "multicurve";

  const allCols = grid.columns;
  const numberCols = useMemo(
    () => allCols.filter((c) => c.type === "number"),
    [allCols],
  );
  const textCols = useMemo(
    () => allCols.filter((c) => c.type !== "number"),
    [allCols],
  );

  const colOptions = allCols.map((c) => ({
    value: c.key,
    label: `${c.name}${c.type === "number" ? " · 数值" : " · 文本"}`,
  }));
  const numOptions = numberCols.map((c) => ({
    value: c.key,
    label: `${c.name} · 数值`,
  }));
  const textOptions = textCols.map((c) => ({
    value: c.key,
    label: `${c.name} · 文本`,
  }));
  const groupOptions = [
    { value: "", label: "不分组（每个 Y 一条系列）" },
    ...textOptions,
  ];

  const figure = useMemo(
    () => (isMulticurve ? null : buildPlotlyFigure(grid, m)),
    [grid, m, isMulticurve],
  );

  const tipText = [...(data.tips || []), ...(grid.tips || [])]
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, 4)
    .join("；");

  const mappingFields = (() => {
    if (isMulticurve) return null;
    switch (m.chartKind) {
      case "line":
      case "bar":
        return (
          <>
            <FieldLabel>X 轴</FieldLabel>
            <Select
              allowClear
              style={{ width: 180 }}
              placeholder="选 X"
              value={m.xKey}
              onChange={(v) => patch({ xKey: v })}
              options={colOptions}
            />
            <FieldLabel>Y 轴</FieldLabel>
            <Select
              mode="multiple"
              allowClear
              style={{ minWidth: 220, maxWidth: 360 }}
              placeholder="数值列（可多选）"
              value={m.yKeys}
              onChange={(v) => patch({ yKeys: v })}
              options={numOptions}
            />
            <FieldLabel>分组（图例）</FieldLabel>
            <Select
              style={{ width: 200 }}
              value={m.groupKey || ""}
              onChange={(v) => patch({ groupKey: v || undefined })}
              options={groupOptions}
            />
          </>
        );
      case "scatter":
        return (
          <>
            <FieldLabel>X（数值）</FieldLabel>
            <Select
              allowClear
              style={{ width: 180 }}
              placeholder="选 X"
              value={m.xKey}
              onChange={(v) => patch({ xKey: v })}
              options={numOptions}
            />
            <FieldLabel>Y（可多选）</FieldLabel>
            <Select
              mode="multiple"
              allowClear
              style={{ minWidth: 220, maxWidth: 360 }}
              placeholder="数值列"
              value={m.yKeys}
              onChange={(v) => patch({ yKeys: v })}
              options={numOptions}
            />
          </>
        );
      case "pie":
        return (
          <>
            <FieldLabel>分类</FieldLabel>
            <Select
              allowClear
              style={{ width: 180 }}
              placeholder="分类列"
              value={m.categoryKey}
              onChange={(v) => patch({ categoryKey: v })}
              options={colOptions}
            />
            <FieldLabel>数值</FieldLabel>
            <Select
              allowClear
              style={{ width: 180 }}
              placeholder="数值列"
              value={m.valueKey}
              onChange={(v) => patch({ valueKey: v })}
              options={numOptions}
            />
          </>
        );
      case "parallel":
        return (
          <>
            <FieldLabel>维度（≥2）</FieldLabel>
            <Select
              mode="multiple"
              allowClear
              style={{ minWidth: 280, maxWidth: 480 }}
              placeholder="选多个数值列"
              value={m.dimKeys}
              onChange={(v) => patch({ dimKeys: v })}
              options={numOptions}
            />
          </>
        );
      case "sunburst":
        return (
          <>
            <FieldLabel>层级（外→内）</FieldLabel>
            <Select
              mode="multiple"
              allowClear
              style={{ minWidth: 240, maxWidth: 400 }}
              placeholder="多层分类列"
              value={m.levelKeys}
              onChange={(v) => patch({ levelKeys: v })}
              options={colOptions}
            />
            <FieldLabel>数值</FieldLabel>
            <Select
              allowClear
              style={{ width: 180 }}
              placeholder="数值列"
              value={m.valueKey}
              onChange={(v) => patch({ valueKey: v })}
              options={numOptions}
            />
          </>
        );
      case "histogram":
        return (
          <>
            <FieldLabel>数值列</FieldLabel>
            <Select
              allowClear
              style={{ width: 200 }}
              placeholder="分箱列"
              value={m.histKey}
              onChange={(v) => patch({ histKey: v })}
              options={numOptions}
            />
            <FieldLabel>箱数</FieldLabel>
            <Select
              style={{ width: 100 }}
              value={m.histBins}
              onChange={(v) => patch({ histBins: v })}
              options={[6, 8, 10, 12, 16, 20, 24, 30, 40].map((n) => ({
                value: n,
                label: String(n),
              }))}
            />
          </>
        );
      default:
        return null;
    }
  })();

  return (
    <div>
      {!isMulticurve && tipText ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 10 }}
          message={`${grid.sheet} · ${grid.row_count} 行 × ${grid.column_count} 列`}
          description={tipText}
        />
      ) : !isMulticurve ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          {grid.sheet} · {grid.row_count} 行 × {grid.column_count} 列 · {mappingHint(m.chartKind)}
        </Typography.Paragraph>
      ) : null}

      <Space wrap style={{ marginBottom: 12 }} size={[8, 8]}>
        <FieldLabel>图表类型</FieldLabel>
        <Select
          style={{ width: 150 }}
          value={m.chartKind}
          onChange={switchKind}
          options={CHART_KIND_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
        {!isMulticurve ? (
          <>
            <FieldLabel>空值</FieldLabel>
            <Select
              style={{ width: 150 }}
              value={m.nullPolicy}
              onChange={(v) => patch({ nullPolicy: v })}
              options={NULL_POLICY_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
            />
            {mappingFields}
          </>
        ) : null}
      </Space>

      {isMulticurve ? (
        <FileSpectrumPanel data={data} active={active} />
      ) : (
        <PlotlyChartWorkbench
          figure={figure}
          exportName={exportName}
          active={active}
          fullscreen={fullscreen}
          emptyText={`请按「${CHART_KIND_OPTIONS.find((o) => o.value === m.chartKind)?.label}」要求选好字段`}
        />
      )}
    </div>
  );
}
