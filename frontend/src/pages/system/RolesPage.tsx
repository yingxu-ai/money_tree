import { Form, Input, Select, Space } from "antd";
import { useState } from "react";
import { createRole, deleteRole, fetchPermissions, fetchRoles, updateRole } from "@/api/system";
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
import type { RoleItem } from "@/types";

export default function RolesPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RoleItem | null>(null);
  const [form] = Form.useForm();

  const { data: roles = [], loading, refresh } = useRequest(fetchRoles);
  const { data: permissions = [] } = useRequest(fetchPermissions);

  const close = () => {
    setOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const { mutate: saveRole, loading: saving } = useMutation(
    async (values: Record<string, unknown>) => {
      if (editing) return updateRole(editing.id, values);
      return createRole(values);
    },
    {
      successMessage: () => (editing ? "更新成功" : "创建成功"),
      onSuccess: async () => {
        close();
        await refresh();
      },
    },
  );

  return (
    <div>
      <PageHeader
        title="角色管理"
        extra={
          <AuthButton
            type="primary"
            permission="role:assign"
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setOpen(true);
            }}
          >
            新增角色
          </AuthButton>
        }
      />
      <DataTable<RoleItem>
        rowKey="id"
        loading={loading}
        dataSource={roles}
        columns={[
          { title: "名称", dataIndex: "name" },
          { title: "编码", dataIndex: "code" },
          { title: "数据范围", dataIndex: "data_scope" },
          {
            title: "状态",
            dataIndex: "status",
            render: (v) => <StatusTag value={v} typeCode="common_status" />,
          },
          {
            title: "操作",
            render: (_, record) => (
              <Space>
                <EditAction
                  permission="role:assign"
                  onClick={() => {
                    setEditing(record);
                    form.setFieldsValue(record);
                    setOpen(true);
                  }}
                />
                <DeleteAction
                  permission="role:assign"
                  title="确认删除角色？"
                  content={`将删除角色「${record.name}」。`}
                  onConfirm={async () => {
                    await deleteRole(record.id);
                    await refresh();
                  }}
                />
              </Space>
            ),
          },
        ]}
      />

      <FormModal
        title={editing ? "编辑角色" : "新增角色"}
        open={open}
        form={form}
        confirmLoading={saving}
        onCancel={close}
        width={640}
        onOk={async () => {
          const values = await form.validateFields();
          await saveRole(values);
        }}
      >
        <Form.Item name="name" label="名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="code" label="编码" rules={[{ required: true }]}>
          <Input disabled={!!editing} />
        </Form.Item>
        <Form.Item name="data_scope" label="数据范围" initialValue="ALL">
          <Select
            options={[
              { value: "ALL", label: "全部" },
              { value: "ORG", label: "组织及下级" },
              { value: "SELF_ORG", label: "当前组织" },
              { value: "SELF", label: "仅本人" },
            ]}
          />
        </Form.Item>
        <Form.Item name="permission_ids" label="权限">
          <Select
            mode="multiple"
            optionFilterProp="label"
            options={permissions.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))}
          />
        </Form.Item>
      </FormModal>
    </div>
  );
}
