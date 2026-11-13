import { Card, Col, Row, Statistic, Typography } from "antd";

export interface KpiPart {
  label: string;
  value: number | string;
}

export interface KpiItem {
  title: string;
  value: number | string;
  unit?: string;
  /** @deprecated 较上期文案；新页面请用 ratio */
  delta?: string;
  /** 占比说明，如「1013/1050 全厂（96.5%）」 */
  ratio?: string;
  /** 同一卡片内多指标（如应报/已报/未报） */
  parts?: KpiPart[];
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
            {item.parts?.length ? (
              <>
                <Typography.Text type="secondary" style={{ fontSize: 14, display: "block", marginBottom: 8 }}>
                  {item.title}
                </Typography.Text>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {item.parts.map((p) => (
                    <div key={p.label} style={{ minWidth: 56, flex: "1 1 0" }}>
                      <Statistic
                        title={
                          <span style={{ fontSize: 12, color: "rgba(0,0,0,0.45)" }}>{p.label}</span>
                        }
                        value={p.value}
                        valueStyle={{ fontSize: 22 }}
                        precision={
                          typeof p.value === "number" && !Number.isInteger(p.value) ? 1 : 0
                        }
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <Statistic
                title={item.title}
                value={item.value}
                suffix={item.unit}
                precision={typeof item.value === "number" && !Number.isInteger(item.value) ? 1 : 0}
              />
            )}
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
