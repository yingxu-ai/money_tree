import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Card, Col, Collapse, List, Progress, Row, Space, Tag, Timeline, Typography } from "antd";
import type { ChartPoint } from "@/charts";
import { BarChart, LineChart } from "@/charts";
import type { FutureNarrative } from "@/modules/equipment-analysis/api/equipmentAnalysis";
import { Link } from "react-router-dom";
import { buildDeviceDetailHref, type DeviceDetailNavContext } from "@/modules/equipment-analysis/ui/deviceNav";
import {
  CurrentDiagnosticsDepth,
  type CurrentDiagnostics,
} from "@/modules/equipment-analysis/ui/CurrentDiagnosticsDepth";
import { MultiDimDiagnosisPanel } from "@/modules/equipment-analysis/ui/MultiDimDiagnosisPanel";
import type {
  MetricChartMeta,
  MetricForecastItem,
} from "@/modules/equipment-analysis/ui/MetricForecastPanel";

export interface MetricCard {
  code: string;
  label: string;
  value: number;
  unit: string;
  band_low: number;
  band_high: number;
  status: "normal" | "warn" | "alarm" | string;
  delta_pct?: number;
}

export interface AnomalyWindow {
  start_index: number;
  end_index: number;
  start_label: string;
  end_label: string;
  level: "warn" | "alarm" | string;
  label: string;
}

export interface TimelineEvent {
  step: number;
  at_index: number;
  at_label: string;
  kind: "alert" | "diagnose" | "action" | "observe" | "recover" | string;
  title: string;
  detail: string;
}

export interface CurrentRichBlock {
  verdict: string;
  one_liner: string;
  triggers?: string[];
  deviation_score?: number;
  duration_hours?: number;
  metric_cards?: MetricCard[];
  band_trend?: {
    code: string;
    label: string;
    unit: string;
    band_low: number;
    band_high: number;
    points: ChartPoint[];
  };
  multi_source?: Array<{ dim: string; score: number }>;
  contributions?: Array<{ name: string; value: number }>;
  evidence_compare?: Array<{ metric: string; baseline: number; current: number; unit: string }>;
  evidence: Array<{ metric: string; text: string }>;
  peer_compare?: string;
  action_steps?: string[];
  causes?: Array<{ name: string; prob: number; tag?: string }>;
  worsen_if_ignored?: {
    summary: string;
    horizon: string;
    risk_level: string;
  } | null;
  trend_24h?: Record<string, ChartPoint[]>;
  anomaly_windows?: AnomalyWindow[];
  timeline_events?: TimelineEvent[];
  diagnostics?: CurrentDiagnostics;
  metric_forecasts?: MetricForecastItem[];
  metric_forecasts_by_period?: Partial<
    Record<"week" | "month" | "quarter" | "year", MetricForecastItem[]>
  >;
  metric_chart?: MetricChartMeta;
}

const STATUS_COLOR: Record<string, string> = {
  normal: "green",
  warn: "orange",
  alarm: "red",
};

const EVENT_KIND_COLOR: Record<string, string> = {
  alert: "red",
  diagnose: "orange",
  action: "blue",
  observe: "green",
  recover: "green",
};

function circleNum(step: number) {
  const map = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];
  return map[step - 1] ?? `${step}.`;
}

export function Sparkline({ data, color = "#1677ff" }: { data: number[]; color?: string }) {
  if (!data.length) return <span>—</span>;
  const option: EChartsOption = {
    grid: { left: 0, right: 0, top: 2, bottom: 2 },
    xAxis: { type: "category", show: false, data: data.map((_, i) => i) },
    yAxis: { type: "value", show: false },
    series: [{ type: "line", data, smooth: true, symbol: "none", lineStyle: { width: 1.5, color } }],
  };
  return <ReactECharts option={option} style={{ width: 88, height: 28 }} notMerge lazyUpdate />;
}

export function BandLineChart({
  points,
  bandLow,
  bandHigh,
  unit = "",
  height = 220,
  loading,
  anomalyWindows,
  events,
}: {
  points: ChartPoint[];
  bandLow: number;
  bandHigh: number;
  unit?: string;
  height?: number;
  loading?: boolean;
  anomalyWindows?: AnomalyWindow[];
  events?: TimelineEvent[];
}) {
  const categories = points.map((p) => p.label);
  const markAreaData: Array<[{ xAxis: string; itemStyle?: { color: string } }, { xAxis: string }]> = [];
  for (const w of anomalyWindows ?? []) {
    const startLabel = categories[w.start_index] ?? w.start_label;
    const endLabel = categories[w.end_index] ?? w.end_label;
    if (!startLabel || !endLabel) continue;
    markAreaData.push([
      {
        xAxis: startLabel,
        itemStyle: {
          color: w.level === "alarm" ? "rgba(255, 77, 79, 0.14)" : "rgba(250, 173, 20, 0.16)",
        },
      },
      { xAxis: endLabel },
    ]);
  }

  const markPoints = (events ?? [])
    .filter((e) => e.at_index >= 0 && e.at_index < points.length)
    .map((e) => ({
      name: e.title,
      coord: [categories[e.at_index], points[e.at_index]?.value] as [string, number],
      value: circleNum(e.step),
      itemStyle: {
        color:
          e.kind === "alert"
            ? "#ff4d4f"
            : e.kind === "diagnose"
              ? "#fa8c16"
              : e.kind === "action"
                ? "#1677ff"
                : "#52c41a",
      },
      label: {
        show: true,
        formatter: "{c}",
        color: "#fff",
        fontSize: 11,
        fontWeight: 600,
      },
    }));

  const option: EChartsOption = {
    grid: { left: 48, right: 20, top: 36, bottom: 28 },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const rows = Array.isArray(params) ? params : [params];
        const head = rows[0] as { axisValue?: string; data?: number; marker?: string; seriesName?: string };
        const lines = [`${head?.axisValue ?? ""}`];
        for (const r of rows as Array<{ marker?: string; seriesName?: string; data?: number }>) {
          if (r.seriesName === "事件") continue;
          lines.push(`${r.marker ?? ""}${r.seriesName ?? ""}: ${r.data ?? "—"}${unit}`);
        }
        const idx = categories.indexOf(String(head?.axisValue ?? ""));
        const hit = (events ?? []).filter((e) => e.at_index === idx);
        for (const e of hit) {
          lines.push(`${circleNum(e.step)} ${e.title}：${e.detail}`);
        }
        return lines.join("<br/>");
      },
    },
    xAxis: { type: "category", data: categories, boundaryGap: false },
    yAxis: {
      type: "value",
      axisLabel: { formatter: unit ? `{value}${unit}` : "{value}" },
    },
    series: [
      {
        name: "测点",
        type: "line",
        smooth: true,
        data: points.map((p) => p.value),
        symbolSize: 6,
        z: 3,
        markArea: {
          silent: true,
          data: [
            [
              {
                yAxis: bandLow,
                itemStyle: { color: "rgba(82, 196, 26, 0.1)" },
              },
              { yAxis: bandHigh },
            ],
            ...markAreaData,
          ],
        },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { type: "dashed", color: "#faad14" },
          data: [{ yAxis: bandHigh, label: { formatter: "上限" } }],
        },
        markPoint:
          markPoints.length > 0
            ? {
                symbol: "circle",
                symbolSize: 22,
                data: markPoints,
              }
            : undefined,
      },
    ],
  };
  return (
    <ReactECharts
      option={option}
      showLoading={loading}
      style={{ height, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}

function DiagnosisTimeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return null;
  return (
    <Timeline
      style={{ marginTop: 4, marginBottom: 0 }}
      items={events.map((e) => ({
        color: EVENT_KIND_COLOR[e.kind] ?? "gray",
        children: (
          <div>
            <Space wrap size={6}>
              <Typography.Text strong>
                {circleNum(e.step)} {e.title}
              </Typography.Text>
              <Tag>{e.at_label}</Tag>
            </Space>
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0", fontSize: 12 }}>
              {e.detail}
            </Typography.Paragraph>
          </div>
        ),
      }))}
    />
  );
}

export function MetricCardsRow({ cards }: { cards: MetricCard[] }) {
  return (
    <Row gutter={[12, 12]}>
      {cards.map((c) => (
        <Col xs={12} md={6} key={c.code}>
          <Card size="small" className="ea-metric-card">
            <Typography.Text type="secondary">{c.label}</Typography.Text>
            <div style={{ fontSize: 22, fontWeight: 600 }}>
              {c.value}
              <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>
                {c.unit}
              </Typography.Text>
            </div>
            <Space size={4} wrap style={{ marginTop: 4 }}>
              <Tag color={STATUS_COLOR[c.status] ?? "default"}>
                {c.status === "alarm" ? "偏高" : c.status === "warn" ? "关注" : "正常"}
              </Tag>
              {c.delta_pct ? <Typography.Text type="secondary">较基线 +{c.delta_pct}%</Typography.Text> : null}
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 11, display: "block" }}>
              正常带 {c.band_low}～{c.band_high} {c.unit}
            </Typography.Text>
          </Card>
        </Col>
      ))}
    </Row>
  );
}

export function DeviceCurrentPanel({
  current,
  deviceName,
  analysisStatus,
  lastSampleAt,
  loading,
  onOpenTab,
}: {
  current?: CurrentRichBlock;
  deviceName?: string;
  analysisStatus?: string;
  lastSampleAt?: string;
  loading?: boolean;
  onOpenTab?: (tab: "future" | "analysis") => void;
}) {
  if (!current) return null;

  const alertType =
    analysisStatus === "abnormal" ? "error" : analysisStatus === "watch" ? "warning" : "success";
  const timeline = current.timeline_events ?? [];
  const anomalyWindows = current.anomaly_windows ?? [];
  const hasQuant =
    Boolean(current.contributions?.length) ||
    Boolean(current.evidence_compare?.length) ||
    Boolean(current.multi_source?.length) ||
    Boolean(current.evidence?.length) ||
    Boolean(current.causes?.length);
  const hasOps = Boolean(current.band_trend) || timeline.length > 0 || Boolean(current.metric_cards?.length);

  return (
    <div className="ea-current-panel">
      {/* ① 判定摘要：极短，动作去处置 */}
      <Card size="small" style={{ marginBottom: 12 }} loading={loading}>
        <Space wrap style={{ marginBottom: 8 }}>
          <Tag color={STATUS_COLOR[analysisStatus ?? "normal"] ?? "default"}>{current.verdict}</Tag>
          {current.triggers?.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
          {current.deviation_score != null ? (
            <Typography.Text type="secondary">偏离度 {current.deviation_score} 分</Typography.Text>
          ) : null}
          {current.duration_hours ? (
            <Typography.Text type="secondary">已持续 {current.duration_hours}h</Typography.Text>
          ) : null}
          {lastSampleAt ? (
            <Typography.Text type="secondary">采样 {lastSampleAt}</Typography.Text>
          ) : null}
        </Space>
        <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>
          {deviceName}
        </Typography.Title>
        <Typography.Paragraph type={alertType === "error" ? "danger" : undefined} style={{ marginBottom: 8 }}>
          {current.one_liner}
        </Typography.Paragraph>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          本页核验机理与特征依据；排窗口与动作见「处置」。
          {onOpenTab ? (
            <>
              {" "}
              <Typography.Link onClick={() => onOpenTab("analysis")}>看对照</Typography.Link>
              {" · "}
              <Typography.Link onClick={() => onOpenTab("future")}>去处置</Typography.Link>
            </>
          ) : null}
        </Typography.Text>
      </Card>

      {/* ② 经典频谱 + 特征频段（卖点第一层）；异常机下多维展开 */}
      <CurrentDiagnosticsDepth
        diagnostics={current.diagnostics}
        analysisStatus={analysisStatus}
        loading={loading}
      />

      {/* ③ 量化证据：当前 vs 基线、贡献、多源、原因候选 —— 主叙事，不折叠 */}
      {hasQuant ? (
        <Card
          size="small"
          title="量化证据 · 基线 / 贡献 / 多源"
          style={{ marginBottom: 12 }}
          loading={loading}
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
            相对健康基线的偏移与特征贡献，对应后期归因 / 融合模型的可解释输出。
          </Typography.Paragraph>
          <Row gutter={[12, 12]}>
            {current.evidence_compare?.length ? (
              <Col xs={24} lg={12}>
                <Typography.Text strong>当前 vs 基线</Typography.Text>
                <BarChart
                  data={current.evidence_compare.flatMap((e) => [
                    { label: `${e.metric}·基线`, value: e.baseline },
                    { label: `${e.metric}·当前`, value: e.current },
                  ])}
                  height={200}
                  loading={loading}
                />
              </Col>
            ) : null}
            {current.contributions?.length ? (
              <Col xs={24} lg={12}>
                <Typography.Text strong>异常特征贡献</Typography.Text>
                <BarChart
                  data={current.contributions.map((c) => ({ label: c.name, value: c.value }))}
                  unit="%"
                  height={200}
                  loading={loading}
                />
              </Col>
            ) : null}
            {current.multi_source?.length ? (
              <Col xs={24} lg={12}>
                <Typography.Text strong>多源一致性（越高越异常）</Typography.Text>
                <BarChart
                  data={current.multi_source.map((m) => ({ label: m.dim, value: m.score }))}
                  unit="分"
                  height={180}
                  loading={loading}
                />
              </Col>
            ) : null}
            {(current.causes?.length ?? 0) > 0 ? (
              <Col xs={24} lg={12}>
                <Typography.Text strong>原因候选</Typography.Text>
                <div style={{ marginTop: 8 }}>
                  <Space direction="vertical" style={{ width: "100%" }}>
                    {current.causes!.map((c) => (
                      <div key={c.name}>
                        <Space>
                          <span>{c.name}</span>
                          {c.tag ? <Tag>{c.tag}</Tag> : null}
                          <span>{c.prob}%</span>
                        </Space>
                        <Progress percent={c.prob} showInfo={false} size="small" />
                      </div>
                    ))}
                  </Space>
                </div>
              </Col>
            ) : null}
          </Row>
          {current.evidence?.length ? (
            <Card size="small" type="inner" title="证据说明" style={{ marginTop: 12 }}>
              <List
                size="small"
                dataSource={current.evidence}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta title={item.metric} description={item.text} />
                  </List.Item>
                )}
              />
              {current.peer_compare ? (
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 8 }}>
                  同类对照：{current.peer_compare}
                </Typography.Paragraph>
              ) : null}
            </Card>
          ) : null}
        </Card>
      ) : null}

      {/* ④ 高维联动：异常/关注默认展开，正常机折叠 */}
      {current.diagnostics?.multidim_panel ? (
        analysisStatus === "abnormal" || analysisStatus === "watch" ? (
          <MultiDimDiagnosisPanel panel={current.diagnostics.multidim_panel} loading={loading} />
        ) : (
          <Collapse
            style={{ marginBottom: 12 }}
            items={[
              {
                key: "multidim",
                label: "高维特征与时频联动（平行坐标 / 聚类 / FFT / 3D 瀑布）",
                children: (
                  <MultiDimDiagnosisPanel panel={current.diagnostics.multidim_panel} loading={loading} />
                ),
              },
            ]}
          />
        )
      ) : null}

      {/* ⑤ 工况辅证：已偏多久 —— 折叠，不抢机理 */}
      {hasOps ? (
        <Collapse
          style={{ marginBottom: 12 }}
          defaultActiveKey={[]}
          items={[
            {
              key: "ops",
              label: "工况辅证 · 带状趋势与诊断时间线（已偏多久）",
              children: (
                <>
                  {current.metric_cards?.length ? (
                    <div style={{ marginBottom: 12 }}>
                      <MetricCardsRow cards={current.metric_cards} />
                    </div>
                  ) : null}
                  <Row gutter={16}>
                    <Col xs={24} lg={timeline.length ? 14 : 24}>
                      {current.band_trend ? (
                        <Card
                          size="small"
                          title={
                            <Space wrap>
                              <span>{current.band_trend.label}</span>
                              {anomalyWindows.map((w) => (
                                <Tag
                                  key={`${w.start_index}-${w.end_index}`}
                                  color={w.level === "alarm" ? "red" : "orange"}
                                >
                                  {w.label} · {w.start_label}～{w.end_label}
                                </Tag>
                              ))}
                            </Space>
                          }
                          loading={loading}
                        >
                          <BandLineChart
                            points={current.band_trend.points}
                            bandLow={current.band_trend.band_low}
                            bandHigh={current.band_trend.band_high}
                            unit={current.band_trend.unit}
                            loading={loading}
                            anomalyWindows={anomalyWindows}
                            events={timeline}
                            height={260}
                          />
                        </Card>
                      ) : current.trend_24h ? (
                        <Card size="small" title="近 24h 趋势">
                          <LineChart
                            data={Object.values(current.trend_24h)[0] ?? []}
                            height={200}
                            loading={loading}
                          />
                        </Card>
                      ) : null}
                    </Col>
                    {timeline.length ? (
                      <Col xs={24} lg={10}>
                        <Card size="small" title="诊断时间线" loading={loading}>
                          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
                            告警 → 诊断（钉在趋势图 ①②③）；动作请到「处置」
                          </Typography.Paragraph>
                          <DiagnosisTimeline events={timeline} />
                        </Card>
                      </Col>
                    ) : null}
                  </Row>
                </>
              ),
            },
          ]}
        />
      ) : null}
    </div>
  );
}

export function FleetSituationCard({ situation }: { situation?: string }) {
  if (!situation) return null;
  return (
    <Card size="small" style={{ marginBottom: 12 }} title="本班态势">
      <Typography.Paragraph style={{ marginBottom: 0 }}>{situation}</Typography.Paragraph>
    </Card>
  );
}

export function FutureSituationCard({
  narrative,
  navCtx,
}: {
  narrative?: FutureNarrative;
  navCtx?: DeviceDetailNavContext;
}) {
  if (!narrative?.paragraphs?.length && !narrative?.action_hints?.length) return null;
  const stories = narrative.backtest_stories ?? [];
  return (
    <Card size="small" style={{ marginBottom: 12 }} title="预测态势">
      {narrative.paragraphs.map((p, i) => (
        <Typography.Paragraph
          key={i}
          style={{
            marginBottom:
              i === narrative.paragraphs.length - 1 && !narrative.priority_devices.length ? 12 : 8,
          }}
        >
          {p}
        </Typography.Paragraph>
      ))}
      {narrative.priority_devices.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text strong>优先关注设备</Typography.Text>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {narrative.priority_devices.map((d) => (
              <li key={d.id}>
                <Link
                  to={buildDeviceDetailHref(d.id, {
                    from: "future",
                    tab: "future",
                    ...navCtx,
                  })}
                >
                  {d.name}
                </Link>
                <Typography.Text type="secondary">
                  （{d.dept_name}）— 7日风险 {d.risk_7d}%，RUL {d.rul_days} 天，可能 {d.likely_fault}
                </Typography.Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {stories.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text strong>历史回溯与决策提示</Typography.Text>
          {narrative.fleet_downtime_avoidable_label ? (
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 8px" }}>
              优先设备回溯合计可少停约 {narrative.fleet_downtime_avoidable_label}（须现场确认）
            </Typography.Paragraph>
          ) : null}
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {stories.map((s) => (
              <li key={s.id} style={{ marginBottom: 6 }}>
                <Typography.Text strong>{s.title}</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ margin: "2px 0 0" }}>
                  {s.summary}
                </Typography.Paragraph>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {narrative.action_hints.length > 0 ? (
        <div>
          <Typography.Text strong>建议动作</Typography.Text>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20, marginBottom: 0 }}>
            {narrative.action_hints.map((hint, i) => (
              <li key={i}>
                <Typography.Text type="secondary">{hint}</Typography.Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
