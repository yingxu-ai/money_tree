import { Tag } from "antd";
import { useDict } from "@/hooks/useDict";

const DEFAULT_COLORS: Record<string, string> = {
  active: "green",
  online: "green",
  success: "green",
  disabled: "default",
  draft: "default",
  offline: "orange",
  failed: "red",
  error: "red",
};

export interface StatusTagProps {
  value?: string | null;
  /** 传入则用字典 label 展示 */
  typeCode?: string;
  /** value -> 颜色覆盖 */
  colorMap?: Record<string, string>;
  /** value -> 文案覆盖（无 typeCode 时用） */
  labelMap?: Record<string, string>;
}

/**
 * 状态 Tag：可接字典 label，或本地 labelMap。
 */
export default function StatusTag({ value, typeCode, colorMap, labelMap }: StatusTagProps) {
  const { items } = useDict(typeCode);
  if (value == null || value === "") return <Tag>-</Tag>;

  const dictLabel = typeCode
    ? items.find((i) => i.value === value)?.label
    : undefined;
  const label = dictLabel || labelMap?.[value] || value;
  const color = colorMap?.[value] || DEFAULT_COLORS[value] || "default";

  return <Tag color={color}>{label}</Tag>;
}
