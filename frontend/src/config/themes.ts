import { theme as antdTheme, type ThemeConfig } from "antd";

/** 配色参考 Gentelella (MIT): light / dark 两套官方主题 */
export type ThemeName = "light" | "dark";

export interface ThemeLayout {
  bodyBg: string;
  siderBg: string;
  siderText: string;
  headerBg: string;
  headerText: string;
  contentBg: string;
  borderColor: string;
  loginBackground: string;
  loginCardBg: string;
  loginCardBlur: boolean;
  loginTitleColor: string;
  loginSubtitleColor: string;
}

export interface AppThemePreset {
  name: ThemeName;
  label: string;
  antd: ThemeConfig;
  layout: ThemeLayout;
}

/** Gentelella v4 tokens — DNA: Dark sidebar · Teal #1ABB9C */
const GT_PRIMARY = "#1ABB9C";
const GT_PRIMARY_DK = "#169f85";
const GT_INFO = "#066fd1";
const GT_SUCCESS = "#2fb344";
const GT_WARNING = "#f59f00";
const GT_DANGER = "#d63939";
const GT_SIDEBAR = "#1a2332";

const LEGACY_THEME_MAP: Record<string, ThemeName> = {
  mint: "light",
  industrial: "light",
  light: "light",
  blur: "dark",
  dark: "dark",
};

export const THEME_PRESETS: Record<ThemeName, AppThemePreset> = {
  light: {
    name: "light",
    label: "浅色",
    antd: {
      token: {
        colorPrimary: GT_PRIMARY,
        colorInfo: GT_INFO,
        colorSuccess: GT_SUCCESS,
        colorWarning: GT_WARNING,
        colorError: GT_DANGER,
        colorLink: GT_PRIMARY,
        colorBgLayout: "#f5f7fb",
        colorBgContainer: "#ffffff",
        colorText: "#1e2633",
        colorTextSecondary: "#626d7d",
        colorBorder: "#e6e7eb",
        borderRadius: 6,
      },
    },
    layout: {
      bodyBg: "#f5f7fb",
      siderBg: "#ffffff",
      siderText: "#626d7d",
      headerBg: "#ffffff",
      headerText: "#1e2633",
      contentBg: "#f5f7fb",
      borderColor: "#e6e7eb",
      loginBackground: `linear-gradient(135deg, ${GT_SIDEBAR} 0%, ${GT_PRIMARY_DK} 100%)`,
      loginCardBg: "#ffffff",
      loginCardBlur: false,
      loginTitleColor: GT_SIDEBAR,
      loginSubtitleColor: "#7e8896",
    },
  },
  dark: {
    name: "dark",
    label: "深色",
    antd: {
      algorithm: antdTheme.darkAlgorithm,
      token: {
        colorPrimary: GT_PRIMARY,
        colorInfo: GT_INFO,
        colorSuccess: GT_SUCCESS,
        colorWarning: GT_WARNING,
        colorError: GT_DANGER,
        colorLink: GT_PRIMARY,
        colorBgLayout: "#0f1623",
        colorBgContainer: "#1a2332",
        colorBgElevated: "#141d2b",
        colorText: "#e6ebf2",
        colorTextSecondary: "#b3bccb",
        colorBorder: "rgba(255,255,255,0.08)",
        borderRadius: 6,
      },
    },
    layout: {
      bodyBg: "#0f1623",
      siderBg: GT_SIDEBAR,
      siderText: "#7b8fa3",
      headerBg: "rgba(20,29,43,0.95)",
      headerText: "#e6ebf2",
      contentBg: "#0f1623",
      borderColor: "rgba(255,255,255,0.08)",
      loginBackground: `linear-gradient(160deg, #0f1623 0%, ${GT_SIDEBAR} 45%, rgba(26,187,156,0.25) 100%)`,
      loginCardBg: "#1a2332",
      loginCardBlur: false,
      loginTitleColor: "#e6ebf2",
      loginSubtitleColor: "#8a93a3",
    },
  },
};

export const THEME_OPTIONS = Object.values(THEME_PRESETS).map((t) => ({
  value: t.name,
  label: t.label,
}));

export function resolveThemeName(name?: string): ThemeName {
  if (!name) return "light";
  return LEGACY_THEME_MAP[name] ?? "light";
}

export function getThemePreset(name?: string): AppThemePreset {
  return THEME_PRESETS[resolveThemeName(name)];
}

export function applyThemeCssVars(theme: AppThemePreset) {
  const root = document.documentElement;
  const { layout } = theme;
  root.style.setProperty("--app-body-bg", layout.bodyBg);
  root.style.setProperty("--app-sider-bg", layout.siderBg);
  root.style.setProperty("--app-sider-text", layout.siderText);
  root.style.setProperty("--app-header-bg", layout.headerBg);
  root.style.setProperty("--app-header-text", layout.headerText);
  root.style.setProperty("--app-content-bg", layout.contentBg);
  root.style.setProperty("--app-border-color", layout.borderColor);
  root.style.setProperty("--app-login-bg", layout.loginBackground);
  root.style.setProperty("--app-login-card-bg", layout.loginCardBg);
  root.style.setProperty("--app-login-title-color", layout.loginTitleColor);
  root.style.setProperty("--app-login-subtitle-color", layout.loginSubtitleColor);
  root.dataset.theme = theme.name;
}
