import { useState } from "react";
import { Alert, Button, Card, Col, Row, Tag, Space, Typography } from "antd";
import { Link } from "react-router-dom";
import { ChartGrid, KpiRow } from "@/components/blocks";
import { DataTable, PageHeader } from "@/components/kit";
import {
  fetchCurrentAnalysis,
  fetchFutureAnalysis,
  fetchOptimizeAnalysis,
  type DeviceListItem,
} from "@/api/equipmentAnalysis";
import { useRequest } from "@/hooks/useRequest";
import { FleetSituationCard, FutureSituationCard } from "@/pages/equipment-analysis/CurrentAnalysisBlocks";
import {
  DeptRankingTable,
  FocusDevicesTable,
  TypeStatsTable,
} from "@/pages/equipment-analysis/CurrentCockpitSections";
import { FleetIssueViewPanel } from "@/pages/equipment-analysis/FleetIssueViewPanel";
import { OptimizeFleetBoard } from "@/pages/equipment-analysis/OptimizeFleetBoard";
import { DemoAnchorBar } from "@/pages/equipment-analysis/DemoAnchorBar";
import { stretchCol, stretchWrap } from "@/pages/equipment-analysis/CockpitPanel";
import { FleetScopeBar } from "@/pages/equipment-analysis/FleetScopeBar";
import { buildDeviceDetailHref } from "@/pages/equipment-analysis/deviceNav";
import { useFleetScopeParams } from "@/pages/equipment-analysis/useFleetScopeParams";
import { FleetBriefingDrawer, PriorityWatchCard } from "@/pages/equipment-analysis/RoleBriefing";

type Kind = "current" | "future" | "optimize";

const DETAIL_TAB: Record<Kind, "current" | "future" | "analysis"> = {
  current: "analysis",
  future: "analysis",
  optimize: "analysis",
};

export function CurrentFleetPage({ embedded = false }: { embedded?: boolean }) {
  const scope = useFleetScopeParams();
  const { data, loading, refresh } = useRequest(
    () => fetchCurrentAnalysis(scope.deptId, scope.deviceType, scope.groupBy),
    { deps: [scope.deptId, scope.deviceType, scope.groupBy] },
  );

  return (
    <div>
      {embedded ? null : (
        <PageHeader
          title={data?.title ?? "全局现状"}
          subtitle={data?.subtitle}
          extra={
            <Space>
              <Button>
                <Link to="/analysis/compare">设备对比</Link>
              </Button>
              <Button onClick={() => void refresh()} loading={loading}>
                刷新
              </Button>
            </Space>
          }
        />
      )}
      <FleetScopeBar
        deptId={scope.deptId}
        onDeptChange={scope.setDeptId}
        scopeLabel={data?.scope_label}
        deviceType={scope.deviceType}
        typeOptions={data?.type_options}
        onTypeChange={scope.setDeviceType}
        groupBy={scope.groupBy}
        groupByOptions={data?.group_by_options ?? data?.group_level_options}
        onGroupByChange={scope.setGroupBy}
        updatedAt={data?.updated_at}
      />
      <DemoAnchorBar items={data?.demo_items} navCtx={{ from: "cockpit", ...scope.scopeCtx }} />
      {data?.note ? (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={data.note} />
      ) : null}
      <KpiRow items={data?.kpis ?? []} loading={loading && !data} />
      <FleetSituationCard situation={data?.situation} />
      <FleetIssueViewPanel views={data?.fleet_issue_views} loading={loading && !data} />
      <Row gutter={16} align="stretch" style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14} style={stretchCol}>
          <div style={stretchWrap}>
            <DeptRankingTable
              rows={data?.dept_ranking}
              groupByLabel={data?.group_by_label ?? data?.group_level_label}
              loading={loading && !data}
            />
          </div>
        </Col>
        <Col xs={24} lg={10} style={stretchCol}>
          <div style={stretchWrap}>
            <TypeStatsTable rows={data?.type_stats} loading={loading && !data} />
          </div>
        </Col>
      </Row>
      <FocusDevicesTable data={data} loading={loading} navCtx={scope.scopeCtx} />
    </div>
  );
}

export function AnalysisFleetPage({
  kind,
  embedded = false,
}: {
  kind: Exclude<Kind, "current">;
  embedded?: boolean;
}) {
  const scope = useFleetScopeParams();
  const [briefingOpen, setBriefingOpen] = useState(false);
  const fetcher =
    kind === "future"
      ? () => fetchFutureAnalysis(scope.deptId)
      : () => fetchOptimizeAnalysis(scope.deptId, scope.page);
  const { data, loading, refresh } = useRequest(fetcher, {
    deps: kind === "optimize" ? [kind, scope.deptId, scope.page] : [kind, scope.deptId],
  });
  const navCtx = {
    from: kind === "future" ? ("future" as const) : ("optimize" as const),
    ...scope.scopeCtx,
  };

  return (
    <div>
      {embedded ? null : (
        <PageHeader
          title={data?.title ?? (kind === "future" ? "全局风险" : "运行调优")}
          subtitle={data?.subtitle}
          extra={
            <Space>
              {kind === "future" ? (
                <Button type="primary" ghost onClick={() => setBriefingOpen(true)}>
                  汇报摘要
                </Button>
              ) : null}
              <Button onClick={() => void refresh()} loading={loading}>
                刷新
              </Button>
            </Space>
          }
        />
      )}
      {kind === "future" || kind === "optimize" ? (
        <FleetScopeBar
          deptId={scope.deptId}
          onDeptChange={scope.setDeptId}
          scopeLabel={data?.scope_label}
        />
      ) : null}
      <DemoAnchorBar items={data?.demo_items} navCtx={navCtx} />
      {data?.note ? (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={data.note} />
      ) : null}
      <KpiRow items={data?.kpis ?? []} loading={loading && !data} />
      {kind === "future" ? (
        <PriorityWatchCard
          narrative={data?.future_narrative}
          navCtx={navCtx}
          loading={loading && !data}
        />
      ) : null}
      {kind === "future" && data?.future_narrative ? (
        <FutureSituationCard narrative={data.future_narrative} navCtx={navCtx} />
      ) : kind === "future" && data?.situation ? (
        <FleetSituationCard situation={data.situation} />
      ) : null}
      {kind === "optimize" ? (
        <OptimizeFleetBoard data={data} navCtx={navCtx} loading={loading && !data} />
      ) : null}
      {data?.charts?.length ? (
        <ChartGrid items={data.charts} loading={loading && !data} />
      ) : null}
      <Card
        size="small"
        title={kind === "future" ? "风险清单" : "优化机会"}
        style={{ marginTop: 16 }}
      >
        <DataTable<DeviceListItem>
          rowKey="id"
          loading={loading}
          dataSource={data?.items ?? []}
          scroll={kind === "future" ? { x: 1480 } : kind === "optimize" ? { x: 1100 } : undefined}
          pagination={
            kind === "optimize"
              ? {
                  current: data?.page ?? scope.page,
                  pageSize: data?.page_size ?? 10,
                  total: data?.item_total ?? data?.items?.length ?? 0,
                  showSizeChanger: false,
                  showTotal: (total) => `共 ${total} 台`,
                  onChange: (pg) => scope.setPage(pg),
                }
              : kind === "future"
                ? {
                    current: scope.page,
                    pageSize: 10,
                    showSizeChanger: true,
                    pageSizeOptions: ["10", "20", "50"],
                    showTotal: (total) => `共 ${total} 台`,
                    onChange: (pg) => scope.setPage(pg),
                  }
                : false
          }
          columns={buildColumns(kind, navCtx)}
        />
      </Card>
      {kind === "optimize" && (data?.blocked_items?.length ?? 0) > 0 ? (
        <Card size="small" title="暂不调参" style={{ marginTop: 16 }}>
          <DataTable<DeviceListItem>
            rowKey="id"
            loading={loading}
            dataSource={data?.blocked_items ?? []}
            pagination={false}
            columns={[
              {
                title: "设备",
                dataIndex: "name",
                render: (v: unknown, row: DeviceListItem) => (
                  <Link
                    to={buildDeviceDetailHref(row.id, {
                      ...navCtx,
                      tab: "analysis",
                    })}
                  >
                    {String(v)}
                  </Link>
                ),
              },
              { title: "部门", dataIndex: "dept_name" },
              {
                title: "原因",
                dataIndex: "block_reason",
                ellipsis: true,
                render: (v: unknown, row: DeviceListItem) => String(v ?? row.rec_reason ?? "—"),
              },
            ]}
          />
        </Card>
      ) : null}
      {kind === "future" ? (
        <FleetBriefingDrawer
          open={briefingOpen}
          onClose={() => setBriefingOpen(false)}
          kpis={data?.kpis}
          narrative={data?.future_narrative}
          scopeLabel={data?.scope_label}
          navCtx={navCtx}
        />
      ) : null}
    </div>
  );
}

function buildColumns(
  kind: Exclude<Kind, "current">,
  navCtx: { from: "future" | "optimize"; deptId?: number; deviceType?: string; groupBy?: string; page?: number },
) {
  const hrefCtx = {
    from: navCtx.from,
    tab: DETAIL_TAB[kind],
    deptId: navCtx.deptId,
    deviceType: navCtx.deviceType,
    groupBy: navCtx.groupBy,
    page: navCtx.page,
  };
  const base = [
    {
      title: "设备",
      dataIndex: "name",
      render: (v: unknown, row: DeviceListItem) => (
        <Link to={buildDeviceDetailHref(row.id, hrefCtx)}>{String(v)}</Link>
      ),
    },
    { title: "部门", dataIndex: "dept_name" },
  ];

  if (kind === "future") {
    const hiColor = (band?: string) =>
      band === "green" ? "green" : band === "yellow" ? "gold" : band === "red" ? "red" : "default";
    const alertColor = (level?: string) =>
      level === "alarm" ? "red" : level === "warning" ? "gold" : level === "paused" ? "default" : "green";
    return [
      ...base,
      {
        title: "HI",
        dataIndex: "health_index",
        width: 72,
        render: (v: unknown, row: DeviceListItem) =>
          row.prediction_paused ? (
            <Typography.Text type="secondary">—</Typography.Text>
          ) : (
            <Tag color={hiColor(row.health_band)}>{String(v)}</Tag>
          ),
      },
      {
        title: "24h%",
        dataIndex: "risk_24h",
        width: 72,
        render: (v: unknown, row: DeviceListItem) =>
          row.prediction_paused ? (
            "—"
          ) : (
            <Tag color={Number(v) >= 30 ? "red" : Number(v) >= 15 ? "orange" : "green"}>{String(v)}</Tag>
          ),
      },
      {
        title: "7d%",
        dataIndex: "risk_7d",
        width: 72,
        render: (v: unknown, row: DeviceListItem) =>
          row.prediction_paused ? (
            "—"
          ) : (
            <Tag color={Number(v) >= 50 ? "red" : Number(v) >= 20 ? "orange" : "green"}>{String(v)}</Tag>
          ),
      },
      {
        title: "RUL区间",
        dataIndex: "rul_range_label",
        width: 110,
        render: (v: unknown, row: DeviceListItem) =>
          row.prediction_paused ? "—" : String(v ?? "—"),
      },
      {
        title: "分级",
        dataIndex: "alert_label",
        width: 88,
        render: (_: unknown, row: DeviceListItem) => (
          <Tag color={alertColor(row.alert_level)}>{row.alert_label ?? row.alert_level ?? "—"}</Tag>
        ),
      },
      {
        title: "置信度",
        dataIndex: "confidence_label",
        width: 72,
        render: (_: unknown, row: DeviceListItem) =>
          row.prediction_paused ? "—" : (row.confidence_label ?? "—"),
      },
      {
        title: "建议检修日",
        dataIndex: "maintain_by",
        width: 110,
        render: (v: unknown, row: DeviceListItem) =>
          row.prediction_paused ? "—" : String(v ?? "—"),
      },
      {
        title: "主因",
        dataIndex: "primary_cause",
        width: 160,
        ellipsis: true,
        render: (v: unknown, row: DeviceListItem) =>
          row.prediction_paused ? "—" : String(v ?? row.likely_fault ?? "—"),
      },
      {
        title: "可少停",
        dataIndex: "downtime_avoidable_label",
        width: 110,
        render: (v: unknown, row: DeviceListItem) =>
          row.prediction_paused ? "—" : String(v ?? "—"),
      },
      { title: "可能类型", dataIndex: "likely_fault", ellipsis: true, width: 100 },
      {
        title: "操作",
        key: "op",
        width: 72,
        fixed: "right" as const,
        render: (_: unknown, row: DeviceListItem) => (
          <Button type="link" size="small">
            <Link to={buildDeviceDetailHref(row.id, hrefCtx)}>查看</Link>
          </Button>
        ),
      },
    ];
  }

  return [
    ...base,
    { title: "能耗分", dataIndex: "energy_score", width: 80 },
    { title: "当前功率", dataIndex: "power", width: 96, render: (v: unknown) => (v != null ? `${v} kW` : "—") },
    { title: "产量", dataIndex: "output_today", width: 80 },
    {
      title: "建议策略",
      dataIndex: "rec_strategy_label",
      width: 110,
      render: (v: unknown, row: DeviceListItem) => (
        <Tag
          color={
            row.rec_strategy === "energy"
              ? "green"
              : row.rec_strategy === "life"
                ? "blue"
                : row.rec_strategy === "output"
                  ? "orange"
                  : "default"
          }
        >
          {String(v ?? "—")}
        </Tag>
      ),
    },
    {
      title: "能耗影响",
      dataIndex: "rec_energy_label",
      width: 88,
    },
    {
      title: "为何",
      dataIndex: "rec_reason",
      ellipsis: true,
    },
    {
      title: "操作",
      key: "op",
      width: 88,
      render: (_: unknown, row: DeviceListItem) => (
        <Button type="link" size="small">
          <Link to={buildDeviceDetailHref(row.id, hrefCtx)}>进入对照</Link>
        </Button>
      ),
    },
  ];
}

export function CurrentAnalysisPage() {
  return <CurrentFleetPage />;
}

export function FutureAnalysisPage() {
  return <AnalysisFleetPage kind="future" />;
}

export function OptimizeAnalysisPage() {
  return <AnalysisFleetPage kind="optimize" />;
}
