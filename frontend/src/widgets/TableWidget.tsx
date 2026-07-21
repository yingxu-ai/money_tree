import { Table, Tag } from "antd";
import WidgetShell from "@/widgets/WidgetShell";
import { useWidgetData } from "@/hooks/useWidgetData";
import type { WidgetProps } from "@/types/widget";

export default function TableWidget({
  title = "明细",
  metricCode,
  config,
  refreshToken,
}: WidgetProps) {
  const { loading, error, empty, data, reload } = useWidgetData({
    config,
    metricCode,
    refreshToken,
  });

  const unit = config?.unit || data?.unit || "";
  const rows = [...(data?.rows || [])].reverse().slice(0, 8);

  return (
    <WidgetShell
      title={config?.title || title}
      loading={loading}
      error={error}
      empty={empty}
      onRefresh={reload}
      minHeight={220}
    >
      <Table
        size="small"
        pagination={false}
        rowKey={(_, index) => String(index)}
        dataSource={rows.map((row, index) => ({
          key: index,
          time: String(row[0]).replace("T", " ").slice(0, 16),
          value: Number(row[1]),
        }))}
        columns={[
          { title: "时间", dataIndex: "time" },
          {
            title: `数值${unit ? ` (${unit})` : ""}`,
            dataIndex: "value",
            render: (v: number) => <Tag color="blue">{v}</Tag>,
          },
        ]}
      />
    </WidgetShell>
  );
}
