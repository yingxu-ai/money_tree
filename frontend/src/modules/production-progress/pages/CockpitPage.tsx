import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchProductionCockpit,
  type CockpitActionItem,
  type CockpitActiveItem,
  type CockpitDueRow,
  type CockpitView,
} from "@/modules/production-progress/api/progress";
import { LineChart } from "@/charts";
import { PageHeader } from "@/components/kit";
import { useRequest } from "@/hooks/useRequest";

const VIEW_KEY = "pp_cockpit_view";
const BOARD_KEY = "pp_cockpit_board";

type BoardMode = "cards" | "swimlane" | "table";

const ACTION_TYPE_LABEL: Record<string, string> = {
  order_overdue: "订单逾期",
  order_near_behind: "进度落后",
  wip_silent: "在制静默",
  unreported: "应报未报",
  pending_timeout: "待确认",
  rejected_open: "已驳回",
  finished_pending: "成品待确认",
};

function dueTag(days: number | null | undefined) {
  if (typeof days !== "number") return null;
  if (days < 0) return <Tag color="red">逾 {-days} 天</Tag>;
  if (days === 0) return <Tag color="orange">今天到期</Tag>;
  if (days <= 3) return <Tag color="orange">剩 {days} 天</Tag>;
  return <Tag>剩 {days} 天</Tag>;
}

function toneColor(tone?: string) {
  if (tone === "red") return { bg: "#fef2f2", border: "#fecaca", fg: "#b91c1c" };
  if (tone === "yellow") return { bg: "#fff7ed", border: "#fed7aa", fg: "#c2410c" };
  return { bg: "#ecfdf5", border: "#a7f3d0", fg: "#047857" };
}

function actionLevelColor(level?: string) {
  if (level === "error") return "#b91c1c";
  if (level === "warning") return "#c2410c";
  return "#0f766e";
}

function CommandCell({
  tone,
  title,
  count,
  headline,
}: {
  tone: "red" | "yellow" | "green";
  title: string;
  count: number;
  headline?: string;
}) {
  const c = toneColor(tone);
  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 8,
        padding: "16px 18px",
        minHeight: 108,
        height: "100%",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: c.fg, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 36, fontWeight: 700, color: c.fg, lineHeight: 1.1 }}>{count}</div>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
        {headline || "—"}
      </Typography.Text>
    </div>
  );
}

function BucketBar({
  buckets,
}: {
  buckets?: {
    overdue: number;
    d3: number;
    d7: number;
    later: number;
    no_due: number;
  };
}) {
  const items = [
    { key: "overdue", label: "逾期", value: buckets?.overdue ?? 0, color: "#b91c1c" },
    { key: "d3", label: "3日内", value: buckets?.d3 ?? 0, color: "#c2410c" },
    { key: "d7", label: "4–7日", value: buckets?.d7 ?? 0, color: "#ca8a04" },
    { key: "later", label: "更远", value: buckets?.later ?? 0, color: "#047857" },
    { key: "no_due", label: "无交期", value: buckets?.no_due ?? 0, color: "#64748b" },
  ];
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <div>
      <div
        style={{
          display: "flex",
          height: 14,
          borderRadius: 7,
          overflow: "hidden",
          background: "#e2e8f0",
          marginBottom: 10,
        }}
      >
        {items.map((i) =>
          i.value > 0 ? (
            <div
              key={i.key}
              title={`${i.label} ${i.value}`}
              style={{ width: `${(i.value / total) * 100}%`, background: i.color }}
            />
          ) : null,
        )}
      </div>
      <Space wrap size={[12, 6]}>
        {items.map((i) => (
          <span key={i.key} style={{ fontSize: 12, color: "#64748b" }}>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 2,
                background: i.color,
                marginRight: 4,
              }}
            />
            {i.label} <Typography.Text strong>{i.value}</Typography.Text>
          </span>
        ))}
      </Space>
    </div>
  );
}

function ProgressCell({ row }: { row: CockpitDueRow }) {
  if (row.progress_pct != null) {
    return (
      <div style={{ minWidth: 120 }}>
        <Progress
          percent={row.progress_pct}
          size="small"
          status={row.behind ? "exception" : "active"}
          format={(p) => `${p}%`}
        />
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {row.done_qty ?? 0}
          {row.plan_qty != null ? ` / ${row.plan_qty}` : ""}
        </Typography.Text>
      </div>
    );
  }
  return (
    <Typography.Text>
      已确认 <Typography.Text strong>{row.done_qty ?? 0}</Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
        无计划量
      </Typography.Text>
    </Typography.Text>
  );
}

function ActiveCard({ item }: { item: CockpitActiveItem }) {
  const c = toneColor(item.tone);
  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 8,
        padding: 12,
        height: "100%",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <Typography.Text strong ellipsis style={{ maxWidth: "70%" }}>
          {item.work_order_label || item.product || item.id}
        </Typography.Text>
        {dueTag(item.days_to_due)}
      </div>
      <div style={{ fontSize: 12, color: "#475569", marginBottom: 4 }}>
        {item.product || "—"} · {item.current_process || "—"}
      </div>
      <div style={{ fontSize: 12, color: "#475569", marginBottom: 8 }}>
        {item.current_holder || "—"} / {item.equipment_name || "—"}
      </div>
      <Space wrap size={6}>
        <Tag>
          已确认 {item.total_confirmed_qty ?? 0}
          {item.plan_qty != null ? ` / ${item.plan_qty}` : ""}
        </Tag>
        {item.silent_hours != null ? (
          <Tag color={item.silent_hours >= 8 ? "red" : "default"}>静默 {item.silent_hours}h</Tag>
        ) : null}
      </Space>
    </div>
  );
}

function ActionRow({ a }: { a: CockpitActionItem }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 12px",
        borderRadius: 6,
        border: "1px solid #e2e8f0",
        background: "#fff",
      }}
    >
      <Space wrap size={8}>
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: actionLevelColor(a.level),
          }}
        />
        <Tag>{ACTION_TYPE_LABEL[a.type] || a.type}</Tag>
        <Typography.Text strong>{a.title}</Typography.Text>
        <Typography.Text>{a.object_label}</Typography.Text>
        {a.age_label && a.age_minutes > 0 ? (
          <Typography.Text type="secondary">已挂 {a.age_label}</Typography.Text>
        ) : null}
      </Space>
      <Space>
        <Tag>{a.suggested_action || "去处理"}</Tag>
        {a.link ? <Link to={a.link}>去处理</Link> : null}
      </Space>
    </div>
  );
}

/**
 * 全局看板：指挥条 + 必办 + 交期/在制 + 异常中心 + 7 日趋势。
 */
export default function CockpitPage() {
  const [view, setView] = useState<CockpitView>(() => {
    const saved = localStorage.getItem(VIEW_KEY);
    return saved === "director" ? "director" : "manager";
  });
  const [boardMode, setBoardMode] = useState<BoardMode>(() => {
    const saved = localStorage.getItem(BOARD_KEY);
    if (saved === "swimlane" || saved === "table" || saved === "cards") return saved;
    return "cards";
  });
  const [onlySilent, setOnlySilent] = useState(false);
  const [onlyRisk, setOnlyRisk] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertType, setAlertType] = useState<string | undefined>();
  const [alertLevel, setAlertLevel] = useState<string | undefined>();

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view);
  }, [view]);
  useEffect(() => {
    localStorage.setItem(BOARD_KEY, boardMode);
  }, [boardMode]);

  const { data, loading, refresh } = useRequest(
    () => fetchProductionCockpit({ near_days: 3, view }),
    { immediate: true, deps: [view] },
  );

  const cmd = data?.command;
  const actions = data?.actions ?? [];
  const actionsAll = data?.actions_all ?? actions;
  const pulse = data?.pulse;
  const due = data?.due;
  const silentThreshold = data?.config?.silent_hours ?? 8;
  const showDueDetail = view === "manager";

  const activeFiltered = useMemo(() => {
    let rows = data?.active ?? [];
    if (onlySilent) {
      rows = rows.filter((r) => (r.silent_hours ?? 0) >= silentThreshold);
    }
    if (onlyRisk) {
      rows = rows.filter((r) => r.tone === "red" || r.tone === "yellow");
    }
    return rows;
  }, [data?.active, onlySilent, onlyRisk, silentThreshold]);

  const swimlanes = useMemo(() => {
    const map = new Map<string, CockpitActiveItem[]>();
    for (const item of activeFiltered) {
      const lane = item.lane || item.current_process || "未报工序";
      const list = map.get(lane) || [];
      list.push(item);
      map.set(lane, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh"));
  }, [activeFiltered]);

  const alertFiltered = useMemo(() => {
    let rows = actionsAll;
    if (alertType) rows = rows.filter((a) => a.type === alertType);
    if (alertLevel) rows = rows.filter((a) => a.level === alertLevel);
    return rows;
  }, [actionsAll, alertType, alertLevel]);

  const processTrend = useMemo(
    () =>
      (pulse?.trend?.process_qty_7d ?? []).map((p) => ({
        label: p.label,
        value: p.value,
      })),
    [pulse?.trend?.process_qty_7d],
  );
  const finishedTrend = useMemo(
    () =>
      (pulse?.trend?.finished_qty_7d ?? []).map((p) => ({
        label: p.label,
        value: p.value,
      })),
    [pulse?.trend?.finished_qty_7d],
  );

  const typeOptions = useMemo(() => {
    const types = new Set(actionsAll.map((a) => a.type));
    return [...types].map((t) => ({ value: t, label: ACTION_TYPE_LABEL[t] || t }));
  }, [actionsAll]);

  return (
    <div>
      <PageHeader
        title="全局看板"
        subtitle={`${data?.as_of || "今日"} · 红的先追，黄的盯紧。进度来自已确认报工。`}
        extra={
          <Space wrap>
            <Segmented
              value={view}
              onChange={(v) => setView(v as CockpitView)}
              options={[
                { value: "manager", label: "负责人" },
                { value: "director", label: "主任" },
              ]}
            />
            <Typography.Link onClick={() => refresh()}>刷新</Typography.Link>
            <Link to="/production-progress/analysis">进度分析</Link>
            <Link to="/production-progress/daily">每日报工</Link>
          </Space>
        }
      />

      {data?.note ? (
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message={data.note} />
      ) : null}

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <CommandCell
            tone="red"
            title="红 · 逾期"
            count={cmd?.red?.count ?? 0}
            headline={cmd?.red?.headline}
          />
        </Col>
        <Col xs={24} md={8}>
          <CommandCell
            tone="yellow"
            title="黄 · 风险"
            count={cmd?.yellow?.count ?? 0}
            headline={cmd?.yellow?.headline}
          />
        </Col>
        <Col xs={24} md={8}>
          <CommandCell
            tone="green"
            title="绿 · 正常在制"
            count={cmd?.green?.count ?? 0}
            headline={cmd?.green?.headline}
          />
        </Col>
      </Row>

      <Card
        size="small"
        title="今日必办"
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {view === "director" ? "偏现场催办" : "偏交期与静默"}
              {typeof data?.alerts_total === "number" ? ` · 共 ${data.alerts_total} 条` : null}
            </Typography.Text>
            <Button type="link" size="small" onClick={() => setAlertOpen(true)}>
              异常中心
            </Button>
          </Space>
        }
        loading={loading && !data}
      >
        {actions.length ? (
          <Space direction="vertical" style={{ width: "100%" }} size={10}>
            {actions.map((a) => (
              <ActionRow key={a.id} a={a} />
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">暂无必办，现场节奏正常</Typography.Text>
        )}
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {showDueDetail ? (
          <Col xs={24} lg={14}>
            <Card
              size="small"
              title="交期驾驶舱"
              loading={loading && !data}
              extra={
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  订单 {due?.all_count ?? data?.due_risk?.order_total ?? 0} 单
                </Typography.Text>
              }
            >
              <BucketBar buckets={due?.buckets} />
              <Table<CockpitDueRow>
                size="small"
                style={{ marginTop: 14 }}
                rowKey={(r) => `${r.order_code}-${r.due_date}`}
                pagination={false}
                dataSource={due?.rows ?? []}
                locale={{ emptyText: "暂无订单交期数据" }}
                columns={[
                  {
                    title: "订单",
                    width: 130,
                    render: (_: unknown, row) => row.order_code || "—",
                  },
                  { title: "产品", dataIndex: "product", ellipsis: true },
                  {
                    title: "交期",
                    width: 140,
                    render: (_: unknown, row) => (
                      <span>
                        {row.due_date || "—"} {dueTag(row.days_to_due)}
                      </span>
                    ),
                  },
                  {
                    title: "进度",
                    width: 160,
                    render: (_: unknown, row) => <ProgressCell row={row} />,
                  },
                  {
                    title: "标记",
                    width: 140,
                    render: (_: unknown, row) =>
                      (row.risk_tags || []).length ? (
                        <Space size={4} wrap>
                          {row.risk_tags!.map((t) => (
                            <Tag
                              key={t}
                              color={
                                t === "逾期" || t === "落后"
                                  ? "red"
                                  : t === "临期" || t === "静默"
                                    ? "orange"
                                    : "default"
                              }
                            >
                              {t}
                            </Tag>
                          ))}
                        </Space>
                      ) : (
                        "—"
                      ),
                  },
                  {
                    title: "人 / 工序",
                    width: 140,
                    ellipsis: true,
                    render: (_: unknown, row) =>
                      `${row.current_holder || "—"} / ${row.current_process || "—"}`,
                  },
                ]}
              />
            </Card>
          </Col>
        ) : null}
        <Col xs={24} lg={showDueDetail ? 10 : 24}>
          <Card size="small" title={showDueDetail ? "今日脉搏" : "今日现场脉搏"} loading={loading && !data}>
            <Space size={24} wrap>
              <span>
                应报 <Typography.Text strong>{pulse?.attendance_expected ?? 0}</Typography.Text>
              </span>
              <span>
                已报 <Typography.Text strong>{pulse?.attendance_reported ?? 0}</Typography.Text>
              </span>
              <span>
                未报{" "}
                <Typography.Text strong type="warning">
                  {pulse?.attendance_unreported ?? 0}
                </Typography.Text>
              </span>
              <span>
                报工率{" "}
                <Typography.Text strong>
                  {pulse?.attendance_rate != null ? `${pulse.attendance_rate}%` : "—"}
                </Typography.Text>
                {pulse?.attendance_target_rate != null
                  ? ` / 目标 ${pulse.attendance_target_rate}%`
                  : null}
              </span>
              <span>
                工序合计 <Typography.Text strong>{pulse?.process_total_qty ?? 0}</Typography.Text>
              </span>
              <span>
                成品建议 {pulse?.finished_suggested_qty ?? 0} · 已确认{" "}
                <Typography.Text strong>{pulse?.finished_confirmed_qty ?? 0}</Typography.Text>
                {pulse?.finished_gap != null ? (
                  <Typography.Text type="secondary"> · 缺口 {pulse.finished_gap}</Typography.Text>
                ) : null}
              </span>
              <span>
                待确认 {pulse?.pending_reports ?? 0} · 驳回 {pulse?.rejected_reports ?? 0}
              </span>
              <Link to="/production-progress/daily">打开每日报工</Link>
            </Space>
            <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
              <Col xs={24} md={12}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  近 7 日工序确认产量
                </Typography.Text>
                {processTrend.length ? (
                  <LineChart data={processTrend} height={160} unit="" />
                ) : (
                  <Typography.Text type="secondary">暂无</Typography.Text>
                )}
              </Col>
              <Col xs={24} md={12}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  近 7 日成品确认
                </Typography.Text>
                {finishedTrend.length ? (
                  <LineChart data={finishedTrend} height={160} unit="" />
                ) : (
                  <Typography.Text type="secondary">暂无</Typography.Text>
                )}
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title="在制墙"
        extra={
          <Space wrap>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              仅静默{" "}
              <Switch size="small" checked={onlySilent} onChange={setOnlySilent} />
            </span>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              仅红黄{" "}
              <Switch size="small" checked={onlyRisk} onChange={setOnlyRisk} />
            </span>
            <Segmented
              size="small"
              value={boardMode}
              onChange={(v) => setBoardMode(v as BoardMode)}
              options={[
                { value: "cards", label: "卡片" },
                { value: "swimlane", label: "泳道" },
                { value: "table", label: "表格" },
              ]}
            />
          </Space>
        }
      >
        {boardMode === "cards" ? (
          <Row gutter={[12, 12]}>
            {activeFiltered.length ? (
              activeFiltered.map((item) => (
                <Col key={item.id} xs={24} sm={12} lg={8} xl={6}>
                  <ActiveCard item={item} />
                </Col>
              ))
            ) : (
              <Col span={24}>
                <Typography.Text type="secondary">暂无在制；确认报工后会出现在此</Typography.Text>
              </Col>
            )}
          </Row>
        ) : null}

        {boardMode === "swimlane" ? (
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
            {swimlanes.length ? (
              swimlanes.map(([lane, items]) => (
                <div key={lane}>
                  <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
                    {lane}
                    <Typography.Text type="secondary" style={{ marginLeft: 8, fontWeight: 400 }}>
                      {items.length} 单
                    </Typography.Text>
                  </Typography.Text>
                  <Row gutter={[12, 12]}>
                    {items.map((item) => (
                      <Col key={item.id} xs={24} sm={12} lg={8} xl={6}>
                        <ActiveCard item={item} />
                      </Col>
                    ))}
                  </Row>
                </div>
              ))
            ) : (
              <Typography.Text type="secondary">暂无在制</Typography.Text>
            )}
          </Space>
        ) : null}

        {boardMode === "table" ? (
          <Table<CockpitActiveItem>
            size="small"
            rowKey="id"
            loading={loading}
            pagination={false}
            dataSource={activeFiltered}
            locale={{ emptyText: "暂无在制报工" }}
            scroll={{ x: 1080 }}
            columns={[
              {
                title: "态",
                width: 56,
                render: (_: unknown, row) => {
                  const label = row.tone === "red" ? "红" : row.tone === "yellow" ? "黄" : "绿";
                  const color =
                    row.tone === "red" ? "red" : row.tone === "yellow" ? "orange" : "green";
                  return <Tag color={color}>{label}</Tag>;
                },
              },
              {
                title: "工单 / 产品",
                width: 200,
                render: (_: unknown, row) => (
                  <span>
                    <Tag>{row.link_type_label || row.link_type}</Tag>
                    {row.work_order_label || row.product || "—"}
                  </span>
                ),
              },
              { title: "泳道", dataIndex: "lane", width: 100 },
              {
                title: "人 / 机",
                width: 140,
                render: (_: unknown, row) =>
                  `${row.current_holder || "—"} / ${row.equipment_name || "—"}`,
              },
              {
                title: "已确认",
                width: 90,
                render: (_: unknown, row) => (
                  <Typography.Text strong>{row.total_confirmed_qty || 0}</Typography.Text>
                ),
              },
              {
                title: "交期",
                width: 140,
                render: (_: unknown, row) => (
                  <span>
                    {row.due_date || "—"} {dueTag(row.days_to_due)}
                  </span>
                ),
              },
              {
                title: "静默",
                width: 90,
                render: (_: unknown, row) =>
                  row.silent_hours != null ? (
                    <Typography.Text
                      type={row.silent_hours >= silentThreshold ? "danger" : undefined}
                    >
                      {row.silent_hours}h
                    </Typography.Text>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        ) : null}
      </Card>

      <Drawer
        title={`异常中心（${alertFiltered.length}/${actionsAll.length}）`}
        open={alertOpen}
        onClose={() => setAlertOpen(false)}
        width={520}
        destroyOnHidden
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            allowClear
            placeholder="类型"
            style={{ width: 150 }}
            value={alertType}
            onChange={setAlertType}
            options={typeOptions}
          />
          <Select
            allowClear
            placeholder="级别"
            style={{ width: 120 }}
            value={alertLevel}
            onChange={setAlertLevel}
            options={[
              { value: "error", label: "紧急" },
              { value: "warning", label: "警告" },
              { value: "info", label: "提示" },
            ]}
          />
        </Space>
        {alertFiltered.length ? (
          <Space direction="vertical" style={{ width: "100%" }} size={10}>
            {alertFiltered.map((a) => (
              <ActionRow key={a.id} a={a} />
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">无匹配异常</Typography.Text>
        )}
      </Drawer>
    </div>
  );
}
