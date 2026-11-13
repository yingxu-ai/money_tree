import { AutoComplete, Button, DatePicker, Form, Input, InputNumber, Select, Space } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import {
  createProgressProduct,
  deleteProgressProduct,
  fetchProgressProducts,
  updateProgressProduct,
  type ProgressProductItem,
} from "@/modules/production-progress/api/progress";
import { DataTable, DeleteAction, FormModal, PageHeader, StatusTag } from "@/components/kit";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";
import { sortByCreatedDesc } from "@/modules/production-progress/sortByCreatedDesc";
import BaseInfoToolbar from "./BaseInfoToolbar";

const STATUS_LABEL = { active: "启用", disabled: "停用" };
const STATUS_COLOR = { active: "green", disabled: "default" };

type StepForm = {
  process_id: string;
  qty: number;
  qty_unit: string;
  unit_minutes: number;
};

function formatDateTime(v?: string | null) {
  if (!v) return "—";
  return v.length >= 16 ? `${v.slice(0, 10)} ${v.slice(11, 16)}` : v;
}

export default function ProductsPage({ embedded = false }: { embedded?: boolean }) {
  const { data, loading, refresh } = useRequest(fetchProgressProducts, { immediate: true });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProgressProductItem | null>(null);
  const [keyword, setKeyword] = useState("");
  const [form] = Form.useForm();

  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    let list = data?.items ?? [];
    if (kw) {
      list = list.filter((r) => {
        const route = (r.steps || [])
          .map((s) => `${s.process_name || ""} ${s.process_code || ""}`)
          .join(" ");
        return (
          (r.code || "").toLowerCase().includes(kw) ||
          (r.name || "").toLowerCase().includes(kw) ||
          route.toLowerCase().includes(kw) ||
          (r.created_by || "").toLowerCase().includes(kw) ||
          (r.updated_by || "").toLowerCase().includes(kw)
        );
      });
    }
    return sortByCreatedDesc(list);
  }, [data?.items, keyword]);

  const { mutate: save, loading: saving } = useMutation(
    async (values: {
      code: string;
      name: string;
      status?: string;
      effective?: [Dayjs | null, Dayjs | null] | null;
      steps: StepForm[];
    }) => {
      const payload = {
        code: values.code,
        name: values.name,
        status: values.status || "active",
        effective_from: values.effective?.[0]?.format("YYYY-MM-DD") || null,
        effective_to: values.effective?.[1]?.format("YYYY-MM-DD") || null,
        steps: (values.steps || []).map((s) => ({
          process_id: s.process_id,
          qty: Number(s.qty),
          qty_unit: s.qty_unit || "件",
          unit_minutes: Number(s.unit_minutes),
        })),
      };
      if (editing) return updateProgressProduct(editing.id, payload);
      return createProgressProduct(payload);
    },
    {
      successMessage: "已保存",
      onSuccess: () => {
        setOpen(false);
        setEditing(null);
        form.resetFields();
        refresh();
      },
    },
  );

  const { mutate: doDelete } = useMutation((id: string) => deleteProgressProduct(id), {
    successMessage: "已删除",
    onSuccess: () => refresh(),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      status: "active",
      steps: [{ process_id: undefined, qty: 1, qty_unit: "件", unit_minutes: 30 }],
    });
    setOpen(true);
  };

  const openEdit = (row: ProgressProductItem) => {
    setEditing(row);
    form.setFieldsValue({
      code: row.code,
      name: row.name,
      status: row.status || "active",
      effective: [
        row.effective_from ? dayjs(row.effective_from) : null,
        row.effective_to ? dayjs(row.effective_to) : null,
      ],
      steps: (row.steps || []).map((s) => ({
        process_id: s.process_id,
        qty: s.qty,
        qty_unit: s.qty_unit || "件",
        unit_minutes: s.unit_minutes,
      })),
    });
    setOpen(true);
  };

  const extra = (
    <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
      新增产品
    </Button>
  );

  const toolbar = (
    <BaseInfoToolbar
      description="配置产品工艺路线：每道工序填写数量、单位与单位所需时间。开工人选产品时可带出工序；列表「工艺路线」由下方工序行汇总。"
      searchPlaceholder="搜索编码 / 名称 / 工序 / 创建人 / 修改人"
      keyword={keyword}
      onKeywordChange={setKeyword}
      extra={extra}
    />
  );

  return (
    <div>
      {embedded ? (
        toolbar
      ) : (
        <>
          <PageHeader
            title="产品列表"
            subtitle="产品工艺 = 工序 × 数量 × 单位所需时间 + 生效期。"
            extra={extra}
          />
          <BaseInfoToolbar
            description="配置产品工艺路线：每道工序填写数量、单位与单位所需时间。开工人选产品时可带出工序；列表「工艺路线」由下方工序行汇总。"
            searchPlaceholder="搜索编码 / 名称 / 工序 / 创建人 / 修改人"
            keyword={keyword}
            onKeywordChange={setKeyword}
          />
        </>
      )}
      <DataTable<ProgressProductItem>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination
        columns={[
          { title: "编码", dataIndex: "code", width: 110 },
          { title: "名称", dataIndex: "name", width: 140 },
          {
            title: "工艺路线",
            render: (_: unknown, row) =>
              (row.steps || [])
                .map(
                  (s) =>
                    `${s.process_name || s.process_code || s.process_id}×${s.qty}${s.qty_unit || "件"}/${s.unit_minutes}分`,
                )
                .join(" → ") || "—",
          },
          {
            title: "生效期",
            width: 180,
            render: (_: unknown, row) =>
              `${row.effective_from || "—"} ~ ${row.effective_to || "长期"}`,
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 90,
            render: (v: string) => (
              <StatusTag value={v || "active"} labelMap={STATUS_LABEL} colorMap={STATUS_COLOR} />
            ),
          },
          {
            title: "创建",
            width: 150,
            render: (_: unknown, row) => (
              <div style={{ fontSize: 12, lineHeight: 1.45 }}>
                <div>{formatDateTime(row.created_at)}</div>
                <div style={{ color: "#718096" }}>{row.created_by || "—"}</div>
              </div>
            ),
          },
          {
            title: "修改",
            width: 150,
            render: (_: unknown, row) => (
              <div style={{ fontSize: 12, lineHeight: 1.45 }}>
                <div>{formatDateTime(row.updated_at)}</div>
                <div style={{ color: "#718096" }}>{row.updated_by || "—"}</div>
              </div>
            ),
          },
          {
            title: "操作",
            width: 140,
            render: (_: unknown, row) => (
              <Space>
                <Button type="link" size="small" onClick={() => openEdit(row)}>
                  编辑
                </Button>
                <DeleteAction title="删除该产品？" onConfirm={() => doDelete(row.id)} />
              </Space>
            ),
          },
        ]}
      />
      <FormModal
        title={editing ? "编辑产品工艺" : "新增产品工艺"}
        open={open}
        form={form}
        width={780}
        formLayout="horizontal"
        labelCol={{ flex: "150px" }}
        confirmLoading={saving}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        onOk={async () => {
          const values = await form.validateFields();
          await save(values);
        }}
      >
        <Form.Item name="code" label="产品编码" rules={[{ required: true, message: "请填写编码" }]}>
          <Input placeholder="厂内唯一，如 A-001" />
        </Form.Item>
        <Form.Item name="name" label="产品名称" rules={[{ required: true, message: "请填写名称" }]}>
          <Input placeholder="如 产品A" />
        </Form.Item>
        <Form.Item name="effective" label="生效起止">
          <DatePicker.RangePicker
            style={{ width: "100%" }}
            allowEmpty={[true, true]}
            placeholder={["生效起（可空）", "生效止（可空）"]}
          />
        </Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}>
          <Select
            options={[
              { value: "active", label: "启用" },
              { value: "disabled", label: "停用" },
            ]}
          />
        </Form.Item>
        <Form.List
          name="steps"
          rules={[
            {
              validator: async (_, steps) => {
                if (!steps || steps.length < 1) throw new Error("请至少一道工序");
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>工艺工序（顺序即路线）</div>
              <div style={{ overflowX: "auto", marginBottom: 8 }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    tableLayout: "fixed",
                    minWidth: 560,
                  }}
                >
                  <colgroup>
                    <col style={{ width: 44 }} />
                    <col />
                    <col style={{ width: 96 }} />
                    <col style={{ width: 96 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 48 }} />
                  </colgroup>
                  <thead>
                    <tr style={{ background: "#f7fafc" }}>
                      {[
                        "#",
                        "工序",
                        "数量",
                        "单位",
                        "单位所需时间",
                        "",
                      ].map((h) => (
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
                    {fields.map((field, idx) => (
                      <tr key={field.key}>
                        <td
                          style={{
                            padding: "8px 6px",
                            borderBottom: "1px solid #edf2f7",
                            color: "#718096",
                            fontSize: 13,
                          }}
                        >
                          {idx + 1}
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
                              options={(data?.processes ?? [])
                                .filter((p) => p.status !== "disabled")
                                .map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
                            />
                          </Form.Item>
                        </td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #edf2f7" }}>
                          <Form.Item
                            {...field}
                            name={[field.name, "qty"]}
                            rules={[{ required: true, message: "填数量" }]}
                            style={{ marginBottom: 0 }}
                          >
                            <InputNumber min={0.01} placeholder="数量" style={{ width: "100%" }} />
                          </Form.Item>
                        </td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #edf2f7" }}>
                          <Form.Item
                            {...field}
                            name={[field.name, "qty_unit"]}
                            initialValue="件"
                            style={{ marginBottom: 0 }}
                          >
                            <AutoComplete
                              options={[
                                { value: "件" },
                                { value: "套" },
                                { value: "批" },
                              ]}
                              placeholder="件/套/批"
                              filterOption={(input, option) =>
                                (option?.value || "").toLowerCase().includes(input.toLowerCase())
                              }
                            />
                          </Form.Item>
                        </td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #edf2f7" }}>
                          <Form.Item
                            {...field}
                            name={[field.name, "unit_minutes"]}
                            rules={[{ required: true, message: "填分钟" }]}
                            style={{ marginBottom: 0 }}
                          >
                            <InputNumber
                              min={0}
                              addonAfter="分"
                              placeholder="分钟"
                              style={{ width: "100%" }}
                            />
                          </Form.Item>
                        </td>
                        <td
                          style={{
                            padding: "8px 6px",
                            borderBottom: "1px solid #edf2f7",
                            textAlign: "center",
                          }}
                        >
                          <Button
                            type="text"
                            danger
                            size="small"
                            icon={<DeleteOutlined />}
                            disabled={fields.length <= 1}
                            aria-label="删除"
                            onClick={() => remove(field.name)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                type="dashed"
                block
                icon={<PlusOutlined />}
                onClick={() =>
                  add({ process_id: undefined, qty: 1, qty_unit: "件", unit_minutes: 30 })
                }
              >
                加一道工序
              </Button>
              <Form.ErrorList errors={errors} />
            </div>
          )}
        </Form.List>
      </FormModal>
    </div>
  );
}
