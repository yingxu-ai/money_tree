import { Card, Col, Row, Space, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import type { AnalysisPageData } from "@/modules/equipment-analysis/api/equipmentAnalysis";
import { buildDeviceDetailHref, type DeviceDetailNavContext } from "@/modules/equipment-analysis/ui/deviceNav";

const MIX_COLOR: Record<string, string> = {
  energy: "green",
  life: "blue",
  balance: "default",
  output: "orange",
};

export function OptimizeFleetBoard({
  data,
  navCtx,
  loading,
}: {
  data?: AnalysisPageData;
  navCtx: DeviceDetailNavContext;
  loading?: boolean;
}) {
  const brief = data?.optimize_brief;
  const top = data?.focus_items ?? [];
  if (!brief && !top.length) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <Card size="small" title="调优判断" loading={loading} style={{ marginBottom: 12 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          {brief?.headline ?? "运行策略分流"}
        </Typography.Title>
        <Typography.Paragraph style={{ marginBottom: 8 }}>{brief?.stance}</Typography.Paragraph>
        <Space wrap>
          {(brief?.mix ?? []).map((m) => (
            <Tag key={m.key} color={MIX_COLOR[m.key] ?? "default"}>
              {m.label} {m.count} 台
            </Tag>
          ))}
        </Space>
        {brief?.if_act ? (
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            {brief.if_act}
          </Typography.Paragraph>
        ) : null}
      </Card>
      {top.length ? (
        <Card size="small" title="本班优先调优（Top）" loading={loading}>
          <Row gutter={[12, 12]}>
            {top.slice(0, 6).map((d, i) => (
              <Col xs={24} md={12} lg={8} key={d.id}>
                <Card size="small" type="inner">
                  <Space direction="vertical" size={4} style={{ width: "100%" }}>
                    <Space>
                      <Tag>{i + 1}</Tag>
                      <Link
                        to={buildDeviceDetailHref(d.id, {
                          ...navCtx,
                          from: "optimize",
                          tab: "analysis",
                        })}
                      >
                        {d.name}
                      </Link>
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {d.dept_name} · 能耗分 {d.energy_score ?? "—"} · {d.power != null ? `${d.power} kW` : "—"}
                    </Typography.Text>
                    <div>
                      <Tag color={MIX_COLOR[d.rec_strategy ?? ""] ?? "default"}>
                        {d.rec_strategy_label ?? "—"}
                      </Tag>
                      <Tag>{d.rec_energy_label ?? ""}</Tag>
                    </div>
                    <Typography.Text style={{ fontSize: 12 }}>{d.rec_reason}</Typography.Text>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        </Card>
      ) : null}
    </div>
  );
}
