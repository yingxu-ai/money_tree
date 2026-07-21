import { Form, Input, InputNumber, Select, Space } from "antd";
import { useEffect, useState } from "react";
import {
  createDictItem,
  createDictType,
  deleteDictItem,
  deleteDictType,
  fetchDictItems,
  fetchDictTypes,
  updateDictItem,
  updateDictType,
} from "@/api/system";
import {
  AuthButton,
  DataTable,
  DeleteAction,
  EditAction,
  FormModal,
  PageHeader,
  StatusTag,
  notifySuccess,
} from "@/components/kit";
import type { DictItemRow, DictTypeItem } from "@/types";

export default function DictsPage() {
  const [loading, setLoading] = useState(true);
  const [types, setTypes] = useState<DictTypeItem[]>([]);
  const [items, setItems] = useState<DictItemRow[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [typeOpen, setTypeOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [editingType, setEditingType] = useState<DictTypeItem | null>(null);
  const [editingItem, setEditingItem] = useState<DictItemRow | null>(null);
  const [typeForm] = Form.useForm();
  const [itemForm] = Form.useForm();

  const loadTypes = async () => {
    setLoading(true);
    try {
      const data = await fetchDictTypes();
      setTypes(data);
      if (selectedTypeId == null && data.length) {
        setSelectedTypeId(data[0].id);
      } else if (selectedTypeId != null && !data.some((t) => t.id === selectedTypeId)) {
        setSelectedTypeId(data[0]?.id ?? null);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadItems = async (typeId: number | null) => {
    if (typeId == null) {
      setItems([]);
      return;
    }
    setItems(await fetchDictItems({ type_id: typeId }));
  };

  useEffect(() => {
    loadTypes();
  }, []);

  useEffect(() => {
    loadItems(selectedTypeId);
  }, [selectedTypeId]);

  const closeType = () => {
    setTypeOpen(false);
    setEditingType(null);
    typeForm.resetFields();
  };

  const closeItem = () => {
    setItemOpen(false);
    setEditingItem(null);
    itemForm.resetFields();
  };

  return (
    <div>
      <PageHeader title="字典管理" />
      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 16 }}>
        <div>
          <div style={{ marginBottom: 12 }}>
            <AuthButton
              type="primary"
              permission="dict:create"
              onClick={() => {
                setEditingType(null);
                typeForm.resetFields();
                setTypeOpen(true);
              }}
            >
              新增类型
            </AuthButton>
          </div>
          <DataTable<DictTypeItem>
            rowKey="id"
            loading={loading}
            dataSource={types}
            size="small"
            pagination={false}
            rowSelection={{
              type: "radio",
              selectedRowKeys: selectedTypeId != null ? [selectedTypeId] : [],
              onChange: (keys) => setSelectedTypeId((keys[0] as number) ?? null),
            }}
            onRow={(record) => ({
              onClick: () => setSelectedTypeId(record.id),
            })}
            columns={[
              { title: "名称", dataIndex: "name" },
              { title: "编码", dataIndex: "code" },
              {
                title: "操作",
                width: 120,
                render: (_, record) => (
                  <Space>
                    <EditAction
                      permission="dict:update"
                      stopPropagation
                      onClick={() => {
                        setEditingType(record);
                        typeForm.setFieldsValue(record);
                        setTypeOpen(true);
                      }}
                    />
                    <DeleteAction
                      permission="dict:delete"
                      stopPropagation
                      title="确认删除字典类型？"
                      content={`将删除「${record.name}」，请先清空字典项。`}
                      onConfirm={async () => {
                        await deleteDictType(record.id);
                        await loadTypes();
                      }}
                    >
                      删
                    </DeleteAction>
                  </Space>
                ),
              },
            ]}
          />
        </div>

        <div>
          <div style={{ marginBottom: 12 }}>
            <AuthButton
              type="primary"
              permission="dict:create"
              disabled={selectedTypeId == null}
              onClick={() => {
                setEditingItem(null);
                itemForm.resetFields();
                setItemOpen(true);
              }}
            >
              新增字典项
            </AuthButton>
          </div>
          <DataTable<DictItemRow>
            rowKey="id"
            dataSource={items}
            columns={[
              { title: "标签", dataIndex: "label" },
              { title: "值", dataIndex: "value" },
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
                      permission="dict:update"
                      onClick={() => {
                        setEditingItem(record);
                        itemForm.setFieldsValue(record);
                        setItemOpen(true);
                      }}
                    />
                    <DeleteAction
                      permission="dict:delete"
                      title="确认删除字典项？"
                      content={`将删除「${record.label}」。`}
                      onConfirm={async () => {
                        await deleteDictItem(record.id);
                        await loadItems(selectedTypeId);
                      }}
                    />
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </div>

      <FormModal
        title={editingType ? "编辑字典类型" : "新增字典类型"}
        open={typeOpen}
        form={typeForm}
        onCancel={closeType}
        onOk={async () => {
          const values = await typeForm.validateFields();
          if (editingType) {
            await updateDictType(editingType.id, values);
            notifySuccess("更新成功");
          } else {
            await createDictType(values);
            notifySuccess("创建成功");
          }
          closeType();
          loadTypes();
        }}
      >
        {!editingType && (
          <Form.Item name="code" label="编码" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        )}
        <Form.Item name="name" label="名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label="说明">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="status" label="状态" initialValue="active">
          <Select options={[{ value: "active", label: "启用" }, { value: "disabled", label: "禁用" }]} />
        </Form.Item>
      </FormModal>

      <FormModal
        title={editingItem ? "编辑字典项" : "新增字典项"}
        open={itemOpen}
        form={itemForm}
        onCancel={closeItem}
        onOk={async () => {
          const values = await itemForm.validateFields();
          if (editingItem) {
            await updateDictItem(editingItem.id, values);
            notifySuccess("更新成功");
          } else {
            await createDictItem({ ...values, type_id: selectedTypeId });
            notifySuccess("创建成功");
          }
          closeItem();
          loadItems(selectedTypeId);
        }}
      >
        <Form.Item name="label" label="标签" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="value" label="值" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="sort" label="排序" initialValue={0}>
          <InputNumber style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="remark" label="备注">
          <Input />
        </Form.Item>
        <Form.Item name="status" label="状态" initialValue="active">
          <Select options={[{ value: "active", label: "启用" }, { value: "disabled", label: "禁用" }]} />
        </Form.Item>
      </FormModal>
    </div>
  );
}
