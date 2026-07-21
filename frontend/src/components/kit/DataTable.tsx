import { Empty, Table, type TableProps } from "antd";

export type DataTableProps<T extends object> = TableProps<T> & {
  /** 空态文案 */
  emptyText?: string;
};

/**
 * 轻量通用表：统一空态；分页 / 树表等仍走 Ant Design Table API。
 */
export default function DataTable<T extends object>({
  emptyText = "暂无数据",
  locale,
  pagination,
  ...rest
}: DataTableProps<T>) {
  return (
    <Table<T>
      {...rest}
      pagination={pagination === undefined ? false : pagination}
      locale={{
        emptyText: <Empty description={emptyText} image={Empty.PRESENTED_IMAGE_SIMPLE} />,
        ...locale,
      }}
    />
  );
}
