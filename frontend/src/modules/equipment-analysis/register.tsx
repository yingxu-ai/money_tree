import { Navigate } from "react-router-dom";
import type { ModuleRegistration } from "@/platform/modules/types";
import CollectConfigPage from "./ui/CollectConfigPage";
import DeviceListPage from "./ui/DeviceListPage";
import DeviceDetailPage from "./ui/DeviceDetailPage";
import DeviceComparePage from "./ui/DeviceComparePage";
import AnalysisDiagnosisPage from "./ui/AnalysisDiagnosisPage";

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
