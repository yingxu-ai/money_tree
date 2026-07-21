import { useAuthStore } from "@/stores/authStore";

export function usePermission() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  return { hasPermission };
}

interface PermissionProps {
  code: string;
  children: React.ReactNode;
}

export function Permission({ code, children }: PermissionProps) {
  const { hasPermission } = usePermission();
  if (!hasPermission(code)) return null;
  return <>{children}</>;
}
