import { deleteData, getData } from "./client";
import type { PageResult } from "@/types";

export interface FileItem {
  id: number;
  original_name: string;
  object_key: string;
  mime_type: string;
  size: number;
  sha256: string | null;
  status: string;
  created_at: string;
}

export interface OperationLogItem {
  id: number;
  user_id: number | null;
  resource: string;
  action: string;
  request: string | null;
  result: string;
  trace_id: string | null;
  created_at: string;
}

export interface LoginLogItem {
  id: number;
  user_id: number | null;
  username: string;
  ip: string | null;
  result: string;
  created_at: string;
}

export const fetchFiles = (page = 1, pageSize = 20, keyword?: string) =>
  getData<PageResult<FileItem>>("/files", { page, page_size: pageSize, keyword });

export async function uploadFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  const token = localStorage.getItem("access_token");
  const res = await fetch("/api/v1/files", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const body = await res.json();
  if (body.code !== 0) throw new Error(body.message || "上传失败");
  return body.data as FileItem;
}

export async function downloadFile(id: number, filename: string) {
  const token = localStorage.getItem("access_token");
  const res = await fetch(`/api/v1/files/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error("下载失败");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const deleteFile = (id: number) => deleteData(`/files/${id}`);

export const fetchOperationLogs = (page = 1, pageSize = 20) =>
  getData<PageResult<OperationLogItem>>("/audit/operations", {
    page,
    page_size: pageSize,
  });

export const fetchLoginLogs = (page = 1, pageSize = 20) =>
  getData<PageResult<LoginLogItem>>("/audit/logins", {
    page,
    page_size: pageSize,
  });
