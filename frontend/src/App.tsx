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
import ApiPermissionsPage from "@/pages/system/ApiPermissionsPage";
import ConfigsPage from "@/pages/system/ConfigsPage";
import FilesPage from "@/pages/system/FilesPage";
import AuditPage from "@/pages/system/AuditPage";
import DeptsPage from "@/pages/system/DeptsPage";
import DictsPage from "@/pages/system/DictsPage";
import AssistantPage from "@/pages/ai-assistant/AssistantPage";
import OverviewTemplatePage from "@/pages/demo/OverviewTemplatePage";
import QueryTableTemplatePage from "@/pages/demo/QueryTableTemplatePage";
import CollectConfigPage from "@/pages/equipment-analysis/CollectConfigPage";
import DeviceListPage from "@/pages/equipment-analysis/DeviceListPage";
import DeviceDetailPage from "@/pages/equipment-analysis/DeviceDetailPage";
import DeviceComparePage from "@/pages/equipment-analysis/DeviceComparePage";
import AnalysisDiagnosisPage from "@/pages/equipment-analysis/AnalysisDiagnosisPage";
import MasterDataPage from "@/pages/scheduling/MasterDataPage";
import WorkOrdersPage from "@/pages/scheduling/WorkOrdersPage";
import GanttPage from "@/pages/scheduling/GanttPage";
import ReportPage from "@/pages/scheduling/ReportPage";
import CalciumRoiPage from "@/pages/tools/calcium-roi/CalciumRoiPage";
import UnitConverterPage from "@/pages/tools/unit-converter/UnitConverterPage";

function RedirectDiagnosis() {
  return <Navigate to="/analysis/diagnosis" replace />;
}

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
          <Route path="/" element={<Navigate to="/devices" replace />} />
          <Route path="/dashboards" element={<DashboardListPage />} />
          <Route path="/dashboards/:id" element={<DashboardDetailPage />} />
          <Route path="/system/users" element={<UsersPage />} />
          <Route path="/system/roles" element={<RolesPage />} />
          <Route path="/system/menus" element={<MenusPage />} />
          <Route path="/system/api-permissions" element={<ApiPermissionsPage />} />
          <Route path="/system/depts" element={<DeptsPage />} />
          <Route path="/system/dicts" element={<DictsPage />} />
          <Route path="/system/audit" element={<AuditPage />} />
          <Route path="/configs" element={<ConfigsPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/ai-assistant" element={<AssistantPage />} />
          <Route path="/demo/overview" element={<OverviewTemplatePage />} />
          <Route path="/demo/query-table" element={<QueryTableTemplatePage />} />
          <Route path="/devices/collect" element={<CollectConfigPage />} />
          <Route path="/devices" element={<DeviceListPage />} />
          <Route path="/devices/:id" element={<DeviceDetailPage />} />
          <Route path="/analysis/diagnosis" element={<AnalysisDiagnosisPage />} />
          <Route path="/analysis/current" element={<RedirectDiagnosis />} />
          <Route path="/analysis/compare" element={<DeviceComparePage />} />
          <Route path="/analysis/future" element={<RedirectDiagnosis />} />
          <Route path="/analysis/optimize" element={<RedirectDiagnosis />} />
          <Route path="/scheduling/master" element={<MasterDataPage />} />
          <Route path="/scheduling/orders" element={<WorkOrdersPage />} />
          <Route path="/scheduling/gantt" element={<GanttPage />} />
          <Route path="/scheduling/report" element={<ReportPage />} />
          <Route path="/tools/calcium-roi" element={<CalciumRoiPage />} />
          <Route path="/tools/unit-converter" element={<UnitConverterPage />} />
          <Route path="*" element={<Navigate to="/devices" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
