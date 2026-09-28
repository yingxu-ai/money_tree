import { Spin } from "antd";
import { Navigate, Outlet } from "react-router-dom";
import MainLayout from "@/components/MainLayout";
import EmbedShell from "@/platform/layout/EmbedShell";
import { useIsEmbedLayout } from "@/platform/layout/useLayoutMode";
import { useAuthStore } from "@/stores/authStore";

export function ProtectedRoute() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const embed = useIsEmbedLayout();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (embed) {
    return (
      <EmbedShell>
        <Outlet />
      </EmbedShell>
    );
  }

  return (
    <MainLayout>
      <Outlet />
    </MainLayout>
  );
}
