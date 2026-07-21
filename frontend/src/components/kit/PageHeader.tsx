import { Space, Typography } from "antd";

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  extra?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * 页头：左侧标题/副标题，右侧操作区。
 */
export default function PageHeader({ title, subtitle, extra, style }: PageHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 16,
        marginBottom: 16,
        ...style,
      }}
    >
      <div style={{ minWidth: 0 }}>
        {typeof title === "string" ? (
          <Typography.Title level={4} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
        ) : (
          title
        )}
        {subtitle ? (
          <div style={{ marginTop: 4 }}>
            {typeof subtitle === "string" ? (
              <Typography.Text type="secondary">{subtitle}</Typography.Text>
            ) : (
              subtitle
            )}
          </div>
        ) : null}
      </div>
      {extra ? <Space wrap>{extra}</Space> : null}
    </div>
  );
}
