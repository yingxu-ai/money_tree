import { type ThemeName, resolveThemeName } from "@/config/themes";

/** 前端品牌默认值 — 与后端 Settings / sys_config 键名对齐 */
export const APP_CONFIG_DEFAULTS = {
  appTitle: "工业 AI 应用基座",
  appSubtitle: "通用技术底座 · Base Template",
  appSidebarTitle: "工业 AI 基座",
  appLogoUrl: "",
  theme: "mint" as ThemeName,
};

export type AppConfig = {
  appTitle: string;
  appSubtitle: string;
  appSidebarTitle: string;
  appLogoUrl: string;
  theme: ThemeName;
  appName?: string;
  appEnv?: string;
};

function readEnv(key: string, fallback: string): string {
  const value = import.meta.env[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** 构建时配置（VITE_*），启动即可用，无需等 API */
export function getBuildTimeConfig(): AppConfig {
  return {
    appTitle: readEnv("VITE_APP_TITLE", APP_CONFIG_DEFAULTS.appTitle),
    appSubtitle: readEnv("VITE_APP_SUBTITLE", APP_CONFIG_DEFAULTS.appSubtitle),
    appSidebarTitle: readEnv("VITE_APP_SIDEBAR_TITLE", APP_CONFIG_DEFAULTS.appSidebarTitle),
    appLogoUrl: readEnv("VITE_APP_LOGO_URL", APP_CONFIG_DEFAULTS.appLogoUrl),
    theme: resolveThemeName(readEnv("VITE_APP_THEME", APP_CONFIG_DEFAULTS.theme)),
  };
}

/** 将后端 public/settings 响应映射为前端配置 */
export function mapRemoteConfig(remote: Record<string, string>): Partial<AppConfig> {
  const mapped: Partial<AppConfig> = {};
  if (remote["app.title"]) mapped.appTitle = remote["app.title"];
  if (remote["app.subtitle"]) mapped.appSubtitle = remote["app.subtitle"];
  if (remote["app.sidebar_title"]) mapped.appSidebarTitle = remote["app.sidebar_title"];
  if (remote["app.logo_url"]) mapped.appLogoUrl = remote["app.logo_url"];
  if (remote["app.theme"]) mapped.theme = resolveThemeName(remote["app.theme"]);
  if (remote.app_name) mapped.appName = remote.app_name;
  if (remote.app_env) mapped.appEnv = remote.app_env;
  return mapped;
}
