import type { ModuleRegistration } from "@/platform/modules/types";
import OverviewTemplatePage from "@/pages/demo/OverviewTemplatePage";
import QueryTableTemplatePage from "@/pages/demo/QueryTableTemplatePage";

export const demoModule: ModuleRegistration = {
  moduleId: "demo",
  routes: [
    { moduleId: "demo", path: "/demo/overview", element: <OverviewTemplatePage /> },
    { moduleId: "demo", path: "/demo/query-table", element: <QueryTableTemplatePage /> },
  ],
};
