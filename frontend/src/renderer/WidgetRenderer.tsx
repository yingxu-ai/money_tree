import { Card, Col, Empty, Row, Spin, Typography } from "antd";
import NumberWidget from "@/widgets/NumberWidget";
import LineWidget from "@/widgets/LineWidget";
import TableWidget from "@/widgets/TableWidget";
import type { DashboardDetail } from "@/types";
import type { WidgetConfig, WidgetProps } from "@/types/widget";

const widgetMap: Record<string, React.ComponentType<WidgetProps>> = {
  number: NumberWidget,
  line: LineWidget,
  table: TableWidget,
};

const spanMap: Record<string, number> = {
  number: 8,
  line: 16,
  table: 8,
};

interface WidgetRendererProps {
  dashboard: DashboardDetail;
  refreshToken?: number;
}

export default function WidgetRenderer({ dashboard, refreshToken = 0 }: WidgetRendererProps) {
  if (!dashboard.widgets?.length) {
    return <Empty description="暂无组件" />;
  }

  return (
    <Row gutter={[16, 16]}>
      {dashboard.widgets.map((widget) => {
        const Component = widgetMap[widget.type];
        const config = widget.config as WidgetConfig;
        const metricCode = config?.data_source?.params?.metric_code as string | undefined;
        const span = widget.position?.w
          ? Math.min(24, Math.max(6, Math.round((Number(widget.position.w) / 12) * 24)))
          : spanMap[widget.type] || 8;

        return (
          <Col key={widget.widget_code} xs={24} md={span}>
            {Component ? (
              <Component
                title={config?.title}
                metricCode={metricCode}
                config={config}
                refreshToken={refreshToken}
              />
            ) : (
              <Card>
                <Typography.Text type="secondary">未支持的组件类型: {widget.type}</Typography.Text>
              </Card>
            )}
          </Col>
        );
      })}
    </Row>
  );
}

export function WidgetRendererLoading() {
  return (
    <div style={{ textAlign: "center", padding: 48 }}>
      <Spin size="large" />
    </div>
  );
}
