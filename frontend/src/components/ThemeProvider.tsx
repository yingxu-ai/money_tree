import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useEffect } from "react";
import { applyThemeCssVars, getThemePreset } from "@/config/themes";
import { useAppConfigStore } from "@/stores/appConfigStore";

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeName = useAppConfigStore((s) => s.config.theme);
  const preset = getThemePreset(themeName);

  useEffect(() => {
    applyThemeCssVars(preset);
    document.body.style.background = preset.layout.bodyBg;
  }, [preset]);

  return (
    <ConfigProvider locale={zhCN} theme={preset.antd}>
      {children}
    </ConfigProvider>
  );
}
