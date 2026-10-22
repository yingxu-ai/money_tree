import { Form, Input, Select, Space, message } from "antd";
import { useState } from "react";
import { createTenant, deleteTenant, fetchTenants, updateTenant, type TenantItem } from "@/api/system";
import {
  AuthButton,
  DataTable,
  DeleteAction,
  EditAction,
  FormModal,
  PageHeader,
  StatusTag,
} from "@/components/kit";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";
import { useAuthStore } from "@/stores/authStore";
import { setOperatingTenantId } from "@/utils/operatingTenantStorage";

const MODULE_OPTIONS = [
  { value: "*", label: "全部模块" },
  { value: "scheduling", label: "生产排产" },
  { value: "equipment-analysis", label: "设备分析" },
  { value: "toolbox", label: "工具箱" },
  { value: "dashboard", label: "驾驶舱 / 配置 / 文件" },
  { value: "system", label: "系统管理" },
];

function modulesLabel(raw: string) {
  if (!raw || raw === "*" || raw.toLowerCase() === "all") return "全部模块";
  return raw;
}

export default function TenantsPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TenantItem | null>(null);
  const [form] = Form.useForm();

  const { data: items = [], loading, refresh } = useRequest(fetchTenants);

  const close = () => {
    setOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const bootstrap = useAuthStore((s) => s.bootstrap);

  const { mutate: save, loading: saving } = useMutation(
    async (values: Record<string, unknown>) => {
      const modules = values.enabled_modules;
      let enabled_modules = "*";
      if (Array.isArray(modules) && modules.length) {
        enabled_modules = modules.includes("*") ? "*" : modules.join(",");
      } else if (typeof modules === "string" && modules) {
        enabled_modules = modules;
      }
      const payload = { ...values, enabled_modules };
      if (editing) {
        await updateTenant(editing.id, payload);
        close();
        refresh();
        return;
      }
      const created = await createTenant(payload);
      // 新建后自动代管，避免再登录/刷新才能管组织账号
      setOperatingTenantId(created.id);
      await bootstrap();
      message.success(`已创建并代管「${created.name}」，可直接去部门/账号管理`);
      close();
      refresh();
    },
  );

  return (
    <>
      <PageHeader
        title="租户管理"
        subtitle="创建客户租户后会自动代管；再到部门管理、账号管理为其建组织与登录账号"
        extra={
          <AuthButton permission="tenant:create" type="primary" onClick={() => setOpen(true)}>
            新建租户
          </AuthButton>
        }
      />
      <DataTable<TenantItem>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={[
          { title: "ID", dataIndex: "id", width: 72 },
          { title: "名称", dataIndex: "name" },
          { title: "编码", dataIndex: "code", width: 140 },
          {
            title: "开通模块",
            dataIndex: "enabled_modules",
            render: (v: string) => modulesLabel(v),
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            render: (s: string) => <StatusTag status={s} />,
          },
          { title: "备注", dataIndex: "remark", ellipsis: true },
          {
            title: "操作",
            width: 160,
            render: (_, row) => (
              <Space>
                <EditAction
                  permission="tenant:update"
                  onClick={() => {
                    setEditing(row);
                    const mods = row.enabled_modules;
                    form.setFieldsValue({
                      ...row,
                      enabled_modules:
                        !mods || mods === "*" ? ["*"] : mods.split(",").map((x) => x.trim()),
                    });
                    setOpen(true);
                  }}
                />
                <DeleteAction
                  permission="tenant:delete"
                  onConfirm={async () => {
                    await deleteTenant(row.id);
                    refresh();
                  }}
                />
              </Space>
            ),
          },
        ]}
      />
      <FormModal
        open={open}
        title={editing ? "编辑租户" : "新建租户"}
        form={form}
        loading={saving}
        onCancel={close}
        onSubmit={() => form.validateFields().then((v) => save(v))}
      >
        <Form.Item name="name" label="租户名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="code" label="租户编码" rules={[{ required: true }]}>
          <Input disabled={!!editing} placeholder="英文标识，如 customer_a" />
        </Form.Item>
        {!editing && (
          <Form.Item name="root_dept_name" label="组织根节点名称">
            <Input placeholder="默认同租户名称" />
          </Form.Item>
        )}
        <Form.Item name="enabled_modules" label="开通模块" initialValue={["*"]}>
          <Select mode="multiple" options={MODULE_OPTIONS} />
        </Form.Item>
        <Form.Item name="status" label="状态" initialValue="active">
          <Select
            options={[
              { value: "active", label: "启用" },
              { value: "disabled", label: "停用" },
            ]}
          />
        </Form.Item>
        <Form.Item name="remark" label="备注">
          <Input.TextArea rows={2} />
        </Form.Item>
      </FormModal>
    </>
  );
}
