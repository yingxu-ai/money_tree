import { Navigate } from "react-router-dom";
import { isModuleAllowedForUser } from "@/platform/menu/filterMenusByEdition";
import { useAuthStore } from "@/stores/authStore";

/** 按登录用户租户 SKU 拦截未购模块页面 */
export default function TenantModuleGate({
  moduleId,
  children,
}: {
  moduleId: string;
  children: React.ReactNode;
}) {
  const enabled = useAuthStore((s) => s.user?.enabled_modules);
  if (!isModuleAllowedForUser(moduleId, enabled)) {
    return <Navigate to="/forbidden-module" replace />;
  }
  return <>{children}</>;
}
