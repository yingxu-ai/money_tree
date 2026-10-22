import { schedulingModule } from "@/modules/scheduling/register";
import { toolboxModule } from "@/modules/toolbox/register";
import { systemModule } from "@/modules/system/register";
import { dashboardModule } from "@/modules/dashboard/register";
import { equipmentAnalysisModule } from "@/modules/equipment-analysis/register";
import { getActiveEdition, isModuleEnabled } from "@/platform/edition";
import type { ModuleRoute } from "@/platform/modules/types";

const ALL_MODULES = [
  systemModule,
  dashboardModule,
  equipmentAnalysisModule,
  schedulingModule,
  toolboxModule,
];

/** 当前 edition 下可用的路由（模式 A 导出包会裁剪；本地 default 为全量） */
export function getEnabledModuleRoutes(): ModuleRoute[] {
  const edition = getActiveEdition();
  return ALL_MODULES.filter((m) => isModuleEnabled(edition, m.moduleId)).flatMap(
    (m) => m.routes,
  );
}

/** 按租户 SKU 选默认首页 */
export function getDefaultHomePathForUser(
  enabledModules?: string[] | null,
  isPlatformAdmin?: boolean,
): string {
  if (isPlatformAdmin) return "/system/tenants";
  const routes = getEnabledModuleRoutes().filter(
    (r) => enabledModules == null || enabledModules.includes(r.moduleId),
  );
  if (routes.some((r) => r.path === "/devices")) return "/devices";
  if (routes.some((r) => r.path === "/scheduling/gantt")) return "/scheduling/gantt";
  return routes[0]?.path || "/login";
}

/** @deprecated 用 getDefaultHomePathForUser */
export function getDefaultHomePath(): string {
  return getDefaultHomePathForUser(null);
}
