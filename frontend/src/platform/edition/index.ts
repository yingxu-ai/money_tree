import defaultEdition from "@editions/default.json";
import skuSchedulingLocal from "@editions/sku-scheduling-local.json";
import skuSchedulingRemote from "@editions/sku-scheduling-remote.json";
import type { EditionConfig, LayoutMode } from "./types";

const CATALOG: Record<string, EditionConfig> = {
  default: defaultEdition as EditionConfig,
  "sku-scheduling-local": skuSchedulingLocal as EditionConfig,
  "sku-scheduling-remote": skuSchedulingRemote as EditionConfig,
};

/** 构建时 / 环境变量指定 SKU，默认全开 */
export function getActiveEdition(): EditionConfig {
  const id =
    (import.meta.env.VITE_EDITION as string | undefined)?.trim() || "default";
  return CATALOG[id] || CATALOG.default;
}

/**
 * 布局模式解析优先级：
 * 1. URL ?embed=1 / ?layout=embed|full
 * 2. sessionStorage（联调可写）
 * 3. edition.layout_mode
 * 4. VITE_LAYOUT_MODE
 */
export function resolveLayoutMode(edition: EditionConfig = getActiveEdition()): LayoutMode {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("embed") === "1" || params.get("embed") === "true") {
      return "embed";
    }
    const layout = params.get("layout");
    if (layout === "embed" || layout === "full" || layout === "content_only") {
      return layout;
    }
    const stored = sessionStorage.getItem("app_layout_mode");
    if (stored === "embed" || stored === "full" || stored === "content_only") {
      return stored;
    }
  }
  const fromEnv = (import.meta.env.VITE_LAYOUT_MODE as string | undefined)?.trim();
  if (fromEnv === "embed" || fromEnv === "full" || fromEnv === "content_only") {
    return fromEnv;
  }
  return edition.layout_mode || "full";
}

export function isEmbedLayout(mode: LayoutMode = resolveLayoutMode()): boolean {
  return mode === "embed" || mode === "content_only";
}

export type { EditionConfig, LayoutMode, ModuleId, DeliveryMode } from "./types";
export { isModuleEnabled } from "./types";
