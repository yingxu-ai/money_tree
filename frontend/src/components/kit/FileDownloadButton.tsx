import { DownloadOutlined } from "@ant-design/icons";
import { Button, type ButtonProps } from "antd";
import { downloadFile } from "@/api/files";
import { notifyError } from "@/components/kit/feedback";
import { Permission } from "@/permissions";

export interface FileDownloadButtonProps {
  fileId: number;
  filename: string;
  permission?: string;
  buttonProps?: ButtonProps;
  children?: React.ReactNode;
}

export default function FileDownloadButton({
  fileId,
  filename,
  permission = "file:view",
  buttonProps,
  children = "下载",
}: FileDownloadButtonProps) {
  return (
    <Permission code={permission}>
      <Button
        size="small"
        icon={<DownloadOutlined />}
        {...buttonProps}
        onClick={async () => {
          try {
            await downloadFile(fileId, filename);
          } catch (err) {
            notifyError(err, "下载失败");
          }
        }}
      >
        {children}
      </Button>
    </Permission>
  );
}
