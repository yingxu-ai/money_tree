import { Alert } from "antd";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { getOperatingTenantId } from "@/utils/operatingTenantStorage";

/** 平台账号未选代管租户时，在组织/账号等数据页提示 */
export default function OperatingTenantBanner() {
  const isPlatform = useAuthStore((s) => s.user?.is_platform_admin);
  const opFromUser = useAuthStore((s) => s.user?.operating_tenant_id);
  if (!isPlatform) return null;
  if (opFromUser != null || getOperatingTenantId() != null) return null;

  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      message="请先在顶栏选择「代管租户」"
      description={
        <>
          新建租户后，在右上角选择该租户，再管理其部门与账号。也可先去{" "}
          <Link to="/system/tenants">租户管理</Link> 创建客户。
        </>
      }
    />
  );
}
