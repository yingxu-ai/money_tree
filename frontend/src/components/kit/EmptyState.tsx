import { Empty } from "antd";
import { Button, Result } from "antd";

export interface EmptyStateProps {
  description?: string;
  extra?: React.ReactNode;
}

export function EmptyState({ description = "暂无数据", extra }: EmptyStateProps) {
  return (
    <Empty description={description} image={Empty.PRESENTED_IMAGE_SIMPLE}>
      {extra}
    </Empty>
  );
}

export interface ErrorStateProps {
  title?: string;
  subTitle?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "加载失败",
  subTitle,
  onRetry,
}: ErrorStateProps) {
  return (
    <Result
      status="error"
      title={title}
      subTitle={subTitle}
      extra={
        onRetry ? (
          <Button type="primary" onClick={onRetry}>
            重试
          </Button>
        ) : null
      }
    />
  );
}
