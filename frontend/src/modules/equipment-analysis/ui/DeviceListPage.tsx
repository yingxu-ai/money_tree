import { useEffect, useMemo, useState } from "react";
import { Button, Col, Collapse, Input, Row, Select, Space, Tag } from "antd";
import { Link } from "react-router-dom";
import { KpiRow } from "@/components/blocks";
import { DataTable, DeptTreeSelect, PageHeader, StatusTag } from "@/components/kit";
import { fetchDevicesPage, type DeviceListItem } from "@/modules/equipment-analysis/api/equipmentAnalysis";
import { useRequest } from "@/hooks/useRequest";
import { stretchCol, stretchWrap } from "@/modules/equipment-analysis/ui/CockpitPanel";
import { DemoAnchorBar } from "@/modules/equipment-analysis/ui/DemoAnchorBar";
import { DeviceFleetSankeyChart } from "@/modules/equipment-analysis/ui/DeviceFleetSankeyChart";
import { DeviceFleetSunburstChart } from "@/modules/equipment-analysis/ui/DeviceFleetSunburstChart";
import { FleetStatusTrendChart } from "@/modules/equipment-analysis/ui/FleetStatusTrendChart";
import { FleetTypeTrendChart } from "@/modules/equipment-analysis/ui/FleetTypeTrendChart";
import { buildDeviceDetailHref } from "@/modules/equipment-analysis/ui/deviceNav";
import { useDeviceListParams } from "@/modules/equipment-analysis/ui/useFleetScopeParams";

export default function DeviceListPage() {
  const list = useDeviceListParams();
  const { data, loading, refresh } = useRequest(() => fetchDevicesPage(list.deptId), {
    deps: [list.deptId],
  });
  const [searchInput, setSearchInput] = useState(list.q);
  useEffect(() => {
    setSearchInput(list.q);
  }, [list.q]);

  const filtered = useMemo(() => {
    let items = data?.items ?? [];
    if (list.anchors) items = items.filter((r) => r.is_anchor);
    if (list.analysisStatus) items = items.filter((r) => r.analysis_status === list.analysisStatus);
    const kw = list.q.trim().toLowerCase();
    if (kw) {
      items = items.filter(
        (r) =>
          r.name.toLowerCase().includes(kw) ||
          r.code.toLowerCase().includes(kw) ||
          r.dept_name.toLowerCase().includes(kw) ||
          r.summary.toLowerCase().includes(kw),
      );
    }
    return items;
  }, [data?.items, list.anchors, list.analysisStatus, list.q]);

  const hrefCtx = list.listCtx;

  return (
    <div>
      <PageHeader
        title={data?.title ?? "设备列表"}
        subtitle={data?.subtitle}
        extra={
          <Button onClick={() => void refresh()} loading={loading}>
            刷新
          </Button>
        }
      />
      <KpiRow items={data?.kpis ?? []} loading={loading && !data} />
      <DemoAnchorBar items={data?.demo_items} navCtx={hrefCtx} />
      <Collapse
        style={{ marginBottom: 16 }}
        items={[
          {
            key: "charts",
            label: "设备分布与趋势（组织口径，不是健康诊断）",
            children: (
              <>
                <Row gutter={16} align="stretch" style={{ marginBottom: 16 }}>
                  <Col xs={24} lg={12} style={stretchCol}>
                    <div style={stretchWrap}>
                      <FleetStatusTrendChart
                        trends={data?.fleet_status_trends}
                        loading={loading && !data}
                      />
                    </div>
                  </Col>
                  <Col xs={24} lg={12} style={stretchCol}>
                    <div style={stretchWrap}>
                      <FleetTypeTrendChart
                        trends={data?.fleet_type_trends}
                        loading={loading && !data}
                      />
                    </div>
                  </Col>
                </Row>
                <Row gutter={16} align="stretch">
                  <Col xs={24} lg={12} style={stretchCol}>
                    <div style={stretchWrap}>
                      <DeviceFleetSunburstChart
                        data={data?.fleet_sunburst}
                        loading={loading && !data}
                      />
                    </div>
                  </Col>
                  <Col xs={24} lg={12} style={stretchCol}>
                    <div style={stretchWrap}>
                      <DeviceFleetSankeyChart data={data?.fleet_sankey} loading={loading && !data} />
                    </div>
                  </Col>
                </Row>
              </>
            ),
          },
        ]}
      />
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <DeptTreeSelect
          allowClear
          placeholder="全部设备 / 全部区域"
          style={{ width: 220 }}
          value={list.deptId}
          onChange={(v) => list.setDeptId(v == null ? undefined : Number(v))}
        />
        <Select
          allowClear
          placeholder="分析状态"
          style={{ width: 140 }}
          value={list.analysisStatus}
          onChange={(v) => list.setAnalysisStatus(v)}
          options={[
            { value: "abnormal", label: "异常" },
            { value: "watch", label: "关注" },
            { value: "normal", label: "正常" },
          ]}
        />
        <Input.Search
          allowClear
          placeholder="搜索设备 / 摘要"
          style={{ width: 280 }}
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            if (!e.target.value) list.setQ("");
          }}
          onSearch={(v) => list.setQ(v.trim())}
        />
        <Button type={list.anchors ? "primary" : "default"} onClick={() => list.setAnchors(!list.anchors)}>
          重点设备
        </Button>
        <Button
          onClick={() => {
            setSearchInput("");
            list.reset();
          }}
        >
          重置
        </Button>
      </div>
      <DataTable<DeviceListItem>
        rowKey="id"
        loading={loading}
        dataSource={filtered}
        pagination={
          filtered.length > 10
            ? {
                current: list.page,
                pageSize: 10,
                showTotal: (total) => `共 ${total} 台`,
                onChange: (pg) => list.setPage(pg),
              }
            : false
        }
        columns={[
          {
            title: "设备",
            dataIndex: "name",
            render: (v, row) => (
              <Space size={6}>
                <Link to={buildDeviceDetailHref(row.id, hrefCtx)}>{String(v)}</Link>
                {row.is_anchor ? <Tag>重点</Tag> : null}
              </Space>
            ),
          },
          { title: "部门", dataIndex: "dept_name" },
          {
            title: "运行状态",
            dataIndex: "run_status",
            render: (v) => (
              <StatusTag
                value={String(v)}
                labelMap={data?.status_label}
                colorMap={data?.status_color}
              />
            ),
          },
          {
            title: "分析状态",
            dataIndex: "analysis_status",
            render: (v) => (
              <StatusTag
                value={String(v)}
                labelMap={data?.status_label}
                colorMap={data?.status_color}
              />
            ),
          },
          { title: "关键实时值", dataIndex: "realtime_display" },
          {
            title: "摘要",
            dataIndex: "summary",
            ellipsis: true,
          },
          {
            title: "操作",
            key: "op",
            width: 220,
            render: (_, row) => (
              <Space size={0}>
                <Button type="link" size="small">
                  <Link to={buildDeviceDetailHref(row.id, { ...hrefCtx, tab: "analysis" })}>对照</Link>
                </Button>
                <Button type="link" size="small">
                  <Link to={buildDeviceDetailHref(row.id, { ...hrefCtx, tab: "current" })}>证据</Link>
                </Button>
                <Button type="link" size="small">
                  <Link to={buildDeviceDetailHref(row.id, { ...hrefCtx, tab: "future" })}>处置</Link>
                </Button>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
