import type { FutureAttributionItem } from "@/modules/equipment-analysis/api/equipmentAnalysis";
import type { HotspotStatus, SchematicDef, SchematicHotspot } from "./types";

export interface HotspotView extends SchematicHotspot {
  status: HotspotStatus;
  contribution_pct?: number;
  reason?: string;
}

function textBlob(parts: (string | undefined | null)[]) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function matchHotspot(h: SchematicHotspot, blob: string, metric?: string): boolean {
  if (metric && h.metrics?.includes(metric)) return true;
  return h.keywords.some((k) => blob.includes(k.toLowerCase()));
}

/**
 * 将归因 / 主因 / 告警映射到热区红橙灰。
 */
export function resolveHotspotViews(
  def: SchematicDef,
  opts: {
    attribution?: FutureAttributionItem[];
    likelyFault?: string;
    primaryCause?: string;
    alertLevel?: string;
  },
): HotspotView[] {
  const attribution = opts.attribution ?? [];
  const scores = new Map<string, { rank: number; pct: number; reason: string }>();

  attribution.forEach((item, idx) => {
    const blob = textBlob([item.metric, item.name, item.text]);
    for (const h of def.hotspots) {
      if (!matchHotspot(h, blob, item.metric)) continue;
      const prev = scores.get(h.id);
      const pct = item.contribution_pct ?? 0;
      if (!prev || idx < prev.rank) {
        scores.set(h.id, { rank: idx, pct, reason: item.text || item.name });
      }
    }
  });

  if (scores.size === 0) {
    const blob = textBlob([opts.likelyFault, opts.primaryCause]);
    for (const h of def.hotspots) {
      if (matchHotspot(h, blob)) {
        scores.set(h.id, {
          rank: 0,
          pct: 40,
          reason: opts.primaryCause || opts.likelyFault || h.label,
        });
        break;
      }
    }
  }

  if (scores.size === 0 && (opts.alertLevel === "alarm" || opts.alertLevel === "warning")) {
    scores.set(def.coreId, {
      rank: 0,
      pct: opts.alertLevel === "alarm" ? 50 : 25,
      reason: opts.primaryCause || opts.likelyFault || "整机告警，定位至核心件",
    });
  }

  // 只保留一个红：取 rank 最小，其次 pct 最大
  let redId: string | null = null;
  let best: { rank: number; pct: number } | null = null;
  for (const [id, s] of scores) {
    if (s.rank === 0 || s.pct >= 35) {
      if (!best || s.rank < best.rank || (s.rank === best.rank && s.pct > best.pct)) {
        best = s;
        redId = id;
      }
    }
  }
  if (!redId && scores.size) {
    const top = [...scores.entries()].sort((a, b) => a[1].rank - b[1].rank || b[1].pct - a[1].pct)[0];
    if (top && (top[1].rank === 0 || opts.alertLevel === "alarm")) redId = top[0];
  }

  return def.hotspots.map((h) => {
    const hit = scores.get(h.id);
    let status: HotspotStatus = "gray";
    if (hit) {
      if (h.id === redId) status = "red";
      else if (hit.rank <= 2 || hit.pct >= 15) status = "orange";
      else status = "orange";
    }
    return {
      ...h,
      status,
      contribution_pct: hit?.pct,
      reason: hit?.reason,
    };
  });
}

export const STATUS_STYLE: Record<
  HotspotStatus,
  { fill: string; stroke: string; label: string }
> = {
  red: { fill: "rgba(255,77,79,0.45)", stroke: "#ff4d4f", label: "命中/高风险" },
  orange: { fill: "rgba(250,173,20,0.35)", stroke: "#faad14", label: "关注" },
  gray: { fill: "rgba(0,0,0,0.04)", stroke: "rgba(0,0,0,0.25)", label: "正常覆盖" },
  dashed: { fill: "rgba(0,0,0,0.02)", stroke: "rgba(0,0,0,0.2)", label: "未启用" },
};
