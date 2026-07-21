import { useCallback, useEffect, useRef, useState } from "react";
import { notifyError } from "@/components/kit/feedback";

export interface UseRequestOptions<T> {
  /** 默认 true；设为 false 则需手动 run */
  immediate?: boolean;
  /** 失败是否 toast，默认 true */
  notifyOnError?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (err: unknown) => void;
}

export interface UseRequestResult<T, A extends unknown[]> {
  data: T | undefined;
  loading: boolean;
  error: unknown;
  run: (...args: A) => Promise<T | undefined>;
  refresh: () => Promise<T | undefined>;
  setData: React.Dispatch<React.SetStateAction<T | undefined>>;
}

/**
 * 查询类请求钩子：loading / 错误提示 / 手动刷新。
 */
export function useRequest<T, A extends unknown[] = []>(
  service: (...args: A) => Promise<T>,
  options: UseRequestOptions<T> = {},
): UseRequestResult<T, A> {
  const { immediate = true, notifyOnError = true, onSuccess, onError } = options;
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(Boolean(immediate));
  const [error, setError] = useState<unknown>();
  const argsRef = useRef<A>([] as unknown as A);
  const serviceRef = useRef(service);
  serviceRef.current = service;

  const run = useCallback(
    async (...args: A): Promise<T | undefined> => {
      argsRef.current = args;
      setLoading(true);
      setError(undefined);
      try {
        const result = await serviceRef.current(...args);
        setData(result);
        onSuccess?.(result);
        return result;
      } catch (err) {
        setError(err);
        if (notifyOnError) notifyError(err, "加载失败");
        onError?.(err);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [notifyOnError, onSuccess, onError],
  );

  const refresh = useCallback(() => run(...argsRef.current), [run]);

  useEffect(() => {
    if (immediate) {
      void run(...([] as unknown as A));
    }
    // 仅挂载时自动跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, loading, error, run, refresh, setData };
}
