import { create } from "zustand";
import { fetchPublicSettings } from "@/api/public";
import {
  type AppConfig,
  type NavLayout,
  getBuildTimeConfig,
  mapRemoteConfig,
  resolveNavLayout,
} from "@/config/app";
import type { ThemeName } from "@/config/themes";
import { resolveThemeName } from "@/config/themes";

interface AppConfigState {
  config: AppConfig;
  ready: boolean;
  load: () => Promise<void>;
  setTheme: (theme: ThemeName) => void;
  setNavLayout: (navLayout: NavLayout) => void;
}

export const useAppConfigStore = create<AppConfigState>((set, get) => ({
  config: getBuildTimeConfig(),
  ready: false,

  load: async () => {
    const base = getBuildTimeConfig();
    try {
      const remote = await fetchPublicSettings();
      const merged = { ...base, ...mapRemoteConfig(remote) };
      // 本地布局偏好优先于远程默认
      const savedLayout = localStorage.getItem("app_nav_layout");
      if (savedLayout) merged.navLayout = resolveNavLayout(savedLayout);
      const savedTheme = localStorage.getItem("app_theme");
      if (savedTheme) merged.theme = resolveThemeName(savedTheme);
      set({ config: merged, ready: true });
    } catch {
      set({ config: base, ready: true });
    }
  },

  setTheme: (theme) => {
    set({ config: { ...get().config, theme } });
    localStorage.setItem("app_theme", theme);
  },

  setNavLayout: (navLayout) => {
    set({ config: { ...get().config, navLayout } });
    localStorage.setItem("app_nav_layout", navLayout);
  },
}));

// 本地预览优先（顶栏切换后刷新仍保留）
const savedTheme = localStorage.getItem("app_theme");
const savedLayout = localStorage.getItem("app_nav_layout");
if (savedTheme || savedLayout) {
  const base = useAppConfigStore.getState().config;
  useAppConfigStore.setState({
    config: {
      ...base,
      ...(savedTheme ? { theme: resolveThemeName(savedTheme) } : {}),
      ...(savedLayout ? { navLayout: resolveNavLayout(savedLayout) } : {}),
    },
  });
}
