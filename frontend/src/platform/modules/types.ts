import type { ReactNode } from "react";
import type { ModuleId } from "@/platform/edition/types";

export interface ModuleRoute {
  path: string;
  element: ReactNode;
  /** 可选：用于列表页映射等 */
  moduleId: ModuleId;
}

export interface ModuleRegistration {
  moduleId: ModuleId;
  routes: ModuleRoute[];
}
