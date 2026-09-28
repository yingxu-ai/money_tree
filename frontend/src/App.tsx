import { useEffect, useMemo } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { useAppConfigStore } from "@/stores/appConfigStore";
import { useAuthStore } from "@/stores/authStore";
import LoginPage from "@/pages/login/LoginPage";
import { getActiveEdition } from "@/platform/edition";
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

/** React Router basename：须有前导 /、无尾 /；根路径用 undefined */
function resolveBasename(raw: string | undefined): string | undefined {
  if (!raw || raw === "/") return undefined;
  let b = raw.trim();
  if (!b.startsWith("/")) b = `/${b}`;
  if (b.length > 1 && b.endsWith("/")) b = b.slice(0, -1);
  return b || undefined;
}

export default function App() {
  const moduleRoutes = getEnabledModuleRoutes();
  const home = getDefaultHomePath();
  const basename = useMemo(
    () => resolveBasename(getActiveEdition().basename),
    [],
  );

  return (
    <BrowserRouter basename={basename}>
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
