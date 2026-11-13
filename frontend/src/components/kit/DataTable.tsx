import { Empty, Table, type TablePaginationConfig, type TableProps } from "antd";

export type DataTableProps<T extends object> = TableProps<T> & {
  /** 空态文案 */
  emptyText?: string;
};

/** 列表默认分页：20 条/页，可改 50 / 100 */
export const DEFAULT_TABLE_PAGINATION: TablePaginationConfig = {
  defaultPageSize: 20,
  pageSizeOptions: ["20", "50", "100"],
  showSizeChanger: true,
  showTotal: (total) => `共 ${total} 条`,
};

/**
 * 轻量通用表：统一空态；分页 / 树表等仍走 Ant Design Table API。
 * pagination 省略或 false = 不分页；true = 使用 DEFAULT_TABLE_PAGINATION。
 */
export default function DataTable<T extends object>({
  emptyText = "暂无数据",
  locale,
  pagination,
  ...rest
}: DataTableProps<T>) {
  const resolvedPagination =
    pagination === undefined || pagination === false
      ? false
      : pagination === true
        ? DEFAULT_TABLE_PAGINATION
        : { ...DEFAULT_TABLE_PAGINATION, ...pagination };

  return (
    <Table<T>
      {...rest}
      pagination={resolvedPagination}
      locale={{
        emptyText: <Empty description={emptyText} image={Empty.PRESENTED_IMAGE_SIMPLE} />,
        ...locale,
      }}
    />
  );
}
