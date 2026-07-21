import { Form, Input, Select, Space } from "antd";
import { useState } from "react";
import { deleteConfig, fetchConfigs, upsertConfig } from "@/api/system";
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
import { useAppConfigStore } from "@/stores/appConfigStore";
import type { ConfigItem } from "@/types";

const BRANDING_KEYS = new Set([
  "app.title",
  "app.subtitle",
  "app.sidebar_title",
  "app.logo_url",
  "app.theme",
]);

export default function ConfigsPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ConfigItem | null>(null);
  const [form] = Form.useForm();
  const reloadBranding = useAppConfigStore((s) => s.load);

  const { data: configs = [], loading, refresh } = useRequest(fetchConfigs);

  const refreshIfBranding = async (configKey?: string) => {
    if (!configKey || BRANDING_KEYS.has(configKey)) {
      await reloadBranding();
    }
  };

  const close = () => {
    setOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const { mutate: saveConfig, loading: saving } = useMutation(
    async (values: Record<string, unknown>) => upsertConfig(values),
    {
      successMessage: () => (editing ? "更新成功" : "保存成功"),
      onSuccess: async (_data, [values]) => {
        close();
        await refresh();
        await refreshIfBranding(String(values.config_key));
      },
    },
  );

  return (
    <div>
      <PageHeader
        title="配置中心"
        extra={
          <AuthButton
            type="primary"
            onClick={() => {
              setEditing(null);
              form.resetFields();
              form.setFieldsValue({ scope_type: "SYSTEM", value_type: "string" });
              setOpen(true);
            }}
          >
            新增配置
          </AuthButton>
        }
      />
      <DataTable<ConfigItem>
        rowKey="id"
        loading={loading}
        dataSource={configs}
        columns={[
          { title: "作用域", dataIndex: "scope_type", width: 100 },
          { title: "键", dataIndex: "config_key" },
          { title: "值", dataIndex: "config_value", ellipsis: true },
          { title: "类型", dataIndex: "value_type", width: 90 },
          { title: "版本", dataIndex: "version", width: 70 },
          { title: "说明", dataIndex: "description", ellipsis: true },
          {
            title: "操作",
            width: 160,
            render: (_, record) => (
              <Space>
                <EditAction
                  onClick={() => {
                    setEditing(record);
                    form.setFieldsValue({
                      scope_type: record.scope_type,
                      scope_id: record.scope_id,
                      config_key: record.config_key,
                      config_value: record.config_value,
                      value_type: record.value_type,
                      description: record.description,
                    });
                    setOpen(true);
                  }}
                />
                <DeleteAction
                  title="确认删除配置？"
                  content={`将删除「${record.config_key}」。品牌类配置删除后会回退到环境变量默认值。`}
                  onConfirm={async () => {
                    await deleteConfig(record.id);
                    await refresh();
                    await refreshIfBranding(record.config_key);
                  }}
                />
              </Space>
            ),
          },
        ]}
      />

      <FormModal
        title={editing ? "编辑配置" : "新增配置"}
        open={open}
        form={form}
        confirmLoading={saving}
        onCancel={close}
        onOk={async () => {
          const values = await form.validateFields();
          await saveConfig(values);
        }}
      >
        <Form.Item name="scope_type" label="作用域" rules={[{ required: true }]} initialValue="SYSTEM">
          <Select
            disabled={!!editing}
            options={[
              { value: "SYSTEM", label: "系统" },
              { value: "TENANT", label: "租户" },
              { value: "USER", label: "用户" },
              { value: "BUSINESS", label: "业务" },
            ]}
          />
        </Form.Item>
        <Form.Item name="config_key" label="配置键" rules={[{ required: true }]}>
          <Input disabled={!!editing} />
        </Form.Item>
        <Form.Item name="config_value" label="配置值" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="value_type" label="值类型" initialValue="string">
          <Select options={[{ value: "string" }, { value: "number" }, { value: "json" }]} />
        </Form.Item>
        <Form.Item name="description" label="说明">
          <Input />
        </Form.Item>
      </FormModal>
    </div>
  );
}
