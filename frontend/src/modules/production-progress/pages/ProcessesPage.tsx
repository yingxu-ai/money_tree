import { Button, Form, Input, Select, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import {
  createProgressProcess,
  deleteProgressProcess,
  fetchProgressProcesses,
  updateProgressProcess,
  type ProgressProcessItem,
} from "@/modules/production-progress/api/progress";
import { DataTable, DeleteAction, FormModal, PageHeader, StatusTag } from "@/components/kit";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";
import { sortByCreatedDesc } from "@/modules/production-progress/sortByCreatedDesc";
import BaseInfoToolbar from "./BaseInfoToolbar";

const STATUS_LABEL = { active: "启用", disabled: "停用" };
const STATUS_COLOR = { active: "green", disabled: "default" };

function formatDateTime(v?: string | null) {
  if (!v) return "—";
  return v.length >= 16 ? `${v.slice(0, 10)} ${v.slice(11, 16)}` : v;
}

export default function ProcessesPage({ embedded = false }: { embedded?: boolean }) {
  const { data, loading, refresh } = useRequest(fetchProgressProcesses, { immediate: true });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProgressProcessItem | null>(null);
  const [keyword, setKeyword] = useState("");
  const [form] = Form.useForm();

  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    let list = data?.items ?? [];
    if (kw) {
      list = list.filter(
        (r) =>
          (r.code || "").toLowerCase().includes(kw) ||
          (r.name || "").toLowerCase().includes(kw) ||
          (r.note || "").toLowerCase().includes(kw) ||
          (r.created_by || "").toLowerCase().includes(kw) ||
          (r.updated_by || "").toLowerCase().includes(kw),
      );
    }
    return sortByCreatedDesc(list);
  }, [data?.items, keyword]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: "active", note: "" });
    setOpen(true);
  };

  const extra = (
    <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
      新增工序
    </Button>
  );

  const { mutate: save, loading: saving } = useMutation(
    async (values: { code: string; name: string; status?: string; note?: string }) => {
      const payload = {
        ...values,
        // 耗时改在产品工艺里维护；工序主数据不再填单位时间
        unit_minutes: editing?.unit_minutes ?? 0,
      };
      if (editing) return updateProgressProcess(editing.id, payload);
      return createProgressProcess(payload);
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

  const { mutate: doDelete } = useMutation((id: string) => deleteProgressProcess(id), {
    successMessage: "已删除",
    onSuccess: () => refresh(),
  });

  const toolbar = (
    <BaseInfoToolbar
      description="维护标准工序（编码、名称）。产品工艺会引用此处工序并填写单位所需时间；已被产品引用的工序不可删除。"
      searchPlaceholder="搜索编码 / 名称 / 备注 / 创建人 / 修改人"
      keyword={keyword}
      onKeywordChange={setKeyword}
      extra={extra}
    />
  );

  return (
    <div>
      {embedded ? toolbar : (
        <>
          <PageHeader title="工序列表" subtitle="标准工序供产品工艺引用。" extra={extra} />
          <BaseInfoToolbar
            description="维护标准工序（编码、名称）。产品工艺会引用此处工序并填写单位所需时间；已被产品引用的工序不可删除。"
            searchPlaceholder="搜索编码 / 名称 / 备注 / 创建人 / 修改人"
            keyword={keyword}
            onKeywordChange={setKeyword}
          />
        </>
      )}
      <DataTable<ProgressProcessItem>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination
        columns={[
          { title: "编码", dataIndex: "code", width: 120 },
          { title: "名称", dataIndex: "name" },
          {
            title: "状态",
            dataIndex: "status",
            width: 90,
            render: (v: string) => (
              <StatusTag value={v || "active"} labelMap={STATUS_LABEL} colorMap={STATUS_COLOR} />
            ),
          },
          { title: "备注", dataIndex: "note", ellipsis: true, render: (v: string) => v || "—" },
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
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    setEditing(row);
                    form.setFieldsValue({
                      code: row.code,
                      name: row.name,
                      status: row.status || "active",
                      note: row.note || "",
                    });
                    setOpen(true);
                  }}
                >
                  编辑
                </Button>
                <DeleteAction title="删除该工序？" onConfirm={() => doDelete(row.id)} />
              </Space>
            ),
          },
        ]}
      />
      <FormModal
        title={editing ? "编辑工序" : "新增工序"}
        open={open}
        form={form}
        formLayout="horizontal"
        labelCol={{ flex: "110px" }}
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
        <Form.Item name="code" label="编码" rules={[{ required: true, message: "请填写编码" }]}>
          <Input placeholder="厂内唯一，如 P-WELD" />
        </Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]}>
          <Input placeholder="如 焊接" />
        </Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}>
          <Select
            options={[
              { value: "active", label: "启用" },
              { value: "disabled", label: "停用" },
            ]}
          />
        </Form.Item>
        <Form.Item name="note" label="备注">
          <Input.TextArea rows={2} placeholder="可选说明" />
        </Form.Item>
      </FormModal>
    </div>
  );
}
