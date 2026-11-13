import type { ModuleRegistration } from "@/platform/modules/types";
import MasterDataPage from "./pages/MasterDataPage";
import WorkOrdersPage from "./pages/WorkOrdersPage";
import GanttPage from "./pages/GanttPage";
import ReportPage from "./pages/ReportPage";
import DailyReportPage from "./pages/DailyReportPage";

export const schedulingModule: ModuleRegistration = {
  moduleId: "scheduling",
  routes: [
    { moduleId: "scheduling", path: "/scheduling/master", element: <MasterDataPage /> },
    { moduleId: "scheduling", path: "/scheduling/orders", element: <WorkOrdersPage /> },
    { moduleId: "scheduling", path: "/scheduling/gantt", element: <GanttPage /> },
    { moduleId: "scheduling", path: "/scheduling/report", element: <ReportPage /> },
    { moduleId: "scheduling", path: "/scheduling/daily", element: <DailyReportPage /> },
  ],
};

export { MasterDataPage, WorkOrdersPage, GanttPage, ReportPage, DailyReportPage };
