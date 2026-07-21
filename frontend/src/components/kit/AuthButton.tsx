import { Button, type ButtonProps } from "antd";
import { Permission, usePermission } from "@/permissions";

export interface AuthButtonProps extends ButtonProps {
  /** 权限码；无权限时默认不渲染 */
  permission?: string;
  /** 无权限时禁用而非隐藏 */
  fallback?: "hide" | "disable";
  children?: React.ReactNode;
}

/**
 * 带权限的按钮：默认无权限隐藏；fallback="disable" 时禁用。
 */
export default function AuthButton({
  permission,
  fallback = "hide",
  children,
  disabled,
  ...buttonProps
}: AuthButtonProps) {
  const { hasPermission } = usePermission();

  if (!permission) {
    return (
      <Button {...buttonProps} disabled={disabled}>
        {children}
      </Button>
    );
  }

  if (fallback === "disable") {
    const allowed = hasPermission(permission);
    return (
      <Button {...buttonProps} disabled={disabled || !allowed}>
        {children}
      </Button>
    );
  }

  return (
    <Permission code={permission}>
      <Button {...buttonProps} disabled={disabled}>
        {children}
      </Button>
    </Permission>
  );
}
