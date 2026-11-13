import {
  Button,
  Card,
  Col,
  DatePicker,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  StopOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  cancelWorkOrder,
  createWorkOrder,
  deleteWorkOrder,
  fetchWorkOrders,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  SOURCE_TYPE_COLOR,
  SOURCE_TYPE_LABEL,
  updateWorkOrder,
  WO_KIND_COLOR,
  WO_KIND_LABEL,
  WO_STATUS_COLOR,
  WO_STATUS_LABEL,
  type WorkOrderItem,
} from "@/modules/scheduling/api/scheduling";
import { DataTable, DeleteAction, FormModal, PageHeader, StatusTag } from "@/components/kit";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";

const STATUS_CHIP_KEYS = ["pending", "producing", "done", "cancelled"] as const;

type OpSpecForm = {
  template_id: string;
  duration_days: number;
  required_headcount: number;
};

function formatDateTime(v?: string | null) {
  if (!v) return "—";
  return v.length >= 16 ? `${v.slice(0, 10)} ${v.slice(11, 16)}` : v;
}

export default function WorkOrdersPage() {
  const navigate = useNavigate();
  const { data, loading, refresh } = useRequest(fetchWorkOrders, { immediate: true });
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrderItem | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [priorityFilter, setPriorityFilter] = useState<string | undefined>();
  const [sourceFilter, setSourceFilter] = useState<string | undefined>();
  const [kindFilter, setKindFilter] = useState<string | undefined>();
  const [keyword, setKeyword] = useState("");
  const [detail, setDetail] = useState<WorkOrderItem | null>(null);
  const [customKinds, setCustomKinds] = useState<Record<string, string>>({});
  const [kindDraft, setKindDraft] = useState("");
  const [customProducts, setCustomProducts] = useState<string[]>([]);
  const [productDraft, setProductDraft] = useState("");
  const woKind = Form.useWatch("wo_kind", form);
  const editWoKind = Form.useWatch("wo_kind", editForm);

  const kindOptions = useMemo(() => {
    const map: Record<string, string> = { ...WO_KIND_LABEL, ...customKinds };
    for (const row of data?.items ?? []) {
      const k = row.wo_kind || "normal";
      if (!map[k]) map[k] = row.wo_kind_label || k;
    }
    return Object.entries(map).map(([value, label]) => ({ value, label }));
  }, [customKinds, data?.items]);

  const addCustomKind = () => {
    const label = kindDraft.trim();
    if (!label) {
      message.warning("请输入工单类型名称");
      return;
    }
    const exists = kindOptions.some((o) => o.value === label || o.label === label);
    if (exists) {
      form.setFieldsValue({
        wo_kind: kindOptions.find((o) => o.label === label || o.value === label)?.value,
      });
      setKindDraft("");
      return;
    }
    setCustomKinds((prev) => ({ ...prev, [label]: label }));
    form.setFieldsValue({ wo_kind: label });
    editForm.setFieldsValue({ wo_kind: label });
    setKindDraft("");
    message.success(`已添加类型「${label}」`);
  };

  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of customProducts) {
      const name = (p || "").trim();
      if (name) set.add(name);
    }
    for (const row of data?.items ?? []) {
      const name = (row.product || "").trim();
      if (name) set.add(name);
    }
    for (const o of data?.orders ?? []) {
      const name = (o.product || "").trim();
      if (name) set.add(name);
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "zh"))
      .map((value) => ({ value, label: value }));
  }, [customProducts, data?.items, data?.orders]);

  const addCustomProduct = () => {
    const name = productDraft.trim();
    if (!name) {
      message.warning("请输入产品名称");
      return;
    }
    if (!productOptions.some((o) => o.value === name)) {
      setCustomProducts((prev) => [...prev, name]);
    }
    form.setFieldsValue({ product: name });
    editForm.setFieldsValue({ product: name });
    setProductDraft("");
    message.success(`已加入产品列表「${name}」`);
  };



  const overview = useMemo(() => {
    const rows = data?.items ?? [];
    const total = rows.length;
    const cancelled = rows.filter((r) => r.status === "cancelled").length;
    const active = total - cancelled;
    const pending = rows.filter((r) => r.status === "pending").length;
    const producing = rows.filter((r) => r.status === "producing").length;
    const done = rows.filter((r) => r.status === "done").length;
    const orders = data?.orders ?? [];
    const customerN = orders.filter((o) => o.source_type === "customer").length;
    const internalN = orders.length - customerN;
    return {
      total,
      cancelled,
      active,
      pending,
      producing,
      done,
      orderCount: orders.length,
      customerN,
      internalN,
      byStatus: {
        pending,
        producing,
        done,
        cancelled,
      } as Record<string, number>,
    };
  }, [data?.items, data?.orders]);

  const items = useMemo(() => {
    let rows = data?.items ?? [];
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (priorityFilter) rows = rows.filter((r) => r.priority === priorityFilter);
    if (sourceFilter) rows = rows.filter((r) => r.source_type === sourceFilter);
    if (kindFilter) rows = rows.filter((r) => (r.wo_kind || "normal") === kindFilter);
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      rows = rows.filter(
        (r) =>
          r.code.toLowerCase().includes(kw) ||
          r.name.toLowerCase().includes(kw) ||
          (r.product || "").toLowerCase().includes(kw) ||
          (r.order_code || "").toLowerCase().includes(kw) ||
          (r.order_name || "").toLowerCase().includes(kw),
      );
    }
    return rows;
  }, [data?.items, statusFilter, priorityFilter, sourceFilter, kindFilter, keyword]);

  const defaultOpSpecs = (data?.templates ?? [])
    .filter((t) => ["tpl-1", "tpl-2", "tpl-3", "tpl-4"].includes(t.id))
    .map((t) => ({
      template_id: t.id,
      duration_days: Math.max(1, Math.round((t.std_hours || 2) / 2) || 1),
      required_headcount: 1,
    }));

  const openCreate = () => {
    form.resetFields();
    setKindDraft("");
    setProductDraft("");
    form.setFieldsValue({
      priority: "normal",
      wo_kind: "normal",
      due_date: dayjs().add(7, "day"),
      op_specs:
        defaultOpSpecs.length > 0
          ? defaultOpSpecs
          : [
              { template_id: "tpl-1", duration_days: 2, required_headcount: 1 },
              { template_id: "tpl-2", duration_days: 2, required_headcount: 1 },
            ],
    });
    setOpen(true);
  };

  const { mutate: save, loading: saving } = useMutation(
    async (values: {
      name: string;
      code?: string;
      order_code?: string;
      product?: string;
      due_date: Dayjs;
      priority?: string;
      wo_kind?: string;
      op_specs?: OpSpecForm[];
    }) => {
      const opSpecs = (values.op_specs || [])
        .filter((s) => s?.template_id)
        .map((s) => ({
          template_id: s.template_id,
          duration_days: Math.max(1, Number(s.duration_days) || 1),
          required_headcount: Math.max(1, Number(s.required_headcount) || 1),
        }));
      const orderCode = (values.order_code || "").trim();
      return createWorkOrder({
        name: values.name,
        code: (values.code || "").trim() || undefined,
        order_code: orderCode || undefined,
        product: values.product || "",
        due_date: values.due_date.format("YYYY-MM-DD"),
        priority: values.priority || "normal",
        wo_kind: values.wo_kind || "normal",
        op_specs: opSpecs,
        source_type: orderCode ? "customer" : "internal",
        order_name: values.name,
      });
    },
    {
      successMessage: "已创建工单并拆分工序",
      onSuccess: async (created) => {
        setOpen(false);
        form.resetFields();
        await refresh();
        const orderId = created?.order_id;
        if (orderId) {
          Modal.confirm({
            title: "是否立即排产？",
            content: "工序已拆分，可马上拉上甘特并自动派人。",
            okText: "立即排产",
            cancelText: "稍后",
            onOk: () => {
              navigate(`/scheduling/gantt?schedule=${encodeURIComponent(orderId)}`);
            },
          });
        }
      },
    },
  );

  const { mutate: doCancel } = useMutation((id: string) => cancelWorkOrder(id), {
    successMessage: "工单已作废，相关工序已撤出排产",
    onSuccess: async () => {
      setDetail(null);
      await refresh();
    },
  });

  const { mutate: doDelete } = useMutation((id: string) => deleteWorkOrder(id), {
    successMessage: "工单已删除",
    onSuccess: async () => {
      setDetail(null);
      await refresh();
    },
  });

  const openEdit = (row: WorkOrderItem) => {
    setEditing(row);
    editForm.setFieldsValue({
      name: row.name,
      product: row.product || "",
      due_date: row.due_date ? dayjs(row.due_date.slice(0, 10)) : dayjs(),
      priority: row.priority || "normal",
      wo_kind: row.wo_kind || "normal",
    });
    setEditOpen(true);
  };

  const { mutate: saveEdit, loading: savingEdit } = useMutation(
    async (values: {
      name: string;
      product?: string;
      due_date: Dayjs;
      priority?: string;
      wo_kind?: string;
    }) => {
      if (!editing) throw new Error("未选择工单");
      return updateWorkOrder(editing.id, {
        name: values.name,
        product: values.product || "",
        due_date: values.due_date.format("YYYY-MM-DD"),
        priority: values.priority || "normal",
        wo_kind: values.wo_kind || "normal",
      });
    },
    {
      successMessage: "工单已更新",
      onSuccess: async (updated) => {
        setEditOpen(false);
        setEditing(null);
        editForm.resetFields();
        if (updated && detail?.id === updated.id) {
          setDetail(updated);
        }
        await refresh();
      },
    },
  );

  return (
    <div>
      <PageHeader
        title="工单管理"
        subtitle=""
        extra={
          <Button
            type="primary"
            onClick={openCreate}
          >
            ＋ 新建工单
          </Button>
        }
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }} align="stretch">
        <Col xs={24} md={14} style={{ display: "flex" }}>
          <Card size="small" loading={loading && !data} style={{ width: "100%", minHeight: 108 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              工单总览
            </Typography.Text>
            <div style={{ marginTop: 6, fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>
              全部 {overview.total}
              <Typography.Text type="secondary" style={{ fontSize: 14, fontWeight: 400, marginLeft: 8 }}>
                （作废 {overview.cancelled}）
              </Typography.Text>
            </div>
            <Typography.Paragraph style={{ margin: "8px 0 0", fontSize: 13 }} type="secondary">
              有效 <Typography.Text strong>{overview.active}</Typography.Text>
              {" = "}
              待排产 {overview.pending}
              {" · "}
              生产中 {overview.producing}
              {" · "}
              已完成 {overview.done}
            </Typography.Paragraph>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              订单 / 任务 {overview.orderCount}
              （客户 {overview.customerN} · 内部 {overview.internalN}）
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={10} style={{ display: "flex" }}>
          <Card size="small" loading={loading && !data} style={{ width: "100%", minHeight: 108 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              按状态筛选（点击过滤列表）
            </Typography.Text>
            <Space wrap size={[8, 8]} style={{ marginTop: 12 }}>
              <Tag.CheckableTag
                checked={!statusFilter}
                onChange={(checked) => {
                  if (checked) setStatusFilter(undefined);
                }}
              >
                全部 {overview.total}
              </Tag.CheckableTag>
              {STATUS_CHIP_KEYS.map((key) => (
                <Tag.CheckableTag
                  key={key}
                  checked={statusFilter === key}
                  onChange={(checked) => setStatusFilter(checked ? key : undefined)}
                >
                  {WO_STATUS_LABEL[key]} {overview.byStatus[key] ?? 0}
                </Tag.CheckableTag>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>

      <DataTable<WorkOrderItem>
        rowKey="id"
        loading={loading}
        dataSource={items}
        title={() => (
          <Space wrap>
            <span style={{ fontWeight: 600 }}>工单列表</span>
            <Input
              allowClear
              placeholder="搜索工单 / 订单 / 产品"
              style={{ width: 200 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Select
              allowClear
              placeholder="来源"
              style={{ width: 120 }}
              value={sourceFilter}
              onChange={setSourceFilter}
              options={Object.entries(SOURCE_TYPE_LABEL).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <Select
              allowClear
              placeholder="类型"
              style={{ width: 120 }}
              value={kindFilter}
              onChange={setKindFilter}
              options={kindOptions}
            />
            <Select
              allowClear
              placeholder="优先级"
              style={{ width: 120 }}
              value={priorityFilter}
              onChange={setPriorityFilter}
              options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Space>
        )}
        columns={[
          { title: "工单号", dataIndex: "code", width: 140 },
          { title: "名称", dataIndex: "name" },
          {
            title: "订单号",
            dataIndex: "order_code",
            width: 130,
            render: (v: string) => v || "—",
          },
          {
            title: "类型",
            dataIndex: "wo_kind",
            width: 100,
            render: (v: string, row: WorkOrderItem) => (
              <Tag color={WO_KIND_COLOR[v || "normal"] || "default"}>
                {row.wo_kind_label || WO_KIND_LABEL[v || "normal"] || v || "正常生产"}
              </Tag>
            ),
          },
          { title: "产品", dataIndex: "product" },
          { title: "工序数", dataIndex: "op_count", width: 80 },
          {
            title: "交期",
            dataIndex: "due_date",
            width: 160,
            render: (v: string, row: WorkOrderItem) => {
              if (!v) return "—";
              const changed =
                row.due_date_updated_at &&
                (row.due_date_initial || "") !== (row.due_date || "");
              return (
                <span>
                  {v.slice(0, 10)}
                  {changed ? (
                    <>
                      <br />
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        改于 {formatDateTime(row.due_date_updated_at)}
                        {row.due_date_updated_by ? ` · ${row.due_date_updated_by}` : ""}
                      </Typography.Text>
                    </>
                  ) : null}
                </span>
              );
            },
          },
          {
            title: "创建",
            width: 160,
            render: (_: unknown, row: WorkOrderItem) => (
              <span>
                {formatDateTime(row.created_at)}
                <br />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {row.created_by || "—"}
                </Typography.Text>
              </span>
            ),
          },
          {
            title: "修改",
            width: 160,
            render: (_: unknown, row: WorkOrderItem) => (
              <span>
                {formatDateTime(row.updated_at)}
                <br />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {row.updated_by || "—"}
                </Typography.Text>
              </span>
            ),
          },
          {
            title: "优先级",
            dataIndex: "priority",
            width: 90,
            render: (v: string) => (
              <StatusTag value={v} labelMap={PRIORITY_LABEL} colorMap={PRIORITY_COLOR} />
            ),
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 90,
            render: (v: string) => (
              <StatusTag value={v} labelMap={WO_STATUS_LABEL} colorMap={WO_STATUS_COLOR} />
            ),
          },
          {
            title: "操作",
            key: "actions",
            width: 128,
            fixed: "right",
            render: (_, row) => (
              <Space size={0} wrap={false}>
                <Tooltip title={row.status === "pending" ? "拆分工序" : "查看"}>
                  <Button
                    type="link"
                    size="small"
                    aria-label={row.status === "pending" ? "拆分工序" : "查看"}
                    icon={
                      row.status === "pending" ? <UnorderedListOutlined /> : <EyeOutlined />
                    }
                    onClick={() => setDetail(row)}
                  />
                </Tooltip>
                {row.status !== "done" && row.status !== "cancelled" ? (
                  <Tooltip title="编辑">
                    <Button
                      type="link"
                      size="small"
                      aria-label="编辑"
                      icon={<EditOutlined />}
                      onClick={() => openEdit(row)}
                    />
                  </Tooltip>
                ) : null}
                {row.status !== "done" && row.status !== "cancelled" ? (
                  <Tooltip title="作废">
                    <span>
                      <DeleteAction
                        title="作废该工单？"
                        content="作废后工序将撤出甘特排产，记录保留可查。误录且未排期的也可之后再删除。"
                        successMessage={false}
                        onConfirm={() => doCancel(row.id)}
                        buttonProps={{
                          type: "link",
                          size: "small",
                          danger: true,
                          icon: <StopOutlined />,
                          "aria-label": "作废",
                        }}
                      >
                        {null}
                      </DeleteAction>
                    </span>
                  </Tooltip>
                ) : null}
                {row.status === "pending" || row.status === "cancelled" ? (
                  <Tooltip title="删除">
                    <span>
                      <DeleteAction
                        title="删除该工单？"
                        content="将永久删除工单及工序；若已排上甘特会一并撤下。有进行中/已完工请用「作废」。"
                        successMessage={false}
                        onConfirm={() => doDelete(row.id)}
                        buttonProps={{
                          type: "link",
                          size: "small",
                          danger: true,
                          icon: <DeleteOutlined />,
                          "aria-label": "删除",
                        }}
                      >
                        {null}
                      </DeleteAction>
                    </span>
                  </Tooltip>
                ) : null}
              </Space>
            ),
          },
        ]}
      />

      <FormModal
        title="新建工单"
        open={open}
        form={form}
        confirmLoading={saving}
        width={860}
        formLayout="horizontal"
        labelCol={{ flex: "88px" }}
        wrapperCol={{ flex: 1 }}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          const values = await form.validateFields();
          await save(values);
        }}
        okText="创建并拆分工序"
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="name" label="工单名称" rules={[{ required: true }]}>
              <Input
                placeholder={
                  woKind === "rework"
                    ? "例如：底座焊缝返工"
                    : woKind === "add_ops"
                      ? "例如：增补质检工序"
                      : "例如：设备底座加工"
                }
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="code" label="工单号" extra="可留空自动生成">
              <Input placeholder="例如：WO-20261107-001" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="order_code" label="订单号" extra="如有则填">
              <Input placeholder="例如：SO-2026-001" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="wo_kind" label="工单类型" rules={[{ required: true }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={kindOptions}
                placeholder="选择或添加类型"
                dropdownRender={(menu) => (
                  <>
                    {menu}
                    <Divider style={{ margin: "8px 0" }} />
                    <Space style={{ padding: "0 8px 8px" }}>
                      <Input
                        placeholder="新类型名称"
                        value={kindDraft}
                        onChange={(e) => setKindDraft(e.target.value)}
                        onPressEnter={(e) => {
                          e.preventDefault();
                          addCustomKind();
                        }}
                      />
                      <Button type="link" icon={<PlusOutlined />} onClick={addCustomKind}>
                        添加
                      </Button>
                    </Space>
                  </>
                )}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="product" label="产品" rules={[{ required: true, message: "请选择产品" }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={productOptions}
                placeholder="选择产品"
                dropdownRender={(menu) => (
                  <>
                    {menu}
                    <Divider style={{ margin: "8px 0" }} />
                    <Space style={{ padding: "0 8px 8px" }}>
                      <Input
                        placeholder="新产品名称"
                        value={productDraft}
                        onChange={(e) => setProductDraft(e.target.value)}
                        onPressEnter={(e) => {
                          e.preventDefault();
                          addCustomProduct();
                        }}
                      />
                      <Button type="link" icon={<PlusOutlined />} onClick={addCustomProduct}>
                        添加产品
                      </Button>
                    </Space>
                  </>
                )}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="due_date" label="交期" rules={[{ required: true }]}>
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="priority" label="优先级" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: "normal", label: "普通优先级" },
                  { value: "high", label: "高优先级" },
                  { value: "rush", label: "紧急插队" },
                ]}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.List
          name="op_specs"
          rules={[
            {
              validator: async (_, specs) => {
                if (!specs || specs.length < 1) {
                  throw new Error("请至少添加一道工序");
                }
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                工序拆分（预计天数 × 每天人数）
              </div>
              <div style={{ color: "#718096", fontSize: 12, marginBottom: 8 }}>
                排产时按这些参数自动算期派人；人手不够则甘特上空岗并标注缺几人。
              </div>
              {fields.map((field, index) => (
                <Space key={field.key} align="start" style={{ display: "flex", marginBottom: 8 }} wrap>
                  <Form.Item
                    {...field}
                    name={[field.name, "template_id"]}
                    rules={[{ required: true, message: "选模板" }]}
                    style={{ marginBottom: 0, width: 160 }}
                  >
                    <Select
                      placeholder="工序模板"
                      options={(data?.templates ?? []).map((t) => ({
                        value: t.id,
                        label: t.name,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item
                    {...field}
                    name={[field.name, "duration_days"]}
                    rules={[{ required: true, message: "天数" }]}
                    style={{ marginBottom: 0, width: 110 }}
                  >
                    <InputNumber min={1} max={30} addonAfter="天" style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item
                    {...field}
                    name={[field.name, "required_headcount"]}
                    rules={[{ required: true, message: "人数" }]}
                    style={{ marginBottom: 0, width: 120 }}
                  >
                    <InputNumber min={1} max={20} addonAfter="人/天" style={{ width: "100%" }} />
                  </Form.Item>
                  <Button
                    type="link"
                    danger
                    disabled={fields.length <= 1}
                    onClick={() => remove(field.name)}
                  >
                    删除
                  </Button>
                  {index === fields.length - 1 ? (
                    <Button
                      type="dashed"
                      onClick={() =>
                        add({
                          template_id: undefined,
                          duration_days: 2,
                          required_headcount: 1,
                        })
                      }
                    >
                      ＋ 工序
                    </Button>
                  ) : null}
                </Space>
              ))}
              <Form.ErrorList errors={errors} />
            </div>
          )}
        </Form.List>
      </FormModal>

      <FormModal
        title={editing ? `编辑工单 · ${editing.code}` : "编辑工单"}
        open={editOpen}
        form={editForm}
        confirmLoading={savingEdit}
        width={520}
        onCancel={() => {
          setEditOpen(false);
          setEditing(null);
          editForm.resetFields();
        }}
        onOk={async () => {
          const values = await editForm.validateFields();
          await saveEdit(values);
        }}
        okText="保存"
      >
        <div style={{ marginBottom: 12, color: "#718096", fontSize: 12 }}>
          可改名称、产品、交期、优先级与类型。修改交期会记录修改时间与修改人；工序排期请到甘特调整。
        </div>
        <Form.Item name="wo_kind" label="工单类型" rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            options={kindOptions}
            dropdownRender={(menu) => (
              <>
                {menu}
                <Divider style={{ margin: "8px 0" }} />
                <Space style={{ padding: "0 8px 8px" }}>
                  <Input
                    placeholder="新类型名称"
                    value={kindDraft}
                    onChange={(e) => setKindDraft(e.target.value)}
                    onPressEnter={(e) => {
                      e.preventDefault();
                      addCustomKind();
                    }}
                  />
                  <Button type="link" icon={<PlusOutlined />} onClick={addCustomKind}>
                    添加
                  </Button>
                </Space>
              </>
            )}
          />
        </Form.Item>
        <Form.Item name="name" label="工单名称" rules={[{ required: true }]}>
          <Input
            placeholder={
              editWoKind === "rework"
                ? "例如：底座焊缝返工"
                : editWoKind === "add_ops"
                  ? "例如：增补质检工序"
                  : "例如：设备底座加工"
            }
          />
        </Form.Item>
        <Form.Item name="product" label="产品" rules={[{ required: true, message: "请选择产品" }]}>
          <Select
            showSearch
            optionFilterProp="label"
            options={productOptions}
            placeholder="选择产品"
            dropdownRender={(menu) => (
              <>
                {menu}
                <Divider style={{ margin: "8px 0" }} />
                <Space style={{ padding: "0 8px 8px" }}>
                  <Input
                    placeholder="新产品名称"
                    value={productDraft}
                    onChange={(e) => setProductDraft(e.target.value)}
                    onPressEnter={(e) => {
                      e.preventDefault();
                      addCustomProduct();
                    }}
                  />
                  <Button type="link" icon={<PlusOutlined />} onClick={addCustomProduct}>
                    添加产品
                  </Button>
                </Space>
              </>
            )}
          />
        </Form.Item>
        <Form.Item name="due_date" label="交期" rules={[{ required: true }]}>
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="priority" label="优先级" rules={[{ required: true }]}>
          <Select
            options={[
              { value: "normal", label: "普通优先级" },
              { value: "high", label: "高优先级" },
              { value: "rush", label: "紧急插队" },
            ]}
          />
        </Form.Item>
      </FormModal>

      <Drawer
        title={detail ? `${detail.code} · ${detail.name}` : "工单详情"}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={640}
        extra={
          detail && detail.status !== "done" && detail.status !== "cancelled" ? (
            <Button
              type="primary"
              onClick={() => {
                openEdit(detail);
              }}
            >
              编辑
            </Button>
          ) : null
        }
      >
        {detail && (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <div>
              <Tag color={SOURCE_TYPE_COLOR[detail.source_type || "internal"]}>
                {detail.source_type_label || SOURCE_TYPE_LABEL[detail.source_type || "internal"]}
              </Tag>
              <Tag color={WO_KIND_COLOR[detail.wo_kind || "normal"] || "default"}>
                {detail.wo_kind_label || WO_KIND_LABEL[detail.wo_kind || "normal"] || detail.wo_kind}
              </Tag>
              <Tag color={PRIORITY_COLOR[detail.priority]}>{PRIORITY_LABEL[detail.priority]}</Tag>
              <Tag color={WO_STATUS_COLOR[detail.status]}>{WO_STATUS_LABEL[detail.status]}</Tag>
            </div>
            <div>工单号：{detail.code}</div>
            <div>订单号：{detail.order_code || "—"}</div>
            {detail.customer_name ? <div>客户：{detail.customer_name}</div> : null}
            <div>产品：{detail.product || "—"}</div>
            <div>
              交期：{detail.due_date || "—"}
              {detail.due_date_initial &&
              detail.due_date_updated_at &&
              detail.due_date_initial !== detail.due_date ? (
                <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>
                  原交期 {detail.due_date_initial} · 于{" "}
                  {formatDateTime(detail.due_date_updated_at)} 由{" "}
                  {detail.due_date_updated_by || "—"} 修改
                </Typography.Text>
              ) : null}
            </div>
            <div>
              创建：{formatDateTime(detail.created_at)} · {detail.created_by || "—"}
            </div>
            <div>
              修改：{formatDateTime(detail.updated_at)} · {detail.updated_by || "—"}
            </div>
            <DataTable
              rowKey="id"
              pagination={false}
              dataSource={detail.operations ?? []}
              columns={[
                { title: "序号", dataIndex: "seq", width: 56 },
                { title: "工序", dataIndex: "name" },
                { title: "技能", dataIndex: "skill_name", width: 72 },
                {
                  title: "预计",
                  width: 72,
                  render: (_, r) => `${r.duration_days || 1} 天`,
                },
                {
                  title: "人力",
                  width: 72,
                  render: (_, r) => `${r.required_headcount || 1} 人/天`,
                },
                {
                  title: "计划",
                  render: (_, r) =>
                    r.plan_start ? `${r.plan_start.slice(5)} ~ ${r.plan_end?.slice(5)}` : "未排产",
                },
                {
                  title: "派人",
                  width: 100,
                  render: (_, r) =>
                    (r.staffing_gap || 0) > 0
                      ? `缺${r.staffing_gap}人`
                      : r.assignee_name || "—",
                },
              ]}
            />
          </Space>
        )}
      </Drawer>
    </div>
  );
}
