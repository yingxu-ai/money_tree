import { Button, Result } from "antd";
import { Link } from "react-router-dom";
import { getDefaultHomePathForUser } from "@/platform/modules/registry";
import { useAuthStore } from "@/stores/authStore";

/** 访问未开通模块路由时的占位页（模式 B / 租户 SKU） */
export default function ModuleForbiddenPage() {
  const enabled = useAuthStore((s) => s.user?.enabled_modules);
  const home = getDefaultHomePathForUser(enabled);
  const skuHint =
    enabled == null
      ? "当前账号无权访问该页面"
      : `当前租户已开通：${enabled.join("、") || "无"}`;

  return (
    <Result
      status="403"
      title="模块未开通"
      subTitle={skuHint}
      extra={
        <Link to={home}>
          <Button type="primary">返回可用首页</Button>
        </Link>
      }
    />
  );
}
