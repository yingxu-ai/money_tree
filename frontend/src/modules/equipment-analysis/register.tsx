import { Navigate } from "react-router-dom";
import type { ModuleRegistration } from "@/platform/modules/types";
import CollectConfigPage from "@/pages/equipment-analysis/CollectConfigPage";
import DeviceListPage from "@/pages/equipment-analysis/DeviceListPage";
import DeviceDetailPage from "@/pages/equipment-analysis/DeviceDetailPage";
import DeviceComparePage from "@/pages/equipment-analysis/DeviceComparePage";
import AnalysisDiagnosisPage from "@/pages/equipment-analysis/AnalysisDiagnosisPage";

function RedirectDiagnosis() {
  return <Navigate to="/analysis/diagnosis" replace />;
}

export const equipmentAnalysisModule: ModuleRegistration = {
  moduleId: "equipment-analysis",
  routes: [
    { moduleId: "equipment-analysis", path: "/devices/collect", element: <CollectConfigPage /> },
    { moduleId: "equipment-analysis", path: "/devices", element: <DeviceListPage /> },
    { moduleId: "equipment-analysis", path: "/devices/:id", element: <DeviceDetailPage /> },
    { moduleId: "equipment-analysis", path: "/analysis/diagnosis", element: <AnalysisDiagnosisPage /> },
    { moduleId: "equipment-analysis", path: "/analysis/current", element: <RedirectDiagnosis /> },
    { moduleId: "equipment-analysis", path: "/analysis/compare", element: <DeviceComparePage /> },
    { moduleId: "equipment-analysis", path: "/analysis/future", element: <RedirectDiagnosis /> },
    { moduleId: "equipment-analysis", path: "/analysis/optimize", element: <RedirectDiagnosis /> },
  ],
};
