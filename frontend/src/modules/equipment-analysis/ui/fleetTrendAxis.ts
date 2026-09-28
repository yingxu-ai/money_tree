export interface TrendAxisInput {
  labels: string[];
  day_labels?: string[];
  tick_indices?: number[];
}

export interface ResolvedTrendAxis {
  categories: string[];
  tickIndices: number[];
  tickLabels: string[];
}

export function resolveTrendAxis(data: TrendAxisInput): ResolvedTrendAxis {
  const categories = data.day_labels?.length ? data.day_labels : data.labels;
  const tickIndices = data.tick_indices?.length
    ? data.tick_indices
    : categories.map((_, i) => i);
  return { categories, tickIndices, tickLabels: data.labels };
}

export function trendAxisLabelFormatter(
  tickIndices: number[],
  tickLabels: string[],
): (value: string, index: number) => string {
  return (_value, index) => {
    const pos = tickIndices.indexOf(index);
    if (pos < 0) return "";
    return tickLabels[pos] ?? _value;
  };
}

export function buildTrendXAxis(axis: ResolvedTrendAxis, extra?: Record<string, unknown>) {
  return {
    type: "category" as const,
    boundaryGap: false,
    data: axis.categories,
    axisLabel: {
      formatter: trendAxisLabelFormatter(axis.tickIndices, axis.tickLabels),
      interval: 0,
    },
    ...extra,
  };
}

/** 舰队趋势图统一布局，避免图例与 Y 轴单位重叠、顶部裁切 */
export const FLEET_TREND_LAYOUT = {
  legendTop: 12,
  legendTopWithSummary: 30,
  gridLeft: 56,
  gridRight: 20,
  gridTop: 64,
  gridTopWithSummary: 78,
} as const;

export function buildFleetChartTitle(summary?: string) {
  if (!summary) return undefined;
  return {
    text: summary,
    left: 8,
    top: 6,
    textStyle: {
      fontSize: 12,
      color: "rgba(0,0,0,0.45)",
      fontWeight: "normal" as const,
      lineHeight: 20,
    },
  };
}

export function buildFleetTrendGrid(gridBottom: number, hasSummary = false) {
  return {
    left: FLEET_TREND_LAYOUT.gridLeft,
    right: FLEET_TREND_LAYOUT.gridRight,
    top: hasSummary ? FLEET_TREND_LAYOUT.gridTopWithSummary : FLEET_TREND_LAYOUT.gridTop,
    bottom: gridBottom,
  };
}

export function buildFleetYAxis() {
  return {
    type: "value" as const,
    name: "台",
    nameLocation: "middle" as const,
    nameRotate: 90,
    nameGap: 38,
    minInterval: 1,
    splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.35 } },
  };
}

/** 单台设备问题态趋势：0=正常，1=处于当前 Tab 问题态 */
export function buildFleetDeviceStateYAxis(activeLabel: string) {
  return {
    type: "value" as const,
    min: 0,
    max: 1,
    interval: 1,
    nameLocation: "middle" as const,
    nameRotate: 90,
    nameGap: 38,
    axisLabel: {
      formatter: (v: number) => (v >= 1 ? activeLabel : "正常"),
    },
    splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.35 } },
  };
}

/** ECharts 内置滚动图例：三角翻页 + 页码，点击切换高亮（不隐藏折线） */
export function buildFleetScrollLegend(
  series: Array<{ key: string; name: string }>,
  activeKeys: Set<string>,
  colorFor: (index: number, active: boolean) => string,
  hasSummary = false,
) {
  return {
    type: "scroll" as const,
    top: hasSummary ? FLEET_TREND_LAYOUT.legendTopWithSummary : FLEET_TREND_LAYOUT.legendTop,
    left: FLEET_TREND_LAYOUT.gridLeft,
    right: FLEET_TREND_LAYOUT.gridRight,
    itemWidth: 10,
    itemHeight: 10,
    itemGap: 12,
    pageButtonItemGap: 8,
    pageButtonPosition: "end" as const,
    pageFormatter: "{current}/{total}",
    pageIconColor: "#1677ff",
    pageIconInactiveColor: "#bfbfbf",
    pageTextStyle: { color: "#8c8c8c", fontSize: 12 },
    data: series.map((s, i) => {
      const active = activeKeys.has(s.key);
      return {
        name: s.name,
        icon: "roundRect",
        itemStyle: { color: colorFor(i, active) },
        textStyle: {
          color: active ? "rgba(0,0,0,0.88)" : "rgba(0,0,0,0.35)",
        },
      };
    }),
    selected: Object.fromEntries(series.map((s) => [s.name, true])),
  };
}

/** 趋势图底部滑块缩放；年/季/月/周默认全量展开，仍可拖拽缩小 */
export function buildTrendDataZoom(_pointCount: number) {
  return {
    gridBottom: 72,
    dataZoom: [
      {
        type: "slider" as const,
        xAxisIndex: 0,
        bottom: 4,
        height: 18,
        start: 0,
        end: 100,
        borderColor: "#d9d9d9",
        fillerColor: "rgba(22, 119, 255, 0.12)",
        handleStyle: { color: "#1677ff" },
        moveHandleSize: 6,
      },
      {
        type: "inside" as const,
        xAxisIndex: 0,
        start: 0,
        end: 100,
      },
    ],
  };
}
