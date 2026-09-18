import axios from "axios";
import type { ApiResponse } from "@/types";
import { ApiError } from "@/api/errors";
import { ErrorCode } from "@/config/errorCodes";
import { clearTokens, getAccessToken } from "@/utils/tokenStorage";

const http = axios.create({
  baseURL: "/api/v1",
  timeout: 30000,
});

let redirectingToLogin = false;

function handleAuthFailure(): void {
  clearTokens();
  if (redirectingToLogin) return;
  if (window.location.pathname.startsWith("/login")) return;
  redirectingToLogin = true;
  window.location.href = "/login";
}

http.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const traceId = crypto.randomUUID?.().replace(/-/g, "") ?? String(Date.now());
  config.headers["X-Trace-Id"] = traceId;
  return config;
});

http.interceptors.response.use(
  (response) => {
    const body = response.data as ApiResponse;
    if (typeof body?.code === "number" && body.code !== ErrorCode.SUCCESS) {
      const apiError = ApiError.fromResponse(body.code, body.message, body.trace_id);
      if (apiError.isAuthError) {
        handleAuthFailure();
      }
      return Promise.reject(apiError);
    }
    return response;
  },
  (error) => {
    if (axios.isAxiosError(error) && error.response?.data) {
      const body = error.response.data as ApiResponse;
      if (typeof body?.code === "number") {
        const apiError = ApiError.fromResponse(body.code, body.message, body.trace_id);
        if (apiError.isAuthError) {
          handleAuthFailure();
        }
        return Promise.reject(apiError);
      }
      // HTTP 401 无业务码时也跳登录
      if (error.response.status === 401) {
        handleAuthFailure();
        return Promise.reject(
          new ApiError(ErrorCode.TOKEN_INVALID, body.message || "令牌无效或已过期")
        );
      }
    }
    return Promise.reject(
      new ApiError(ErrorCode.GENERAL_ERROR, error.message || "网络异常")
    );
  }
);

export async function getData<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await http.get<ApiResponse<T>>(url, { params });
  return res.data.data as T;
}

export async function postData<T>(url: string, data?: unknown): Promise<T> {
  const res = await http.post<ApiResponse<T>>(url, data);
  return res.data.data as T;
}

export async function putData<T>(url: string, data?: unknown): Promise<T> {
  const res = await http.put<ApiResponse<T>>(url, data);
  return res.data.data as T;
}

export async function deleteData<T>(url: string): Promise<T> {
  const res = await http.delete<ApiResponse<T>>(url);
  return res.data.data as T;
}

export default http;
