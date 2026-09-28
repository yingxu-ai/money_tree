import { useMemo, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { getActiveEdition, resolveLayoutMode, isEmbedLayout } from "@/platform/edition";
import type { LayoutMode } from "@/platform/edition/types";

function subscribeUrl(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function getLayoutSnapshot(): LayoutMode {
  return resolveLayoutMode(getActiveEdition());
}

/** 响应 URL 参数变化的布局模式 */
export function useLayoutMode(): LayoutMode {
  useLocation(); // 路由变化时重算
  return useSyncExternalStore(subscribeUrl, getLayoutSnapshot, () => "full");
}

export function useIsEmbedLayout(): boolean {
  const mode = useLayoutMode();
  return useMemo(() => isEmbedLayout(mode), [mode]);
}
