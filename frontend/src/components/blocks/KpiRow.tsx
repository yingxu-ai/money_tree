import { Card, Col, Row, Statistic, Typography } from "antd";

export interface KpiItem {
  title: string;
  value: number | string;
  unit?: string;
  /** @deprecated 较上期文案；新页面请用 ratio */
  delta?: string;
  /** 占比说明，如「1013/1050 全厂（96.5%）」 */
  ratio?: string;
}

export interface KpiRowProps {
  items: KpiItem[];
  loading?: boolean;
}

/** 顶部 KPI 卡片行：数量由数据驱动。 */
export default function KpiRow({ items, loading }: KpiRowProps) {
  if (!items.length) return null;
  const span = items.length >= 4 ? 6 : items.length === 3 ? 8 : 12;

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }} align="stretch">
      {items.map((item) => (
        <Col key={item.title} xs={24} sm={12} md={span} style={{ display: "flex" }}>
          <Card size="small" loading={loading} style={{ width: "100%", minHeight: 108 }}>
            <Statistic
              title={item.title}
              value={item.value}
              suffix={item.unit}
              precision={typeof item.value === "number" && !Number.isInteger(item.value) ? 1 : 0}
            />
            {item.ratio ? (
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
                {item.ratio}
              </Typography.Text>
            ) : item.delta ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                较上期 {item.delta}
              </Typography.Text>
            ) : null}
          </Card>
        </Col>
      ))}
    </Row>
  );
}
