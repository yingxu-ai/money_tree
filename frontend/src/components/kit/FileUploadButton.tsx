import { UploadOutlined } from "@ant-design/icons";
import { Button, Upload, type ButtonProps, type UploadProps } from "antd";
import { uploadFile, type FileItem } from "@/api/files";
import { notifyError, notifySuccess } from "@/components/kit/feedback";
import { Permission } from "@/permissions";

export interface FileUploadButtonProps {
  permission?: string;
  buttonProps?: ButtonProps;
  children?: React.ReactNode;
  accept?: string;
  multiple?: boolean;
  /** 上传成功回调；可拿到文件元数据（含 ref / content_url） */
  onUploaded?: (file?: FileItem) => void | Promise<void>;
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
      const uploaded = await uploadFile(file as File);
      notifySuccess("上传成功");
      onSuccess?.(uploaded);
      await onUploaded?.(uploaded);
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
