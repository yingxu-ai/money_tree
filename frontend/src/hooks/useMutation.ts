import { useCallback, useState } from "react";
import { notifyError, notifySuccess } from "@/components/kit/feedback";

export interface UseMutationOptions<T, A extends unknown[]> {
  successMessage?: string | ((data: T, args: A) => string) | false;
  notifyOnError?: boolean;
  onSuccess?: (data: T, args: A) => void | Promise<void>;
  onError?: (err: unknown) => void;
}

/**
 * 变更类请求钩子：提交 loading、成功/失败提示。
 */
export function useMutation<T, A extends unknown[]>(
  service: (...args: A) => Promise<T>,
  options: UseMutationOptions<T, A> = {},
) {
  const { successMessage = "操作成功", notifyOnError = true, onSuccess, onError } = options;
  const [loading, setLoading] = useState(false);

  const mutate = useCallback(
    async (...args: A): Promise<T | undefined> => {
      setLoading(true);
      try {
        const result = await service(...args);
        if (successMessage !== false) {
          const msg =
            typeof successMessage === "function"
              ? successMessage(result, args)
              : successMessage;
          notifySuccess(msg);
        }
        await onSuccess?.(result, args);
        return result;
      } catch (err) {
        if (notifyOnError) notifyError(err);
        onError?.(err);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [service, successMessage, notifyOnError, onSuccess, onError],
  );

  return { loading, mutate };
}
