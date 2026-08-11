import { getData, postData, putData } from "./client";
import type { MenuNode, UserInfo } from "@/types";
import { getAccessToken } from "@/utils/tokenStorage";

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

export async function updateProfile(payload: {
  display_name?: string;
  email?: string | null;
  avatar_url?: string | null;
}) {
  return putData<UserInfo>("/auth/me/profile", payload);
}

export async function changePassword(payload: { old_password: string; new_password: string }) {
  return postData<null>("/auth/me/change-password", payload);
}

export async function uploadAvatar(file: File) {
  const form = new FormData();
  form.append("file", file);
  const token = getAccessToken();
  const res = await fetch("/api/v1/auth/me/avatar", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const body = await res.json();
  if (body.code !== 0) throw new Error(body.message || "上传失败");
  return body.data as UserInfo;
}

export async function fetchMenus() {
  return getData<MenuNode[]>("/auth/me/menus");
}
