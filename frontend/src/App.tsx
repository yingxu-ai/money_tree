import { useEffect, useMemo } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { useAppConfigStore } from "@/stores/appConfigStore";
import { useAuthStore } from "@/stores/authStore";
import LoginPage from "@/pages/login/LoginPage";
import { getActiveEdition } from "@/platform/edition";
import {
  getDefaultHomePathForUser,
  getEnabledModuleRoutes,
} from "@/platform/modules/registry";
import ModuleForbiddenPage from "@/platform/modules/ModuleForbiddenPage";
import TenantModuleGate from "@/platform/modules/TenantModuleGate";

function Bootstrap() {
  const bootstrapAuth = useAuthStore((s) => s.bootstrap);
  const loadAppConfig = useAppConfigStore((s) => s.load);

  useEffect(() => {
    loadAppConfig();
    bootstrapAuth();
  }, [loadAppConfig, bootstrapAuth]);

  return null;
}

function HomeRedirect() {
  const user = useAuthStore((s) => s.user);
  return (
    <Navigate
      to={getDefaultHomePathForUser(user?.enabled_modules, user?.is_platform_admin)}
      replace
    />
  );
}

function resolveBasename(raw: string | undefined): string | undefined {
  if (!raw || raw === "/") return undefined;
  let b = raw.trim();
  if (!b.startsWith("/")) b = `/${b}`;
  if (b.length > 1 && b.endsWith("/")) b = b.slice(0, -1);
  return b || undefined;
}

export default function App() {
  // 托管多租户：edition 全量时注册全部路由，按登录用户 enabled_modules 拦截
  const moduleRoutes = getEnabledModuleRoutes();
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
          <Route path="/" element={<HomeRedirect />} />
          {moduleRoutes.map((r) => (
            <Route
              key={r.path}
              path={r.path}
              element={
                <TenantModuleGate moduleId={r.moduleId}>{r.element}</TenantModuleGate>
              }
            />
          ))}
          <Route path="/forbidden-module" element={<ModuleForbiddenPage />} />
          <Route path="*" element={<Navigate to="/forbidden-module" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
