import { TreeSelect, type TreeSelectProps } from "antd";
import { useMemo } from "react";
import { useRequest } from "@/hooks/useRequest";
import { fetchDepts } from "@/api/system";
import type { DeptItem } from "@/types";

function toTreeData(items: DeptItem[]): NonNullable<TreeSelectProps["treeData"]> {
  return items.map((item) => ({
    value: item.id,
    title: item.name,
    children: item.children?.length ? toTreeData(item.children) : undefined,
  }));
}

export type DeptTreeSelectProps = Omit<TreeSelectProps, "treeData" | "loading">;

export default function DeptTreeSelect({
  placeholder = "选择部门",
  ...rest
}: DeptTreeSelectProps) {
  const { data, loading } = useRequest(fetchDepts);
  const treeData = useMemo(() => toTreeData(data || []), [data]);

  return (
    <TreeSelect
      allowClear
      showSearch
      treeDefaultExpandAll
      treeNodeFilterProp="title"
      placeholder={placeholder}
      loading={loading}
      treeData={treeData}
      {...rest}
    />
  );
}
