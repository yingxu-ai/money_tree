import type { ModuleRegistration } from "@/platform/modules/types";
import DashboardListPage from "@/pages/dashboard-list/DashboardListPage";
import DashboardDetailPage from "@/pages/dashboard-detail/DashboardDetailPage";
import AssistantPage from "@/pages/ai-assistant/AssistantPage";
import ConfigsPage from "@/pages/system/ConfigsPage";
import FilesPage from "@/pages/system/FilesPage";

export const dashboardModule: ModuleRegistration = {
  moduleId: "dashboard",
  routes: [
    { moduleId: "dashboard", path: "/dashboards", element: <DashboardListPage /> },
    { moduleId: "dashboard", path: "/dashboards/:id", element: <DashboardDetailPage /> },
    { moduleId: "dashboard", path: "/ai-assistant", element: <AssistantPage /> },
    { moduleId: "dashboard", path: "/configs", element: <ConfigsPage /> },
    { moduleId: "dashboard", path: "/files", element: <FilesPage /> },
  ],
};
