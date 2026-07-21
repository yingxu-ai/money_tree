import { ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Collapse, Descriptions, List, Space, Spin, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { executeSkill, fetchDashboard } from "@/api/system";
import WidgetRenderer from "@/renderer/WidgetRenderer";
import type { DashboardDetail } from "@/types";

interface Finding {
  name: string;
  confidence: number;
  impact?: string;
  detail?: string;
}

interface EvidenceItem {
  source: string;
  ref: string;
  label?: string;
  data?: {
    summary?: Record<string, number>;
    unit?: string;
    metric_code?: string;
  };
}

export default function DashboardDetailPage() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<DashboardDetail | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const data = await fetchDashboard(Number(id));
        setDashboard(data);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const result = await executeSkill("production_anomaly_analysis", {
        factory_id: 1,
        date: new Date().toISOString().slice(0, 10),
      });
      setAnalysis(result as Record<string, unknown>);
      message.success("分析完成");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "分析失败");
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading || !dashboard) return <Spin />;

  const findings = (analysis?.findings as Finding[] | undefined) || [];
  const evidence = (analysis?.evidence as EvidenceItem[] | undefined) || [];
  const recommendations = (analysis?.recommendations as string[] | undefined) || [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {dashboard.name}
          </Typography.Title>
          <Typography.Text type="secondary">{dashboard.description}</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => setRefreshToken((t) => t + 1)}>
            刷新组件
          </Button>
          <Button type="primary" loading={analyzing} onClick={handleAnalyze}>
            分析原因
          </Button>
        </Space>
      </div>

      <WidgetRenderer dashboard={dashboard} refreshToken={refreshToken} />

      {analysis && (
        <Card title="分析结果" style={{ marginTop: 24 }}>
          <Typography.Paragraph>
            <strong>摘要：</strong>
            {String(analysis.summary || "")}
          </Typography.Paragraph>

          <Typography.Title level={5}>发现项</Typography.Title>
          <List
            size="small"
            dataSource={findings}
            renderItem={(f) => (
              <List.Item>
                <Space wrap>
                  <Typography.Text>{f.name}</Typography.Text>
                  <Tag color={f.impact === "high" ? "red" : f.impact === "medium" ? "orange" : "blue"}>
                    {f.impact || "info"}
                  </Tag>
                  <Tag>置信度 {(f.confidence * 100).toFixed(0)}%</Tag>
                  {f.detail ? <Typography.Text type="secondary">{f.detail}</Typography.Text> : null}
                </Space>
              </List.Item>
            )}
          />

          <Typography.Title level={5} style={{ marginTop: 16 }}>
            建议
          </Typography.Title>
          <List
            size="small"
            dataSource={recommendations}
            renderItem={(item) => <List.Item>· {item}</List.Item>}
          />

          <Collapse
            style={{ marginTop: 16 }}
            items={[
              {
                key: "evidence",
                label: `Evidence（${evidence.length}）`,
                children: (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    {evidence.map((item, index) => (
                      <Card key={index} size="small" title={item.label || item.ref}>
                        <Descriptions size="small" column={2}>
                          <Descriptions.Item label="来源">{item.source}</Descriptions.Item>
                          <Descriptions.Item label="引用">{item.ref}</Descriptions.Item>
                          <Descriptions.Item label="最新值">
                            {item.data?.summary?.latest ?? "-"} {item.data?.unit || ""}
                          </Descriptions.Item>
                          <Descriptions.Item label="变化">
                            {item.data?.summary?.delta_pct ?? "-"}%
                          </Descriptions.Item>
                        </Descriptions>
                      </Card>
                    ))}
                    {analysis.trace_id ? (
                      <Typography.Text type="secondary">
                        trace_id: {String(analysis.trace_id)}
                      </Typography.Text>
                    ) : null}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
