/** Edition / SKU 类型（与仓库根 editions/*.json 对齐） */
export type DeliveryMode = "code_export" | "remote_hosted";
export type LayoutMode = "full" | "embed" | "content_only";

export type ModuleId =
  | "system"
  | "dashboard"
  | "demo"
  | "equipment-analysis"
  | "scheduling"
  | "production-progress"
  | "progress-analytics"
  | "toolbox";

export interface EditionConfig {
  id: string;
  name: string;
  delivery_mode: DeliveryMode;
  layout_mode: LayoutMode;
  basename: string;
  enabled_modules: ModuleId[];
}

export function isModuleEnabled(edition: EditionConfig, moduleId: ModuleId): boolean {
  return edition.enabled_modules.includes(moduleId);
}
