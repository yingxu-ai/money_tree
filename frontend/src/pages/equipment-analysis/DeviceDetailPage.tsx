import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PageHeader, StatusTag } from "@/components/kit";
import { fetchDeviceDetail } from "@/api/equipmentAnalysis";
import { useRequest } from "@/hooks/useRequest";
import { DeviceCurrentPanel } from "@/pages/equipment-analysis/CurrentAnalysisBlocks";
import type { CurrentRichBlock } from "@/pages/equipment-analysis/CurrentAnalysisBlocks";
import { FutureDevicePanel } from "@/pages/equipment-analysis/FutureDevicePanel";
import { MetricForecastPanel } from "@/pages/equipment-analysis/MetricForecastPanel";
import { DeviceSchematicPanel } from "@/pages/equipment-analysis/schematics/DeviceSchematicPanel";
import { DeviceHealthReportPanel } from "@/pages/equipment-analysis/RoleBriefing";
import {
  buildCompareHref,
  defaultDetailTab,
  detailBackLink,
  detailContextMessage,
  isDeviceDetailTab,
  parseDeviceNavContext,
  type DeviceDetailTab,
} from "@/pages/equipment-analysis/deviceNav";

type TabKey = DeviceDetailTab;

const ALERT_TAG: Record<string, string> = {
  normal: "green",
  warning: "gold",
  alarm: "red",
  paused: "default",
};

/** 旧 tab=optimize 落到对照 */
function resolveTab(raw: string | null, fallback: TabKey): TabKey {
  if (raw === "optimize") return "analysis";
  if (isDeviceDetailTab(raw)) return raw;
  return fallback;
}

export default function DeviceDetailPage() {
  const { id = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navCtx = useMemo(() => parseDeviceNavContext(searchParams), [searchParams]);
  const activeTab: TabKey = resolveTab(searchParams.get("tab"), defaultDetailTab(navCtx));
  const backLink = detailBackLink(navCtx);
  const [reportOpen, setReportOpen] = useState(false);

  const fetcher = useMemo(() => () => fetchDeviceDetail(id), [id]);
  const { data, loading } = useRequest(fetcher, { deps: [id] });

  if (data?.error === "not_found") {
    return (
      <div>
        <PageHeader title="设备不存在" extra={<Link to="/devices">返回列表</Link>} />
      </div>
    );
  }

  const setTab = (key: string) => {
    const next = new URLSearchParams(searchParams);
    // 必须写入 tab（含 overview），否则会删掉 tab 又回落到默认「对照」
    next.set("tab", key);
    setSearchParams(next);
  };

  const comparePeerIds = navCtx.compareIds?.length ? navCtx.compareIds : [id];
  const contextMessage = detailContextMessage(navCtx, data?.name);

  const future = data?.future;
  const current = data?.current as CurrentRichBlock | undefined;
  const taskOneLiner = current?.one_liner ?? data?.summary;

  return (
    <div>
      <PageHeader
        title={data?.title ?? id}
        subtitle={data?.subtitle}
        extra={
          <Space>
            <Button size="small" onClick={() => setReportOpen(true)}>
              健康报告
            </Button>
            <Button size="small">
              <Link to={buildCompareHref(comparePeerIds, navCtx.period)}>加入对比</Link>
            </Button>
            {backLink ? (
              <Button size="small">
                <Link to={backLink.to}>{backLink.label}</Link>
              </Button>
            ) : null}
            <Button size="small">
              <Link to="/analysis/diagnosis">← 分析诊断</Link>
            </Button>
            <Button size="small">
              <Link to="/devices">← 设备列表</Link>
            </Button>
          </Space>
        }
      />

      {contextMessage ? (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={contextMessage} />
      ) : null}

      <Card size="small" style={{ marginBottom: 12 }} loading={loading && !data}>
        <Space wrap style={{ marginBottom: 8 }}>
          <StatusTag
            value={String(data?.run_status ?? "")}
            labelMap={data?.status_label}
            colorMap={data?.status_color}
          />
          <StatusTag
            value={String(data?.analysis_status ?? "")}
            labelMap={data?.status_label}
            colorMap={data?.status_color}
          />
          {future?.alert_label ? (
            <Tag color={ALERT_TAG[future.alert_level ?? ""] ?? "default"}>{future.alert_label}</Tag>
          ) : null}
          {future?.prediction_paused ? <Tag>预测暂停</Tag> : null}
          {future && !future.prediction_paused && future.health_index != null ? (
            <Tag
              color={
                future.health_band === "red" ? "red" : future.health_band === "yellow" ? "gold" : "green"
              }
            >
              HI {future.health_index}
            </Tag>
          ) : null}
          {future && !future.prediction_paused && future.risk_24h != null ? (
            <Tag>24h {future.risk_24h}%</Tag>
          ) : null}
          {future?.maintain_by ? <Tag color="blue">建议检修日前 {future.maintain_by}</Tag> : null}
        </Space>
        <Typography.Paragraph style={{ marginBottom: 4 }}>
          <Typography.Text type="secondary">任务条 · </Typography.Text>
          {taskOneLiner}
        </Typography.Paragraph>
        {future?.primary_cause || future?.likely_fault ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            主因：{future.primary_cause ?? future.likely_fault}
            {future.rul_range_label ? ` · RUL ${future.rul_range_label}` : ""}
          </Typography.Text>
        ) : null}
      </Card>

      <Tabs
        activeKey={activeTab}
        onChange={setTab}
        items={[
          {
            key: "analysis",
            label: "对照",
            children: (
              <MetricForecastPanel
                items={current?.metric_forecasts}
                itemsByPeriod={current?.metric_forecasts_by_period}
                chartMeta={current?.metric_chart}
                loading={loading && !data}
                onOpenEvidence={() => setTab("current")}
                onOpenFuture={() => setTab("future")}
                schematic={
                  <DeviceSchematicPanel
                    deviceType={data?.type}
                    attribution={future?.attribution_top3}
                    likelyFault={future?.likely_fault}
                    primaryCause={future?.primary_cause}
                    alertLevel={future?.alert_level}
                    confidenceLabel={future?.confidence_label}
                    interactive={data?.type === "螺杆压缩机"}
                  />
                }
              />
            ),
          },
          {
            key: "current",
            label: "证据",
            children: (
              <DeviceCurrentPanel
                current={current}
                deviceName={data?.name}
                analysisStatus={data?.analysis_status}
                lastSampleAt={data?.last_sample_at}
                loading={loading && !data}
                onOpenTab={(t) => setTab(t)}
              />
            ),
          },
          {
            key: "future",
            label: "处置",
            children: (
              <FutureDevicePanel
                data={data}
                loading={loading && !data}
                onOpenEvidence={() => setTab("current")}
                onOpenCompare={() => setTab("analysis")}
              />
            ),
          },
          {
            key: "overview",
            label: "设备信息",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Alert
                  type="info"
                  showIcon
                  message="本页是设备档案与采集绑定，不含分析曲线。看数请到「对照」，看机理请到「证据」。"
                />
                <Card size="small" title="设备档案" loading={loading}>
                  <Descriptions bordered column={{ xs: 1, md: 2 }} size="small">
                    <Descriptions.Item label="设备名称">{data?.name}</Descriptions.Item>
                    <Descriptions.Item label="设备编码">{data?.code}</Descriptions.Item>
                    <Descriptions.Item label="设备类型">{data?.type ?? "—"}</Descriptions.Item>
                    <Descriptions.Item label="所属部门">{data?.dept_name}</Descriptions.Item>
                    <Descriptions.Item label="运行状态">
                      <StatusTag
                        value={String(data?.run_status ?? "")}
                        labelMap={data?.status_label}
                        colorMap={data?.status_color}
                      />
                    </Descriptions.Item>
                    <Descriptions.Item label="通信状态">
                      <Tag color={data?.comm_status === "online" ? "green" : "default"}>
                        {data?.comm_status === "online" ? "在线" : data?.comm_status ?? "—"}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="今日产量">{data?.output_today ?? "—"}</Descriptions.Item>
                    <Descriptions.Item label="能耗分">{data?.energy_score ?? "—"}</Descriptions.Item>
                    {data?.alarm_code ? (
                      <Descriptions.Item label="关联报警" span={2}>
                        <Tag color="red">{data.alarm_code}</Tag>
                      </Descriptions.Item>
                    ) : null}
                    <Descriptions.Item label="台账摘要" span={2}>
                      {data?.summary ?? "—"}
                    </Descriptions.Item>
                  </Descriptions>
                </Card>

                <Card size="small" title="采集绑定" loading={loading}>
                  <Descriptions bordered column={{ xs: 1, md: 2 }} size="small">
                    <Descriptions.Item label="采集源">{data?.source_name ?? data?.source_id ?? "—"}</Descriptions.Item>
                    <Descriptions.Item label="源类型">{data?.source_kind ?? "—"}</Descriptions.Item>
                    <Descriptions.Item label="采集周期">
                      {data?.source_interval_sec != null ? `${data.source_interval_sec} 秒` : "—"}
                    </Descriptions.Item>
                    <Descriptions.Item label="最近采样">{data?.last_sample_at ?? "—"}</Descriptions.Item>
                    <Descriptions.Item label="绑定测点数">{data?.point_count ?? data?.points?.length ?? 0}</Descriptions.Item>
                    <Descriptions.Item label="实时快照" span={2}>
                      {data?.realtime_display || "—"}
                    </Descriptions.Item>
                  </Descriptions>
                </Card>

                <Card size="small" title="测点清单" loading={loading}>
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={data?.points ?? []}
                    locale={{ emptyText: "暂无绑定测点" }}
                    columns={[
                      { title: "测点名称", dataIndex: "name" },
                      { title: "编码", dataIndex: "code", width: 120 },
                      {
                        title: "当前值",
                        dataIndex: "value",
                        width: 100,
                        render: (v: unknown) => (v == null || v === "" ? "—" : String(v)),
                      },
                      { title: "单位", dataIndex: "unit", width: 80 },
                      { title: "分类", dataIndex: "category", width: 100 },
                    ]}
                  />
                </Card>
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        title="健康报告"
        width={480}
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        destroyOnClose
      >
        <DeviceHealthReportPanel data={data} />
      </Drawer>
    </div>
  );
}
