import { ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Empty, Result, Skeleton, Space, Typography } from "antd";

interface WidgetShellProps {
  title?: string;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  onRefresh?: () => void;
  extra?: React.ReactNode;
  children: React.ReactNode;
  minHeight?: number;
}

export default function WidgetShell({
  title = "组件",
  loading,
  error,
  empty,
  onRefresh,
  extra,
  children,
  minHeight = 140,
}: WidgetShellProps) {
  return (
    <Card
      title={title}
      extra={
        <Space size={8}>
          {extra}
          {onRefresh ? (
            <Button type="text" size="small" icon={<ReloadOutlined />} onClick={onRefresh} />
          ) : null}
        </Space>
      }
      styles={{ body: { minHeight } }}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : error ? (
        <Result
          status="error"
          title="加载失败"
          subTitle={error}
          extra={
            onRefresh ? (
              <Button size="small" onClick={onRefresh}>
                重试
              </Button>
            ) : null
          }
        />
      ) : empty ? (
        <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        children
      )}
    </Card>
  );
}

export function DeltaBadge({ value }: { value?: number }) {
  if (value === undefined || value === null || Number.isNaN(value)) return null;
  const color = value > 0 ? "#52c41a" : value < 0 ? "#ff4d4f" : "#999";
  const prefix = value > 0 ? "+" : "";
  return (
    <Typography.Text style={{ color, fontSize: 12 }}>
      {prefix}
      {value.toFixed(1)}%
    </Typography.Text>
  );
}
