import { getActiveEdition, isModuleEnabled } from "@/platform/edition";
import type { ModuleRoute } from "@/platform/modules/types";
import { dashboardModule } from "@/modules/dashboard/register";
import { demoModule } from "@/modules/demo/register";
import { equipmentAnalysisModule } from "@/modules/equipment-analysis/register";
import { schedulingModule } from "@/modules/scheduling/register";
import { systemModule } from "@/modules/system/register";
import { toolboxModule } from "@/modules/toolbox/register";

const ALL_MODULES = [
  systemModule,
  dashboardModule,
  demoModule,
  equipmentAnalysisModule,
  schedulingModule,
  toolboxModule,
];

/** 按当前 edition.enabled_modules 过滤后的路由 */
export function getEnabledModuleRoutes(): ModuleRoute[] {
  const edition = getActiveEdition();
  return ALL_MODULES.filter((m) => isModuleEnabled(edition, m.moduleId)).flatMap(
    (m) => m.routes,
  );
}

/** 默认首页：优先设备列表，否则已启用模块的第一条路由 */
export function getDefaultHomePath(): string {
  const routes = getEnabledModuleRoutes();
  if (routes.some((r) => r.path === "/devices")) return "/devices";
  if (routes.some((r) => r.path === "/scheduling/gantt")) return "/scheduling/gantt";
  return routes[0]?.path || "/login";
}
