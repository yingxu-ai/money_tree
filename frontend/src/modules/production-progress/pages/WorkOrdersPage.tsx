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
import {
  cancelWorkOrder,
  createProgressProduct,
  createWorkOrder,
  deleteWorkOrder,
  fetchProgressProducts,
  fetchWorkOrders,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  updateWorkOrder,
  WO_KIND_COLOR,
  WO_KIND_LABEL,
  WO_STATUS_COLOR,
  WO_STATUS_LABEL,
  type ProgressProcessItem,
  type ProgressProductItem,
  type WorkOrderItem,
} from "@/modules/production-progress/api/progress";
import { DataTable, DeleteAction, FormModal, PageHeader, StatusTag } from "@/components/kit";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";
import { sortByCreatedDesc } from "@/modules/production-progress/sortByCreatedDesc";

const STATUS_CHIP_KEYS = ["pending", "producing", "done", "cancelled"] as const;

const PRIORITY_RANK: Record<string, number> = { rush: 3, high: 2, normal: 1 };

type OpSpecForm = {
  process_id: string;
  process_name?: string;
  process_code?: string;
  est_minutes?: number;
};

function formatDateTime(v?: string | null) {
  if (!v) return "—";
  return v.length >= 16 ? `${v.slice(0, 10)} ${v.slice(11, 16)}` : v;
}

function formatDuration(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  const hours = minutes / 60;
  const text = hours >= 10 ? hours.toFixed(1) : hours.toFixed(2);
  return `${text} 小时`;
}

function buildOpSpecsFromProduct(
  product: ProgressProductItem | undefined,
  quantity: number,
): OpSpecForm[] | null {
  const steps = product?.steps || [];
  if (!steps.length) return null;
  const qty = Math.max(0, Number(quantity) || 0);
  return steps.map((s) => {
    const minutes = (Number(s.qty) || 0) * (Number(s.unit_minutes) || 0) * qty;
    return {
      process_id: s.process_id,
      process_name: s.process_name,
      process_code: s.process_code,
      est_minutes: minutes,
    };
  });
}

function defaultProcessOpSpecs(processes: ProgressProcessItem[]): OpSpecForm[] {
  const active = processes.filter((p) => p.status !== "disabled");
  const pick = active.slice(0, Math.min(2, active.length));
  if (!pick.length) {
    return [{ process_id: "" }];
  }
  return pick.map((p) => ({
    process_id: p.id,
    process_name: p.name,
    process_code: p.code,
    est_minutes: 0,
  }));
}

export default function WorkOrdersPage() {
  const { data, loading, refresh } = useRequest(fetchWorkOrders, { immediate: true });
  const { data: productData, refresh: refreshProducts } = useRequest(fetchProgressProducts, {
    immediate: true,
  });
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrderItem | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [priorityFilter, setPriorityFilter] = useState<string | undefined>();
  const [kindFilter, setKindFilter] = useState<string | undefined>();
  const [keyword, setKeyword] = useState("");
  const [detail, setDetail] = useState<WorkOrderItem | null>(null);
  const [customKinds, setCustomKinds] = useState<Record<string, string>>({});
  const [kindDraft, setKindDraft] = useState("");
  const [customProducts, setCustomProducts] = useState<string[]>([]);
  const [productDraft, setProductDraft] = useState("");
  const woKind = Form.useWatch("wo_kind", form);
  const editWoKind = Form.useWatch("wo_kind", editForm);
  const watchedProduct = Form.useWatch("product", form);
  const watchedQuantity = Form.useWatch("quantity", form);
  const watchedOpSpecs = Form.useWatch("op_specs", form) as OpSpecForm[] | undefined;

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
    for (const row of productData?.items ?? []) {
      if (row.status === "disabled") continue;
      const name = (row.name || "").trim();
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
  }, [customProducts, productData?.items, data?.items, data?.orders]);

  const addCustomProduct = async () => {
    const name = productDraft.trim();
    if (!name) {
      message.warning("请输入产品名称");
      return;
    }
    const existed = productOptions.some((o) => o.value === name);
    if (!existed) {
      setCustomProducts((prev) => [...prev, name]);
      try {
        const code = `P-${Date.now().toString().slice(-8)}`;
        await createProgressProduct({ code, name, status: "active", steps: [] });
        await refreshProducts();
      } catch {
        // 本地列表已加入，目录写入失败不阻断选中
      }
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
    return {
      total,
      cancelled,
      active,
      pending,
      producing,
      done,
      orderCount: orders.length,
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
    if (kindFilter) rows = rows.filter((r) => (r.wo_kind || "normal") === kindFilter);
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      rows = rows.filter((r) => {
        const qty = String(r.plan_qty ?? r.quantity ?? "");
        return (
          r.code.toLowerCase().includes(kw) ||
          r.name.toLowerCase().includes(kw) ||
          (r.product || "").toLowerCase().includes(kw) ||
          (r.order_code || "").toLowerCase().includes(kw) ||
          (r.order_name || "").toLowerCase().includes(kw) ||
          (r.wo_kind_label || "").toLowerCase().includes(kw) ||
          qty.includes(kw)
        );
      });
    }
    // 默认按创建时间倒序；点列头「交期 / 数量 / 优先级」可再排
    return sortByCreatedDesc(rows);
  }, [data?.items, statusFilter, priorityFilter, kindFilter, keyword]);

  const catalogProcesses = useMemo(
    () => (productData?.processes ?? []).filter((p) => p.status !== "disabled"),
    [productData?.processes],
  );

  const processOptions = useMemo(
    () =>
      catalogProcesses.map((p) => ({
        value: p.id,
        label: `${p.code} · ${p.name}`,
      })),
    [catalogProcesses],
  );

  const selectedProduct = useMemo(() => {
    const name = (watchedProduct || "").trim();
    if (!name) return undefined;
    return (productData?.items ?? []).find((p) => p.name === name);
  }, [watchedProduct, productData?.items]);

  const processEstimates = useMemo(() => {
    const qty = Math.max(0, Number(watchedQuantity) || 0);
    const steps = selectedProduct?.steps || [];
    const specs = watchedOpSpecs || [];
    if (specs.length) {
      return specs.map((s, idx) => {
        const step =
          steps.find((st) => st.process_id === s?.process_id) ||
          steps.find(
            (st) =>
              !!s?.process_name &&
              (st.process_name === s.process_name ||
                (st.process_name || "").includes(s.process_name) ||
                s.process_name.includes(st.process_name || "")),
          ) ||
          steps[idx];
        const proc = catalogProcesses.find((p) => p.id === s?.process_id);
        let minutes = 0;
        if (step) {
          minutes = (Number(step.qty) || 0) * (Number(step.unit_minutes) || 0) * qty;
        } else if (typeof s?.est_minutes === "number" && s.est_minutes > 0) {
          minutes = s.est_minutes;
        }
        return {
          key: s?.process_id || `op-${idx}`,
          name: proc?.name || s?.process_name || step?.process_name || `工序 ${idx + 1}`,
          minutes,
        };
      });
    }
    return steps.map((s) => ({
      key: s.process_id,
      name: s.process_name || s.process_code || s.process_id,
      minutes: (Number(s.qty) || 0) * (Number(s.unit_minutes) || 0) * qty,
    }));
  }, [selectedProduct, watchedQuantity, watchedOpSpecs, catalogProcesses]);

  const totalEstimateMinutes = useMemo(
    () => processEstimates.reduce((sum, row) => sum + (row.minutes || 0), 0),
    [processEstimates],
  );

  const applyProductToOpSpecs = (productName: string, quantity: number) => {
    const product = (productData?.items ?? []).find((p) => p.name === productName);
    const specs = buildOpSpecsFromProduct(product, quantity);
    if (specs?.length) {
      form.setFieldsValue({ op_specs: specs });
    }
  };

  const openCreate = () => {
    form.resetFields();
    setKindDraft("");
    setProductDraft("");
    form.setFieldsValue({
      priority: "normal",
      wo_kind: "normal",
      quantity: 1,
      due_date: dayjs().add(7, "day"),
      op_specs: defaultProcessOpSpecs(catalogProcesses),
    });
    setOpen(true);
  };

  const { mutate: save, loading: saving } = useMutation(
    async (values: {
      name: string;
      code?: string;
      order_code?: string;
      product?: string;
      quantity?: number;
      due_date: Dayjs;
      priority?: string;
      wo_kind?: string;
      op_specs?: OpSpecForm[];
    }) => {
      const quantity = Math.max(0.01, Number(values.quantity) || 1);
      const opSpecs = (values.op_specs || [])
        .filter((s) => s?.process_id)
        .map((s, idx) => {
          const proc = catalogProcesses.find((p) => p.id === s.process_id);
          const step = (selectedProduct?.steps || []).find((st) => st.process_id === s.process_id);
          const est =
            step != null
              ? (Number(step.qty) || 0) * (Number(step.unit_minutes) || 0) * quantity
              : Number(s.est_minutes) || processEstimates[idx]?.minutes || 0;
          const hours = est / 60;
          return {
            process_id: s.process_id,
            process_name: proc?.name || s.process_name,
            process_code: proc?.code || s.process_code,
            name: proc?.name || s.process_name,
            // 内部仍保留天数/人数默认值，供底层工序结构使用；生产进度不做排产
            duration_days: Math.max(1, Math.ceil(hours / 8) || 1),
            required_headcount: 1,
            est_minutes: est,
          };
        });
      const orderCode = (values.order_code || "").trim();
      return createWorkOrder({
        name: values.name,
        code: (values.code || "").trim() || undefined,
        order_code: orderCode || undefined,
        product: values.product || "",
        quantity,
        plan_qty: quantity,
        due_date: values.due_date.format("YYYY-MM-DD"),
        priority: values.priority || "normal",
        wo_kind: values.wo_kind || "normal",
        op_specs: opSpecs,
        // 生产进度不再暴露「来源」；有订单号时仍记客户单，便于底层订单编号
        source_type: orderCode ? "customer" : "internal",
        order_name: values.name,
      });
    },
    {
      successMessage: "已创建工单并拆分工序",
      onSuccess: async () => {
        setOpen(false);
        form.resetFields();
        await refresh();
      },
    },
  );

  const { mutate: doCancel } = useMutation((id: string) => cancelWorkOrder(id), {
    successMessage: "工单已作废",
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
              待开工 {overview.pending}
              {" · "}
              生产中 {overview.producing}
              {" · "}
              已完成 {overview.done}
            </Typography.Paragraph>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              关联订单 {overview.orderCount}
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
        pagination
        title={() => (
          <Space wrap>
            <span style={{ fontWeight: 600 }}>工单列表</span>
            <Input
              allowClear
              placeholder="搜索工单号 / 名称 / 订单 / 产品 / 数量"
              style={{ width: 260 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
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
          {
            title: "数量",
            width: 90,
            sorter: (a, b) =>
              Number(a.plan_qty ?? a.quantity ?? 0) - Number(b.plan_qty ?? b.quantity ?? 0),
            render: (_: unknown, row) => row.plan_qty ?? row.quantity ?? "—",
          },
          { title: "工序数", dataIndex: "op_count", width: 80 },
          {
            title: "交期",
            dataIndex: "due_date",
            width: 160,
            sorter: (a, b) =>
              (a.due_date || "").slice(0, 10).localeCompare((b.due_date || "").slice(0, 10)),
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
            width: 100,
            sorter: (a, b) =>
              (PRIORITY_RANK[a.priority || "normal"] ?? 0) -
              (PRIORITY_RANK[b.priority || "normal"] ?? 0),
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
                        content="作废后工单不可再报工，记录保留可查。误录且未开工的也可之后再删除。"
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
                        content="将永久删除工单及工序。有进行中/已完工请用「作废」。"
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
            <Form.Item name="code" label="工单号">
              <Input placeholder="可留空自动生成，如 WO-20261107-001" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="order_code" label="订单号">
              <Input placeholder="如有则填，如 SO-2026-001" />
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
                onChange={(name: string) => {
                  applyProductToOpSpecs(name, Number(form.getFieldValue("quantity")) || 1);
                }}
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
            <Form.Item
              name="quantity"
              label="数量"
              rules={[{ required: true, message: "请填写数量" }]}
            >
              <InputNumber
                min={0.01}
                style={{ width: "100%" }}
                placeholder="本单数量"
                onChange={(v) => {
                  const name = form.getFieldValue("product");
                  if (name) applyProductToOpSpecs(name, Number(v) || 1);
                }}
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
          <Col span={24}>
            <div
              style={{
                marginBottom: 12,
                padding: "8px 12px",
                background: "#f7fafc",
                borderRadius: 6,
                border: "1px solid #e2e8f0",
                fontSize: 13,
              }}
            >
              按产品工艺 × 数量估算：
              <Typography.Text strong style={{ marginLeft: 8 }}>
                预计 {formatDuration(totalEstimateMinutes)}
              </Typography.Text>
              {selectedProduct?.steps?.length ? null : (
                <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                  （请选择已配置工艺的产品，或手动选择工序）
                </Typography.Text>
              )}
            </div>
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
              <div style={{ fontWeight: 600, marginBottom: 8 }}>工序拆分</div>
              <div style={{ overflowX: "auto", marginBottom: 8 }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    tableLayout: "fixed",
                    minWidth: 420,
                  }}
                >
                  <thead>
                    <tr style={{ background: "#f7fafc" }}>
                      {["#", "工序", "预计时间", ""].map((h) => (
                        <th
                          key={h || "del"}
                          style={{
                            padding: "8px 6px",
                            textAlign: "left",
                            fontWeight: 600,
                            fontSize: 13,
                            borderBottom: "1px solid #e2e8f0",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field, index) => (
                      <tr key={field.key}>
                        <td
                          style={{
                            padding: "8px 6px",
                            borderBottom: "1px solid #edf2f7",
                            color: "#718096",
                            width: 36,
                          }}
                        >
                          {index + 1}
                        </td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #edf2f7" }}>
                          <Form.Item
                            {...field}
                            name={[field.name, "process_id"]}
                            rules={[{ required: true, message: "选工序" }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Select
                              placeholder="选择工序"
                              options={processOptions}
                              showSearch
                              optionFilterProp="label"
                              onChange={(pid: string) => {
                                const proc = catalogProcesses.find((p) => p.id === pid);
                                if (proc) {
                                  form.setFieldValue(
                                    ["op_specs", field.name, "process_name"],
                                    proc.name,
                                  );
                                  form.setFieldValue(
                                    ["op_specs", field.name, "process_code"],
                                    proc.code,
                                  );
                                }
                              }}
                            />
                          </Form.Item>
                          <Form.Item {...field} name={[field.name, "process_name"]} hidden>
                            <Input />
                          </Form.Item>
                          <Form.Item {...field} name={[field.name, "process_code"]} hidden>
                            <Input />
                          </Form.Item>
                        </td>
                        <td
                          style={{
                            padding: "8px 6px",
                            borderBottom: "1px solid #edf2f7",
                            width: 120,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatDuration(processEstimates[index]?.minutes || 0)}
                        </td>
                        <td
                          style={{
                            padding: "8px 6px",
                            borderBottom: "1px solid #edf2f7",
                            width: 56,
                            textAlign: "center",
                          }}
                        >
                          <Button
                            type="link"
                            danger
                            disabled={fields.length <= 1}
                            onClick={() => remove(field.name)}
                          >
                            删
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 8,
                }}
              >
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    add({
                      process_id: undefined,
                      process_name: undefined,
                      process_code: undefined,
                    })
                  }
                >
                  加一道工序
                </Button>
                <div style={{ fontSize: 13 }}>
                  总时长：
                  <Typography.Text strong>{formatDuration(totalEstimateMinutes)}</Typography.Text>
                  {totalEstimateMinutes > 0 ? (
                    <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                      （{Math.round(totalEstimateMinutes)} 分钟）
                    </Typography.Text>
                  ) : null}
                </div>
              </div>
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
          可改名称、产品、交期、优先级与类型。修改交期会记录修改时间与修改人。
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
              <Tag color={WO_KIND_COLOR[detail.wo_kind || "normal"] || "default"}>
                {detail.wo_kind_label || WO_KIND_LABEL[detail.wo_kind || "normal"] || detail.wo_kind}
              </Tag>
              <Tag color={PRIORITY_COLOR[detail.priority]}>{PRIORITY_LABEL[detail.priority]}</Tag>
              <Tag color={WO_STATUS_COLOR[detail.status]}>{WO_STATUS_LABEL[detail.status]}</Tag>
            </div>
            <div>工单号：{detail.code}</div>
            <div>订单号：{detail.order_code || "—"}</div>
            <div>产品：{detail.product || "—"}</div>
            <div>数量：{detail.plan_qty ?? detail.quantity ?? "—"}</div>
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
                  title: "预计时间",
                  width: 100,
                  render: (_, r) =>
                    r.est_minutes != null && Number(r.est_minutes) > 0
                      ? formatDuration(Number(r.est_minutes))
                      : "—",
                },
              ]}
            />
          </Space>
        )}
      </Drawer>
    </div>
  );
}
