import { Select, type SelectProps } from "antd";
import { useDict } from "@/hooks/useDict";

export interface DictSelectProps extends Omit<SelectProps, "options" | "loading"> {
  /** 字典类型编码，如 user_status */
  typeCode: string;
}

export default function DictSelect({ typeCode, placeholder = "请选择", ...rest }: DictSelectProps) {
  const { options, loading } = useDict(typeCode);
  return <Select allowClear placeholder={placeholder} loading={loading} options={options} {...rest} />;
}
