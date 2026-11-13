import { Alert, Input, Space } from "antd";
import type { ReactNode } from "react";

export type BaseInfoToolbarProps = {
  /** 本页用途说明 */
  description: string;
  searchPlaceholder?: string;
  keyword?: string;
  onKeywordChange?: (kw: string) => void;
  /** 搜索旁筛选（Select 等） */
  filters?: ReactNode;
  /** 右侧主操作（新增等） */
  extra?: ReactNode;
};

/**
 * 基础信息各 Tab 统一顶栏：说明文案 + 搜索 + 筛选 + 操作。
 */
export default function BaseInfoToolbar({
  description,
  searchPlaceholder = "搜索编码 / 名称",
  keyword = "",
  onKeywordChange,
  filters,
  extra,
}: BaseInfoToolbarProps) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={description} />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Space wrap>
          {onKeywordChange ? (
            <Input.Search
              allowClear
              placeholder={searchPlaceholder}
              value={keyword}
              style={{ width: 240 }}
              onChange={(e) => onKeywordChange(e.target.value)}
              onSearch={(v) => onKeywordChange(v)}
            />
          ) : null}
          {filters}
        </Space>
        {extra ? <Space wrap>{extra}</Space> : null}
      </div>
    </div>
  );
}
