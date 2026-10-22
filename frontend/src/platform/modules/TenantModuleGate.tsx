import { Navigate } from "react-router-dom";
import { isModuleAllowedForUser } from "@/platform/menu/filterMenusByEdition";
import { useAuthStore } from "@/stores/authStore";

/** 按登录用户租户 SKU 拦截未购模块页面（平台运维账号不拦截） */
export default function TenantModuleGate({
  moduleId,
  children,
}: {
  moduleId: string;
  children: React.ReactNode;
}) {
  const isPlatform = useAuthStore((s) => s.user?.is_platform_admin);
  const enabled = useAuthStore((s) => s.user?.enabled_modules);
  if (isPlatform) return <>{children}</>;
  // 系统模块中的组织自管页由路由本身控制；SKU 未开 system 时仍允许进 users/roles/depts/dicts
  if (moduleId === "system") return <>{children}</>;
  if (!isModuleAllowedForUser(moduleId, enabled)) {
    return <Navigate to="/forbidden-module" replace />;
  }
  return <>{children}</>;
}
