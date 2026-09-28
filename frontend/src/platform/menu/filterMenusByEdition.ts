import { getActiveEdition } from "@/platform/edition";
import type { ModuleId } from "@/platform/edition/types";
import type { MenuNode } from "@/types";

/** 与 MANIFEST route_prefixes 对齐，用于侧栏按 SKU 裁剪 */
const MODULE_ROUTE_PREFIXES: Record<ModuleId, string[]> = {
  system: ["/system"],
  dashboard: ["/dashboards", "/ai-assistant", "/configs", "/files"],
  demo: ["/demo"],
  "equipment-analysis": ["/devices", "/analysis"],
  scheduling: ["/scheduling"],
  toolbox: ["/tools"],
};

function pathAllowed(path: string | null | undefined, allowedPrefixes: string[]): boolean {
  if (!path) return true; // CATALOG 无 path，看子节点
  return allowedPrefixes.some((p) => path === p || path.startsWith(p + "/"));
}

function collectAllowedPrefixes(): string[] {
  const edition = getActiveEdition();
  const prefixes: string[] = [];
  for (const mid of edition.enabled_modules) {
    prefixes.push(...(MODULE_ROUTE_PREFIXES[mid] || []));
  }
  return prefixes;
}

/** 按当前 edition 过滤菜单树（模式 B 侧栏） */
export function filterMenusByEdition(nodes: MenuNode[]): MenuNode[] {
  const allowed = collectAllowedPrefixes();
  if (!allowed.length) return nodes;

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
