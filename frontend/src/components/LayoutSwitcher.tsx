import { PicLeftOutlined, InsertRowAboveOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { useAppConfigStore } from "@/stores/appConfigStore";

/** 侧栏 / 顶栏导航布局一键切换 */
export default function LayoutSwitcher() {
  const navLayout = useAppConfigStore((s) => s.config.navLayout);
  const setNavLayout = useAppConfigStore((s) => s.setNavLayout);
  const isTop = navLayout === "top";

  return (
    <Tooltip title={isTop ? "切换左侧导航" : "切换顶部导航"}>
      <Button
        type="text"
        className="app-theme-toggle"
        icon={isTop ? <PicLeftOutlined /> : <InsertRowAboveOutlined />}
        aria-label={isTop ? "切换左侧导航" : "切换顶部导航"}
        onClick={() => setNavLayout(isTop ? "side" : "top")}
      />
    </Tooltip>
  );
}
