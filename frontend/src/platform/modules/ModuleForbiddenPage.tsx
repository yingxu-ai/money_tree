import { Button, Result } from "antd";
import { Link } from "react-router-dom";
import { getActiveEdition } from "@/platform/edition";
import { getDefaultHomePath } from "@/platform/modules/registry";

/** 访问未启用模块路由时的占位页（模式 B） */
export default function ModuleForbiddenPage() {
  const edition = getActiveEdition();
  const home = getDefaultHomePath();
  return (
    <Result
      status="403"
      title="模块未开通"
      subTitle={`当前 SKU「${edition.name}」未包含该页面所属业务模块。`}
      extra={
        <Link to={home}>
          <Button type="primary">返回可用首页</Button>
        </Link>
      }
    />
  );
}
