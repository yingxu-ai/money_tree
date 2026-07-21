import { Select } from "antd";
import { THEME_OPTIONS } from "@/config/themes";
import { useAppConfigStore } from "@/stores/appConfigStore";

/** 顶栏主题切换器，便于 Demo 预览效果 */
export default function ThemeSwitcher() {
  const theme = useAppConfigStore((s) => s.config.theme);
  const setTheme = useAppConfigStore((s) => s.setTheme);

  return (
    <Select
      size="small"
      value={theme}
      options={THEME_OPTIONS}
      onChange={setTheme}
      style={{ width: 200 }}
      popupMatchSelectWidth={false}
    />
  );
}
