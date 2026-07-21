import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { useAppConfigStore } from "@/stores/appConfigStore";
import { useAuthStore } from "@/stores/authStore";
import LoginPage from "@/pages/login/LoginPage";
import DashboardListPage from "@/pages/dashboard-list/DashboardListPage";
import DashboardDetailPage from "@/pages/dashboard-detail/DashboardDetailPage";
import UsersPage from "@/pages/system/UsersPage";
import RolesPage from "@/pages/system/RolesPage";
import MenusPage from "@/pages/system/MenusPage";
import ConfigsPage from "@/pages/system/ConfigsPage";
import FilesPage from "@/pages/system/FilesPage";
import AuditPage from "@/pages/system/AuditPage";
import DeptsPage from "@/pages/system/DeptsPage";
import DictsPage from "@/pages/system/DictsPage";
import AssistantPage from "@/pages/ai-assistant/AssistantPage";

function Bootstrap() {
  const bootstrapAuth = useAuthStore((s) => s.bootstrap);
  const loadAppConfig = useAppConfigStore((s) => s.load);

  useEffect(() => {
    loadAppConfig();
    bootstrapAuth();
  }, [loadAppConfig, bootstrapAuth]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <Bootstrap />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Navigate to="/dashboards" replace />} />
          <Route path="/dashboards" element={<DashboardListPage />} />
          <Route path="/dashboards/:id" element={<DashboardDetailPage />} />
          <Route path="/system/users" element={<UsersPage />} />
          <Route path="/system/roles" element={<RolesPage />} />
          <Route path="/system/menus" element={<MenusPage />} />
          <Route path="/system/depts" element={<DeptsPage />} />
          <Route path="/system/dicts" element={<DictsPage />} />
          <Route path="/system/audit" element={<AuditPage />} />
          <Route path="/configs" element={<ConfigsPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/ai-assistant" element={<AssistantPage />} />
          <Route path="*" element={<Navigate to="/dashboards" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
