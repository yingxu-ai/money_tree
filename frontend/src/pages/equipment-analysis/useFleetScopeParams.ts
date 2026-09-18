import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/** 舰队页筛选与 URL 同步，钻取返回不丢范围 */
export function useFleetScopeParams() {
  const [searchParams, setSearchParams] = useSearchParams();

  const deptId = useMemo(() => {
    const raw = searchParams.get("dept_id");
    if (raw == null || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }, [searchParams]);

  const deviceType = searchParams.get("type") || undefined;
  const groupBy = searchParams.get("group_by") || "auto";
  const page = useMemo(() => {
    const raw = searchParams.get("page");
    if (raw == null || raw === "") return 1;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [searchParams]);

  const patch = useCallback(
    (next: {
      deptId?: number | null;
      deviceType?: string | null;
      groupBy?: string | null;
      page?: number | null;
    }) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if ("deptId" in next) {
            if (next.deptId == null) p.delete("dept_id");
            else p.set("dept_id", String(next.deptId));
          }
          if ("deviceType" in next) {
            if (!next.deviceType) p.delete("type");
            else p.set("type", next.deviceType);
          }
          if ("groupBy" in next) {
            if (!next.groupBy || next.groupBy === "auto") p.delete("group_by");
            else p.set("group_by", next.groupBy);
          }
          if ("page" in next) {
            if (next.page == null || next.page <= 1) p.delete("page");
            else p.set("page", String(next.page));
          }
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return {
    deptId,
    deviceType,
    groupBy,
    page,
    setDeptId: (id?: number) => patch({ deptId: id ?? null, groupBy: "auto", page: 1 }),
    setDeviceType: (t?: string) => patch({ deviceType: t ?? null, page: 1 }),
    setGroupBy: (g: string) => patch({ groupBy: g, page: 1 }),
    setPage: (pg: number) => patch({ page: pg }),
    scopeCtx: { deptId, deviceType, groupBy, page },
  };
}

/** 分析诊断总览筛选（组织 / 类型 / 运行状态 / 时间） */
export function useDiagnosisOverviewParams() {
  const [searchParams, setSearchParams] = useSearchParams();

  const deptId = useMemo(() => {
    const raw = searchParams.get("dept_id");
    if (raw == null || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }, [searchParams]);

  const deviceType = searchParams.get("type") || undefined;
  const runStatus = searchParams.get("run") || undefined;
  const period = searchParams.get("period") || "shift";

  const patch = useCallback(
    (next: {
      deptId?: number | null;
      deviceType?: string | null;
      runStatus?: string | null;
      period?: string | null;
    }) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if ("deptId" in next) {
            if (next.deptId == null) p.delete("dept_id");
            else p.set("dept_id", String(next.deptId));
          }
          if ("deviceType" in next) {
            if (!next.deviceType) p.delete("type");
            else p.set("type", next.deviceType);
          }
          if ("runStatus" in next) {
            if (!next.runStatus) p.delete("run");
            else p.set("run", next.runStatus);
          }
          if ("period" in next) {
            if (!next.period || next.period === "shift") p.delete("period");
            else p.set("period", next.period);
          }
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return {
    deptId,
    deviceType,
    runStatus,
    period,
    setDeptId: (id?: number) => patch({ deptId: id ?? null }),
    setDeviceType: (t?: string) => patch({ deviceType: t ?? null }),
    setRunStatus: (s?: string) => patch({ runStatus: s ?? null }),
    setPeriod: (p: string) => patch({ period: p }),
    scopeCtx: { deptId, deviceType },
  };
}

/** 设备列表筛选与 URL 同步 */
export function useDeviceListParams() {
  const [searchParams, setSearchParams] = useSearchParams();

  const deptId = useMemo(() => {
    const raw = searchParams.get("dept_id");
    if (raw == null || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }, [searchParams]);

  const analysisStatus = searchParams.get("status") || undefined;
  const q = searchParams.get("q") || "";
  const anchors = searchParams.get("anchors") === "1";
  const page = useMemo(() => {
    const raw = searchParams.get("page");
    if (raw == null || raw === "") return 1;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [searchParams]);

  const patch = useCallback(
    (next: {
      deptId?: number | null;
      analysisStatus?: string | null;
      q?: string | null;
      page?: number | null;
      anchors?: boolean | null;
    }) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if ("deptId" in next) {
            if (next.deptId == null) p.delete("dept_id");
            else p.set("dept_id", String(next.deptId));
          }
          if ("analysisStatus" in next) {
            if (!next.analysisStatus) p.delete("status");
            else p.set("status", next.analysisStatus);
          }
          if ("q" in next) {
            if (!next.q) p.delete("q");
            else p.set("q", next.q);
          }
          if ("page" in next) {
            if (next.page == null || next.page <= 1) p.delete("page");
            else p.set("page", String(next.page));
          }
          if ("anchors" in next) {
            if (!next.anchors) p.delete("anchors");
            else p.set("anchors", "1");
          }
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return {
    deptId,
    analysisStatus,
    q,
    page,
    anchors,
    setDeptId: (id?: number) => patch({ deptId: id ?? null, page: 1 }),
    setAnalysisStatus: (s?: string) => patch({ analysisStatus: s ?? null, page: 1 }),
    setQ: (v: string) => patch({ q: v || null, page: 1 }),
    setPage: (pg: number) => patch({ page: pg }),
    setAnchors: (v: boolean) => patch({ anchors: v || null, page: 1 }),
    reset: () =>
      patch({ deptId: null, analysisStatus: null, q: null, page: 1, anchors: null }),
    listCtx: { from: "list" as const, deptId, analysisStatus, q, page, anchors },
  };
}
