import { getData, postData } from "./client";
import type { MenuNode, UserInfo } from "@/types";

export async function login(username: string, password: string) {
  return postData<{
    access_token: string;
    refresh_token: string;
    token_type: string;
    user: UserInfo;
  }>("/auth/login", { username, password });
}

export async function fetchMe() {
  return getData<UserInfo>("/auth/me");
}

export async function fetchMenus() {
  return getData<MenuNode[]>("/auth/me/menus");
}
