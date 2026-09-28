import { Button, type ButtonProps } from "antd";
import { confirmDelete, notifySuccess } from "@/components/kit/feedback";
import { Permission } from "@/permissions";

export interface DeleteActionProps {
  permission?: string;
  title?: string;
  content?: string;
  /** 删除成功后的提示；false 则不提示 */
  successMessage?: string | false;
  onConfirm: () => void | Promise<void>;
  children?: React.ReactNode;
  stopPropagation?: boolean;
  buttonProps?: ButtonProps;
}

export default function DeleteAction({
  permission,
  title = "确认删除？",
  content = "删除后不可恢复。",
  successMessage = "删除成功",
  onConfirm,
  children = "删除",
  stopPropagation = false,
  buttonProps,
}: DeleteActionProps) {
  const btn = (
    <Button
      size="small"
      danger
      {...buttonProps}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        confirmDelete({
          title,
          content,
          onOk: async () => {
            await onConfirm();
            if (successMessage !== false) {
              notifySuccess(successMessage);
            }
          },
        });
      }}
    >
      {children ?? null}
    </Button>
  );

  if (!permission) return btn;
  return <Permission code={permission}>{btn}</Permission>;
}
