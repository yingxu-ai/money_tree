import type { ThemeName } from "@/config/themes";
import { resolveThemeName } from "@/config/themes";

/** 甘特几何：与视觉规范 v1 对齐 */
export const GANTT_GEO = {
  collapsedH: 44,
  barH: 36,
  laneGap: 4,
  dueGap: 7,
  orderAccentW: 3,
  barRadius: 6,
} as const;

/** 状态语义色：浅/深共用，深色仅微调实绩/幽灵透明度 */
export const GANTT_STATUS = {
  planDefault: "rgba(37,99,235,0.85)",
  planRunning: "rgba(22,163,74,0.85)",
  planInsert: "rgba(220,38,38,0.85)",
  planStaffing: "rgba(192,38,211,0.85)",
  planAttention: "rgba(217,119,6,0.9)",
  actual: "rgba(71,85,105,0.88)",
  actualDark: "rgba(148,163,184,0.88)",
  due: "#ea580c",
  today: "#2563eb",
  ghost: "rgba(37,99,235,0.5)",
  collapsedPlan: "rgba(37,99,235,0.85)",
  collapsedActual: "rgba(71,85,105,0.92)",
  collapsedActualDark: "rgba(148,163,184,0.92)",
  /** KPI / 摘要用实色 */
  solidConflict: "#dc2626",
  solidStaffing: "#c026d3",
  solidDelay: "#d97706",
  solidOk: "#16a34a",
  solidInfo: "#2563eb",
} as const;

export interface GanttTokens {
  theme: ThemeName;
  geo: typeof GANTT_GEO;
  status: typeof GANTT_STATUS;
  /** 中性：跟顶栏深浅 */
  canvas: string;
  grid: string;
  gridPast: string;
  gridToday: string;
  gridStripe: string;
  ink: string;
  inkMute: string;
  line: string;
  lineStrong: string;
  orderEvenBg: string;
  orderOddBg: string;
  orderOddWash: string;
  actualRowBg: string;
  digestWarnBg: string;
  digestWarnBorder: string;
  digestOkBg: string;
  digestOkBorder: string;
  heatmapStickyBg: string;
  heatmapBorder: string;
  sandboxBg: string;
  sandboxBorder: string;
  sandboxAccent: string;
  /** 条填充 */
  barActual: string;
  barGhost: string;
  collapsedPlan: string;
  collapsedActual: string;
  accentA: string;
  accentB: string;
}

const LIGHT: Omit<GanttTokens, "theme" | "geo" | "status"> = {
  canvas: "#f4f6f9",
  grid: "#ffffff",
  gridPast: "#f1f3f6",
  gridToday: "#e8f1ff",
  gridStripe: "#f8fafc",
  ink: "#1e2633",
  inkMute: "#64748b",
  line: "#e2e8f0",
  lineStrong: "#94a3b8",
  orderEvenBg: "#ffffff",
  orderOddBg: "#e8eef5",
  orderOddWash: "rgba(226,232,240,0.35)",
  actualRowBg: "rgba(148,163,184,0.08)",
  digestWarnBg: "#fffbeb",
  digestWarnBorder: "#fde68a",
  digestOkBg: "#f0fdf4",
  digestOkBorder: "#bbf7d0",
  heatmapStickyBg: "#ffffff",
  heatmapBorder: "#f0f2f5",
  sandboxBg: "rgba(26,187,156,0.08)",
  sandboxBorder: "rgba(26,187,156,0.35)",
  sandboxAccent: "#1abb9c",
  barActual: GANTT_STATUS.actual,
  barGhost: GANTT_STATUS.ghost,
  collapsedPlan: GANTT_STATUS.collapsedPlan,
  collapsedActual: GANTT_STATUS.collapsedActual,
  accentA: "#2563eb",
  accentB: "#0f766e",
};

const DARK: Omit<GanttTokens, "theme" | "geo" | "status"> = {
  canvas: "#0f1623",
  grid: "#1a2332",
  gridPast: "#141d2b",
  gridToday: "rgba(37,99,235,0.22)",
  gridStripe: "#151e2c",
  ink: "#e6ebf2",
  inkMute: "#8a93a3",
  line: "rgba(255,255,255,0.08)",
  lineStrong: "#64748b",
  orderEvenBg: "#1a2332",
  orderOddBg: "#222d3f",
  orderOddWash: "rgba(255,255,255,0.04)",
  actualRowBg: "rgba(148,163,184,0.1)",
  digestWarnBg: "rgba(245,158,0,0.12)",
  digestWarnBorder: "rgba(245,158,0,0.35)",
  digestOkBg: "rgba(47,179,68,0.12)",
  digestOkBorder: "rgba(47,179,68,0.35)",
  heatmapStickyBg: "#1a2332",
  heatmapBorder: "rgba(255,255,255,0.08)",
  sandboxBg: "rgba(26,187,156,0.12)",
  sandboxBorder: "rgba(26,187,156,0.4)",
  sandboxAccent: "#1abb9c",
  barActual: GANTT_STATUS.actualDark,
  barGhost: "rgba(96,165,250,0.45)",
  collapsedPlan: "rgba(96,165,250,0.9)",
  collapsedActual: GANTT_STATUS.collapsedActualDark,
  accentA: "#60a5fa",
  accentB: "#2dd4bf",
};

export function getGanttTokens(themeName?: string): GanttTokens {
  const theme = resolveThemeName(themeName);
  const base = theme === "dark" ? DARK : LIGHT;
  return { theme, geo: GANTT_GEO, status: GANTT_STATUS, ...base };
}

export type PlanBarSource = {
  staffing_gap?: number | null;
  is_insert?: boolean | null;
  plan_vs_actual?: { needs_action?: boolean } | null;
  plan_drift?: boolean | string | null;
  status?: string | null;
};

/** 缺编 > 插队 > 需关注 > 进行中 > 默认 */
export function resolvePlanBarColor(op: PlanBarSource, tokens: GanttTokens): string {
  if ((op.staffing_gap || 0) > 0) return tokens.status.planStaffing;
  if (op.is_insert) return tokens.status.planInsert;
  if (op.plan_vs_actual?.needs_action || !!op.plan_drift) return tokens.status.planAttention;
  if (op.status === "running") return tokens.status.planRunning;
  return tokens.status.planDefault;
}

export function kpiValueColor(
  title: string,
  value: number | string,
  tokens: GanttTokens,
): string | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return tokens.inkMute;
  if (title.includes("冲突")) return tokens.status.solidConflict;
  if (title.includes("缺编")) return tokens.status.solidStaffing;
  if (title.includes("延期")) return tokens.status.solidDelay;
  if (title.includes("在排")) return tokens.status.solidInfo;
  return undefined;
}
