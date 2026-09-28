import { deleteData, getData } from "./client";
import type { PageResult } from "@/types";
import { getAccessToken } from "@/utils/tokenStorage";

export interface FileItem {
  id: number;
  original_name: string;
  object_key: string;
  mime_type: string;
  size: number;
  sha256: string | null;
  status: string;
  created_at: string;
  content_url?: string;
  ref?: string;
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
  const token = getAccessToken();
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
  const token = getAccessToken();
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

export function isFileAnalyzable(file: Pick<FileItem, "original_name" | "mime_type">): boolean {
  const name = (file.original_name || "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if ([".xlsx", ".xlsm", ".csv"].includes(ext)) return true;
  const mime = (file.mime_type || "").toLowerCase();
  return [
    "text/csv",
    "application/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ].includes(mime);
}

export interface AnalyzeLabelOption {
  key: string;
  label: string;
}

export interface AnalyzeRow {
  excel_row: number;
  meta: Record<string, string | number | null>;
  y: Array<number | null>;
}

export interface TableGridColumn {
  key: string;
  name: string;
  index: number;
  type: "number" | "string" | string;
  numeric_ratio?: number;
}

export interface TableGrid {
  source: string;
  sheet: string;
  columns: TableGridColumn[];
  records: Array<Record<string, string | number | null>>;
  tips: string[];
  row_count: number;
  column_count: number;
  truncated?: boolean;
}

export interface FileAnalyzeResult {
  source: string;
  sheet: string;
  waves: number[];
  x_labels?: string[] | null;
  meta_cols: string[];
  label_options: AnalyzeLabelOption[];
  rows: AnalyzeRow[];
  tips: string[];
  skipped_columns: string[];
  series_count: number;
  row_count: number;
  /** P0 图表构建器用的行列网格 */
  grid?: TableGrid | null;
}

export const fetchFileAnalyze = (id: number) =>
  getData<FileAnalyzeResult>(`/files/${id}/analyze`);

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
