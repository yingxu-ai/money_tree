import { Form, Input, InputNumber, Select, Space, Switch, Tag, TreeSelect } from "antd";
import { useMemo, useState } from "react";
import { createMenu, deleteMenu, fetchMenus, updateMenu } from "@/api/system";
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
import type { MenuItem } from "@/types";

function toTableTree(items: MenuItem[]): MenuItem[] {
  return items.map((item) => ({
    ...item,
    children: item.children?.length ? toTableTree(item.children) : undefined,
  }));
}

function toTreeOptions(
  items: MenuItem[],
): Array<{ value: number; title: string; children?: ReturnType<typeof toTreeOptions> }> {
  return items.map((item) => ({
    value: item.id,
    title: item.name,
    children: item.children?.length ? toTreeOptions(item.children) : undefined,
  }));
}

export default function MenusPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [form] = Form.useForm();

  const { data: menus = [], loading, refresh } = useRequest(fetchMenus);
  const tableData = useMemo(() => toTableTree(menus), [menus]);
  const treeOptions = useMemo(() => toTreeOptions(menus), [menus]);

  const close = () => {
    setOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const { mutate: saveMenu, loading: saving } = useMutation(
    async (values: Record<string, unknown>) => {
      if (editing) return updateMenu(editing.id, values);
      return createMenu(values);
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
        title="菜单管理"
        extra={
          <AuthButton
            type="primary"
            permission="menu:view"
            onClick={() => {
              setEditing(null);
              form.resetFields();
              form.setFieldsValue({ type: "MENU", sort: 0, visible: true });
              setOpen(true);
            }}
          >
            新增菜单
          </AuthButton>
        }
      />
      <DataTable<MenuItem>
        rowKey="id"
        loading={loading}
        dataSource={tableData}
        pagination={false}
        defaultExpandAllRows
        columns={[
          { title: "名称", dataIndex: "name" },
          { title: "类型", dataIndex: "type", render: (v) => <Tag>{v}</Tag> },
          { title: "路径", dataIndex: "path" },
          { title: "组件", dataIndex: "component" },
          { title: "图标", dataIndex: "icon" },
          { title: "排序", dataIndex: "sort", width: 80 },
          {
            title: "可见",
            dataIndex: "visible",
            width: 80,
            render: (v) => (v ? "是" : "否"),
          },
          {
            title: "操作",
            width: 160,
            render: (_, record) => (
              <Space>
                <EditAction
                  permission="menu:view"
                  onClick={() => {
                    setEditing(record);
                    form.setFieldsValue({
                      parent_id: record.parent_id,
                      name: record.name,
                      path: record.path,
                      component: record.component,
                      type: record.type,
                      sort: record.sort,
                      visible: record.visible,
                      icon: record.icon,
                    });
                    setOpen(true);
                  }}
                />
                <DeleteAction
                  permission="menu:view"
                  title="确认删除菜单？"
                  content={`将删除「${record.name}」，有子菜单时无法删除。`}
                  onConfirm={async () => {
                    await deleteMenu(record.id);
                    await refresh();
                  }}
                />
              </Space>
            ),
          },
        ]}
      />

      <FormModal
        title={editing ? "编辑菜单" : "新增菜单"}
        open={open}
        form={form}
        confirmLoading={saving}
        onCancel={close}
        onOk={async () => {
          const values = await form.validateFields();
          await saveMenu(values);
        }}
      >
        <Form.Item name="parent_id" label="上级菜单">
          <TreeSelect
            allowClear
            treeData={treeOptions}
            placeholder="不选则为顶级"
            treeDefaultExpandAll
          />
        </Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="type" label="类型" rules={[{ required: true }]}>
          <Select
            options={[
              { value: "CATALOG", label: "目录" },
              { value: "MENU", label: "菜单" },
              { value: "BUTTON", label: "按钮" },
            ]}
          />
        </Form.Item>
        <Form.Item name="path" label="路径">
          <Input placeholder="如 /system/users" />
        </Form.Item>
        <Form.Item name="component" label="组件">
          <Input placeholder="如 system/Users" />
        </Form.Item>
        <Form.Item name="icon" label="图标">
          <Input placeholder="如 UserOutlined" />
        </Form.Item>
        <Form.Item name="sort" label="排序" initialValue={0}>
          <InputNumber style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="visible" label="可见" valuePropName="checked" initialValue={true}>
          <Switch />
        </Form.Item>
      </FormModal>
    </div>
  );
}
