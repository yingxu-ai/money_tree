import type { ModuleRegistration } from "@/platform/modules/types";
import WorkbenchPage from "./pages/WorkbenchPage";

export const progressAnalyticsModule: ModuleRegistration = {
  moduleId: "progress-analytics",
  routes: [
    {
      moduleId: "progress-analytics",
      path: "/progress-analytics",
      element: <WorkbenchPage />,
    },
  ],
};

export { WorkbenchPage };
