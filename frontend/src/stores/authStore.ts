import { create } from "zustand";
import type { MenuNode, UserInfo } from "@/types";
import { fetchMe, fetchMenus, login as apiLogin } from "@/api/auth";

interface AuthState {
  user: UserInfo | null;
  menus: MenuNode[];
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  bootstrap: () => Promise<void>;
  hasPermission: (code: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  menus: [],
  loading: false,

  login: async (username, password) => {
    const data = await apiLogin(username, password);
    localStorage.setItem("access_token", data.access_token);
    localStorage.setItem("refresh_token", data.refresh_token);
    const menus = await fetchMenus();
    set({ user: data.user, menus });
  },

  logout: () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    set({ user: null, menus: [] });
  },

  bootstrap: async () => {
    const token = localStorage.getItem("access_token");
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
