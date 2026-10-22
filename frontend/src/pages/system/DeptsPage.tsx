import { Form, Input, InputNumber, Select, Space, TreeSelect } from "antd";
import { useMemo, useState } from "react";
import { createDept, deleteDept, fetchDepts, updateDept } from "@/api/system";
import {
  AuthButton,
  DataTable,
  DeleteAction,
  EditAction,
  FormModal,
  PageHeader,
  StatusTag,
} from "@/components/kit";
import OperatingTenantBanner from "@/components/OperatingTenantBanner";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";
import type { DeptItem } from "@/types";

function toTableTree(items: DeptItem[]): DeptItem[] {
  return items.map((item) => ({
    ...item,
    children: item.children?.length ? toTableTree(item.children) : undefined,
  }));
}

function toTreeOptions(
  items: DeptItem[],
): Array<{ value: number; title: string; children?: ReturnType<typeof toTreeOptions> }> {
  return items.map((item) => ({
    value: item.id,
    title: item.name,
    children: item.children?.length ? toTreeOptions(item.children) : undefined,
  }));
}

export default function DeptsPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DeptItem | null>(null);
  const [form] = Form.useForm();

  const { data: depts = [], loading, refresh } = useRequest(fetchDepts);
  const treeOptions = useMemo(() => toTreeOptions(depts), [depts]);
  const tableData = useMemo(() => toTableTree(depts), [depts]);

  const close = () => {
    setOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const { mutate: saveDept, loading: saving } = useMutation(
    async (values: Record<string, unknown>) => {
      if (editing) return updateDept(editing.id, values);
      return createDept(values);
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
      <OperatingTenantBanner />
      <PageHeader
        title="部门管理"
        extra={
          <AuthButton
            type="primary"
            permission="dept:create"
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setOpen(true);
            }}
          >
            新增部门
          </AuthButton>
        }
      />
      <DataTable<DeptItem>
        rowKey="id"
        loading={loading}
        dataSource={tableData}
        pagination={false}
        defaultExpandAllRows
        columns={[
          { title: "名称", dataIndex: "name" },
          { title: "编码", dataIndex: "code" },
          { title: "负责人", dataIndex: "leader" },
          { title: "排序", dataIndex: "sort", width: 80 },
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
                  permission="dept:update"
                  onClick={() => {
                    setEditing(record);
                    form.setFieldsValue({
                      parent_id: record.parent_id,
                      name: record.name,
                      code: record.code,
                      sort: record.sort,
                      status: record.status,
                      leader: record.leader,
                      phone: record.phone,
                    });
                    setOpen(true);
                  }}
                />
                <DeleteAction
                  permission="dept:delete"
                  title="确认删除部门？"
                  content={`将删除「${record.name}」，有子部门或用户时无法删除。`}
                  onConfirm={async () => {
                    await deleteDept(record.id);
                    await refresh();
                  }}
                />
              </Space>
            ),
          },
        ]}
      />

      <FormModal
        title={editing ? "编辑部门" : "新增部门"}
        open={open}
        form={form}
        confirmLoading={saving}
        onCancel={close}
        onOk={async () => {
          const values = await form.validateFields();
          await saveDept(values);
        }}
      >
        <Form.Item name="parent_id" label="上级部门">
          <TreeSelect
            allowClear
            treeData={treeOptions}
            placeholder="不选则为顶级部门"
            treeDefaultExpandAll
          />
        </Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="code" label="编码">
          <Input />
        </Form.Item>
        <Form.Item name="leader" label="负责人">
          <Input />
        </Form.Item>
        <Form.Item name="phone" label="电话">
          <Input />
        </Form.Item>
        <Form.Item name="sort" label="排序" initialValue={0}>
          <InputNumber style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="status" label="状态" initialValue="active">
          <Select options={[{ value: "active", label: "启用" }, { value: "disabled", label: "禁用" }]} />
        </Form.Item>
      </FormModal>
    </div>
  );
}
