import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Tree,
  Typography,
} from "antd";
import type { DataNode } from "antd/es/tree";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  fetchDeviceCompare,
  fetchDeviceCompareTree,
  type DeviceTreeNode,
  type FleetStatusTrendPeriod,
} from "@/modules/equipment-analysis/api/equipmentAnalysis";
import { PageHeader, DeptTreeSelect } from "@/components/kit";
import { useRequest } from "@/hooks/useRequest";
import { DeviceStatusSwimlaneChart } from "@/modules/equipment-analysis/ui/DeviceStatusSwimlaneChart";
import { buildDeviceDetailHref } from "@/modules/equipment-analysis/ui/deviceNav";

const PERIOD_OPTIONS: { label: string; value: FleetStatusTrendPeriod }[] = [
  { label: "周", value: "week" },
  { label: "月", value: "month" },
  { label: "季", value: "quarter" },
  { label: "年", value: "year" },
];

const STATUS_TAG_COLOR: Record<string, string> = {
  normal: "green",
  watch: "gold",
  abnormal: "red",
  fault: "magenta",
};

interface DevicePickOption {
  id: string;
  name: string;
  code?: string;
  type?: string;
  deptName?: string;
}

function flattenDevices(nodes: DeviceTreeNode[], deptName = ""): DevicePickOption[] {
  const out: DevicePickOption[] = [];
  for (const n of nodes) {
    if (n.type === "device" && n.device_id) {
      out.push({
        id: n.device_id,
        name: n.title,
        code: n.code,
        type: n.device_type,
        deptName,
      });
    } else if (n.children?.length) {
      const nextDept = n.type === "dept" ? n.title : deptName;
      out.push(...flattenDevices(n.children, nextDept));
    }
  }
  return out;
}

function filterDeviceTree(nodes: DeviceTreeNode[], keyword: string): DeviceTreeNode[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return nodes;
  const walk = (list: DeviceTreeNode[]): DeviceTreeNode[] => {
    const result: DeviceTreeNode[] = [];
    for (const n of list) {
      if (n.type === "device") {
        const hay = `${n.title} ${n.code ?? ""} ${n.device_type ?? ""}`.toLowerCase();
        if (hay.includes(kw)) result.push(n);
      } else {
        const children = n.children ? walk(n.children) : [];
        if (children.length) result.push({ ...n, children });
      }
    }
    return result;
  };
  return walk(nodes);
}

function toAntdTree(nodes: DeviceTreeNode[]): DataNode[] {
  return nodes.map((n) => ({
    key: n.key,
    title:
      n.type === "device" ? (
        <Space size={4}>
          <span>{n.title}</span>
          {n.code ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {n.code}
            </Typography.Text>
          ) : null}
          {n.device_type ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {n.device_type}
            </Typography.Text>
          ) : null}
        </Space>
      ) : (
        n.title
      ),
    isLeaf: n.isLeaf,
    disableCheckbox: n.type === "dept",
    selectable: n.type === "device",
    children: n.children?.length ? toAntdTree(n.children) : undefined,
  }));
}

function deviceKeysToChecked(keys: string[]) {
  return keys.map((id) => `device:${id}`);
}

function checkedToDeviceIds(checked: string[]) {
  return checked
    .filter((k) => k.startsWith("device:"))
    .map((k) => k.slice("device:".length));
}

function formatDeviceLabel(d: DevicePickOption) {
  const parts = [d.name];
  if (d.type) parts.push(d.type);
  if (d.deptName) parts.push(`（${d.deptName}）`);
  return parts.join(" · ");
}

export default function DeviceComparePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialIds = useMemo(
    () => searchParams.get("ids")?.split(",").filter(Boolean) ?? [],
    [searchParams],
  );
  const periodParam = searchParams.get("period") as FleetStatusTrendPeriod | null;
  const [deptId, setDeptId] = useState<number | undefined>();
  const [period, setPeriod] = useState<FleetStatusTrendPeriod>(
    periodParam && PERIOD_OPTIONS.some((p) => p.value === periodParam) ? periodParam : "year",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds);
  const [deviceKeyword, setDeviceKeyword] = useState("");
  const [deviceMeta, setDeviceMeta] = useState<Record<string, DevicePickOption>>({});
  const [limitHint, setLimitHint] = useState(false);

  const { data: treeData, loading: treeLoading } = useRequest(
    () => fetchDeviceCompareTree(deptId),
    { deps: [deptId] },
  );

  const maxSelect = treeData?.max_select ?? 8;

  const {
    data: compareData,
    loading: compareLoading,
    refresh,
  } = useRequest(
    async () => {
      if (!selectedIds.length) return undefined;
      return fetchDeviceCompare(selectedIds, period);
    },
    { deps: [selectedIds.join(","), period] },
  );

  useEffect(() => {
    const fromUrl = searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
    if (fromUrl.join(",") !== selectedIds.join(",")) {
      setSelectedIds(fromUrl);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!compareData?.devices) return;
    setDeviceMeta((prev) => {
      const next = { ...prev };
      for (const d of compareData.devices) {
        next[d.id] = {
          id: d.id,
          name: d.name,
          code: d.code,
          type: d.type,
          deptName: d.dept_name,
        };
      }
      return next;
    });
  }, [compareData?.devices]);

  const syncUrl = useCallback(
    (ids: string[], nextPeriod = period) => {
      const params: Record<string, string> = {};
      if (ids.length) params.ids = ids.join(",");
      if (nextPeriod !== "year") params.period = nextPeriod;
      setSearchParams(params, { replace: true });
    },
    [period, setSearchParams],
  );

  const applySelection = useCallback(
    (ids: string[], metaPatch?: DevicePickOption[]) => {
      let next = ids;
      if (next.length > maxSelect) {
        next = next.slice(0, maxSelect);
        setLimitHint(true);
      } else {
        setLimitHint(false);
      }
      if (metaPatch?.length) {
        setDeviceMeta((prev) => {
          const m = { ...prev };
          for (const d of metaPatch) m[d.id] = d;
          return m;
        });
      }
      setSelectedIds(next);
      syncUrl(next);
    },
    [maxSelect, syncUrl],
  );

  const onCheck = (checked: unknown) => {
    const keys = Array.isArray(checked) ? checked : (checked as { checked: string[] }).checked;
    const ids = checkedToDeviceIds(keys as string[]);
    const scopeOptions = flattenDevices(treeData?.tree ?? []);
    const metaPatch = scopeOptions.filter((o) => ids.includes(o.id));
    applySelection(ids, metaPatch);
  };

  const onSelectDevices = (ids: string[]) => {
    const scopeOptions = flattenDevices(treeData?.tree ?? []);
    const metaPatch = ids
      .map((id) => scopeOptions.find((o) => o.id === id) ?? deviceMeta[id])
      .filter((o): o is DevicePickOption => Boolean(o));
    applySelection(ids, metaPatch);
  };

  const onPeriodChange = (v: FleetStatusTrendPeriod) => {
    setPeriod(v);
    syncUrl(selectedIds, v);
  };

  const filteredTree = useMemo(
    () => filterDeviceTree(treeData?.tree ?? [], deviceKeyword),
    [treeData?.tree, deviceKeyword],
  );
  const antdTree = useMemo(() => toAntdTree(filteredTree), [filteredTree]);

  const deviceOptions = useMemo(() => {
    const scopeOptions = flattenDevices(treeData?.tree ?? []);
    const map = new Map(scopeOptions.map((o) => [o.id, o]));
    for (const id of selectedIds) {
      if (!map.has(id) && deviceMeta[id]) map.set(id, deviceMeta[id]);
    }
    return [...map.values()];
  }, [treeData?.tree, selectedIds, deviceMeta]);

  const selectOptions = useMemo(
    () =>
      deviceOptions.map((d) => {
        const searchText = `${d.name} ${d.code ?? ""} ${d.type ?? ""} ${d.deptName ?? ""}`;
        return {
          value: d.id,
          label: formatDeviceLabel(d),
          searchText,
          disabled: !selectedIds.includes(d.id) && selectedIds.length >= maxSelect,
        };
      }),
    [deviceOptions, selectedIds, maxSelect],
  );

  const checkedKeys = deviceKeysToChecked(selectedIds);
  const statusLabels = compareData?.status_label ?? {};

  const detailHref = useCallback(
    (deviceId: string) =>
      buildDeviceDetailHref(deviceId, {
        from: "compare",
        tab: "current",
        period,
        compareIds: selectedIds,
      }),
    [period, selectedIds],
  );

  const goToDeviceDetail = useCallback(
    (deviceId: string) => {
      navigate(detailHref(deviceId));
    },
    [navigate, detailHref],
  );

  const removeDevice = (id: string) => {
    const next = selectedIds.filter((x) => x !== id);
    applySelection(next);
  };

  return (
    <div>
      <PageHeader
        title="设备状态对比"
        subtitle="先缩小部门范围，再搜索或勾选设备；支持跨部门对比"
        extra={
          <Space>
            <Button onClick={() => void refresh()} loading={compareLoading}>
              刷新
            </Button>
            <Button>
              <Link to="/analysis/diagnosis">← 返回分析诊断</Link>
            </Button>
          </Space>
        }
      />

      <Row gutter={16}>
        <Col xs={24} lg={7}>
          <Card
            size="small"
            title="设备选择"
            loading={treeLoading}
            extra={
              <Typography.Text type="secondary">
                {selectedIds.length}/{maxSelect}
              </Typography.Text>
            }
            style={{ marginBottom: 16 }}
          >
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
              <div>
                <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
                  筛选部门范围
                </Typography.Text>
                <DeptTreeSelect
                  allowClear
                  placeholder="全部设备 / 全部区域"
                  style={{ width: "100%" }}
                  value={deptId}
                  onChange={(v) => setDeptId(v == null ? undefined : Number(v))}
                />
              </div>
              <div>
                <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
                  搜索并添加设备
                </Typography.Text>
                <Select
                  mode="multiple"
                  showSearch
                  allowClear
                  placeholder="名称 / 编码 / 类型"
                  style={{ width: "100%" }}
                  value={selectedIds}
                  options={selectOptions}
                  optionFilterProp="searchText"
                  filterOption={(input, option) =>
                    String(option?.searchText ?? "")
                      .toLowerCase()
                      .includes(input.trim().toLowerCase())
                  }
                  onSearch={setDeviceKeyword}
                  onChange={onSelectDevices}
                  maxTagCount="responsive"
                  notFoundContent={
                    deviceKeyword.trim() ? "无匹配设备" : "输入关键字搜索当前范围内设备"
                  }
                />
              </div>
              {limitHint ? (
                <Alert
                  type="warning"
                  showIcon
                  message={`最多同时对比 ${maxSelect} 台设备`}
                  closable
                  onClose={() => setLimitHint(false)}
                />
              ) : null}
              {deviceKeyword.trim() ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  下方部门树已按「{deviceKeyword}」过滤
                </Typography.Text>
              ) : null}
              {antdTree.length ? (
                <Tree
                  checkable
                  defaultExpandAll
                  checkedKeys={checkedKeys}
                  onCheck={onCheck}
                  treeData={antdTree}
                  height={360}
                />
              ) : (
                <Empty
                  description={
                    deviceKeyword.trim() ? `未找到包含「${deviceKeyword}」的设备` : "当前范围内无设备"
                  }
                />
              )}
            </Space>
          </Card>

          {selectedIds.length > 0 ? (
            <Card size="small" title="已选设备">
              <Space wrap>
                {selectedIds.map((id) => {
                  const d =
                    compareData?.devices.find((x) => x.id === id) ??
                    deviceMeta[id];
                  const label = d?.name ?? id;
                  const status =
                    compareData?.devices.find((x) => x.id === id)?.current_status;
                  return (
                    <Tag
                      key={id}
                      closable
                      color={status ? STATUS_TAG_COLOR[status] : undefined}
                      onClose={() => removeDevice(id)}
                      style={{ cursor: "pointer" }}
                    >
                      <Link to={detailHref(id)} style={{ color: "inherit" }} onClick={(e) => e.stopPropagation()}>
                        {label}
                      </Link>
                    </Tag>
                  );
                })}
              </Space>
            </Card>
          ) : null}
        </Col>

        <Col xs={24} lg={17}>
          {compareData?.run_order?.length ? (
            <Card size="small" title="推荐运行顺序" style={{ marginBottom: 16 }}>
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={[...compareData.devices].sort(
                  (a, b) => (a.run_order ?? 99) - (b.run_order ?? 99),
                )}
                columns={[
                  { title: "顺序", dataIndex: "run_order", width: 64 },
                  {
                    title: "设备",
                    dataIndex: "name",
                    render: (v, row) => <Link to={detailHref(row.id)}>{String(v)}</Link>,
                  },
                  {
                    title: "健康度",
                    dataIndex: "health_index",
                    width: 80,
                    render: (v) => v ?? "—",
                  },
                  {
                    title: "7日风险",
                    dataIndex: "risk_7d",
                    width: 90,
                    render: (v) => (v != null ? `${v}%` : "—"),
                  },
                  {
                    title: "建议",
                    dataIndex: "advice",
                    width: 110,
                    render: (v) => {
                      const color =
                        v === "优先运行"
                          ? "green"
                          : v === "建议检修"
                            ? "red"
                            : v === "备用关注"
                              ? "gold"
                              : "blue";
                      return <Tag color={color}>{String(v ?? "—")}</Tag>;
                    },
                  },
                ]}
              />
              <Timeline
                style={{ marginTop: 16, marginBottom: 0 }}
                items={(compareData.run_order ?? []).map((r) => ({
                  children: (
                    <span>
                      <Typography.Text strong>
                        {r.run_order} · {r.name}
                      </Typography.Text>
                      {" — "}
                      {r.advice}
                      {r.advice_reason ? (
                        <Typography.Text type="secondary">（{r.advice_reason}）</Typography.Text>
                      ) : null}
                    </span>
                  ),
                }))}
              />
            </Card>
          ) : null}
          <Card
            size="small"
            title="状态时间轴"
            extra={
              <Segmented
                size="small"
                options={PERIOD_OPTIONS}
                value={period}
                onChange={(v) => onPeriodChange(v as FleetStatusTrendPeriod)}
              />
            }
            style={{ marginBottom: 16 }}
          >
            {!selectedIds.length ? (
              <Empty
                description="请搜索或勾选设备（支持跨部门对比，如叉车 A、叉车 B、变压器）"
                style={{ padding: "48px 0" }}
              />
            ) : compareData?.error ? (
              <Alert type="error" showIcon message={compareData.message ?? "加载失败"} />
            ) : compareData?.devices?.length ? (
              <>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                  {compareData.axis.start_date} ~ {compareData.axis.end_date}
                  ，共 {compareData.axis.day_count} 天；色块表示各设备在该时段的状态。
                </Typography.Paragraph>
                <DeviceStatusSwimlaneChart
                  devices={compareData.devices}
                  axis={compareData.axis}
                  legend={compareData.status_legend}
                  loading={compareLoading}
                  onDeviceClick={goToDeviceDetail}
                />
                <Typography.Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
                  点击泳道设备名或色块可查看详情
                </Typography.Text>
                <Space wrap style={{ marginTop: 12 }}>
                  {compareData.devices.map((d) => (
                    <Typography.Text key={d.id} type="secondary">
                      <Link to={detailHref(d.id)}>{d.name}</Link>
                      ：当前
                      <Tag color={STATUS_TAG_COLOR[d.current_status]} style={{ marginInline: 4 }}>
                        {statusLabels[d.current_status] ?? d.current_status}
                      </Tag>
                    </Typography.Text>
                  ))}
                </Space>
              </>
            ) : (
              <Empty description="暂无对比数据" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
