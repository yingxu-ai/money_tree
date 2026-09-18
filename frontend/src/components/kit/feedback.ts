import { message, Modal } from "antd";
import { ApiError } from "@/api/errors";

export function getErrorMessage(err: unknown, fallback = "操作失败"): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function notifySuccess(msg = "操作成功"): void {
  message.success(msg);
}

export function notifyError(err: unknown, fallback = "操作失败"): void {
  // 令牌失效：拦截器已跳登录，避免多请求连环弹窗
  if (err instanceof ApiError && err.isAuthError) return;
  message.error(getErrorMessage(err, fallback));
}

export function notifyWarning(msg: string): void {
  message.warning(msg);
}

export interface ConfirmDeleteOptions {
  title?: string;
  content?: string;
  onOk: () => void | Promise<void>;
}

/** 统一删除确认；成功提示由调用方或 onOk 内处理 */
export function confirmDelete(options: ConfirmDeleteOptions): void {
  const { title = "确认删除？", content = "删除后不可恢复。", onOk } = options;
  Modal.confirm({
    title,
    content,
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    onOk: async () => {
      try {
        await onOk();
      } catch (err) {
        notifyError(err);
        throw err;
      }
    },
  });
}
