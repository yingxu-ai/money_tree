import { useMemo, useState } from "react";
import { DataTable, PageHeader, SearchBar, StatusTag } from "@/components/kit";
import { fetchDemoQueryTable, type DemoQueryTableItem } from "@/api/demo";
import { useRequest } from "@/hooks/useRequest";

const STATUS_LABEL: Record<string, string> = {
  running: "运行",
  idle: "空闲",
  alarm: "告警",
  maintenance: "维保",
};

const STATUS_COLOR: Record<string, string> = {
  running: "green",
  idle: "default",
  alarm: "red",
  maintenance: "orange",
};

/**
 * QueryTable 骨架范本：SearchBar + DataTable。
 * 新 Demo：复制本文件 → 改列定义 → 改 fixtures/query_table.json（或换真实接口）。
 */
export default function QueryTableTemplatePage() {
  const [keyword, setKeyword] = useState("");
  const { data, loading } = useRequest(fetchDemoQueryTable);

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter(
      (row) =>
        row.code.toLowerCase().includes(kw) ||
        row.name.toLowerCase().includes(kw) ||
        row.dept.toLowerCase().includes(kw) ||
        row.owner.toLowerCase().includes(kw),
    );
  }, [data?.items, keyword]);

  return (
    <div>
      <PageHeader
        title={data?.title ?? "查询表范本"}
        subtitle={data?.subtitle ?? "加载中…"}
      />
      <SearchBar
        placeholder={data?.keyword_placeholder ?? "搜索"}
        onSearch={setKeyword}
      />
      <DataTable<DemoQueryTableItem>
        rowKey="id"
        loading={loading}
        dataSource={filtered}
        columns={[
          { title: "设备编号", dataIndex: "code" },
          { title: "设备名称", dataIndex: "name" },
          { title: "所属部门", dataIndex: "dept" },
          {
            title: "状态",
            dataIndex: "status",
            render: (status: string) => (
              <StatusTag value={status} labelMap={STATUS_LABEL} colorMap={STATUS_COLOR} />
            ),
          },
          { title: "负责人", dataIndex: "owner" },
          { title: "更新时间", dataIndex: "updated_at" },
        ]}
        pagination={{ pageSize: 10, showSizeChanger: false }}
      />
    </div>
  );
}
