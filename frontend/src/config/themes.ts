import type { ThemeConfig } from "antd";

/** 配色参考 blur-admin (MIT): mint / blur 两套官方主题 */
export type ThemeName = "mint" | "blur" | "industrial";

export interface ThemeLayout {
  bodyBg: string;
  siderBg: string;
  siderText: string;
  headerBg: string;
  headerText: string;
  contentBg: string;
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

const BLUR_ADMIN_PRIMARY = "#209e91";
const BLUR_ADMIN_INFO = "#2dacd1";
const BLUR_ADMIN_SUCCESS = "#90b900";
const BLUR_ADMIN_WARNING = "#dfb81c";
const BLUR_ADMIN_DANGER = "#e85656";

export const THEME_PRESETS: Record<ThemeName, AppThemePreset> = {
  mint: {
    name: "mint",
    label: "Mint",
    antd: {
      token: {
        colorPrimary: BLUR_ADMIN_PRIMARY,
        colorInfo: BLUR_ADMIN_INFO,
        colorSuccess: BLUR_ADMIN_SUCCESS,
        colorWarning: BLUR_ADMIN_WARNING,
        colorError: BLUR_ADMIN_DANGER,
        colorBgLayout: "#F0F3F4",
        colorBgContainer: "#ffffff",
        colorText: "#666666",
        colorTextSecondary: "#949494",
        borderRadius: 4,
      },
    },
    layout: {
      bodyBg: "#F0F3F4",
      siderBg: "#1C2B36",
      siderText: "#ffffff",
      headerBg: "#ffffff",
      headerText: "#666666",
      contentBg: "#F0F3F4",
      loginBackground: "linear-gradient(135deg, #1C2B36 0%, #209e91 100%)",
      loginCardBg: "#ffffff",
      loginCardBlur: false,
      loginTitleColor: "#1C2B36",
      loginSubtitleColor: "#949494",
    },
  },
  blur: {
    name: "blur",
    label: "Blur",
    antd: {
      token: {
        colorPrimary: BLUR_ADMIN_PRIMARY,
        colorInfo: BLUR_ADMIN_INFO,
        colorSuccess: BLUR_ADMIN_SUCCESS,
        colorWarning: BLUR_ADMIN_WARNING,
        colorError: BLUR_ADMIN_DANGER,
        colorBgLayout: "#2a2a35",
        colorBgContainer: "rgba(255,255,255,0.92)",
        colorText: "#ffffff",
        colorTextSecondary: "#eeeeee",
        borderRadius: 4,
      },
      algorithm: undefined,
    },
    layout: {
      bodyBg: "#2a2a35",
      siderBg: "rgba(0, 0, 0, 0.5)",
      siderText: "#ffffff",
      headerBg: "rgba(0, 0, 0, 0.35)",
      headerText: "#ffffff",
      contentBg: "transparent",
      loginBackground:
        "linear-gradient(135deg, rgba(32,158,145,0.35) 0%, rgba(28,43,54,0.95) 50%, rgba(0,0,0,0.85) 100%)",
      loginCardBg: "rgba(0, 0, 0, 0.55)",
      loginCardBlur: true,
      loginTitleColor: "#ffffff",
      loginSubtitleColor: "#eeeeee",
    },
  },
  industrial: {
    name: "industrial",
    label: "Industrial",
    antd: {
      token: {
        colorPrimary: "#2d5a8e",
        colorInfo: "#2dacd1",
        colorSuccess: "#52c41a",
        colorWarning: "#faad14",
        colorError: "#ff4d4f",
        colorBgLayout: "#f5f7fa",
        colorBgContainer: "#ffffff",
        borderRadius: 6,
      },
    },
    layout: {
      bodyBg: "#f5f7fa",
      siderBg: "#1a2a4a",
      siderText: "#ffffff",
      headerBg: "#ffffff",
      headerText: "#333333",
      contentBg: "#f5f7fa",
      loginBackground: "linear-gradient(135deg, #1a2a4a 0%, #2d5a8e 100%)",
      loginCardBg: "#ffffff",
      loginCardBlur: false,
      loginTitleColor: "#1a2a4a",
      loginSubtitleColor: "#666666",
    },
  },
};

export const THEME_OPTIONS = Object.values(THEME_PRESETS).map((t) => ({
  value: t.name,
  label: t.label,
}));

export function resolveThemeName(name?: string): ThemeName {
  if (name && name in THEME_PRESETS) return name as ThemeName;
  return "mint";
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
  root.style.setProperty("--app-login-bg", layout.loginBackground);
  root.style.setProperty("--app-login-card-bg", layout.loginCardBg);
  root.style.setProperty("--app-login-title-color", layout.loginTitleColor);
  root.style.setProperty("--app-login-subtitle-color", layout.loginSubtitleColor);
  root.dataset.theme = theme.name;
}
