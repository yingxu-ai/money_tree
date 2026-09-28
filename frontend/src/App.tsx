import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { useAppConfigStore } from "@/stores/appConfigStore";
import { useAuthStore } from "@/stores/authStore";
import LoginPage from "@/pages/login/LoginPage";
import {
  getDefaultHomePath,
  getEnabledModuleRoutes,
} from "@/platform/modules/registry";
import ModuleForbiddenPage from "@/platform/modules/ModuleForbiddenPage";

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
  const moduleRoutes = getEnabledModuleRoutes();
  const home = getDefaultHomePath();

  return (
    <BrowserRouter>
      <Bootstrap />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Navigate to={home} replace />} />
          {moduleRoutes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          <Route path="/forbidden-module" element={<ModuleForbiddenPage />} />
          <Route path="*" element={<Navigate to="/forbidden-module" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
