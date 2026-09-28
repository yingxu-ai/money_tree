import type { ModuleRegistration } from "@/platform/modules/types";
import MasterDataPage from "@/pages/scheduling/MasterDataPage";
import WorkOrdersPage from "@/pages/scheduling/WorkOrdersPage";
import GanttPage from "@/pages/scheduling/GanttPage";
import ReportPage from "@/pages/scheduling/ReportPage";

export const schedulingModule: ModuleRegistration = {
  moduleId: "scheduling",
  routes: [
    { moduleId: "scheduling", path: "/scheduling/master", element: <MasterDataPage /> },
    { moduleId: "scheduling", path: "/scheduling/orders", element: <WorkOrdersPage /> },
    { moduleId: "scheduling", path: "/scheduling/gantt", element: <GanttPage /> },
    { moduleId: "scheduling", path: "/scheduling/report", element: <ReportPage /> },
  ],
};
