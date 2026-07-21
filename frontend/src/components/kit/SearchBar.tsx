import { Button, Input, Space } from "antd";
import { useState } from "react";

export interface SearchBarProps {
  placeholder?: string;
  defaultValue?: string;
  width?: number | string;
  /** 搜索；传空表示清空 */
  onSearch: (keyword: string) => void;
  /** 是否显示重置按钮，默认 true */
  showReset?: boolean;
  extra?: React.ReactNode;
}

/**
 * 关键词搜索栏：搜索 + 可选重置 + 右侧扩展区。
 */
export default function SearchBar({
  placeholder = "搜索",
  defaultValue = "",
  width = 280,
  onSearch,
  showReset = true,
  extra,
}: SearchBarProps) {
  const [value, setValue] = useState(defaultValue);

  const doSearch = (kw: string) => {
    setValue(kw);
    onSearch(kw.trim());
  };

  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
      <Space wrap>
        <Input.Search
          allowClear
          placeholder={placeholder}
          value={value}
          style={{ width }}
          onChange={(e) => setValue(e.target.value)}
          onSearch={(v) => doSearch(v)}
        />
        {showReset ? (
          <Button
            onClick={() => {
              setValue("");
              onSearch("");
            }}
          >
            重置
          </Button>
        ) : null}
      </Space>
      {extra ? <Space wrap>{extra}</Space> : null}
    </div>
  );
}
