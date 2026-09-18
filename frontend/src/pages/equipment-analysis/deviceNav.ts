import type { FleetStatusTrendPeriod } from "@/api/equipmentAnalysis";

export type DeviceDetailFrom = "compare" | "cockpit" | "list" | "future" | "optimize" | "diagnosis";

/** URL tab：对照 analysis / 证据 current / 处置 future / 设备信息 overview */
export type DeviceDetailTab = "overview" | "analysis" | "current" | "future";

const DETAIL_TABS: DeviceDetailTab[] = ["overview", "analysis", "current", "future"];
const PERIODS: FleetStatusTrendPeriod[] = ["week", "month", "quarter", "year"];
const FROM_VALUES: DeviceDetailFrom[] = ["compare", "cockpit", "list", "future", "optimize", "diagnosis"];

export interface DeviceDetailNavContext {
  from?: DeviceDetailFrom;
  tab?: DeviceDetailTab;
  period?: FleetStatusTrendPeriod;
  compareIds?: string[];
  /** 舰队筛选：返回时还原 */
  deptId?: number;
  deviceType?: string;
  groupBy?: string;
  page?: number;
  analysisStatus?: string;
  q?: string;
  anchors?: boolean;
}

export function isDeviceDetailTab(v: string | null | undefined): v is DeviceDetailTab {
  return !!v && (DETAIL_TABS as string[]).includes(v);
}

export function isFleetPeriod(v: string | null | undefined): v is FleetStatusTrendPeriod {
  return !!v && (PERIODS as string[]).includes(v);
}

export function buildFleetScopeHref(
  path: "/analysis/diagnosis" | "/analysis/current" | "/analysis/future" | "/analysis/optimize",
  ctx: Pick<DeviceDetailNavContext, "deptId" | "deviceType" | "groupBy" | "page"> & { tab?: string } = {},
): string {
  const params = new URLSearchParams();
  if (ctx.deptId != null) params.set("dept_id", String(ctx.deptId));
  if (ctx.deviceType) params.set("type", ctx.deviceType);
  if (ctx.groupBy && ctx.groupBy !== "auto") params.set("group_by", ctx.groupBy);
  if (ctx.page != null && ctx.page > 1) params.set("page", String(ctx.page));
  if (ctx.tab && ctx.tab !== "overview") params.set("tab", ctx.tab);
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ""}`;
}

export function buildDeviceListHref(
  ctx: Pick<DeviceDetailNavContext, "deptId" | "analysisStatus" | "q" | "page" | "anchors"> = {},
): string {
  const params = new URLSearchParams();
  if (ctx.deptId != null) params.set("dept_id", String(ctx.deptId));
  if (ctx.analysisStatus) params.set("status", ctx.analysisStatus);
  if (ctx.q) params.set("q", ctx.q);
  if (ctx.page != null && ctx.page > 1) params.set("page", String(ctx.page));
  if (ctx.anchors) params.set("anchors", "1");
  const qs = params.toString();
  return `/devices${qs ? `?${qs}` : ""}`;
}

export function buildDeviceDetailHref(deviceId: string, ctx: DeviceDetailNavContext = {}): string {
  const params = new URLSearchParams();
  const tab =
    ctx.tab ??
    (ctx.from === "compare" || ctx.from === "cockpit" || ctx.from === "diagnosis" || ctx.from === "future"
      ? "analysis"
      : ctx.from === "optimize"
        ? "analysis"
        : "analysis");
  if (tab) params.set("tab", tab);
  if (ctx.from) params.set("from", ctx.from);
  if (ctx.period) params.set("period", ctx.period);
  if (ctx.compareIds?.length) params.set("compare_ids", ctx.compareIds.join(","));
  if (ctx.deptId != null) params.set("dept_id", String(ctx.deptId));
  if (ctx.deviceType) params.set("type", ctx.deviceType);
  if (ctx.groupBy && ctx.groupBy !== "auto") params.set("group_by", ctx.groupBy);
  if (ctx.page != null && ctx.page > 1) params.set("page", String(ctx.page));
  if (ctx.analysisStatus) params.set("status", ctx.analysisStatus);
  if (ctx.q) params.set("q", ctx.q);
  if (ctx.anchors) params.set("anchors", "1");
  const qs = params.toString();
  return `/devices/${encodeURIComponent(deviceId)}${qs ? `?${qs}` : ""}`;
}

export function buildCompareHref(ids: string[], period?: FleetStatusTrendPeriod): string {
  const params = new URLSearchParams();
  if (ids.length) params.set("ids", ids.join(","));
  if (period) params.set("period", period);
  const qs = params.toString();
  return `/analysis/compare${qs ? `?${qs}` : ""}`;
}

export function parseDeviceNavContext(searchParams: URLSearchParams): DeviceDetailNavContext {
  const from = searchParams.get("from");
  const tabRaw = searchParams.get("tab");
  const periodRaw = searchParams.get("period");
  const compareIds = searchParams.get("compare_ids")?.split(",").filter(Boolean);
  const deptRaw = searchParams.get("dept_id");
  const pageRaw = searchParams.get("page");
  const deptId = deptRaw != null && deptRaw !== "" ? Number(deptRaw) : undefined;
  const page = pageRaw != null && pageRaw !== "" ? Number(pageRaw) : undefined;
  return {
    from: FROM_VALUES.includes(from as DeviceDetailFrom) ? (from as DeviceDetailFrom) : undefined,
    tab: isDeviceDetailTab(tabRaw) ? tabRaw : undefined,
    period: isFleetPeriod(periodRaw) ? periodRaw : undefined,
    compareIds: compareIds?.length ? compareIds : undefined,
    deptId: Number.isFinite(deptId) ? deptId : undefined,
    deviceType: searchParams.get("type") || undefined,
    groupBy: searchParams.get("group_by") || undefined,
    page: Number.isFinite(page) && (page as number) > 0 ? page : undefined,
    analysisStatus: searchParams.get("status") || undefined,
    q: searchParams.get("q") || undefined,
    anchors: searchParams.get("anchors") === "1",
  };
}

export function defaultDetailTab(ctx: DeviceDetailNavContext): DeviceDetailTab {
  if (ctx.tab) return ctx.tab;
  return "analysis";
}

export function detailBackLink(ctx: DeviceDetailNavContext): { to: string; label: string } | null {
  const scope = {
    deptId: ctx.deptId,
    deviceType: ctx.deviceType,
    groupBy: ctx.groupBy,
    page: ctx.page,
  };
  if (ctx.from === "compare") {
    return {
      to: buildCompareHref(ctx.compareIds ?? [], ctx.period),
      label: "← 返回设备对比",
    };
  }
  if (ctx.from === "cockpit" || ctx.from === "diagnosis") {
    return { to: buildFleetScopeHref("/analysis/diagnosis", scope), label: "← 返回分析诊断" };
  }
  if (ctx.from === "future") {
    return { to: buildFleetScopeHref("/analysis/diagnosis", scope), label: "← 返回分析诊断" };
  }
  if (ctx.from === "optimize") {
    return { to: buildFleetScopeHref("/analysis/diagnosis", scope), label: "← 返回分析诊断" };
  }
  if (ctx.from === "list") {
    return {
      to: buildDeviceListHref({
        deptId: ctx.deptId,
        analysisStatus: ctx.analysisStatus,
        q: ctx.q,
        page: ctx.page,
        anchors: ctx.anchors,
      }),
      label: "← 返回设备列表",
    };
  }
  return null;
}

export function detailContextMessage(
  ctx: DeviceDetailNavContext,
  deviceName?: string,
  compareNames?: string[],
): string | null {
  if (ctx.from === "compare") {
    const periodLabel =
      ctx.period === "week"
        ? "周"
        : ctx.period === "month"
          ? "月"
          : ctx.period === "quarter"
            ? "季"
            : ctx.period === "year"
              ? "年"
              : "";
    const others = (compareNames ?? []).filter((n) => n !== deviceName);
    let peer = "";
    if (others.length > 0) {
      peer = `，与 ${others.slice(0, 3).join("、")}${others.length > 3 ? " 等" : ""} 对比`;
    } else {
      const peerCount = (ctx.compareIds ?? []).length;
      if (peerCount > 1) peer = `，对比组共 ${peerCount} 台设备`;
    }
    return `来自设备对比${periodLabel ? ` · ${periodLabel}视图` : ""}${peer}`;
  }
  if (ctx.from === "cockpit") return "来自现状驾驶舱 · 请确认现场后按建议动作处置";
  if (ctx.from === "future") return "来自风险清单 · 关注建议检修日与处置动作";
  if (ctx.from === "optimize") return "来自运行调优（已并入对照/处置）";
  if (ctx.from === "list") return "来自设备列表";
  return null;
}
