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

/** 顶部 KPI 卡片行：数量由数据驱动；≥5 个时桌面端等分一行。 */
export default function KpiRow({ items, loading }: KpiRowProps) {
  if (!items.length) return null;
  const n = items.length;
  // 5 个及以上：桌面等分一行；4/3/2 仍用 24 栅格
  const useFlex = n >= 5;
  const span = n >= 4 ? 6 : n === 3 ? 8 : 12;

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }} align="stretch" wrap={!useFlex}>
      {items.map((item) => (
        <Col
          key={item.title}
          xs={24}
          sm={useFlex ? undefined : 12}
          md={useFlex ? undefined : span}
          flex={useFlex ? "1 1 0" : undefined}
          style={{ display: "flex", minWidth: useFlex ? 140 : undefined }}
        >
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
