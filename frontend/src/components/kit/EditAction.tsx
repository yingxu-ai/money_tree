import { Button, type ButtonProps } from "antd";
import { Permission } from "@/permissions";

export interface EditActionProps {
  /** 有权限码时走 Permission 包裹；不传则始终显示 */
  permission?: string;
  onClick: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
  /** 表格行内点击时阻止冒泡（如行选中） */
  stopPropagation?: boolean;
  buttonProps?: ButtonProps;
}

export default function EditAction({
  permission,
  onClick,
  children = "编辑",
  stopPropagation = false,
  buttonProps,
}: EditActionProps) {
  const btn = (
    <Button
      size="small"
      {...buttonProps}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onClick(e);
      }}
    >
      {children}
    </Button>
  );

  if (!permission) return btn;
  return <Permission code={permission}>{btn}</Permission>;
}
