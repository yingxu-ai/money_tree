import { create } from "zustand";
import type { MenuNode, UserInfo } from "@/types";
import { fetchMe, fetchMenus, login as apiLogin } from "@/api/auth";
import {
  clearTokens,
  getAccessToken,
  setRememberedUsername,
  setTokens,
} from "@/utils/tokenStorage";

interface AuthState {
  user: UserInfo | null;
  menus: MenuNode[];
  loading: boolean;
  login: (username: string, password: string, remember?: boolean) => Promise<void>;
  logout: () => void;
  setUser: (user: UserInfo) => void;
  bootstrap: () => Promise<void>;
  hasPermission: (code: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  menus: [],
  loading: false,

  login: async (username, password, remember = true) => {
    const data = await apiLogin(username, password);
    setTokens(data.access_token, data.refresh_token, remember);
    if (remember) {
      setRememberedUsername(username);
    } else {
      setRememberedUsername(null);
    }
    const menus = await fetchMenus();
    set({ user: data.user, menus });
  },

  logout: () => {
    clearTokens();
    set({ user: null, menus: [] });
  },

  setUser: (user) => {
    set({ user });
  },

  bootstrap: async () => {
    const token = getAccessToken();
    if (!token) return;
    set({ loading: true });
    try {
      const [user, menus] = await Promise.all([fetchMe(), fetchMenus()]);
      set({ user, menus });
    } catch {
      get().logout();
    } finally {
      set({ loading: false });
    }
  },

  hasPermission: (code) => {
    const user = get().user;
    return user?.permissions.includes(code) ?? false;
  },
}));
