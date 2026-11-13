import {
  Alert,
  AutoComplete,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
  Space,
  Tabs,
  Tag,
  TimePicker,
  Typography,
  message,
} from "antd";
import { CheckOutlined, CloseOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import {
  deleteShopFloorReport,
  fetchShopFloorProgress,
  fetchShopFloorReports,
  fetchShopFloorShiftHint,
  reviewShopFloorReport,
  submitShopFloorReportsBatch,
  type ShopFloorOrderProgressItem,
  type ShopFloorProgressItem,
  type ShopFloorReportItem,
} from "@/modules/scheduling/api/scheduling";
import { KpiRow } from "@/components/blocks";
import { DataTable, FormModal, PageHeader, StatusTag } from "@/components/kit";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";

const STATUS_LABEL: Record<string, string> = {
  pending: "待确认",
  confirmed: "已确认",
  rejected: "已驳回",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "orange",
  confirmed: "green",
  rejected: "default",
};

type LinkType = "work_order" | "product";

type BatchRow = {
  link_type: LinkType;
  link_value?: string;
  process_name?: string;
  template_id?: string;
  equipment_value?: string;
  qty?: number;
  start_time?: Dayjs | null;
  end_time?: Dayjs | null;
  note?: string;
};

function emptyRow(defaults?: { start?: Dayjs | null; end?: Dayjs | null }): BatchRow {
  return {
    link_type: "work_order",
    link_value: undefined,
    process_name: undefined,
    template_id: undefined,
    equipment_value: undefined,
    qty: 1,
    start_time: defaults?.start ?? null,
    end_time: defaults?.end ?? null,
    note: undefined,
  };
}

function parseHm(v?: string | null): Dayjs | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  return dayjs().hour(Number(m[1])).minute(Number(m[2])).second(0).millisecond(0);
}

/**
 * 生产日报（免排产）：
 * - 按人批量表格提交：工单/产品 + 工序 + 设备（均可选可填）
 * - 起止时间默认取当日班次，无班次则自填
 * - 不当天不提供修改；仅当天待确认/已驳回可删
 */
export default function DailyReportPage() {
  const [workDate, setWorkDate] = useState<Dayjs>(() => dayjs());
  const [statusFilter, setStatusFilter] = useState<string | undefined>("pending");
  const [progressView, setProgressView] = useState<"work_order" | "order">("order");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [shiftHintText, setShiftHintText] = useState<string | null>(null);
  const [form] = Form.useForm<{ person_id?: string; rows: BatchRow[] }>();

  const dateStr = workDate.format("YYYY-MM-DD");

  const { data, loading, refresh } = useRequest(
    () => fetchShopFloorReports({ work_date: dateStr }),
    { immediate: true, deps: [dateStr] },
  );

  const {
    data: progress,
    loading: progressLoading,
    refresh: refreshProgress,
  } = useRequest(fetchShopFloorProgress, { immediate: true });

  const todayStr = data?.today || dayjs().format("YYYY-MM-DD");
  const isToday = dateStr === todayStr;

  const items = useMemo(() => {
    let rows = data?.items ?? [];
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    return rows;
  }, [data?.items, statusFilter]);

  const workOrderOptions = useMemo(
    () =>
      (data?.work_orders ?? []).map((w) => ({
        value: `${w.code} · ${w.name}`,
        label: `${w.code} · ${w.name}`,
        id: w.id,
      })),
    [data?.work_orders],
  );

  const productOptions = useMemo(
    () => (data?.product_options ?? []).map((p) => ({ value: p, label: p })),
    [data?.product_options],
  );

  const processOptions = useMemo(
    () =>
      (data?.templates ?? []).map((t) => ({
        value: t.name,
        label: t.name,
        id: t.id,
      })),
    [data?.templates],
  );

  const equipmentOptions = useMemo(
    () =>
      (data?.equipments ?? [])
        .filter((e) => e.status !== "disabled")
        .map((e) => ({
          value: `${e.name}（${e.code}）`,
          label: `${e.name}（${e.code}）`,
          id: e.id,
          name: e.name,
        })),
    [data?.equipments],
  );

  const applyShiftHint = async (personId: string) => {
    if (!personId) {
      setShiftHintText(null);
      return { start: null as Dayjs | null, end: null as Dayjs | null };
    }
    try {
      const hint = await fetchShopFloorShiftHint(personId, dateStr);
      if (hint.found && hint.start_time && hint.end_time) {
        const start = parseHm(hint.start_time);
        const end = parseHm(hint.end_time);
        setShiftHintText(
          hint.shift_name
            ? `已带入班次「${hint.shift_name}」${hint.start_time}-${hint.end_time}，可改时分`
            : `已带入班次 ${hint.start_time}-${hint.end_time}，可改时分`,
        );
        return { start, end };
      }
      setShiftHintText(hint.message || "未找到当日班次，请自行填写起止时间");
      return { start: null, end: null };
    } catch {
      setShiftHintText("无法获取班次，请自行填写起止时间");
      return { start: null, end: null };
    }
  };

  const openSubmit = () => {
    form.resetFields();
    form.setFieldsValue({ person_id: undefined, rows: [emptyRow()] });
    setShiftHintText(null);
    setSubmitOpen(true);
  };

  const { mutate: doSubmit, loading: submitting } = useMutation(
    async (values: { person_id: string; rows: BatchRow[] }) => {
      const rows = (values.rows || []).map((row) => {
        const linkType = row.link_type || "work_order";
        const linkValue = (row.link_value || "").trim();
        const processName = (row.process_name || "").trim();
        const tpl = processOptions.find((t) => t.value === processName || t.id === row.template_id);
        const eqOpt = equipmentOptions.find(
          (e) => e.value === row.equipment_value || e.name === row.equipment_value,
        );
        const payload: {
          link_type: LinkType;
          process_name: string;
          template_id?: string;
          qty: number;
          start_time?: string;
          end_time?: string;
          work_order_id?: string;
          work_order_label?: string;
          product?: string;
          equipment_id?: string;
          equipment_name?: string;
          note?: string;
        } = {
          link_type: linkType,
          process_name: processName,
          template_id: tpl?.id,
          qty: Number(row.qty) || 0,
          start_time: row.start_time ? row.start_time.format("HH:mm") : undefined,
          end_time: row.end_time ? row.end_time.format("HH:mm") : undefined,
          note: row.note,
        };
        if (linkType === "work_order") {
          const wo = workOrderOptions.find((w) => w.value === linkValue || w.id === linkValue);
          if (wo) payload.work_order_id = wo.id;
          else payload.work_order_label = linkValue;
        } else {
          payload.product = linkValue;
        }
        if (eqOpt) {
          payload.equipment_id = eqOpt.id;
          payload.equipment_name = eqOpt.name;
        } else if ((row.equipment_value || "").trim()) {
          payload.equipment_name = (row.equipment_value || "").trim();
        }
        return payload;
      });
      return submitShopFloorReportsBatch({
        person_id: values.person_id,
        work_date: dateStr,
        rows,
      });
    },
    {
      successMessage: "已提交，等待车间主任确认",
      onSuccess: () => {
        setSubmitOpen(false);
        form.resetFields();
        refresh();
        refreshProgress();
      },
    },
  );

  const { mutate: doReview, loading: reviewing } = useMutation(
    async (payload: { id: string; action: "confirm" | "reject" }) =>
      reviewShopFloorReport(payload.id, {
        action: payload.action,
        reviewer: "车间主任",
      }),
    {
      successMessage: "已处理",
      onSuccess: () => {
        refresh();
        refreshProgress();
      },
    },
  );

  const { mutate: doDelete } = useMutation(
    (id: string) => deleteShopFloorReport(id),
    {
      successMessage: "已删除",
      onSuccess: () => refresh(),
    },
  );

  return (
    <div>
      <PageHeader
        title="生产日报"
        subtitle=""
        extra={
          <Space wrap>
            <DatePicker
              value={workDate}
              allowClear={false}
              onChange={(d) => d && setWorkDate(d)}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={openSubmit}>
              下班提交
            </Button>
          </Space>
        }
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="按人报工：一人可一次填多行（多工单/产品、多工序）。挂接仅工单或产品；工序与设备可从列表选也可手写。起止默认当日班次。历史日仅查看，不提供修改；仅当天待确认/已驳回可删。"
      />

      {!isToday ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="当前查看的不是今天：可浏览与确认，暂不提供修改；删除仅限当天未确认记录。"
        />
      ) : null}

      <KpiRow items={data?.kpis ?? []} loading={loading && !data} />

      <Tabs
        items={[
          {
            key: "review",
            label: "当日确认",
            children: (
              <DataTable<ShopFloorReportItem>
                rowKey="id"
                loading={loading}
                dataSource={items}
                scroll={{ x: 1100 }}
                title={() => (
                  <Space wrap>
                    <span style={{ fontWeight: 600 }}>当日日报</span>
                    <Select
                      allowClear
                      placeholder="状态"
                      style={{ width: 120 }}
                      value={statusFilter}
                      onChange={setStatusFilter}
                      options={[
                        { value: "pending", label: "待确认" },
                        { value: "confirmed", label: "已确认" },
                        { value: "rejected", label: "已驳回" },
                      ]}
                    />
                  </Space>
                )}
                columns={[
                  { title: "日期", dataIndex: "work_date", width: 110 },
                  {
                    title: "状态",
                    dataIndex: "status",
                    width: 90,
                    render: (v: string) => (
                      <StatusTag value={v} labelMap={STATUS_LABEL} colorMap={STATUS_COLOR} />
                    ),
                  },
                  {
                    title: "挂接",
                    width: 180,
                    render: (_: unknown, row) => (
                      <span>
                        <Tag>{row.link_type_label || row.link_type}</Tag>
                        {row.work_order_label ||
                          row.work_order_code ||
                          row.product_display ||
                          "—"}
                      </span>
                    ),
                  },
                  { title: "工序", dataIndex: "process_name", width: 100 },
                  {
                    title: "数量",
                    dataIndex: "qty",
                    width: 80,
                    render: (v: number) => <Typography.Text strong>{v}</Typography.Text>,
                  },
                  { title: "人员", dataIndex: "person_name", width: 90 },
                  {
                    title: "设备",
                    dataIndex: "equipment_name",
                    width: 100,
                    render: (v) => v || "—",
                  },
                  {
                    title: "时段",
                    width: 110,
                    render: (_: unknown, row) =>
                      row.start_time && row.end_time
                        ? `${row.start_time}-${row.end_time}`
                        : "—",
                  },
                  { title: "工时", dataIndex: "hours", width: 70 },
                  { title: "备注", dataIndex: "note", ellipsis: true },
                  {
                    title: "操作",
                    width: 200,
                    fixed: "right",
                    render: (_: unknown, row) => {
                      const canDelete =
                        isToday && (row.status === "pending" || row.status === "rejected");
                      return (
                        <Space size={4}>
                          {row.status === "pending" ? (
                            <>
                              <Button
                                type="link"
                                size="small"
                                icon={<CheckOutlined />}
                                loading={reviewing}
                                onClick={() => doReview({ id: row.id, action: "confirm" })}
                              >
                                确认
                              </Button>
                              <Button
                                type="link"
                                size="small"
                                danger
                                icon={<CloseOutlined />}
                                loading={reviewing}
                                onClick={() => doReview({ id: row.id, action: "reject" })}
                              >
                                驳回
                              </Button>
                            </>
                          ) : (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {row.reviewed_by || "—"}
                              {row.reviewed_at ? ` · ${row.reviewed_at.slice(11, 16)}` : ""}
                            </Typography.Text>
                          )}
                          {canDelete ? (
                            <Button
                              type="link"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => doDelete(row.id)}
                            >
                              删除
                            </Button>
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
            key: "progress",
            label: "进度",
            children: (
              <>
                <Space wrap style={{ marginBottom: 12 }}>
                  <Segmented
                    value={progressView}
                    onChange={(v) => setProgressView(v as "work_order" | "order")}
                    options={[
                      { value: "order", label: "订单进度（老板）" },
                      { value: "work_order", label: "工单 / 产品" },
                    ]}
                  />
                </Space>
                {progress?.note ? (
                  <Alert type="info" showIcon style={{ marginBottom: 12 }} message={progress.note} />
                ) : null}
                {progressView === "order" && (progress?.unlinked_product_reports ?? 0) > 0 ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={`另有 ${progress?.unlinked_product_reports} 条已确认日报未挂到订单（仅产品或手写工单），请在「工单 / 产品」视图查看。`}
                  />
                ) : null}

                {progressView === "order" ? (
                  <DataTable<ShopFloorOrderProgressItem>
                    rowKey="id"
                    loading={progressLoading}
                    dataSource={progress?.orders ?? []}
                    columns={[
                      { title: "订单号", dataIndex: "order_code", width: 130 },
                      { title: "名称", dataIndex: "order_name" },
                      { title: "产品", dataIndex: "product", width: 120 },
                      {
                        title: "下属工单",
                        width: 160,
                        render: (_: unknown, row) =>
                          row.work_order_codes?.length
                            ? row.work_order_codes.join("、")
                            : row.work_order_count
                              ? `${row.work_order_count} 个`
                              : "—",
                      },
                      {
                        title: "交期",
                        dataIndex: "due_date",
                        width: 130,
                        render: (v: string, row) => (
                          <span>
                            {v || "—"}
                            {typeof row.days_to_due === "number" ? (
                              <Tag
                                color={
                                  row.days_to_due < 0
                                    ? "red"
                                    : row.days_to_due <= 3
                                      ? "orange"
                                      : "default"
                                }
                                style={{ marginLeft: 6 }}
                              >
                                {row.days_to_due < 0
                                  ? `逾 ${-row.days_to_due} 天`
                                  : `剩 ${row.days_to_due} 天`}
                              </Tag>
                            ) : null}
                          </span>
                        ),
                      },
                      {
                        title: "已确认产量",
                        dataIndex: "total_confirmed_qty",
                        width: 110,
                        render: (v: number) => (v ? v : "—"),
                      },
                      {
                        title: "工序累计",
                        render: (_: unknown, row) =>
                          row.processes?.length
                            ? row.processes.map((p) => `${p.process_name} ${p.qty}`).join(" · ")
                            : "暂无已确认日报",
                      },
                      {
                        title: "最近工序 / 人",
                        width: 160,
                        render: (_: unknown, row) =>
                          row.current_process || row.current_holder
                            ? `${row.current_process || "—"} / ${row.current_holder || "—"}`
                            : "—",
                      },
                    ]}
                  />
                ) : (
                  <DataTable<ShopFloorProgressItem>
                    rowKey="id"
                    loading={progressLoading}
                    dataSource={progress?.work_orders ?? progress?.items ?? []}
                    columns={[
                      {
                        title: "挂接",
                        width: 80,
                        render: (_: unknown, row) => (
                          <Tag>{row.link_type_label || row.link_type}</Tag>
                        ),
                      },
                      {
                        title: "工单 / 产品",
                        render: (_: unknown, row) =>
                          row.link_type === "product"
                            ? row.product || "—"
                            : row.work_order_label ||
                              [row.work_order_code, row.work_order_name].filter(Boolean).join(" · ") ||
                              row.product ||
                              "—",
                      },
                      {
                        title: "产品",
                        dataIndex: "product",
                        width: 120,
                        render: (v: string, row) => (row.link_type === "product" ? "—" : v || "—"),
                      },
                      {
                        title: "交期",
                        dataIndex: "due_date",
                        width: 130,
                        render: (v: string, row) => (
                          <span>
                            {v || "—"}
                            {typeof row.days_to_due === "number" ? (
                              <Tag
                                color={
                                  row.days_to_due < 0
                                    ? "red"
                                    : row.days_to_due <= 3
                                      ? "orange"
                                      : "default"
                                }
                                style={{ marginLeft: 6 }}
                              >
                                {row.days_to_due < 0
                                  ? `逾 ${-row.days_to_due} 天`
                                  : `剩 ${row.days_to_due} 天`}
                              </Tag>
                            ) : null}
                          </span>
                        ),
                      },
                      {
                        title: "已确认产量",
                        dataIndex: "total_confirmed_qty",
                        width: 110,
                        render: (v: number) => (v ? v : "—"),
                      },
                      {
                        title: "工序累计",
                        render: (_: unknown, row) =>
                          row.processes?.length
                            ? row.processes.map((p) => `${p.process_name} ${p.qty}`).join(" · ")
                            : "暂无已确认日报",
                      },
                      {
                        title: "最近工序 / 人",
                        width: 160,
                        render: (_: unknown, row) =>
                          row.current_process || row.current_holder
                            ? `${row.current_process || "—"} / ${row.current_holder || "—"}`
                            : "—",
                      },
                    ]}
                  />
                )}
              </>
            ),
          },
        ]}
      />

      <FormModal
        title={`下班提交 · ${dateStr}`}
        open={submitOpen}
        form={form}
        onCancel={() => setSubmitOpen(false)}
        confirmLoading={submitting}
        width={1080}
        onOk={async () => {
          const values = await form.validateFields();
          if (!values.person_id) {
            message.warning("请选择作业人员");
            return;
          }
          if (!(values.rows || []).length) {
            message.warning("请至少填写一行");
            return;
          }
          await doSubmit(values as { person_id: string; rows: BatchRow[] });
        }}
      >
        <Form.Item name="person_id" label="作业人员" rules={[{ required: true, message: "请选择人员" }]}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="一人一天可报多行"
            options={(data?.persons ?? [])
              .filter((p) => p.status !== "disabled")
              .map((p) => ({ value: p.id, label: `${p.name}（${p.code}）` }))}
            onChange={async (personId: string) => {
              const { start, end } = await applyShiftHint(personId);
              const rows = (form.getFieldValue("rows") as BatchRow[]) || [];
              form.setFieldsValue({
                rows: rows.map((r) => ({
                  ...r,
                  start_time: start,
                  end_time: end,
                })),
              });
            }}
          />
        </Form.Item>

        {shiftHintText ? (
          <Alert
            type={shiftHintText.includes("未找到") || shiftHintText.includes("无法") ? "warning" : "success"}
            showIcon
            style={{ marginBottom: 12 }}
            message={shiftHintText}
          />
        ) : null}

        <Form.List
          name="rows"
          rules={[
            {
              validator: async (_, rows) => {
                if (!rows || rows.length < 1) throw new Error("请至少添加一行报工");
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <div style={{ overflowX: "auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "88px 1fr 1fr 1fr 72px 88px 88px 1fr 40px",
                  gap: 8,
                  marginBottom: 6,
                  fontSize: 12,
                  color: "#718096",
                  minWidth: 920,
                }}
              >
                <span>挂接</span>
                <span>工单 / 产品</span>
                <span>工序</span>
                <span>设备</span>
                <span>数量</span>
                <span>开始</span>
                <span>结束</span>
                <span>备注</span>
                <span />
              </div>
              {fields.map((field) => (
                <div
                  key={field.key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "88px 1fr 1fr 1fr 72px 88px 88px 1fr 40px",
                    gap: 8,
                    marginBottom: 8,
                    minWidth: 920,
                    alignItems: "start",
                  }}
                >
                  <Form.Item
                    {...field}
                    name={[field.name, "link_type"]}
                    rules={[{ required: true }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Select
                      options={[
                        { value: "work_order", label: "工单" },
                        { value: "product", label: "产品" },
                      ]}
                      onChange={() => {
                        form.setFieldValue(["rows", field.name, "link_value"], undefined);
                      }}
                    />
                  </Form.Item>

                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, cur) => {
                      const a = prev?.rows?.[field.name]?.link_type;
                      const b = cur?.rows?.[field.name]?.link_type;
                      return a !== b;
                    }}
                  >
                    {() => {
                      const linkType =
                        (form.getFieldValue(["rows", field.name, "link_type"]) as LinkType) ||
                        "work_order";
                      return (
                        <Form.Item
                          {...field}
                          name={[field.name, "link_value"]}
                          rules={[
                            {
                              required: true,
                              message: linkType === "product" ? "填产品" : "填工单",
                            },
                          ]}
                          style={{ marginBottom: 0 }}
                        >
                          <AutoComplete
                            allowClear
                            placeholder={linkType === "product" ? "选或写产品" : "选或写工单"}
                            options={linkType === "product" ? productOptions : workOrderOptions}
                            filterOption={(input, option) =>
                              String(option?.value ?? "")
                                .toLowerCase()
                                .includes(input.toLowerCase())
                            }
                          />
                        </Form.Item>
                      );
                    }}
                  </Form.Item>

                  <Form.Item
                    {...field}
                    name={[field.name, "process_name"]}
                    rules={[{ required: true, message: "填工序" }]}
                    style={{ marginBottom: 0 }}
                  >
                    <AutoComplete
                      allowClear
                      placeholder="选模板或手写"
                      options={processOptions}
                      filterOption={(input, option) =>
                        String(option?.value ?? "")
                          .toLowerCase()
                          .includes(input.toLowerCase())
                      }
                      onSelect={(value) => {
                        const tpl = processOptions.find((t) => t.value === value);
                        if (tpl) {
                          form.setFieldValue(["rows", field.name, "template_id"], tpl.id);
                        }
                      }}
                      onChange={(value) => {
                        const tpl = processOptions.find((t) => t.value === value);
                        form.setFieldValue(
                          ["rows", field.name, "template_id"],
                          tpl?.id,
                        );
                      }}
                    />
                  </Form.Item>

                  <Form.Item {...field} name={[field.name, "equipment_value"]} style={{ marginBottom: 0 }}>
                    <AutoComplete
                      allowClear
                      placeholder="选或写设备"
                      options={equipmentOptions}
                      filterOption={(input, option) =>
                        String(option?.value ?? "")
                          .toLowerCase()
                          .includes(input.toLowerCase())
                      }
                    />
                  </Form.Item>

                  <Form.Item
                    {...field}
                    name={[field.name, "qty"]}
                    rules={[{ required: true, message: "数量" }]}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber min={0.01} style={{ width: "100%" }} />
                  </Form.Item>

                  <Form.Item {...field} name={[field.name, "start_time"]} style={{ marginBottom: 0 }}>
                    <TimePicker format="HH:mm" style={{ width: "100%" }} placeholder="开始" />
                  </Form.Item>

                  <Form.Item {...field} name={[field.name, "end_time"]} style={{ marginBottom: 0 }}>
                    <TimePicker format="HH:mm" style={{ width: "100%" }} placeholder="结束" />
                  </Form.Item>

                  <Form.Item {...field} name={[field.name, "note"]} style={{ marginBottom: 0 }}>
                    <Input placeholder="可选" />
                  </Form.Item>

                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={fields.length <= 1}
                    onClick={() => remove(field.name)}
                  />
                </div>
              ))}
              <Button
                type="dashed"
                block
                icon={<PlusOutlined />}
                onClick={() => {
                  const rows = (form.getFieldValue("rows") as BatchRow[]) || [];
                  const last = rows[rows.length - 1];
                  add(
                    emptyRow({
                      start: last?.start_time ?? null,
                      end: last?.end_time ?? null,
                    }),
                  );
                }}
              >
                再加一行
              </Button>
              <Form.ErrorList errors={errors} />
            </div>
          )}
        </Form.List>
      </FormModal>
    </div>
  );
}
