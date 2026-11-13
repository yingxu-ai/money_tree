import { getActiveEdition } from "@/platform/edition";
import type { ModuleId } from "@/platform/edition/types";
import type { MenuNode } from "@/types";

/** 与 MANIFEST route_prefixes 对齐 */
export const MODULE_ROUTE_PREFIXES: Record<ModuleId, string[]> = {
  // 平台专属；租户自管页见 TENANT_SELF_ADMIN_PREFIXES
  system: ["/system/tenants", "/system/menus", "/system/api-permissions", "/system/audit"],
  dashboard: ["/dashboards", "/ai-assistant", "/configs", "/files"],
  demo: ["/demo"],
  "equipment-analysis": ["/devices", "/analysis"],
  scheduling: ["/scheduling"],
  "production-progress": ["/production-progress"],
  "progress-analytics": ["/progress-analytics"],
  toolbox: ["/tools"],
};

/** 任意客户租户都可进入的组织自管页（不按 SKU 裁剪） */
const TENANT_SELF_ADMIN_PREFIXES = [
  "/system/users",
  "/system/roles",
  "/system/depts",
  "/system/dicts",
];

function pathAllowed(path: string | null | undefined, allowedPrefixes: string[]): boolean {
  if (!path) return true;
  if (TENANT_SELF_ADMIN_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) {
    return true;
  }
  return allowedPrefixes.some((p) => path === p || path.startsWith(p + "/"));
}

function prefixesForModules(moduleIds: string[]): string[] {
  const prefixes: string[] = [];
  for (const mid of moduleIds) {
    prefixes.push(...(MODULE_ROUTE_PREFIXES[mid as ModuleId] || []));
  }
  return prefixes;
}

/**
 * 侧栏裁剪：
 * - enabledModules === null/undefined → 回退 edition.enabled_modules
 * - enabledModules === [] → 无业务菜单
 * - 数组 → 仅这些模块
 */
export function filterMenusByAccess(
  nodes: MenuNode[],
  enabledModules?: string[] | null,
): MenuNode[] {
  const modules =
    enabledModules === undefined
      ? getActiveEdition().enabled_modules
      : enabledModules === null
        ? null
        : enabledModules;

  if (modules === null) {
    // 全开：仍可按 edition 收一刀；edition default 也是全开
    const editionMods = getActiveEdition().enabled_modules;
    return filterByPrefixes(nodes, prefixesForModules(editionMods));
  }

  return filterByPrefixes(nodes, prefixesForModules(modules));
}

function filterByPrefixes(nodes: MenuNode[], allowed: string[]): MenuNode[] {
  if (!allowed.length) return [];

  const walk = (list: MenuNode[]): MenuNode[] => {
    const out: MenuNode[] = [];
    for (const node of list) {
      const children = node.children?.length ? walk(node.children) : [];
      if (node.type === "CATALOG" || !node.path) {
        if (children.length) out.push({ ...node, children });
        continue;
      }
      if (pathAllowed(node.path, allowed)) {
        out.push({ ...node, children: children.length ? children : node.children });
      }
    }
    return out;
  };
  return walk(nodes);
}

/** @deprecated 使用 filterMenusByAccess */
export function filterMenusByEdition(nodes: MenuNode[]): MenuNode[] {
  return filterMenusByAccess(nodes);
}

export function isModuleAllowedForUser(
  moduleId: string,
  enabledModules?: string[] | null,
): boolean {
  if (enabledModules == null) return true;
  return enabledModules.includes(moduleId);
}
