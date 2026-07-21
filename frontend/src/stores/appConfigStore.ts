import { create } from "zustand";
import { fetchPublicSettings } from "@/api/public";
import {
  type AppConfig,
  getBuildTimeConfig,
  mapRemoteConfig,
} from "@/config/app";
import type { ThemeName } from "@/config/themes";
import { resolveThemeName } from "@/config/themes";

interface AppConfigState {
  config: AppConfig;
  ready: boolean;
  load: () => Promise<void>;
  setTheme: (theme: ThemeName) => void;
}

export const useAppConfigStore = create<AppConfigState>((set, get) => ({
  config: getBuildTimeConfig(),
  ready: false,

  load: async () => {
    const base = getBuildTimeConfig();
    try {
      const remote = await fetchPublicSettings();
      set({
        config: { ...base, ...mapRemoteConfig(remote) },
        ready: true,
      });
    } catch {
      set({ config: base, ready: true });
    }
  },

  setTheme: (theme) => {
    set({ config: { ...get().config, theme } });
    localStorage.setItem("app_theme", theme);
  },
}));

// 本地预览优先（顶栏切换后刷新仍保留）
const savedTheme = localStorage.getItem("app_theme");
if (savedTheme) {
  const base = useAppConfigStore.getState().config;
  useAppConfigStore.setState({
    config: { ...base, theme: resolveThemeName(savedTheme) },
  });
}
