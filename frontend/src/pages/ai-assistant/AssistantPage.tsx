import { SendOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Collapse,
  Descriptions,
  List,
  Space,
  Tag,
  Typography,
  Input,
  message,
} from "antd";
import { useState } from "react";
import { aiQuery } from "@/api/system";
import { notifyError } from "@/components/kit/feedback";

const SUGGESTIONS = [
  "今日产量多少？",
  "分析今日生产异常原因",
  "设备稼动率怎么样？",
  "有哪些驾驶舱？",
];

const routeColor: Record<string, string> = {
  fixed_api: "blue",
  single_tool: "cyan",
  fixed_skill: "purple",
  planner: "orange",
  unknown: "default",
};

const routeLabel: Record<string, string> = {
  fixed_api: "固定 API",
  single_tool: "单 Tool",
  fixed_skill: "固定 Skill",
  planner: "Planner",
  unknown: "未识别",
};

export default function AssistantPage() {
  const [question, setQuestion] = useState("今日生产情况如何？");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const ask = async (text?: string) => {
    const q = (text ?? question).trim();
    if (!q) {
      message.warning("请输入问题");
      return;
    }
    setQuestion(q);
    setLoading(true);
    try {
      const data = await aiQuery(q, 1);
      setResult(data);
      if (data.status === "failed") {
        message.warning(String(data.summary || "未能完成查询"));
      } else {
        message.success("分析完成");
      }
    } catch (err) {
      notifyError(err, "请求失败");
    } finally {
      setLoading(false);
    }
  };

  const intent = (result?.intent || {}) as Record<string, unknown>;
  const evidence = (result?.evidence as Array<Record<string, unknown>> | undefined) || [];
  const recommendations = (result?.recommendations as string[] | undefined) || [];
  const nestedFindings =
    ((result?.data as Record<string, unknown> | undefined)?.findings as
      | Array<Record<string, unknown>>
      | undefined) || [];

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Card title="AI 助手">
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Typography.Text type="secondary">
            自然语言经 Query Pipeline 自动路由到 API / Tool / Skill。
          </Typography.Text>
          <Input.TextArea
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
            placeholder="例如：今日产量多少？ / 分析今日生产异常原因"
          />
          <Space wrap>
            {SUGGESTIONS.map((s) => (
              <Button key={s} size="small" onClick={() => ask(s)}>
                {s}
              </Button>
            ))}
          </Space>
          <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={() => ask()}>
            发送
          </Button>
        </Space>
      </Card>

      {result && (
        <Card
          title="结构化结果"
          extra={
            <Space>
              <Tag color={routeColor[String(result.route)] || "default"}>
                {routeLabel[String(result.route)] || String(result.route)}
              </Tag>
              {result.target ? <Tag>{String(result.target)}</Tag> : null}
            </Space>
          }
        >
          <Typography.Paragraph>
            <strong>摘要：</strong>
            {String(result.summary || "")}
          </Typography.Paragraph>

          {nestedFindings.length > 0 && (
            <>
              <Typography.Title level={5}>发现项</Typography.Title>
              <List
                size="small"
                dataSource={nestedFindings}
                renderItem={(f) => (
                  <List.Item>
                    <Space wrap>
                      <Typography.Text>{String(f.name || "")}</Typography.Text>
                      {f.impact ? <Tag>{String(f.impact)}</Tag> : null}
                      {typeof f.confidence === "number" ? (
                        <Tag>置信度 {(Number(f.confidence) * 100).toFixed(0)}%</Tag>
                      ) : null}
                    </Space>
                  </List.Item>
                )}
              />
            </>
          )}

          {recommendations.length > 0 && (
            <>
              <Typography.Title level={5}>建议</Typography.Title>
              <List
                size="small"
                dataSource={recommendations}
                renderItem={(item) => <List.Item>· {item}</List.Item>}
              />
            </>
          )}

          <Collapse
            style={{ marginTop: 16 }}
            items={[
              {
                key: "intent",
                label: "路由意图",
                children: (
                  <Descriptions size="small" column={1}>
                    <Descriptions.Item label="原问题">{String(intent.raw_query || "")}</Descriptions.Item>
                    <Descriptions.Item label="路由">{String(intent.route || "")}</Descriptions.Item>
                    <Descriptions.Item label="目标">{String(intent.target || "-")}</Descriptions.Item>
                    <Descriptions.Item label="原因">{String(intent.reason || "")}</Descriptions.Item>
                    <Descriptions.Item label="置信度">
                      {intent.confidence != null ? Number(intent.confidence).toFixed(2) : "-"}
                    </Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                key: "evidence",
                label: `Evidence（${evidence.length}）`,
                children: (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    {evidence.map((item, index) => (
                      <Card key={index} size="small" title={String(item.label || item.ref || item.source)}>
                        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
                          {JSON.stringify(item, null, 2)}
                        </pre>
                      </Card>
                    ))}
                    {result.trace_id ? (
                      <Typography.Text type="secondary">
                        trace_id: {String(result.trace_id)}
                      </Typography.Text>
                    ) : null}
                  </Space>
                ),
              },
              {
                key: "raw",
                label: "原始 JSON",
                children: (
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
                    {JSON.stringify(result, null, 2)}
                  </pre>
                ),
              },
            ]}
          />
        </Card>
      )}
    </Space>
  );
}
