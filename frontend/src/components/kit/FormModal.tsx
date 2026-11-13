import { Form, Modal, type FormInstance, type ModalProps } from "antd";

export interface FormModalProps extends Omit<ModalProps, "onOk" | "children"> {
  form: FormInstance;
  children: React.ReactNode;
  /** 默认 true：关闭后销毁内容，避免表单残留 */
  destroyOnHidden?: boolean;
  onOk?: () => void | Promise<void>;
  /** Form layout，默认 vertical */
  formLayout?: "horizontal" | "vertical" | "inline";
  labelCol?: { span?: number; flex?: string | number };
  wrapperCol?: { span?: number; flex?: string | number };
}

/**
 * 标准 CRUD 弹窗：Modal + Form，统一 destroyOnHidden / layout。
 * 字段内容由调用方传入 Form.Item。
 */
export default function FormModal({
  form,
  children,
  onOk,
  onCancel,
  destroyOnHidden = true,
  formLayout = "vertical",
  labelCol,
  wrapperCol,
  confirmLoading,
  ...modalProps
}: FormModalProps) {
  return (
    <Modal
      {...modalProps}
      destroyOnHidden={destroyOnHidden}
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={async () => {
        await onOk?.();
      }}
    >
      <Form form={form} layout={formLayout} labelCol={labelCol} wrapperCol={wrapperCol}>
        {children}
      </Form>
    </Modal>
  );
}
