import { useCallback, useMemo, useState } from "react";

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
}

export interface UsePaginationOptions {
  page?: number;
  pageSize?: number;
}

export function usePagination(options: UsePaginationOptions = {}) {
  const [page, setPage] = useState(options.page ?? 1);
  const [pageSize, setPageSize] = useState(options.pageSize ?? 20);
  const [total, setTotal] = useState(0);

  const setFromResult = useCallback((result: { page?: number; page_size?: number; total: number }) => {
    if (result.page != null) setPage(result.page);
    if (result.page_size != null) setPageSize(result.page_size);
    setTotal(result.total);
  }, []);

  const onChange = useCallback((nextPage: number, nextSize?: number) => {
    setPage(nextPage);
    if (nextSize != null && nextSize !== pageSize) {
      setPageSize(nextSize);
      setPage(1);
    }
  }, [pageSize]);

  const tablePagination = useMemo(
    () => ({
      current: page,
      pageSize,
      total,
      showSizeChanger: true,
      showTotal: (t: number) => `共 ${t} 条`,
      onChange,
    }),
    [page, pageSize, total, onChange],
  );

  return {
    page,
    pageSize,
    total,
    setPage,
    setPageSize,
    setTotal,
    setFromResult,
    onChange,
    tablePagination,
  };
}
