import { Form, Input, Select, Space, Tag } from "antd";
import { useState } from "react";
import { createUser, deleteUser, fetchRoles, fetchUsers, updateUser } from "@/api/system";
import {
  AuthButton,
  DataTable,
  DeleteAction,
  DeptTreeSelect,
  DictSelect,
  EditAction,
  FormModal,
  PageHeader,
  StatusTag,
} from "@/components/kit";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";
import type { RoleItem, UserItem } from "@/types";

export default function UsersPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [form] = Form.useForm();

  const {
    data: userPage,
    loading,
    refresh,
  } = useRequest(() => fetchUsers(), { immediate: true });
  const { data: roles = [] } = useRequest(fetchRoles);

  const users = userPage?.items ?? [];

  const close = () => {
    setOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const { mutate: saveUser, loading: saving } = useMutation(
    async (values: Record<string, unknown>) => {
      if (editing) {
        const payload = { ...values };
        if (!payload.password) delete payload.password;
        return updateUser(editing.id, payload);
      }
      return createUser(values);
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
        title="账号管理"
        subtitle="账号关联主部门与角色，控制登录身份与权限"
        extra={
          <AuthButton
            type="primary"
            permission="user:create"
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setOpen(true);
            }}
          >
            新增账号
          </AuthButton>
        }
      />
      <DataTable<UserItem>
        rowKey="id"
        loading={loading}
        dataSource={users}
        columns={[
          { title: "账号", dataIndex: "username" },
          { title: "显示名", dataIndex: "display_name" },
          { title: "部门", dataIndex: "dept_name", render: (v) => v || "-" },
          {
            title: "角色",
            dataIndex: "role_names",
            render: (names: string[]) =>
              names?.length ? (
                <Space size={[4, 4]} wrap>
                  {names.map((n) => (
                    <Tag key={n}>{n}</Tag>
                  ))}
                </Space>
              ) : (
                "-"
              ),
          },
          {
            title: "状态",
            dataIndex: "status",
            render: (v) => <StatusTag value={v} typeCode="user_status" />,
          },
          {
            title: "操作",
            render: (_, record) => (
              <Space>
                <EditAction
                  permission="user:update"
                  onClick={() => {
                    setEditing(record);
                    form.setFieldsValue({
                      display_name: record.display_name,
                      email: record.email,
                      status: record.status,
                      dept_id: record.dept_id,
                      role_ids: record.role_ids,
                      password: undefined,
                    });
                    setOpen(true);
                  }}
                />
                <DeleteAction
                  permission="user:delete"
                  title="确认删除账号？"
                  content={`将删除账号「${record.username}」。`}
                  onConfirm={async () => {
                    await deleteUser(record.id);
                    await refresh();
                  }}
                />
              </Space>
            ),
          },
        ]}
      />

      <FormModal
        title={editing ? "编辑账号" : "新增账号"}
        open={open}
        form={form}
        confirmLoading={saving}
        onCancel={close}
        onOk={async () => {
          const values = await form.validateFields();
          await saveUser(values);
        }}
      >
        {!editing ? (
          <>
            <Form.Item name="username" label="账号" rules={[{ required: true, min: 2 }]}>
              <Input placeholder="登录用户名" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, min: 6 }]}>
              <Input.Password placeholder="至少 6 位" />
            </Form.Item>
          </>
        ) : (
          <Form.Item
            name="password"
            label="重置密码"
            rules={[
              {
                validator: async (_, value) => {
                  if (!value) return;
                  if (String(value).length < 6) {
                    throw new Error("密码至少 6 位");
                  }
                },
              },
            ]}
            extra="留空表示不修改密码"
          >
            <Input.Password placeholder="留空则不修改" />
          </Form.Item>
        )}
        <Form.Item name="display_name" label="显示名">
          <Input />
        </Form.Item>
        <Form.Item name="email" label="邮箱">
          <Input />
        </Form.Item>
        <Form.Item name="dept_id" label="所属部门" extra="一期仅支持一个主部门">
          <DeptTreeSelect placeholder="选择主部门" />
        </Form.Item>
        <Form.Item name="role_ids" label="角色" extra="可多选，权限取角色并集">
          <Select
            mode="multiple"
            placeholder="选择角色"
            optionFilterProp="label"
            options={(roles as RoleItem[]).map((r) => ({ value: r.id, label: r.name }))}
          />
        </Form.Item>
        <Form.Item name="status" label="状态" initialValue="active">
          <DictSelect typeCode="user_status" />
        </Form.Item>
      </FormModal>
    </div>
  );
}
