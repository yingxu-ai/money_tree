import type { TableGrid, TableGridColumn } from "@/api/files";

export type ChartKind =
  | "multicurve"
  | "line"
  | "bar"
  | "scatter"
  | "pie"
  | "parallel"
  | "sunburst"
  | "histogram";

export type NullPolicy = "skip_point" | "skip_row" | "fill_zero" | "ffill";

export const CHART_KIND_OPTIONS: {
  value: ChartKind;
  label: string;
  tip: string;
}[] = [
  { value: "multicurve", label: "多曲线对照", tip: "按行/分组自动多曲线（光谱/宽表）" },
  { value: "line", label: "折线图", tip: "X + 一个或多个数值 Y" },
  { value: "bar", label: "柱状图", tip: "类目 X + 数值 Y" },
  { value: "scatter", label: "散点图", tip: "数值 X + 数值 Y" },
  { value: "pie", label: "饼图", tip: "分类 + 数值（自动汇总）" },
  { value: "parallel", label: "平行坐标系", tip: "多个数值维度对照" },
  { value: "sunburst", label: "旭日图", tip: "多层分类 + 数值" },
  { value: "histogram", label: "直方图", tip: "单个数值列分箱统计" },
];

export const NULL_POLICY_OPTIONS: { value: NullPolicy; label: string; tip: string }[] = [
  { value: "skip_point", label: "跳过该点", tip: "空值处断点" },
  { value: "skip_row", label: "跳过整行", tip: "映射列为空则丢行" },
  { value: "fill_zero", label: "填 0", tip: "数值空位按 0" },
  { value: "ffill", label: "前值填充", tip: "用上一有效值" },
];

export interface ChartMapping {
  chartKind: ChartKind;
  nullPolicy: NullPolicy;
  xKey?: string;
  yKeys: string[];
  groupKey?: string;
  categoryKey?: string;
  valueKey?: string;
  dimKeys: string[];
  levelKeys: string[];
  histKey?: string;
  histBins: number;
}

/** Plotly 图数据：与多曲线对照同一套引擎 */
export interface PlotlyFigure {
  traces: object[];
  layout: Record<string, unknown>;
  /** 是否支持框选/平移（笛卡尔坐标图） */
  cartesian: boolean;
  /** 非笛卡尔图的分析交互提示 */
  exploreTip?: string;
}

export function emptyMapping(kind: ChartKind = "line"): ChartMapping {
  return {
    chartKind: kind,
    nullPolicy: "skip_point",
    yKeys: [],
    dimKeys: [],
    levelKeys: [],
    histBins: 12,
  };
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function toLabel(v: unknown, fallback: string): string {
  if (v === null || v === undefined || v === "") return fallback;
  return String(v);
}

function fillOne(
  v: number | null,
  last: number | null,
  policy: NullPolicy,
): { value: number | null; last: number | null } {
  if (v != null) return { value: v, last: v };
  if (policy === "fill_zero") return { value: 0, last };
  if (policy === "ffill") return { value: last, last };
  return { value: null, last };
}

function colName(colMap: Map<string, TableGridColumn>, key: string): string {
  return colMap.get(key)?.name || key;
}

const BASE_LAYOUT = {
  margin: { l: 64, r: 24, t: 40, b: 56 },
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "#fafcfe",
  font: { family: "Segoe UI, Microsoft YaHei, sans-serif", color: "#1a2b3c", size: 12 },
  legend: {
    bgcolor: "rgba(255,255,255,0.92)",
    bordercolor: "#d5dee8",
    borderwidth: 1,
  },
  hovermode: "closest" as const,
};

function axisStyle(title: string) {
  return {
    title: { text: title, standoff: 8 },
    showgrid: true,
    gridcolor: "#e6edf5",
    zeroline: false,
  };
}

function buildLineBar(
  grid: TableGrid,
  m: ChartMapping,
  kind: "line" | "bar",
): PlotlyFigure | null {
  if (!m.xKey || !m.yKeys.length) return null;
  const colMap = new Map(grid.columns.map((c) => [c.key, c]));
  const xCol = colMap.get(m.xKey);
  if (!xCol) return null;

  type Pack = { xLabel: string; group: string; ys: Array<number | null> };
  const packs: Pack[] = [];
  const lastByY = m.yKeys.map(() => null as number | null);

  for (let i = 0; i < grid.records.length; i++) {
    const rec = grid.records[i];
    const xRaw = rec[m.xKey];
    const xNum = toNum(xRaw);
    if (m.nullPolicy === "skip_row" && xCol.type === "number" && xNum == null) continue;

    const ys: Array<number | null> = [];
    let skip = false;
    m.yKeys.forEach((yk, yi) => {
      const filled = fillOne(toNum(rec[yk]), lastByY[yi], m.nullPolicy);
      lastByY[yi] = filled.last;
      if (m.nullPolicy === "skip_row" && filled.value == null) skip = true;
      ys.push(filled.value);
    });
    if (skip) continue;

    packs.push({
      xLabel: toLabel(xRaw, `行${rec.__row ?? i + 1}`),
      group: m.groupKey ? toLabel(rec[m.groupKey], "（空）") : "__all__",
      ys,
    });
  }
  if (!packs.length) return null;

  const categories = [...new Set(packs.map((p) => p.xLabel))];
  const traces: object[] = [];
  const connectgaps = m.nullPolicy === "ffill" || m.nullPolicy === "fill_zero";

  if (!m.groupKey) {
    m.yKeys.forEach((yk, yi) => {
      const y = categories.map((cat) => {
        const hit = packs.find((p) => p.xLabel === cat);
        return hit ? hit.ys[yi] : null;
      });
      traces.push({
        type: kind === "bar" ? "bar" : "scatter",
        mode: kind === "line" ? "lines" : undefined,
        name: colName(colMap, yk),
        x: categories,
        y,
        connectgaps,
        line: kind === "line" ? { width: 1.8 } : undefined,
      });
    });
  } else {
    const groups = [...new Set(packs.map((p) => p.group))];
    groups.forEach((g) => {
      m.yKeys.forEach((yk, yi) => {
        const y = categories.map((cat) => {
          const hit = packs.find((p) => p.xLabel === cat && p.group === g);
          return hit ? hit.ys[yi] : null;
        });
        const yName = colName(colMap, yk);
        traces.push({
          type: kind === "bar" ? "bar" : "scatter",
          mode: kind === "line" ? "lines" : undefined,
          name: m.yKeys.length > 1 ? `${g} · ${yName}` : g,
          x: categories,
          y,
          connectgaps,
          line: kind === "line" ? { width: 1.8 } : undefined,
        });
      });
    });
  }

  return {
    traces,
    cartesian: true,
    layout: {
      ...BASE_LAYOUT,
      xaxis: axisStyle(colName(colMap, m.xKey)),
      yaxis: axisStyle("数值"),
    },
  };
}

function buildScatter(grid: TableGrid, m: ChartMapping): PlotlyFigure | null {
  if (!m.xKey || !m.yKeys.length) return null;
  const colMap = new Map(grid.columns.map((c) => [c.key, c]));
  const traces: object[] = [];

  for (const yk of m.yKeys) {
    const xs: number[] = [];
    const ys: number[] = [];
    let lastX: number | null = null;
    let lastY: number | null = null;
    for (const rec of grid.records) {
      const fx = fillOne(toNum(rec[m.xKey!]), lastX, m.nullPolicy);
      const fy = fillOne(toNum(rec[yk]), lastY, m.nullPolicy);
      lastX = fx.last;
      lastY = fy.last;
      if (fx.value == null || fy.value == null) {
        if (m.nullPolicy === "skip_row") continue;
        continue;
      }
      xs.push(fx.value);
      ys.push(fy.value);
    }
    if (!xs.length) continue;
    traces.push({
      type: "scatter",
      mode: "markers",
      name: colName(colMap, yk),
      x: xs,
      y: ys,
      marker: { size: 8 },
    });
  }
  if (!traces.length) return null;
  return {
    traces,
    cartesian: true,
    layout: {
      ...BASE_LAYOUT,
      xaxis: axisStyle(colName(colMap, m.xKey)),
      yaxis: axisStyle("数值"),
    },
  };
}

function buildPie(grid: TableGrid, m: ChartMapping): PlotlyFigure | null {
  if (!m.categoryKey || !m.valueKey) return null;
  const agg = new Map<string, number>();
  let last: number | null = 0;
  for (const rec of grid.records) {
    const filled = fillOne(toNum(rec[m.valueKey]), last, m.nullPolicy);
    last = filled.last;
    if (filled.value == null) continue;
    const name = toLabel(rec[m.categoryKey], "（空）");
    agg.set(name, (agg.get(name) || 0) + filled.value);
  }
  const labels = [...agg.keys()];
  const values = [...agg.values()];
  if (!labels.length) return null;
  return {
    traces: [
      {
        type: "pie",
        labels,
        values,
        hole: 0.35,
        textinfo: "label+percent",
        hoverinfo: "label+value+percent",
        textposition: "outside",
        automargin: true,
      },
    ],
    cartesian: false,
    exploreTip: "悬停看占比明细 · 点图例显隐扇区",
    layout: {
      ...BASE_LAYOUT,
      margin: { l: 40, r: 40, t: 36, b: 36 },
      showlegend: true,
    },
  };
}

function buildParallel(grid: TableGrid, m: ChartMapping): PlotlyFigure | null {
  const dims = m.dimKeys.filter(Boolean);
  if (dims.length < 2) return null;
  const colMap = new Map(grid.columns.map((c) => [c.key, c]));

  const dimensions = dims.map((key) => {
    const vals: number[] = [];
    for (const rec of grid.records) {
      const v = toNum(rec[key]);
      if (v != null) vals.push(v);
      else if (m.nullPolicy === "fill_zero") vals.push(0);
    }
    const min = vals.length ? Math.min(...vals) : 0;
    const max = vals.length ? Math.max(...vals) : 1;
    return {
      label: colName(colMap, key),
      values: vals,
      range: [min, max],
    };
  });

  // 对齐行数：只保留各维都有值的行
  const rows: number[][] = [];
  for (const rec of grid.records) {
    const row: number[] = [];
    let ok = true;
    for (const key of dims) {
      const v = toNum(rec[key]);
      if (v == null) {
        if (m.nullPolicy === "fill_zero") row.push(0);
        else {
          ok = false;
          break;
        }
      } else row.push(v);
    }
    if (ok) rows.push(row);
  }
  if (!rows.length) return null;

  const aligned = dims.map((key, di) => ({
    label: colName(colMap, key),
    values: rows.map((r) => r[di]),
    range: [
      Math.min(...rows.map((r) => r[di])),
      Math.max(...rows.map((r) => r[di])),
    ],
  }));

  return {
    traces: [
      {
        type: "parcoords",
        line: { color: "rgba(37,99,235,0.55)" },
        dimensions: aligned.length ? aligned : dimensions,
        labelangle: -15,
        labelside: "bottom",
      },
    ],
    cartesian: false,
    exploreTip: "在各轴上拖选区间可刷选过滤样本",
    layout: {
      ...BASE_LAYOUT,
      margin: { l: 64, r: 64, t: 48, b: 40 },
    },
  };
}

type SunLeaf = { ids: string[]; labels: string[]; parents: string[]; values: number[] };

function buildSunburst(grid: TableGrid, m: ChartMapping): PlotlyFigure | null {
  const levels = m.levelKeys.filter(Boolean);
  if (!levels.length || !m.valueKey) return null;

  const leaf: SunLeaf = { ids: [], labels: [], parents: [], values: [] };
  const seen = new Map<string, number>(); // id -> index

  const ensure = (id: string, label: string, parent: string, add = 0) => {
    if (seen.has(id)) {
      if (add) leaf.values[seen.get(id)!] += add;
      return;
    }
    seen.set(id, leaf.ids.length);
    leaf.ids.push(id);
    leaf.labels.push(label);
    leaf.parents.push(parent);
    leaf.values.push(add);
  };

  let last: number | null = 0;
  for (const rec of grid.records) {
    const filled = fillOne(toNum(rec[m.valueKey]), last, m.nullPolicy);
    last = filled.last;
    if (filled.value == null) continue;

    let parent = "";
    let path = "";
    levels.forEach((lk, idx) => {
      const label = toLabel(rec[lk], "（空）");
      path = path ? `${path}/${label}` : label;
      const isLeaf = idx === levels.length - 1;
      ensure(path, label, parent, isLeaf ? filled.value! : 0);
      parent = path;
    });
  }

  if (!leaf.ids.length) return null;
  return {
    traces: [
      {
        type: "sunburst",
        ids: leaf.ids,
        labels: leaf.labels,
        parents: leaf.parents,
        values: leaf.values,
        branchvalues: "total",
        hoverinfo: "label+value+percent parent",
        // 点击扇区钻取放大，是旭日图的核心分析交互
        maxdepth: 3,
      },
    ],
    cartesian: false,
    exploreTip: "点击扇区钻取下钻 · 点中心或「重置」返回上层",
    layout: {
      ...BASE_LAYOUT,
      margin: { l: 16, r: 16, t: 24, b: 16 },
    },
  };
}

function buildHistogram(grid: TableGrid, m: ChartMapping): PlotlyFigure | null {
  if (!m.histKey) return null;
  const colMap = new Map(grid.columns.map((c) => [c.key, c]));
  const vals: number[] = [];
  let last: number | null = null;
  for (const rec of grid.records) {
    const filled = fillOne(toNum(rec[m.histKey]), last, m.nullPolicy);
    last = filled.last;
    if (filled.value != null) vals.push(filled.value);
  }
  if (vals.length < 2) return null;

  const bins = Math.max(4, Math.min(60, m.histBins || 12));
  return {
    traces: [
      {
        type: "histogram",
        x: vals,
        nbinsx: bins,
        name: "频数",
        marker: { color: "rgba(37,99,235,0.75)" },
      },
    ],
    cartesian: true,
    layout: {
      ...BASE_LAYOUT,
      xaxis: axisStyle(colName(colMap, m.histKey)),
      yaxis: axisStyle("频数"),
      bargap: 0.05,
    },
  };
}

export function buildPlotlyFigure(grid: TableGrid, m: ChartMapping): PlotlyFigure | null {
  switch (m.chartKind) {
    case "multicurve":
      return null;
    case "line":
      return buildLineBar(grid, m, "line");
    case "bar":
      return buildLineBar(grid, m, "bar");
    case "scatter":
      return buildScatter(grid, m);
    case "pie":
      return buildPie(grid, m);
    case "parallel":
      return buildParallel(grid, m);
    case "sunburst":
      return buildSunburst(grid, m);
    case "histogram":
      return buildHistogram(grid, m);
    default:
      return null;
  }
}

export function suggestMapping(
  columns: TableGridColumn[],
  preferMulticurve = false,
): ChartMapping {
  const nums = columns.filter((c) => c.type === "number");
  const strs = columns.filter((c) => c.type !== "number");
  const m = emptyMapping(preferMulticurve ? "multicurve" : "line");
  m.xKey = strs[0]?.key || nums[0]?.key;
  m.yKeys = nums.slice(strs[0] ? 0 : 1, strs[0] ? 3 : 4).map((c) => c.key);
  m.categoryKey = strs[0]?.key;
  m.valueKey = nums[0]?.key;
  m.dimKeys = nums.slice(0, Math.min(5, nums.length)).map((c) => c.key);
  m.levelKeys = strs.slice(0, Math.min(3, strs.length)).map((c) => c.key);
  m.histKey = nums[0]?.key;
  m.histBins = 12;
  return m;
}

export function mappingHint(kind: ChartKind): string {
  return CHART_KIND_OPTIONS.find((o) => o.value === kind)?.tip || "";
}
