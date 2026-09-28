import { Form, Input, InputNumber, Select, Space, Switch, Tag } from "antd";
import { useMemo, useState } from "react";
import {
  createApiPermission,
  deleteApiPermission,
  fetchApiPermissions,
  fetchPermissions,
  fetchRegisteredRoutes,
  syncApiPermissions,
  updateApiPermission,
  type ApiPermissionRule,
} from "@/api/system";
import {
  AuthButton,
  DataTable,
  DeleteAction,
  EditAction,
  FormModal,
  PageHeader,
} from "@/components/kit";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";

export default function ApiPermissionsPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ApiPermissionRule | null>(null);
  const [form] = Form.useForm();

  const { data: rules = [], loading, refresh } = useRequest(fetchApiPermissions);
  const { data: permissions = [] } = useRequest(fetchPermissions);
  const { data: routes = [], refresh: refreshRoutes } = useRequest(fetchRegisteredRoutes);

  const permOptions = useMemo(
    () =>
      permissions.map((p) => ({
        value: p.code,
        label: `${p.name} (${p.code})`,
      })),
    [permissions],
  );

  const close = () => {
    setOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const { mutate: saveRule, loading: saving } = useMutation(
    async (values: Record<string, unknown>) => {
      if (editing) return updateApiPermission(editing.id, values);
      return createApiPermission(values);
    },
    {
      successMessage: () => (editing ? "已更新" : "已创建"),
      onSuccess: async () => {
        close();
        await refresh();
      },
    },
  );

  const { mutate: doSync, loading: syncing } = useMutation(
    () => syncApiPermissions(),
    {
      successMessage: (r) => `已同步，新增 ${r?.created ?? 0} 条（默认未启用）`,
      onSuccess: async () => {
        await refresh();
        await refreshRoutes();
      },
    },
  );

  const { mutate: toggleEnabled, loading: toggling } = useMutation(
    async (row: ApiPermissionRule) => {
      if (!row.enabled && !row.permission_code) {
        throw new Error("请先填写权限码再启用");
      }
      return updateApiPermission(row.id, { enabled: !row.enabled });
    },
    {
      successMessage: "状态已更新",
      onSuccess: async () => {
        await refresh();
      },
    },
  );

  return (
    <div>
      <PageHeader
        title="接口权限"
        subtitle="方法 + 路径模板 → 权限码。启用后全局鉴权；新业务只配这里，不必每个接口再写 require_permission。"
        extra={
          <Space>
            <AuthButton permission="api_perm:manage" loading={syncing} onClick={() => void doSync()}>
              从路由同步
            </AuthButton>
            <AuthButton
              type="primary"
              permission="api_perm:manage"
              onClick={() => {
                setEditing(null);
                form.resetFields();
                form.setFieldsValue({ method: "GET", enabled: false, sort: 0 });
                setOpen(true);
              }}
            >
              新增规则
            </AuthButton>
          </Space>
        }
      />
      <DataTable<ApiPermissionRule>
        rowKey="id"
        loading={loading || toggling}
        dataSource={rules}
        columns={[
          {
            title: "方法",
            dataIndex: "method",
            width: 90,
            render: (v) => <Tag>{v}</Tag>,
          },
          { title: "路径模板", dataIndex: "path_pattern", ellipsis: true },
          { title: "名称", dataIndex: "name", width: 160, ellipsis: true },
          {
            title: "权限码",
            dataIndex: "permission_code",
            width: 200,
            render: (v) => v || <span style={{ color: "#a0aec0" }}>未配置</span>,
          },
          {
            title: "启用",
            dataIndex: "enabled",
            width: 90,
            render: (v, row) => (
              <Switch
                checked={!!v}
                onChange={() => void toggleEnabled(row)}
                disabled={!row.permission_code && !v}
              />
            ),
          },
          {
            title: "操作",
            width: 140,
            render: (_, record) => (
              <Space>
                <EditAction
                  permission="api_perm:manage"
                  onClick={() => {
                    setEditing(record);
                    form.setFieldsValue(record);
                    setOpen(true);
                  }}
                />
                <DeleteAction
                  permission="api_perm:manage"
                  title="删除该接口权限规则？"
                  onConfirm={async () => {
                    await deleteApiPermission(record.id);
                    await refresh();
                  }}
                />
              </Space>
            ),
          },
        ]}
      />

      <FormModal
        title={editing ? "编辑接口权限" : "新增接口权限"}
        open={open}
        confirmLoading={saving}
        onCancel={close}
        onOk={async () => {
          const values = await form.validateFields();
          await saveRule(values);
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="method" label="方法" rules={[{ required: true }]}>
            <Select
              options={["GET", "POST", "PUT", "DELETE", "PATCH", "*"].map((m) => ({
                value: m,
                label: m,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="path_pattern"
            label="路径模板"
            rules={[{ required: true, message: "如 /scheduling/gantt/tasks/{op_id}" }]}
            extra="相对 /api/v1；可用 {param} 占位。也可从下方已注册路由挑选。"
          >
            <Input placeholder="/scheduling/report/{op_id}/start" />
          </Form.Item>
          {routes.length ? (
            <Form.Item label="从已注册路由填入">
              <Select
                showSearch
                allowClear
                placeholder="选择后填入方法与路径"
                optionFilterProp="label"
                options={routes.map((r) => ({
                  value: `${r.method} ${r.path_pattern}`,
                  label: `${r.method} ${r.path_pattern}`,
                }))}
                onChange={(v: string) => {
                  if (!v) return;
                  const [method, ...rest] = v.split(" ");
                  form.setFieldsValue({ method, path_pattern: rest.join(" ") });
                }}
              />
            </Form.Item>
          ) : null}
          <Form.Item name="permission_code" label="权限码" rules={[{ required: true }]}>
            <Select
              showSearch
              allowClear
              optionFilterProp="label"
              options={permOptions}
              placeholder="选择或先在角色权限里维护权限码"
            />
          </Form.Item>
          <Form.Item name="name" label="名称">
            <Input placeholder="便于识别" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="sort" label="排序">
            <InputNumber style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </FormModal>
    </div>
  );
}
