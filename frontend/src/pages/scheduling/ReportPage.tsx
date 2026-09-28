import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  CheckCircleOutlined,
  CheckOutlined,
  DeleteOutlined,
  FormOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import {
  deleteDailyLog,
  fetchReport,
  finishOperation,
  OP_STATUS_COLOR,
  OP_STATUS_LABEL,
  pauseOperation,
  startOperation,
  submitDailyLog,
  type DailyLogItem,
  type OperationItem,
} from "@/api/scheduling";
import SignaturePad from "@/pages/scheduling/SignaturePad";
import { KpiRow } from "@/components/blocks";
import { DataTable, FormModal, PageHeader, StatusTag } from "@/components/kit";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";

type TodayTask = OperationItem & {
  today_logged?: boolean;
  today_confirmed?: boolean;
  today_log?: DailyLogItem | null;
  can_resign?: boolean;
  task_bucket?: string;
  task_bucket_label?: string;
  start_hint?: string;
  plan_assignee_name?: string;
  actual_assignee_names?: string | null;
  actual_workers_today?: Array<{
    person_id: string;
    person_name: string;
    hours?: number;
    confirmed?: boolean;
  }>;
  today_signed_count?: number;
  today_report_count?: number;
};

/** 与甘特同一套「今天」：真实日历（后端 _planning_today） */
export default function ReportPage() {
  const [defaultSignerId, setDefaultSignerId] = useState<string | undefined>(undefined);
  const [workDate, setWorkDate] = useState<Dayjs>(() => dayjs());
  const [logOpen, setLogOpen] = useState(false);
  const [loggingOp, setLoggingOp] = useState<TodayTask | null>(null);
  const [signPersonId, setSignPersonId] = useState<string | undefined>(undefined);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [sigResetKey, setSigResetKey] = useState(0);
  const [previewSig, setPreviewSig] = useState<string | null>(null);
  const [logForm] = Form.useForm();
  const [resourceId, setResourceId] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [keyword, setKeyword] = useState("");

  const dateStr = workDate.format("YYYY-MM-DD");

  const { data, loading, refresh } = useRequest(
    () => fetchReport({ work_date: dateStr }),
    { immediate: true, deps: [dateStr] },
  );

  const resources = useMemo(() => {
    const map = new Map<string, string>();
    for (const op of data?.items ?? []) {
      if (op.resource_id && op.resource_name) map.set(op.resource_id, op.resource_name);
    }
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [data?.items]);

  /** 关键字：订单号/名、工单号/名、工序名、责任人；不碰「默认签字人」 */
  const matchKeyword = (r: {
    name?: string;
    order_code?: string | null;
    order_name?: string | null;
    work_order_code?: string | null;
    work_order_name?: string | null;
    op_name?: string | null;
    assignee_name?: string | null;
    plan_assignee_name?: string | null;
    actual_assignee_names?: string | null;
    person_name?: string | null;
  }) => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return true;
    const hay = [
      r.name,
      r.op_name,
      r.order_code,
      r.order_name,
      r.work_order_code,
      r.work_order_name,
      r.assignee_name,
      r.plan_assignee_name,
      r.actual_assignee_names,
      r.person_name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(kw);
  };

  const items = useMemo(() => {
    let rows = data?.items ?? [];
    if (resourceId) rows = rows.filter((r) => r.resource_id === resourceId);
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    rows = rows.filter((r) => matchKeyword(r));
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matchKeyword 随 keyword 变
  }, [data?.items, resourceId, statusFilter, keyword]);

  const todayTasks = useMemo(
    () => (data?.today_tasks ?? []).filter((r) => matchKeyword(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.today_tasks, keyword],
  );

  const dailyLogs = useMemo(
    () =>
      (data?.daily_logs ?? []).filter((lg) =>
        matchKeyword({
          op_name: lg.op_name,
          order_code: lg.order_code,
          order_name: lg.order_name,
          work_order_code: lg.work_order_code,
          person_name: lg.person_name,
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.daily_logs, keyword],
  );

  const findPersonLog = (opId: string, pid: string | undefined) => {
    if (!pid) return undefined;
    return dailyLogs.find(
      (lg) =>
        lg.op_id === opId &&
        lg.person_id === pid &&
        (lg.work_date || "").slice(0, 10) === dateStr,
    );
  };

  const fillLogForm = (op: TodayTask, pid: string | undefined) => {
    const prev = findPersonLog(op.id, pid);
    const isDone = op.status === "done";
    setSignatureData(prev?.signature_data || null);
    setSigResetKey((k) => k + 1);
    logForm.setFieldsValue({
      hours: prev?.hours ?? 8,
      progress: isDone ? 100 : (prev?.progress ?? Math.max(op.progress || 0, 10)),
      work_content: prev?.work_content || prev?.note || "",
    });
  };

  const currentSignLog = loggingOp ? findPersonLog(loggingOp.id, signPersonId) : undefined;

  const { mutate: act, loading: acting } = useMutation(
    async (payload: { id: string; action: "start" | "finish" | "pause" }) => {
      if (payload.action === "start") return startOperation(payload.id);
      if (payload.action === "finish") return finishOperation(payload.id);
      return pauseOperation(payload.id, "现场异常");
    },
    {
      successMessage: (r, args) => {
        const a = args[0]?.action;
        if (a === "start") {
          const drift = (r as { plan_drift_label?: string })?.plan_drift_label;
          return drift ? `已开工（${drift}，计划已回写甘特）` : "已开工，状态已回写甘特";
        }
        if (a === "finish") {
          const calib = (r as { calibration?: { message?: string } })?.calibration?.message;
          return (
            (calib || "已完工") + "；可继续点「完工补签」完成今日签字"
          );
        }
        return "已暂停并记录";
      },
      onSuccess: async () => {
        await refresh();
      },
    },
  );

  const { mutate: saveLog, loading: savingLog } = useMutation(
    async (values: { hours: number; progress: number; work_content: string }) => {
      if (!loggingOp || !signPersonId) throw new Error("请选择实际签字人");
      if (!signatureData) throw new Error("请先手写签字确认");
      return submitDailyLog({
        op_id: loggingOp.id,
        person_id: signPersonId,
        work_date: dateStr,
        hours: values.hours,
        progress: values.progress,
        work_content: values.work_content,
        note: values.work_content,
        signature_data: signatureData,
      });
    },
    {
      successMessage: (r) => r?.message || "已确认并签字",
      onSuccess: async () => {
        setLogOpen(false);
        setLoggingOp(null);
        setSignPersonId(undefined);
        setSignatureData(null);
        logForm.resetFields();
        await refresh();
      },
    },
  );

  const { mutate: removeLog, loading: removingLog } = useMutation(
    async (logId: string) => deleteDailyLog(logId),
    {
      successMessage: (r) => r?.message || "已删除",
      onSuccess: async () => {
        if (logOpen && loggingOp) {
          setSignatureData(null);
          setSigResetKey((k) => k + 1);
          logForm.setFieldsValue({
            hours: 8,
            progress:
              loggingOp.status === "done" ? 100 : Math.max(loggingOp.progress || 0, 10),
            work_content: "",
          });
        }
        await refresh();
      },
    },
  );

  const openLog = (op: TodayTask) => {
    const defaultPid =
      defaultSignerId ||
      op.actual_workers_today?.[0]?.person_id ||
      data?.persons?.[0]?.id;
    if (!defaultPid) {
      message.warning("暂无人员可选，请先在基础数据维护人员");
      return;
    }
    setLoggingOp(op);
    setSignPersonId(defaultPid);
    fillLogForm(op, defaultPid);
    setLogOpen(true);
  };

  const onSignPersonChange = (pid: string) => {
    setSignPersonId(pid);
    if (loggingOp) fillLogForm(loggingOp, pid);
  };

  return (
    <div>
      <PageHeader
        title="工序报工"
        subtitle="班组看全部今日任务；计划责任人与实际签字人对照。人数可变：谁上手谁报、同日可多人签。"
        extra={
          <Space wrap>
            <Input
              allowClear
              placeholder="搜订单 / 工单 / 工序名"
              style={{ width: 200 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <span style={{ color: "#718096" }}>默认签字人</span>
            <Select
              allowClear
              placeholder="仅预填，不筛列表"
              style={{ width: 168 }}
              value={defaultSignerId}
              onChange={setDefaultSignerId}
              options={(data?.persons ?? []).map((p) => ({
                value: p.id,
                label: `${p.name}${p.code ? `（${p.code}）` : ""}`,
              }))}
            />
            <span style={{ color: "#718096" }}>工作日</span>
            <DatePicker
              value={workDate}
              onChange={(d) => d && setWorkDate(d)}
              allowClear={false}
            />
            <Button type="primary" onClick={() => void refresh()} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      />
      <KpiRow items={data?.kpis ?? []} loading={loading && !data} />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={data?.daily_summary?.message || "今日现场任务"}
        description="工作日决定拉取哪天任务；搜索筛订单/工单/工序；默认签字人只预填弹窗，不改变列表。"
      />

      {data?.work_order_progress ? (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            background: "#fff",
            border: "1px solid #e6eaf0",
            borderRadius: 12,
          }}
        >
          <Typography.Text type="secondary">焦点工单进度</Typography.Text>
          <div style={{ fontWeight: 600, marginTop: 4 }}>
            {data.work_order_progress.work_order_code} · {data.work_order_progress.work_order_name}
          </div>
          <Progress percent={data.work_order_progress.percent} style={{ maxWidth: 360 }} />
          <div style={{ color: "#718096", fontSize: 12 }}>{data.work_order_progress.summary}</div>
        </div>
      ) : null}

      <Tabs
        items={[
          {
            key: "today",
            label: "今日任务",
            children: (
              <DataTable<TodayTask>
                rowKey="id"
                loading={loading || acting}
                dataSource={todayTasks}
                locale={{
                  emptyText: "暂无待办：无当日计划、无补做、无可提前工序",
                }}
                columns={[
                  {
                    title: "工序",
                    key: "op",
                    render: (_, r) => (
                      <div>
                        <div style={{ fontWeight: 600 }}>{r.name}</div>
                        <div style={{ fontSize: 12, color: "#718096" }}>
                          {r.order_code || "-"} · {r.work_order_code || "-"}
                        </div>
                        <Space size={4} wrap style={{ marginTop: 4 }}>
                          {r.task_bucket_label ? (
                            <Tag
                              color={
                                r.task_bucket === "overdue"
                                  ? "red"
                                  : r.task_bucket === "early"
                                    ? "geekblue"
                                    : r.task_bucket === "running"
                                      ? "green"
                                      : "default"
                              }
                            >
                              {r.task_bucket_label}
                            </Tag>
                          ) : null}
                          {r.plan_drift_label ? <Tag color="orange">{r.plan_drift_label}</Tag> : null}
                        </Space>
                        {r.start_hint ? (
                          <div style={{ fontSize: 12, color: "#718096", marginTop: 2 }}>
                            {r.start_hint}
                          </div>
                        ) : null}
                      </div>
                    ),
                  },
                  {
                    title: "计划日期",
                    width: 120,
                    render: (_, r) =>
                      r.plan_start
                        ? `${r.plan_start.slice(5)}~${(r.plan_end || r.plan_start).slice(5)}`
                        : "未排产",
                  },
                  {
                    title: "班次",
                    width: 100,
                    render: (_, r) => r.shift_name || r.slot_label || "—",
                  },
                  {
                    title: "计划 / 实际",
                    width: 168,
                    render: (_, r) => (
                      <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                        <div>
                          <span style={{ color: "#718096" }}>计划 </span>
                          {r.plan_assignee_name || r.assignee_name || "未派人"}
                        </div>
                        <div>
                          <span style={{ color: "#718096" }}>实际 </span>
                          {r.actual_assignee_names || (
                            <span style={{ color: "#a0aec0" }}>未报</span>
                          )}
                        </div>
                        {(r.today_signed_count || 0) > 0 ? (
                          <div style={{ color: "#718096" }}>
                            已签 {r.today_signed_count}
                            {(r.today_report_count || 0) > (r.today_signed_count || 0)
                              ? ` / 已报 ${r.today_report_count}`
                              : ""}{" "}
                            人
                          </div>
                        ) : null}
                      </div>
                    ),
                  },
                  {
                    title: "进度",
                    width: 120,
                    render: (_, r) => <Progress percent={r.progress || 0} size="small" />,
                  },
                  {
                    title: "确认",
                    width: 100,
                    render: (_, r) => {
                      if ((r.today_signed_count || 0) > 0) {
                        return <Tag color="green">已签 {r.today_signed_count} 人</Tag>;
                      }
                      if ((r.today_report_count || 0) > 0) {
                        return <Tag color="orange">有报未签</Tag>;
                      }
                      return <Tag>未确认</Tag>;
                    },
                  },
                  {
                    title: "状态",
                    dataIndex: "status",
                    width: 90,
                    render: (v: string) => (
                      <StatusTag value={v} labelMap={OP_STATUS_LABEL} colorMap={OP_STATUS_COLOR} />
                    ),
                  },
                  {
                    title: "操作",
                    width: 128,
                    fixed: "right",
                    render: (_, r) => {
                      const confirmed = Boolean(r.today_confirmed);
                      return (
                      <Space size={0} wrap={false}>
                        <Tooltip
                          title={
                            r.status === "done"
                              ? confirmed
                                ? "查看/重签"
                                : "完工补签"
                              : confirmed
                                ? "重新确认"
                                : "下班确认"
                          }
                        >
                          <Button
                            type="link"
                            size="small"
                            aria-label={
                              r.status === "done"
                                ? confirmed
                                  ? "重签"
                                  : "完工补签"
                                : confirmed
                                  ? "重新确认"
                                  : "下班确认"
                            }
                            icon={confirmed ? <FormOutlined /> : <CheckCircleOutlined />}
                            onClick={() => openLog(r)}
                          />
                        </Tooltip>
                        {r.status === "pending" ? (
                          <Tooltip
                            title={
                              r.can_start === false
                                ? r.start_blocked_reason || "未到计划开始日"
                                : "开工"
                            }
                          >
                            <Button
                              type="link"
                              size="small"
                              aria-label="开工"
                              disabled={r.can_start === false}
                              icon={<PlayCircleOutlined />}
                              onClick={() => void act({ id: r.id, action: "start" })}
                            />
                          </Tooltip>
                        ) : null}
                        {r.status === "running" ? (
                          <>
                            <Tooltip title="暂停">
                              <Button
                                type="link"
                                size="small"
                                aria-label="暂停"
                                icon={<PauseCircleOutlined />}
                                onClick={() => void act({ id: r.id, action: "pause" })}
                              />
                            </Tooltip>
                            <Tooltip title="完工">
                              <Button
                                type="link"
                                size="small"
                                aria-label="完工"
                                icon={<CheckOutlined />}
                                onClick={() => void act({ id: r.id, action: "finish" })}
                              />
                            </Tooltip>
                          </>
                        ) : null}
                        {r.status === "paused" ? (
                          <Tooltip title="复工">
                            <Button
                              type="link"
                              size="small"
                              aria-label="复工"
                              icon={<PlayCircleOutlined />}
                              onClick={() => void act({ id: r.id, action: "start" })}
                            />
                          </Tooltip>
                        ) : null}
                      </Space>
                      );
                    },
                  },
                ]}
              />
            ),
          },
          {
            key: "logs",
            label: "每日生产记录",
            children: (
              <DataTable<DailyLogItem>
                rowKey="id"
                loading={loading}
                dataSource={dailyLogs}
                locale={{ emptyText: "当日暂无报工记录" }}
                columns={[
                  {
                    title: "时间",
                    dataIndex: "at",
                    width: 150,
                    render: (v: string) => (v ? v.replace("T", " ").slice(0, 16) : "—"),
                  },
                  {
                    title: "人员",
                    key: "person",
                    width: 100,
                    render: (_, r) => r.person_name || r.person_id,
                  },
                  {
                    title: "工序 / 订单",
                    key: "op",
                    render: (_, r) => (
                      <div>
                        <div>{r.op_name || r.op_id}</div>
                        <div style={{ fontSize: 12, color: "#718096" }}>
                          {r.order_code || "-"} · {r.work_order_code || "-"}
                        </div>
                      </div>
                    ),
                  },
                  {
                    title: "工时",
                    dataIndex: "hours",
                    width: 72,
                    render: (v: number) => `${v} h`,
                  },
                  {
                    title: "进度",
                    dataIndex: "progress",
                    width: 72,
                    render: (v: number) => `${v}%`,
                  },
                  {
                    title: "工作内容",
                    dataIndex: "work_content",
                    ellipsis: true,
                    render: (v: string, r) => v || r.note || "—",
                  },
                  {
                    title: "签字",
                    width: 100,
                    render: (_, r) =>
                      r.has_signature || r.signature_data ? (
                        <Button
                          type="link"
                          size="small"
                          onClick={() => setPreviewSig(r.signature_data || null)}
                        >
                          查看签字
                        </Button>
                      ) : (
                        <Tag color="orange">未签</Tag>
                      ),
                  },
                  {
                    title: "确认",
                    width: 80,
                    render: (_, r) =>
                      r.confirmed ? <Tag color="green">已确认</Tag> : <Tag>未确认</Tag>,
                  },
                  {
                    title: "操作",
                    width: 72,
                    fixed: "right",
                    render: (_, r) => (
                      <Popconfirm
                        title="删除该报工记录？"
                        description="签错可删；不回滚工序进度。"
                        okText="删除"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => void removeLog(r.id)}
                      >
                        <Button
                          type="link"
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                          loading={removingLog}
                        />
                      </Popconfirm>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: "all",
            label: "全部工序（查询）",
            children: (
              <>
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="本页仅查询与对照"
                  description="开工 / 暂停 / 完工 / 报工请到「今日任务」。可补做逾期未完成，也可提前开明天的计划（开工会回写甘特）。"
                />
                <DataTable<OperationItem>
                  rowKey="id"
                  loading={loading}
                  dataSource={items}
                  title={() => (
                    <Space wrap>
                      <Select
                        allowClear
                        placeholder="全部班组"
                        style={{ width: 140 }}
                        value={resourceId}
                        onChange={setResourceId}
                        options={resources}
                      />
                      <Select
                        allowClear
                        placeholder="全部状态"
                        style={{ width: 140 }}
                        value={statusFilter}
                        onChange={setStatusFilter}
                        options={Object.entries(OP_STATUS_LABEL).map(([value, label]) => ({
                          value,
                          label,
                        }))}
                      />
                      <Input
                        allowClear
                        placeholder="搜订单 / 工单 / 工序"
                        style={{ width: 200 }}
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                      />
                    </Space>
                  )}
                  columns={[
                    {
                      title: "订单 / 任务",
                      key: "order",
                      width: 140,
                      render: (_, r) => (
                        <div>
                          <div>{r.order_code || "-"}</div>
                          <div style={{ fontSize: 12, color: "#718096" }}>{r.order_name || ""}</div>
                        </div>
                      ),
                    },
                    { title: "工序", dataIndex: "name" },
                    {
                      title: "计划",
                      width: 130,
                      render: (_, r) =>
                        r.plan_start
                          ? `${r.plan_start.slice(5)}~${(r.plan_end || "").slice(5)}`
                          : "未排产",
                    },
                    { title: "责任人", dataIndex: "assignee_name", width: 100 },
                    {
                      title: "进度",
                      width: 140,
                      render: (_, r) => <Progress percent={r.progress || 0} size="small" />,
                    },
                    {
                      title: "状态",
                      dataIndex: "status",
                      width: 90,
                      render: (v: string) => (
                        <StatusTag value={v} labelMap={OP_STATUS_LABEL} colorMap={OP_STATUS_COLOR} />
                      ),
                    },
                    {
                      title: "偏离",
                      width: 100,
                      render: (_, r) =>
                        r.plan_drift_label ? (
                          <Tag color="orange">{r.plan_drift_label}</Tag>
                        ) : (
                          "—"
                        ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: "events",
            label: "现场动态",
            children: (
              <ul style={{ lineHeight: 1.9 }}>
                {(data?.events ?? []).map((ev) => (
                  <li key={ev.id}>
                    <Typography.Text type="secondary">{ev.at}</Typography.Text> · {ev.person_name}{" "}
                    · {ev.op_name} · {ev.message}
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
      />

      <FormModal
        title={
          loggingOp
            ? `${loggingOp.status === "done" ? "完工补签" : "下班确认"} · ${loggingOp.name}`
            : "下班确认"
        }
        open={logOpen}
        form={logForm}
        confirmLoading={savingLog}
        width={560}
        onCancel={() => {
          setLogOpen(false);
          setLoggingOp(null);
          setSignPersonId(undefined);
          setSignatureData(null);
        }}
        onOk={async () => {
          if (!signPersonId) {
            message.warning("请选择实际签字人");
            return;
          }
          if (!signatureData) {
            message.warning("请先用手写签字确认");
            return;
          }
          const values = await logForm.validateFields();
          await saveLog(values);
        }}
        okText="确认并签字提交"
      >
        {loggingOp ? (
          <div style={{ marginBottom: 12, color: "#718096", fontSize: 12 }}>
            {dateStr} · 当前进度 {loggingOp.progress || 0}%
            {loggingOp.status === "done"
              ? " · 工序已完工，补签今日工作内容"
              : " · 下班前确认今日工作并签字"}
            {currentSignLog?.confirmed ? " · 该人今日已签，提交将覆盖" : ""}
          </div>
        ) : null}
        <Form.Item label="实际签字人" required>
          <Select
            style={{ width: "100%" }}
            placeholder="选择实际签字人"
            value={signPersonId}
            onChange={onSignPersonChange}
            options={(data?.persons ?? []).map((p) => ({
              value: p.id,
              label: `${p.name}${p.code ? `（${p.code}）` : ""}`,
            }))}
          />
        </Form.Item>
        <Form.Item
          name="work_content"
          label="今日工作内容确认"
          rules={[{ required: true, message: "请填写工作内容" }]}
        >
          <Input.TextArea
            rows={3}
            placeholder="例如：完成装配主体，待质检；异常已报班长…"
          />
        </Form.Item>
        <Form.Item
          name="hours"
          label="今日工时（小时）"
          rules={[{ required: true, message: "请填写工时" }]}
        >
          <InputNumber min={0} max={24} step={0.5} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          name="progress"
          label="工序进度 %"
          rules={[{ required: true, message: "请填写进度" }]}
        >
          <InputNumber
            min={0}
            max={100}
            style={{ width: "100%" }}
            disabled={loggingOp?.status === "done"}
          />
        </Form.Item>
        <Form.Item label="本人签字" required>
          <SignaturePad
            resetKey={`${loggingOp?.id || ""}-${signPersonId || ""}-${sigResetKey}`}
            initialDataUrl={currentSignLog?.signature_data || null}
            onChange={setSignatureData}
          />
        </Form.Item>
        {currentSignLog?.id ? (
          <div style={{ marginTop: 8 }}>
            <Popconfirm
              title="删除该人今日报工记录？"
              description="签错可删；删除后可重新签字。不回滚工序进度。"
              okText="删除"
              okButtonProps={{ danger: true, loading: removingLog }}
              onConfirm={() => void removeLog(currentSignLog.id)}
            >
              <Button type="link" danger icon={<DeleteOutlined />} loading={removingLog}>
                删除本条签字记录
              </Button>
            </Popconfirm>
          </div>
        ) : null}
      </FormModal>

      <Modal
        title="签字预览"
        open={!!previewSig}
        onCancel={() => setPreviewSig(null)}
        footer={
          <Button type="primary" onClick={() => setPreviewSig(null)}>
            关闭
          </Button>
        }
        width={420}
        destroyOnHidden
      >
        {previewSig ? (
          <img
            src={previewSig}
            alt="签字"
            style={{ width: "100%", border: "1px solid #e6eaf0", borderRadius: 8 }}
          />
        ) : null}
      </Modal>
    </div>
  );
}
