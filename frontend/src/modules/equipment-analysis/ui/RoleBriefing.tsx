import { Button, Card, Col, Divider, Drawer, Row, Space, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import type { AnalysisPageData, DeviceDetailData, FutureNarrative } from "@/modules/equipment-analysis/api/equipmentAnalysis";
import { buildDeviceDetailHref, type DeviceDetailNavContext } from "@/modules/equipment-analysis/ui/deviceNav";

/** 厂级汇报摘要 / 单机健康报告共用（打印友好） */
export function FleetBriefingPanel({
  kpis,
  narrative,
  scopeLabel,
  navCtx,
}: {
  kpis?: AnalysisPageData["kpis"];
  narrative?: FutureNarrative;
  scopeLabel?: string;
  navCtx?: DeviceDetailNavContext;
}) {
  const priority = narrative?.priority_devices ?? [];
  const stories = (narrative?.backtest_stories ?? []).slice(0, 2);
  const alarmKpi = kpis?.find((k) => k.title.includes("报警"));
  const warnKpi = kpis?.find((k) => k.title.includes("预警"));
  const pauseKpi = kpis?.find((k) => k.title.includes("暂停"));

  return (
    <div className="ea-report-print">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        设备预测 · 汇报摘要
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        范围：{scopeLabel || "全部"} · 本页供班长/设备主管汇报，非经营 BI
      </Typography.Paragraph>
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Typography.Text type="secondary">报警</Typography.Text>
            <Typography.Title level={3} style={{ margin: "4px 0 0" }}>
              {alarmKpi?.value ?? "—"}
            </Typography.Title>
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Typography.Text type="secondary">预警</Typography.Text>
            <Typography.Title level={3} style={{ margin: "4px 0 0" }}>
              {warnKpi?.value ?? "—"}
            </Typography.Title>
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Typography.Text type="secondary">预测暂停</Typography.Text>
            <Typography.Title level={3} style={{ margin: "4px 0 0" }}>
              {pauseKpi?.value ?? "—"}
            </Typography.Title>
          </Card>
        </Col>
      </Row>
      {narrative?.fleet_downtime_avoidable_label ? (
        <AlertDowntime label={narrative.fleet_downtime_avoidable_label} />
      ) : null}
      <Typography.Text strong>优先关注设备（Top {Math.min(5, priority.length)}）</Typography.Text>
      <ul style={{ marginTop: 8, paddingLeft: 20 }}>
        {priority.slice(0, 5).map((d) => (
          <li key={d.id} style={{ marginBottom: 6 }}>
            <Link
              to={buildDeviceDetailHref(d.id, {
                from: "future",
                tab: "analysis",
                ...navCtx,
              })}
            >
              {d.name}
            </Link>
            <Typography.Text type="secondary">
              {" "}
              （{d.dept_name}）— 7日 {d.risk_7d}% · RUL {d.rul_days} 天 · {d.likely_fault}
            </Typography.Text>
          </li>
        ))}
        {!priority.length ? <li>当前范围暂无高优先级设备</li> : null}
      </ul>
      {stories.length ? (
        <>
          <Divider style={{ margin: "12px 0" }} />
          <Typography.Text strong>决策提示</Typography.Text>
          {stories.map((s) => (
            <Typography.Paragraph key={s.id} style={{ marginTop: 8, marginBottom: 4 }}>
              <Typography.Text strong>{s.title}：</Typography.Text>
              {s.summary}
            </Typography.Paragraph>
          ))}
        </>
      ) : null}
      <div style={{ marginTop: 16 }}>
        <Button onClick={() => window.print()}>打印本页</Button>
      </div>
    </div>
  );
}

function AlertDowntime({ label }: { label: string }) {
  return (
    <Card size="small" style={{ marginBottom: 16, background: "rgba(82, 196, 26, 0.08)" }}>
      <Typography.Text>
        优先设备若上周按建议干预，合计可少停约{" "}
        <Typography.Text strong style={{ color: "#389e0d" }}>
          {label}
        </Typography.Text>
        （工况估计，须现场确认）
      </Typography.Text>
    </Card>
  );
}

export function DeviceHealthReportPanel({ data }: { data?: DeviceDetailData }) {
  if (!data) return null;
  const f = data.future;
  const c = data.current;
  return (
    <div className="ea-report-print">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        设备健康报告 · {data.name}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {data.code} · {data.dept_name} · {data.type}
      </Typography.Paragraph>
      <DescriptionsBlock
        items={[
          ["分析状态", data.status_label?.[data.analysis_status] ?? data.analysis_status],
          ["一句话", c?.one_liner ?? data.summary],
          ["健康指数 HI", f?.prediction_paused ? "预测暂停" : String(f?.health_index ?? "—")],
          ["24h / 7d 风险", f?.prediction_paused ? "—" : `${f?.risk_24h ?? "—"}% / ${f?.risk_7d ?? "—"}%`],
          ["RUL", f?.prediction_paused ? "—" : (f?.rul_range_label ?? "—")],
          ["预警分级", f?.alert_label ?? "—"],
          ["建议检修日", f?.maintain_by ?? "—"],
          ["计划检修", f?.prediction_paused ? "—" : (f?.downtime_planned_label ?? "—")],
          ["突发停机", f?.prediction_paused ? "—" : (f?.downtime_unplanned_label ?? "—")],
          ["可少停", f?.prediction_paused ? "—" : (f?.downtime_avoidable_label ?? "—")],
          ["主因", f?.primary_cause ?? f?.likely_fault ?? "—"],
        ]}
      />
      {(c?.action_steps?.length || f?.avoid?.length) ? (
        <>
          <Typography.Text strong>建议动作</Typography.Text>
          <ol style={{ marginTop: 8 }}>
            {(c?.action_steps?.length ? c.action_steps : f?.avoid ?? []).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </>
      ) : null}
      {c?.worsen_if_ignored ? (
        <Typography.Paragraph style={{ marginTop: 12 }}>
          <Typography.Text type="danger">若不处理：</Typography.Text>
          {c.worsen_if_ignored.summary}
        </Typography.Paragraph>
      ) : null}
      <div style={{ marginTop: 16 }}>
        <Button onClick={() => window.print()}>打印报告</Button>
      </div>
    </div>
  );
}

function DescriptionsBlock({ items }: { items: Array<[string, string]> }) {
  return (
    <Space direction="vertical" style={{ width: "100%", marginBottom: 12 }} size={4}>
      {items.map(([k, v]) => (
        <div key={k}>
          <Typography.Text type="secondary">{k}：</Typography.Text>
          <Typography.Text>{v}</Typography.Text>
        </div>
      ))}
    </Space>
  );
}

export function FleetBriefingDrawer({
  open,
  onClose,
  kpis,
  narrative,
  scopeLabel,
  navCtx,
}: {
  open: boolean;
  onClose: () => void;
  kpis?: AnalysisPageData["kpis"];
  narrative?: FutureNarrative;
  scopeLabel?: string;
  navCtx?: DeviceDetailNavContext;
}) {
  return (
    <Drawer title="汇报摘要" width={480} open={open} onClose={onClose} destroyOnClose>
      <FleetBriefingPanel kpis={kpis} narrative={narrative} scopeLabel={scopeLabel} navCtx={navCtx} />
    </Drawer>
  );
}

export function PriorityWatchCard({
  narrative,
  navCtx,
  loading,
}: {
  narrative?: FutureNarrative;
  navCtx?: DeviceDetailNavContext;
  loading?: boolean;
}) {
  const list = (narrative?.priority_devices ?? []).slice(0, 5);
  if (!list.length && !narrative?.fleet_downtime_avoidable_label) return null;
  return (
    <Card
      size="small"
      loading={loading}
      title={
        <Space wrap>
          <span>本班优先</span>
          <Tag color="red">先管谁</Tag>
          {narrative?.fleet_downtime_avoidable_label ? (
            <Tag color="green">可少停 {narrative.fleet_downtime_avoidable_label}</Tag>
          ) : null}
        </Space>
      }
      style={{ marginBottom: 12 }}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
        先管这几台 → 点进去看依据 → 按建议检修日排窗口
      </Typography.Paragraph>
      <Space direction="vertical" style={{ width: "100%" }} size={8}>
        {list.map((d, i) => (
          <div
            key={d.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              paddingBottom: 6,
              borderBottom: i < list.length - 1 ? "1px solid var(--app-border-color, #f0f0f0)" : undefined,
            }}
          >
            <Space wrap>
              <Tag>{i + 1}</Tag>
              <Link
                to={buildDeviceDetailHref(d.id, {
                  from: "future",
                  tab: "analysis",
                  ...navCtx,
                })}
              >
                {d.name}
              </Link>
              <Typography.Text type="secondary">{d.dept_name}</Typography.Text>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              7日 {d.risk_7d}% · RUL {d.rul_days} 天 · {d.likely_fault}
            </Typography.Text>
          </div>
        ))}
      </Space>
    </Card>
  );
}
