import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import {
  Alert,
  Card,
  Col,
  Collapse,
  Descriptions,
  List,
  Progress,
  Radio,
  Row,
  Space,
  Tag,
  Timeline,
  Typography,
} from "antd";
import type { DeviceDetailData, FutureFaultCoverageWall } from "@/modules/equipment-analysis/api/equipmentAnalysis";

const ALERT_COLORS: Record<string, string> = {
  normal: "green",
  warning: "gold",
  alarm: "red",
  paused: "default",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "green",
  medium: "blue",
  low: "orange",
};

const WEEK_LABELS = ["-6周", "-5周", "-4周", "-3周", "-2周", "上周", "本周"];

function DegradationTrendChart({ data }: { data: number[] }) {
  const option: EChartsOption = useMemo(
    () => ({
      grid: { left: 40, right: 12, top: 16, bottom: 28 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: WEEK_LABELS.slice(-data.length),
        boundaryGap: false,
      },
      yAxis: {
        type: "value",
        name: "倍率",
        min: 0,
        axisLabel: { formatter: (v: number) => `${v}×` },
      },
      series: [
        {
          name: "劣化加速度",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 6,
          lineStyle: { width: 2, color: "#fa8c16" },
          itemStyle: { color: "#fa8c16" },
          areaStyle: { color: "rgba(250, 140, 22, 0.12)" },
          data,
        },
      ],
    }),
    [data],
  );
  return <ReactECharts option={option} style={{ height: 180, width: "100%" }} notMerge lazyUpdate />;
}

function FaultCoverageWall({ wall }: { wall?: FutureFaultCoverageWall }) {
  if (!wall?.groups?.length) return null;
  return (
    <div>
      <Space wrap style={{ marginBottom: 8 }}>
        <Tag color="blue">{wall.summary}</Tag>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          红=本次命中 · 青=已覆盖 · 灰虚=未启用
        </Typography.Text>
      </Space>
      <Row gutter={[12, 12]}>
        {wall.groups.map((g) => (
          <Col xs={24} md={12} key={g.key}>
            <Card size="small" type="inner" title={g.label}>
              <Space size={[8, 8]} wrap>
                {g.items.map((it) => {
                  const isHit = it.status === "hit";
                  const isGap = it.status === "gap";
                  return (
                    <Tag
                      key={it.key}
                      color={isHit ? "error" : isGap ? undefined : "cyan"}
                      title={it.hint ?? undefined}
                      style={
                        isGap
                          ? {
                              borderStyle: "dashed",
                              color: "rgba(0,0,0,0.35)",
                              background: "transparent",
                            }
                          : isHit
                            ? { fontWeight: 600 }
                            : undefined
                      }
                    >
                      {it.name}
                      {isHit && it.prob != null ? ` ${it.prob}%` : ""}
                    </Tag>
                  );
                })}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}

/** 处置 Tab：结论 → 怎么做 → 折叠辅证（不与对照/证据抢戏） */
export function FutureDevicePanel({
  data,
  loading,
  onOpenEvidence,
  onOpenCompare,
}: {
  data?: DeviceDetailData;
  loading?: boolean;
  onOpenEvidence?: () => void;
  onOpenCompare?: () => void;
}) {
  const f = data?.future;
  const [thresholdKey, setThresholdKey] = useState(f?.threshold_profile ?? "balanced");
  if (!f) return null;

  if (f.prediction_paused) {
    return (
      <Alert
        type="warning"
        showIcon
        message="预测暂停 · 暂不排处置"
        description={f.data_valid_reason ?? "当前数据不可靠，暂不输出风险预测与处置建议。"}
        style={{ marginBottom: 12 }}
      />
    );
  }

  const brief = f.decision_brief;
  const attribution = f.attribution_top3 ?? [];
  const degradationWeek = f.degradation_week ?? [];
  const thresholdOptions = f.threshold_options ?? [];
  const activeThreshold =
    thresholdOptions.find((o) => o.key === thresholdKey) ?? thresholdOptions[0];
  const similarCases = f.similar_cases ?? [];
  const avoidSteps = f.avoid ?? [];
  const worsen = data?.current?.worsen_if_ignored;

  const headline = brief?.headline ?? f.likely_fault ?? "关注窗口内风险";
  const stance = brief?.stance ?? data?.current?.one_liner ?? data?.summary ?? "请结合对照曲线与证据确认后排程。";

  return (
    <div>
      {/* ① 结论 */}
      <Card
        size="small"
        title="处置结论"
        loading={loading}
        style={{ marginBottom: 12 }}
        extra={
          <Space wrap>
            <Tag color={ALERT_COLORS[f.alert_level ?? ""] ?? "default"}>
              {f.alert_label ?? f.alert_level ?? "—"}
            </Tag>
            {brief?.severity ? <Tag>风险 {brief.severity}</Tag> : null}
            {f.confidence_label ? (
              <Tag color={CONFIDENCE_COLORS[f.confidence ?? ""] ?? "default"}>
                可信度 {f.confidence_label}
              </Tag>
            ) : null}
          </Space>
        }
      >
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          {headline}
        </Typography.Title>
        <Typography.Paragraph style={{ marginBottom: 12 }}>{stance}</Typography.Paragraph>
        <Descriptions column={{ xs: 1, md: 3 }} size="small">
          <Descriptions.Item label="建议检修日前">
            <Typography.Text strong>{f.maintain_by ?? "—"}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="可能类型">
            <Tag color="red">{f.likely_fault ?? "—"}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="RUL">
            {f.rul_range_label ?? `${f.rul_ci?.[0] ?? "—"}～${f.rul_ci?.[1] ?? "—"} 天`}
            <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              （24h {f.risk_24h}% · 7日 {f.risk_7d}% · HI {f.health_index ?? "—"}）
            </Typography.Text>
          </Descriptions.Item>
        </Descriptions>
        <Space wrap style={{ marginTop: 8 }}>
          {onOpenCompare ? <Typography.Link onClick={onOpenCompare}>← 回对照看预测曲线</Typography.Link> : null}
          {onOpenEvidence ? <Typography.Link onClick={onOpenEvidence}>看证据（频谱/特征）→</Typography.Link> : null}
          {f.review_required ? <Tag color="orange">低置信度，建议人工复核后再排工单</Tag> : null}
        </Space>
      </Card>

      {/* ② 怎么做 */}
      <Card size="small" title="怎么做（本班优先）" loading={loading} style={{ marginBottom: 12 }}>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          今日建议动作
        </Typography.Title>
        {avoidSteps.length ? (
          <List
            size="small"
            dataSource={avoidSteps}
            renderItem={(t, i) => (
              <List.Item>
                <Typography.Text>
                  {i + 1}. {t}
                </Typography.Text>
              </List.Item>
            )}
          />
        ) : (
          <Typography.Text type="secondary">暂无明确避免措施，先看证据与对照确认工况。</Typography.Text>
        )}

        <Typography.Title level={5} style={{ marginTop: 16 }}>
          若仍发生（预案）
        </Typography.Title>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="步骤">{f.contingency?.steps ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="备件">
            {(f.contingency?.spares ?? []).join("、") || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="转单">{f.contingency?.workorder_hint ?? "—"}</Descriptions.Item>
        </Descriptions>

        <Row gutter={[12, 12]} style={{ marginTop: 12 }} align="stretch">
          <Col xs={24} md={12} style={{ display: "flex" }}>
            <Card
              size="small"
              style={{
                width: "100%",
                flex: 1,
                display: "flex",
                flexDirection: "column",
                background: "#fffbe6",
                borderColor: "#ffe58f",
              }}
              styles={{ body: { flex: 1 } }}
            >
              <Typography.Text strong style={{ color: "#ad6800" }}>
                如果不处理
              </Typography.Text>
              <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                {brief?.if_ignore ?? worsen?.summary ?? "风险可能继续抬升，增加非计划停机概率。"}
              </Typography.Paragraph>
            </Card>
          </Col>
          <Col xs={24} md={12} style={{ display: "flex" }}>
            <Card
              size="small"
              style={{
                width: "100%",
                flex: 1,
                display: "flex",
                flexDirection: "column",
                background: "#f6ffed",
                borderColor: "#b7eb8f",
              }}
              styles={{ body: { flex: 1 } }}
            >
              <Typography.Text strong style={{ color: "#389e0d" }}>
                如果处理
              </Typography.Text>
              <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                {brief?.if_act ?? "按窗口点检/检修，可降低突发停机与连带损失。"}
              </Typography.Paragraph>
            </Card>
          </Col>
        </Row>

        {(brief?.causes?.length ?? 0) > 0 ? (
          <div style={{ marginTop: 12 }}>
            <Typography.Text type="secondary">主要原因（摘要）</Typography.Text>
            <ol style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
              {brief!.causes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
            {onOpenEvidence ? (
              <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                <Typography.Link onClick={onOpenEvidence}>到「证据」核对称谱与特征频段 →</Typography.Link>
              </Typography.Paragraph>
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* ③ 折叠辅证 */}
      <Collapse
        style={{ marginBottom: 12 }}
        items={[
          {
            key: "downtime",
            label: "停机时长对比 · 报警策略",
            children: (
              <>
                <Row gutter={16} style={{ marginBottom: 12 }}>
                  <Col xs={24} md={8}>
                    <Card size="small" type="inner" title="现在计划检修">
                      <Typography.Title level={4} style={{ margin: 0 }}>
                        {f.downtime_planned_label ?? "—"}
                      </Typography.Title>
                    </Card>
                  </Col>
                  <Col xs={24} md={8}>
                    <Card size="small" type="inner" title="拖到突发停机">
                      <Typography.Title level={4} style={{ margin: 0, color: "#cf1322" }}>
                        {f.downtime_unplanned_label ?? "—"}
                      </Typography.Title>
                    </Card>
                  </Col>
                  <Col xs={24} md={8}>
                    <Card size="small" type="inner" title="可少停">
                      <Typography.Title level={4} style={{ margin: 0, color: "#389e0d" }}>
                        {f.downtime_avoidable_label ?? "—"}
                      </Typography.Title>
                    </Card>
                  </Col>
                </Row>
                {f.downtime_hint ? (
                  <Typography.Paragraph type="secondary">{f.downtime_hint}</Typography.Paragraph>
                ) : null}
                {thresholdOptions.length > 0 ? (
                  <div>
                    <Typography.Text strong>报警灵敏度</Typography.Text>
                    <div style={{ marginTop: 8 }}>
                      <Radio.Group
                        optionType="button"
                        buttonStyle="solid"
                        value={thresholdKey}
                        onChange={(e) => setThresholdKey(e.target.value)}
                        options={thresholdOptions.map((o) => ({ label: o.label, value: o.key }))}
                      />
                    </div>
                    {activeThreshold ? (
                      <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                        {activeThreshold.desc}
                      </Typography.Paragraph>
                    ) : null}
                  </div>
                ) : null}
              </>
            ),
          },
          {
            key: "cases",
            label: `相近工况案例${similarCases.length ? `（${similarCases.length}）` : ""}`,
            children: similarCases.length ? (
              <Space direction="vertical" style={{ width: "100%" }} size={12}>
                {f.backtest_summary ? (
                  <Alert type="info" showIcon message="历史回溯" description={f.backtest_summary} />
                ) : null}
                {similarCases.map((c) => (
                  <Card key={c.id} size="small" type="inner">
                    <Space wrap style={{ marginBottom: 8 }}>
                      <Typography.Text strong>{c.title}</Typography.Text>
                      <Tag>{c.when}</Tag>
                      {c.is_counterfactual ? <Tag color="red">反例</Tag> : null}
                      {c.avoided_downtime_label ? (
                        <Tag color="green">少停 {c.avoided_downtime_label}</Tag>
                      ) : null}
                    </Space>
                    <Timeline
                      style={{ marginBottom: 0 }}
                      items={
                        c.is_counterfactual
                          ? [
                              { color: "orange", children: "告警出现后未及时干预" },
                              { color: "red", children: `行动：${c.action}` },
                              { color: "red", children: `结果：${c.outcome}` },
                            ]
                          : [
                              { color: "red", children: "① 告警 / 特征异常" },
                              { color: "orange", children: `② 诊断与处置：${c.action}` },
                              { color: "green", children: `③ 结果回落：${c.outcome}` },
                            ]
                      }
                    />
                  </Card>
                ))}
              </Space>
            ) : (
              <Typography.Text type="secondary">暂无相近案例</Typography.Text>
            ),
          },
          {
            key: "trust",
            label: "预测可信度 · 模型覆盖",
            children: (
              <>
                <Descriptions column={{ xs: 1, md: 2 }} size="small">
                  <Descriptions.Item label="预测可信度">
                    <Tag color={CONFIDENCE_COLORS[f.confidence ?? ""] ?? "default"}>
                      {f.confidence_label ?? f.confidence ?? "—"}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="数据完整度">
                    {f.data_valid ? (
                      <Tag color="green">有效</Tag>
                    ) : (
                      <Tag color="orange">{f.data_valid_reason ?? "无效"}</Tag>
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="RUL 区间">
                    {f.rul_ci?.[0] ?? "—"}～{f.rul_ci?.[1] ?? "—"} 天
                  </Descriptions.Item>
                  <Descriptions.Item label="覆盖摘要">
                    {f.fault_coverage_wall?.summary ??
                      ((f.model_coverage ?? []).slice(0, 4).join("、") || "—")}
                  </Descriptions.Item>
                </Descriptions>
                <div style={{ marginTop: 12 }}>
                  <FaultCoverageWall wall={f.fault_coverage_wall} />
                </div>
              </>
            ),
          },
          {
            key: "attr",
            label: "故障归因与劣化（详情见证据）",
            children: (
              <Row gutter={16}>
                <Col xs={24} lg={12}>
                  <Typography.Text strong>特征贡献 Top 3</Typography.Text>
                  {onOpenEvidence ? (
                    <Typography.Paragraph style={{ marginBottom: 8 }}>
                      <Typography.Link onClick={onOpenEvidence}>打开证据 Tab 看频谱/特征表 →</Typography.Link>
                    </Typography.Paragraph>
                  ) : (
                    <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                      规则归因摘要；机理细节在「证据」
                    </Typography.Paragraph>
                  )}
                  <Space direction="vertical" style={{ width: "100%" }} size={12}>
                    {attribution.map((item) => (
                      <div key={item.metric}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <Typography.Text>{item.name}</Typography.Text>
                          <Typography.Text type="secondary">{item.contribution_pct}%</Typography.Text>
                        </div>
                        <Progress percent={item.contribution_pct} size="small" showInfo={false} />
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {item.text}
                        </Typography.Text>
                      </div>
                    ))}
                    {!attribution.length ? (
                      <Typography.Text type="secondary">暂无归因条目</Typography.Text>
                    ) : null}
                  </Space>
                </Col>
                <Col xs={24} lg={12}>
                  <Space style={{ marginBottom: 8 }}>
                    <Typography.Text strong>劣化加速度</Typography.Text>
                    <Tag color={f.degradation_ratio && f.degradation_ratio >= 1.8 ? "orange" : "default"}>
                      {f.degradation_label ?? `×${f.degradation_ratio ?? "—"}`}
                    </Tag>
                  </Space>
                  {degradationWeek.length > 1 ? (
                    <DegradationTrendChart data={degradationWeek} />
                  ) : (
                    <Typography.Text type="secondary">暂无周趋势</Typography.Text>
                  )}
                  <Descriptions column={1} size="small" style={{ marginTop: 12 }}>
                    <Descriptions.Item label="异常残差">
                      <Space>
                        <Typography.Text>{f.residual_score ?? "—"}</Typography.Text>
                        <Tag color={f.residual_score && f.residual_score >= 60 ? "red" : "default"}>
                          {f.residual_label ?? "—"}
                        </Tag>
                      </Space>
                    </Descriptions.Item>
                  </Descriptions>
                </Col>
              </Row>
            ),
          },
        ]}
      />
    </div>
  );
}
