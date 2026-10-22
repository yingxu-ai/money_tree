import { Button, Form, Input, Select, Space, Tag, Tree, Typography } from "antd";
import type { DataNode } from "antd/es/tree";
import { useMemo, useState, type Key } from "react";
import {
  createRole,
  deleteRole,
  fetchPermissionAssignTree,
  fetchRoles,
  updateRole,
  type PermissionAssignNode,
} from "@/api/system";
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

function toTreeData(nodes: PermissionAssignNode[]): DataNode[] {
  return nodes.map((n) => {
    const isApi = n.node_type === "API";
    return {
      key: n.key,
      disableCheckbox: n.disableCheckbox,
      title: isApi ? (
        <span>
          <Typography.Text strong>{n.name || n.title}</Typography.Text>
          <Tag style={{ marginInlineStart: 8 }}>{n.method}</Tag>
          <Typography.Text type="secondary" code style={{ fontSize: 12 }}>
            {n.path_pattern}
          </Typography.Text>
          {n.enabled === false ? <Tag style={{ marginLeft: 8 }}>未启用</Tag> : null}
        </span>
      ) : (
        <span>
          {n.title}
          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            {n.node_type === "CATALOG" ? "目录" : n.node_type === "MENU" ? "页面" : n.node_type}
          </Typography.Text>
        </span>
      ),
      children: n.children?.length ? toTreeData(n.children) : undefined,
    };
  });
}

function collectCheckableKeys(nodes: PermissionAssignNode[]): string[] {
  const keys: string[] = [];
  const walk = (list: PermissionAssignNode[]) => {
    for (const n of list) {
      if (!n.disableCheckbox) keys.push(n.key);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return keys;
}

function collectApiRuleIds(nodes: PermissionAssignNode[], checked: Set<string>): number[] {
  const ids = new Set<number>();
  const walk = (list: PermissionAssignNode[]) => {
    for (const n of list) {
      if (n.node_type === "API" && checked.has(n.key) && n.api_rule_id) {
        ids.add(n.api_rule_id);
      }
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return [...ids];
}

/** 编辑回填：按 api_permission_ids（稳定规则 id）勾选 */
function keysFromRole(role: RoleItem): string[] {
  return [
    ...role.menu_ids.map((id) => `menu:${id}`),
    ...(role.api_permission_ids ?? []).map((id) => `api:${id}`),
  ];
}

function parseMenuIds(keys: Key[]): number[] {
  const menu_ids: number[] = [];
  for (const raw of keys) {
    const key = String(raw);
    if (key.startsWith("menu:")) {
      const id = Number(key.slice(5));
      if (!Number.isNaN(id)) menu_ids.push(id);
    }
  }
  return menu_ids;
}

export default function RolesPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RoleItem | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<Key[]>([]);
  const [form] = Form.useForm();

  const { data: roles = [], loading, refresh } = useRequest(fetchRoles);
  const { data: assignTree = [] } = useRequest(fetchPermissionAssignTree);
  const treeData = useMemo(() => toTreeData(assignTree), [assignTree]);
  const allKeys = useMemo(() => collectCheckableKeys(assignTree), [assignTree]);

  const close = () => {
    setOpen(false);
    setEditing(null);
    setCheckedKeys([]);
    form.resetFields();
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ data_scope: "ALL", status: "active" });
    setCheckedKeys([]);
    setOpen(true);
  };

  const openEdit = (record: RoleItem) => {
    setEditing(record);
    form.setFieldsValue(record);
    setCheckedKeys(keysFromRole(record));
    setOpen(true);
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
        subtitle="按菜单勾选页面，展开后勾选该页接口（绑定规则 id；改名/改路径不丢授权）。重启后端会自动同步新路由。"
        extra={
          <AuthButton type="primary" permission="role:assign" onClick={openCreate}>
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
            title: "菜单数",
            width: 90,
            render: (_, r) => r.menu_ids?.length ?? 0,
          },
          {
            title: "接口数",
            width: 90,
            render: (_, r) => r.api_permission_ids?.length ?? 0,
          },
          {
            title: "状态",
            dataIndex: "status",
            render: (v) => <StatusTag value={v} typeCode="common_status" />,
          },
          {
            title: "操作",
            render: (_, record) => (
              <Space>
                <EditAction permission="role:assign" onClick={() => openEdit(record)} />
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
        width={820}
        onOk={async () => {
          const values = await form.validateFields();
          const checked = new Set(checkedKeys.map(String));
          const menu_ids = parseMenuIds(checkedKeys);
          const api_permission_ids = collectApiRuleIds(assignTree, checked);
          await saveRole({ ...values, menu_ids, api_permission_ids, permission_ids: [] });
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
        <Form.Item
          label="菜单与接口权限"
          extra="勾选目录/页面控制侧栏；展开后勾选接口（方法 + 路径）。接口需先在「接口权限」里绑定权限码。页面下若为空，可先去该页「从路由同步」。"
        >
          <div
            style={{
              maxHeight: 440,
              overflow: "auto",
              border: "1px solid var(--ant-color-border-secondary, #f0f0f0)",
              borderRadius: 8,
              padding: 12,
            }}
          >
            <Space style={{ marginBottom: 8 }}>
              <Button size="small" onClick={() => setCheckedKeys(allKeys)}>
                全选
              </Button>
              <Button size="small" onClick={() => setCheckedKeys([])}>
                清空
              </Button>
            </Space>
            <Tree
              checkable
              checkStrictly
              defaultExpandAll
              treeData={treeData}
              checkedKeys={checkedKeys}
              onCheck={(checked) => {
                const next = Array.isArray(checked) ? checked : checked.checked;
                setCheckedKeys(next);
              }}
            />
          </div>
        </Form.Item>
      </FormModal>
    </div>
  );
}
