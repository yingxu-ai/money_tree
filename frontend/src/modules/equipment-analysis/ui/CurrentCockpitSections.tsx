import { Progress, Space, Table, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import { DataTable, StatusTag } from "@/components/kit";
import type {
  CurrentAnalysisPageData,
  DeptRankingRow,
  DeviceListItem,
  TypeStatRow,
} from "@/modules/equipment-analysis/api/equipmentAnalysis";
import { CockpitPanel } from "@/modules/equipment-analysis/ui/CockpitPanel";
import { buildDeviceDetailHref, buildDeviceListHref } from "@/modules/equipment-analysis/ui/deviceNav";

const PANEL_BODY = 300;

export function HealthBreakdown({
  data,
  loading,
}: {
  data?: CurrentAnalysisPageData;
  loading?: boolean;
}) {
  const total =
    data?.health_distribution?.reduce((s, p) => s + Number(p.value), 0) ?? 0;
  const colors: Record<string, string> = {
    正常: "#52c41a",
    关注: "#faad14",
    异常: "#ff4d4f",
  };

  return (
    <CockpitPanel title="设备健康状态" loading={loading} bodyMinHeight={PANEL_BODY}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {data?.health_distribution?.map((row) => {
          const pct = total ? Math.round((Number(row.value) / total) * 1000) / 10 : 0;
          return (
            <div key={row.label} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <Typography.Text>{row.label}</Typography.Text>
                <Typography.Text>
                  {row.value} 台 · {pct}%
                </Typography.Text>
              </div>
              <Progress
                percent={pct}
                showInfo={false}
                strokeColor={colors[row.label] ?? "#1677ff"}
                size="small"
              />
            </div>
          );
        })}
        {data?.summary_rates ? (
          <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
            健康率 {data.summary_rates.health_rate}% · 运行率 {data.summary_rates.running_rate}%
          </Typography.Text>
        ) : null}
      </div>
    </CockpitPanel>
  );
}

export function DeptRankingTable({
  rows,
  groupByLabel,
  loading,
}: {
  rows?: DeptRankingRow[];
  groupByLabel?: string;
  loading?: boolean;
}) {
  const title = groupByLabel ? `部门设备分析 · ${groupByLabel}` : "部门设备分析";
  return (
    <CockpitPanel title={title} loading={loading} bodyMinHeight={PANEL_BODY}>
      <Table<DeptRankingRow>
        size="small"
        rowKey="dept_id"
        loading={loading}
        pagination={false}
        dataSource={rows ?? []}
        scroll={{ y: 220 }}
        columns={[
          { title: "部门", dataIndex: "dept_name", ellipsis: true },
          { title: "设备数", dataIndex: "device_count", width: 72 },
          {
            title: "在线率",
            dataIndex: "online_rate",
            width: 80,
            render: (v: number) => `${v}%`,
          },
          { title: "运行中", dataIndex: "running_count", width: 72 },
          { title: "关注", dataIndex: "watch_count", width: 56 },
          { title: "异常", dataIndex: "abnormal_count", width: 56 },
          { title: "故障", dataIndex: "fault_count", width: 56 },
        ]}
      />
    </CockpitPanel>
  );
}

export function TypeStatsTable({
  rows,
  loading,
}: {
  rows?: TypeStatRow[];
  loading?: boolean;
}) {
  return (
    <CockpitPanel title="设备类型统计" loading={loading} bodyMinHeight={PANEL_BODY}>
      <Table<TypeStatRow>
        size="small"
        rowKey="type"
        loading={loading}
        pagination={false}
        dataSource={rows ?? []}
        scroll={{ y: 220 }}
        columns={[
          { title: "类型", dataIndex: "type" },
          { title: "总数", dataIndex: "total", width: 72 },
          { title: "异常+关注", dataIndex: "issue", width: 96 },
          {
            title: "问题占比",
            dataIndex: "issue_rate",
            width: 88,
            render: (v: number) => `${v}%`,
          },
        ]}
      />
    </CockpitPanel>
  );
}

export function FocusDevicesTable({
  data,
  loading,
  navCtx,
}: {
  data?: CurrentAnalysisPageData;
  loading?: boolean;
  navCtx?: { deptId?: number; deviceType?: string; groupBy?: string; page?: number };
}) {
  const items = data?.focus_items ?? data?.items ?? [];
  const hrefBase = { from: "cockpit" as const, tab: "analysis" as const, ...navCtx };

  return (
    <CockpitPanel
      title={
        <Space>
          <span>本班优先</span>
          <Tag color="red">先管这 {items.length} 台</Tag>
        </Space>
      }
      extra={
        <Link to={buildDeviceListHref({ deptId: navCtx?.deptId, analysisStatus: "abnormal" })}>
          全部异常 → 设备列表
        </Link>
      }
      loading={loading}
      bodyMinHeight={200}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
        现状页只列本班该先看的几台；全厂台账在设备列表。
      </Typography.Paragraph>
      <DataTable<DeviceListItem>
        rowKey="id"
        loading={loading}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: "当前范围内无异常或关注设备" }}
        columns={[
          {
            title: "设备",
            dataIndex: "name",
            render: (v: unknown, row: DeviceListItem) => (
              <Link to={buildDeviceDetailHref(row.id, hrefBase)}>{String(v)}</Link>
            ),
          },
          { title: "部门", dataIndex: "dept_name" },
          {
            title: "通信",
            dataIndex: "comm_status",
            width: 72,
            render: (v: unknown) => (
              <StatusTag
                value={String(v ?? "online")}
                labelMap={data?.status_label}
                colorMap={data?.status_color}
              />
            ),
          },
          {
            title: "运行",
            dataIndex: "run_bucket",
            width: 72,
            render: (v: unknown, row: DeviceListItem) => (
              <StatusTag
                value={String(v ?? row.run_status)}
                labelMap={data?.status_label}
                colorMap={data?.status_color}
              />
            ),
          },
          {
            title: "健康",
            dataIndex: "analysis_status",
            width: 72,
            render: (v: unknown) => (
              <StatusTag
                value={String(v)}
                labelMap={data?.status_label}
                colorMap={data?.status_color}
              />
            ),
          },
          {
            title: "持续",
            dataIndex: "duration_text",
            width: 100,
            render: (v: unknown, row: DeviceListItem) =>
              String(v ?? (row.duration_hours ? `${row.duration_hours}h` : "—")),
          },
          { title: "现象摘要", dataIndex: "one_liner", ellipsis: true },
          {
            title: "建议动作",
            dataIndex: "action_preview",
            ellipsis: true,
            width: 200,
            render: (v: unknown) =>
              v ? <Typography.Text type="secondary">{String(v)}</Typography.Text> : "—",
          },
        ]}
      />
    </CockpitPanel>
  );
}
