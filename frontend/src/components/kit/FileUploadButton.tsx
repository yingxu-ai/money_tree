import { UploadOutlined } from "@ant-design/icons";
import { Button, Upload, type ButtonProps, type UploadProps } from "antd";
import { uploadFile } from "@/api/files";
import { notifyError, notifySuccess } from "@/components/kit/feedback";
import { Permission } from "@/permissions";

export interface FileUploadButtonProps {
  permission?: string;
  buttonProps?: ButtonProps;
  children?: React.ReactNode;
  accept?: string;
  multiple?: boolean;
  onUploaded?: () => void | Promise<void>;
}

export default function FileUploadButton({
  permission = "file:upload",
  buttonProps,
  children = "上传文件",
  accept,
  multiple = false,
  onUploaded,
}: FileUploadButtonProps) {
  const customRequest: UploadProps["customRequest"] = async ({ file, onSuccess, onError }) => {
    try {
      await uploadFile(file as File);
      notifySuccess("上传成功");
      onSuccess?.({});
      await onUploaded?.();
    } catch (err) {
      notifyError(err, "上传失败");
      onError?.(err as Error);
    }
  };

  return (
    <Permission code={permission}>
      <Upload showUploadList={false} customRequest={customRequest} accept={accept} multiple={multiple}>
        <Button type="primary" icon={<UploadOutlined />} {...buttonProps}>
          {children}
        </Button>
      </Upload>
    </Permission>
  );
}
