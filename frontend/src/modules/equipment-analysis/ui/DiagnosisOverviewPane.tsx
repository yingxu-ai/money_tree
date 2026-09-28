import { useMemo, useState } from "react";
import { Card, Col, Progress, Row, Segmented, Select, Space, Table, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import { KpiRow } from "@/components/blocks";
import { DeptTreeSelect, StatusTag } from "@/components/kit";
import {
  fetchDiagnosisOverview,
  type DiagnosisEventItem,
  type DiagnosisOverviewDevice,
  type DiagnosisOverviewData,
} from "@/modules/equipment-analysis/api/equipmentAnalysis";
import { useRequest } from "@/hooks/useRequest";
import { DemoAnchorBar } from "@/modules/equipment-analysis/ui/DemoAnchorBar";
import { buildDeviceDetailHref } from "@/modules/equipment-analysis/ui/deviceNav";
import { useDiagnosisOverviewParams } from "@/modules/equipment-analysis/ui/useFleetScopeParams";

const LEVEL_COLOR: Record<string, string> = {
  alarm: "red",
  warning: "orange",
  abnormal: "red",
};

function HealthDistribution({
  items,
  total,
  loading,
}: {
  items?: DiagnosisOverviewData["health_distribution"];
  total: number;
  loading?: boolean;
}) {
  if (!items?.length) return null;
  return (
    <Card size="small" title="健康状态分布（现状口径）" loading={loading} style={{ marginBottom: 16 }}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
        健康/关注/异常来自实测分析状态；离线为采集通信。与「未来风险」分列，避免两套算法混读。
      </Typography.Paragraph>
      <Row gutter={[16, 12]}>
        {items.map((h) => {
          const pct = total > 0 ? Math.round((h.count / total) * 100) : 0;
          const stroke =
            h.key === "abnormal" ? "#cf1322" : h.key === "watch" ? "#faad14" : h.key === "offline" ? "#bfbfbf" : "#52c41a";
          return (
            <Col xs={12} md={6} key={h.key}>
              <Space direction="vertical" style={{ width: "100%" }} size={4}>
                <Space>
                  <Tag color={h.color}>{h.label}</Tag>
                  <Typography.Text strong>
                    {h.count} 台
                  </Typography.Text>
                  <Typography.Text type="secondary">{pct}%</Typography.Text>
                </Space>
                <Progress percent={pct} showInfo={false} strokeColor={stroke} size="small" />
              </Space>
            </Col>
          );
        })}
      </Row>
    </Card>
  );
}

function DeviceHealthTable({
  data,
  loading,
  view,
}: {
  data?: DiagnosisOverviewData;
  loading?: boolean;
  view: "table" | "card";
}) {
  const navCtx = {
    from: "diagnosis" as const,
    tab: "analysis" as const,
    deptId: undefined as number | undefined,
  };
  const rows = data?.devices ?? [];

  if (view === "card") {
    return (
      <Row gutter={[12, 12]}>
        {rows.map((row) => (
          <Col xs={24} md={12} xl={8} key={row.id}>
            <Card
              size="small"
              title={
                <Link to={buildDeviceDetailHref(row.id, { ...navCtx, deptId: row.dept_id })}>
                  {row.name}
                </Link>
              }
              extra={
                <StatusTag
                  value={String(row.analysis_status)}
                  labelMap={data?.status_label}
                  colorMap={data?.status_color}
                />
              }
              loading={loading}
            >
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                <Typography.Text type="secondary">
                  {row.type} · {row.dept_name}
                </Typography.Text>
                <Space wrap>
                  <Tag>HI {row.health_index ?? "—"}</Tag>
                  <Tag color="red">异常 {row.current_issue_count ?? 0}</Tag>
                  <Tag color="orange">风险 {row.future_risk_count ?? 0}</Tag>
                </Space>
                <Typography.Text style={{ fontSize: 12 }}>{row.current_one_liner}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  未来：{row.future_one_liner}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {row.load_label}
                </Typography.Text>
                <Link to={buildDeviceDetailHref(row.id, { from: "diagnosis", tab: "analysis" })}>
                  查看详情
                </Link>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    );
  }

  return (
    <Table<DiagnosisOverviewDevice>
      size="small"
      rowKey="id"
      loading={loading}
      dataSource={rows}
      pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 台` }}
      scroll={{ x: 1100 }}
      columns={[
        {
          title: "设备名称",
          dataIndex: "name",
          fixed: "left",
          render: (v, row) => (
            <Link to={buildDeviceDetailHref(row.id, { from: "diagnosis", tab: "analysis" })}>
              {String(v)}
            </Link>
          ),
        },
        { title: "设备类型", dataIndex: "type", width: 110 },
        { title: "所属车间", dataIndex: "dept_name", width: 110 },
        {
          title: "当前状态",
          dataIndex: "analysis_status",
          width: 90,
          render: (v) => (
            <StatusTag value={String(v)} labelMap={data?.status_label} colorMap={data?.status_color} />
          ),
        },
        {
          title: "健康度",
          dataIndex: "health_index",
          width: 80,
          render: (v) => (v == null ? "—" : v),
        },
        {
          title: "当前异常",
          dataIndex: "current_issue_count",
          width: 90,
          render: (v) => <Tag color={Number(v) > 0 ? "red" : "default"}>{Number(v) || 0}</Tag>,
        },
        {
          title: "未来风险",
          dataIndex: "future_risk_count",
          width: 90,
          render: (v, row) => (
            <Space size={4}>
              <Tag color={Number(v) > 0 ? "orange" : "default"}>{Number(v) || 0}</Tag>
              {row.alert_label ? <Typography.Text type="secondary">{row.alert_label}</Typography.Text> : null}
            </Space>
          ),
        },
        {
          title: "能效/负载",
          dataIndex: "load_label",
          width: 160,
          ellipsis: true,
        },
        {
          title: "操作",
          key: "op",
          width: 100,
          fixed: "right",
          render: (_, row) => (
            <Link to={buildDeviceDetailHref(row.id, { from: "diagnosis", tab: "analysis" })}>
              查看详情
            </Link>
          ),
        },
      ]}
    />
  );
}

function EventsTable({
  events,
  loading,
}: {
  events?: DiagnosisEventItem[];
  loading?: boolean;
}) {
  return (
    <Table<DiagnosisEventItem>
      size="small"
      rowKey="id"
      loading={loading}
      dataSource={events ?? []}
      pagination={{ pageSize: 8, showTotal: (t) => `共 ${t} 条` }}
      scroll={{ x: 1100 }}
      columns={[
        {
          title: "类型",
          dataIndex: "kind_label",
          width: 100,
          render: (v, row) => (
            <Tag color={row.kind === "current" ? "red" : "orange"}>{String(v)}</Tag>
          ),
        },
        {
          title: "设备",
          dataIndex: "device_name",
          width: 120,
          render: (v, row) => (
            <Link to={buildDeviceDetailHref(row.device_id, { from: "diagnosis", tab: "analysis" })}>
              {String(v)}
            </Link>
          ),
        },
        { title: "部件", dataIndex: "component", width: 120, ellipsis: true },
        { title: "测点", dataIndex: "point", width: 100 },
        {
          title: "等级",
          dataIndex: "level_label",
          width: 90,
          render: (v, row) => <Tag color={LEVEL_COLOR[row.level] ?? "default"}>{String(v)}</Tag>,
        },
        { title: "风险描述", dataIndex: "description", ellipsis: true },
        { title: "建议措施", dataIndex: "advice", ellipsis: true, width: 180 },
        {
          title: "处理状态",
          dataIndex: "handle_status_label",
          width: 90,
          render: (v) => <Tag>{String(v)}</Tag>,
        },
      ]}
    />
  );
}

/** 分析诊断 · 总览（筛选 + KPI + 分布 + 设备 + 事件） */
export function DiagnosisOverviewPane({ mode = "full" }: { mode?: "full" | "devices" }) {
  const scope = useDiagnosisOverviewParams();
  const { data, loading, refresh } = useRequest(
    () =>
      fetchDiagnosisOverview({
        deptId: scope.deptId,
        deviceType: scope.deviceType,
        runStatus: scope.runStatus,
        period: scope.period,
      }),
    { deps: [scope.deptId, scope.deviceType, scope.runStatus, scope.period] },
  );
  const [listView, setListView] = useState<"table" | "card">("table");
  const total = useMemo(() => data?.devices?.length ?? 0, [data?.devices]);

  const filterBar = (
    <Card size="small" style={{ marginBottom: 12 }}>
      <Space wrap align="center">
        <Typography.Text type="secondary">厂区/车间</Typography.Text>
        <DeptTreeSelect
          allowClear
          placeholder="全部组织"
          style={{ width: 200 }}
          value={scope.deptId}
          onChange={(v) => scope.setDeptId(v == null ? undefined : Number(v))}
        />
        <Typography.Text type="secondary">设备类型</Typography.Text>
        <Select
          allowClear
          placeholder="全部类型"
          style={{ width: 140 }}
          value={scope.deviceType}
          onChange={(v) => scope.setDeviceType(v ?? undefined)}
          options={(data?.type_options ?? []).map((t) => ({ value: t, label: t }))}
        />
        <Typography.Text type="secondary">运行状态</Typography.Text>
        <Select
          allowClear
          placeholder="全部状态"
          style={{ width: 130 }}
          value={scope.runStatus}
          onChange={(v) => scope.setRunStatus(v ?? undefined)}
          options={data?.run_status_options ?? []}
        />
        <Typography.Text type="secondary">时间范围</Typography.Text>
        <Select
          style={{ width: 120 }}
          value={scope.period}
          onChange={(v) => scope.setPeriod(v)}
          options={
            data?.period_options ?? [
              { value: "shift", label: "本班" },
              { value: "24h", label: "近24小时" },
              { value: "7d", label: "近7日" },
            ]
          }
        />
        {data?.scope_label && data.scope_label !== "全部" ? (
          <Typography.Text type="secondary">范围：{data.scope_label}</Typography.Text>
        ) : null}
        <Typography.Link onClick={() => void refresh()}>刷新</Typography.Link>
      </Space>
    </Card>
  );

  const deviceCard = (
    <Card
      size="small"
      title="设备健康列表"
      style={{ marginBottom: mode === "full" ? 16 : 0 }}
      extra={
        <Segmented
          size="small"
          value={listView}
          onChange={(v) => setListView(v as "table" | "card")}
          options={[
            { label: "列表", value: "table" },
            { label: "卡片", value: "card" },
          ]}
        />
      }
    >
      <DeviceHealthTable data={data} loading={loading} view={listView} />
    </Card>
  );

  if (mode === "devices") {
    return (
      <div>
        {filterBar}
        <DemoAnchorBar
          items={data?.demo_items}
          navCtx={{ from: "diagnosis", tab: "analysis", ...scope.scopeCtx }}
        />
        {deviceCard}
      </div>
    );
  }

  return (
    <div>
      {filterBar}
      <DemoAnchorBar items={data?.demo_items} navCtx={{ from: "diagnosis", tab: "analysis", ...scope.scopeCtx }} />
      <KpiRow items={data?.kpis ?? []} loading={loading && !data} />
      <HealthDistribution items={data?.health_distribution} total={total} loading={loading && !data} />
      {deviceCard}
      <Card size="small" title="异常与风险事件">
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
          「现状异常」来自实测分析；「未来风险」来自预测判断。处理状态默认为待处理。
        </Typography.Paragraph>
        <EventsTable events={data?.events} loading={loading} />
      </Card>
    </div>
  );
}
