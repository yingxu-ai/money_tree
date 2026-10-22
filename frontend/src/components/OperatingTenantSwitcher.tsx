import { Select, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { fetchTenants, type TenantItem } from "@/api/system";
import { useAuthStore } from "@/stores/authStore";
import { getOperatingTenantId, setOperatingTenantId } from "@/utils/operatingTenantStorage";

/** 平台管理员代管客户租户：写入 X-Operating-Tenant-Id */
export default function OperatingTenantSwitcher() {
  const user = useAuthStore((s) => s.user);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [value, setValue] = useState<number | null>(
    () => user?.operating_tenant_id ?? getOperatingTenantId(),
  );
  const [switching, setSwitching] = useState(false);

  const isPlatform = user?.is_platform_admin;

  useEffect(() => {
    setValue(user?.operating_tenant_id ?? getOperatingTenantId());
  }, [user?.operating_tenant_id]);

  useEffect(() => {
    if (!isPlatform) return;
    fetchTenants()
      .then(setTenants)
      .catch(() => setTenants([]));
  }, [isPlatform]);

  if (!isPlatform) return null;

  const options = tenants.map((t) => ({
    value: t.id,
    label: `${t.name}（${t.code}）`,
  }));

  return (
    <div className="app-header-operating-tenant" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
        代管租户
      </Typography.Text>
      <Select
        allowClear
        placeholder="选择后管理该客户组织/账号"
        style={{ minWidth: 240 }}
        size="small"
        loading={switching}
        options={options}
        value={value ?? undefined}
        onChange={async (id) => {
          const next = id ?? null;
          setSwitching(true);
          try {
            setValue(next);
            setOperatingTenantId(next);
            await bootstrap();
            message.success(next ? "已切换代管租户，可管理其组织与账号" : "已取消代管");
          } catch {
            message.error("切换失败，请重试");
          } finally {
            setSwitching(false);
          }
        }}
      />
    </div>
  );
}
