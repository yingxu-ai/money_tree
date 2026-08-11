import { MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { useAppConfigStore } from "@/stores/appConfigStore";

/** 顶栏主题切换：Gentelella 风格 light / dark 一键切换 */
export default function ThemeSwitcher() {
  const theme = useAppConfigStore((s) => s.config.theme);
  const setTheme = useAppConfigStore((s) => s.setTheme);
  const isDark = theme === "dark";

  return (
    <Tooltip title={isDark ? "切换浅色" : "切换深色"}>
      <Button
        type="text"
        className="app-theme-toggle"
        icon={isDark ? <SunOutlined /> : <MoonOutlined />}
        aria-label={isDark ? "切换浅色主题" : "切换深色主题"}
        onClick={() => setTheme(isDark ? "light" : "dark")}
      />
    </Tooltip>
  );
}
