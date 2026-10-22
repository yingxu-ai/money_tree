import { UndoOutlined } from "@ant-design/icons";
import { Button, Popconfirm, Tooltip, message } from "antd";
import { useState } from "react";
import { resetSchedulingBaseline } from "@/modules/scheduling/api/scheduling";
import { usePermission } from "@/permissions";
import { useAuthStore } from "@/stores/authStore";
import { getOperatingTenantId } from "@/utils/operatingTenantStorage";

const RESTORE_PERMS = ["scheduling:baseline:restore", "scheduling:demo:reset"] as const;

/** 具备恢复权限时显示；平台 admin 须先选代管租户 */
export default function DemoResetButton() {
  const { hasPermission } = usePermission();
  const isPlatform = useAuthStore((s) => s.user?.is_platform_admin);
  const opTenant = useAuthStore((s) => s.user?.operating_tenant_id) ?? getOperatingTenantId();
  const [loading, setLoading] = useState(false);

  const canRestore = RESTORE_PERMS.some((p) => hasPermission(p));
  if (!canRestore) return null;

  const needPickTenant = isPlatform && opTenant == null;

  const btn = (
    <Button
      type="text"
      size="small"
      icon={<UndoOutlined />}
      loading={loading}
      disabled={needPickTenant}
      className="app-header-demo-reset"
      title="恢复排产测试数据"
    >
      恢复测试数据
    </Button>
  );

  if (needPickTenant) {
    return <Tooltip title="请先在顶栏选择要代管的租户">{btn}</Tooltip>;
  }

  return (
    <Popconfirm
      title="恢复排产测试数据？"
      description="将清空本租户排产全部本地修改（人员/班制/排班/工单/工序等），恢复为内置测试种子。"
      okText="全部恢复"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      onConfirm={async () => {
        setLoading(true);
        try {
          const res = await resetSchedulingBaseline();
          message.success(res?.message || "已恢复排产测试数据");
          window.setTimeout(() => window.location.reload(), 400);
        } catch (e) {
          message.error(e instanceof Error ? e.message : "恢复失败");
        } finally {
          setLoading(false);
        }
      }}
    >
      {btn}
    </Popconfirm>
  );
}
