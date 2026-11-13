import type { ModuleRegistration } from "@/platform/modules/types";
import BaseInfoPage from "./pages/BaseInfoPage";
import WorkOrdersPage from "./pages/WorkOrdersPage";
import DailyReportPage from "./pages/DailyReportPage";
import ProgressAnalysisPage from "./pages/ProgressAnalysisPage";
import CockpitPage from "./pages/CockpitPage";

export const productionProgressModule: ModuleRegistration = {
  moduleId: "production-progress",
  routes: [
    {
      moduleId: "production-progress",
      path: "/production-progress/cockpit",
      element: <CockpitPage />,
    },
    {
      moduleId: "production-progress",
      path: "/production-progress/master",
      element: <BaseInfoPage />,
    },
    {
      moduleId: "production-progress",
      path: "/production-progress/orders",
      element: <WorkOrdersPage />,
    },
    {
      moduleId: "production-progress",
      path: "/production-progress/daily",
      element: <DailyReportPage />,
    },
    {
      moduleId: "production-progress",
      path: "/production-progress/analysis",
      element: <ProgressAnalysisPage />,
    },
  ],
};

export {
  CockpitPage,
  BaseInfoPage,
  WorkOrdersPage,
  DailyReportPage,
  ProgressAnalysisPage,
};
