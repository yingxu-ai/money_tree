import { Select, Space, Typography } from "antd";
import { DeptTreeSelect } from "@/components/kit";
import type { GroupLevelOption } from "@/api/equipmentAnalysis";

export function FleetScopeBar({
  deptId,
  onDeptChange,
  scopeLabel,
  deviceType,
  typeOptions,
  onTypeChange,
  groupBy,
  groupByOptions,
  onGroupByChange,
  updatedAt,
}: {
  deptId?: number;
  onDeptChange: (id?: number) => void;
  scopeLabel?: string;
  deviceType?: string;
  typeOptions?: string[];
  onTypeChange?: (type?: string) => void;
  groupBy?: string;
  groupByOptions?: GroupLevelOption[];
  onGroupByChange?: (mode: string) => void;
  updatedAt?: string;
}) {
  return (
    <Space wrap style={{ marginBottom: 12 }} align="center">
      <DeptTreeSelect
        allowClear
        placeholder="全部设备 / 全部区域"
        style={{ width: 220 }}
        value={deptId}
        onChange={(v) => onDeptChange(v == null ? undefined : Number(v))}
      />
      {onGroupByChange && (groupByOptions?.length ?? 0) > 0 ? (
        <Select
          style={{ width: 160 }}
          value={groupBy ?? "auto"}
          onChange={onGroupByChange}
          options={groupByOptions}
          placeholder="部门汇总"
        />
      ) : null}
      {onTypeChange ? (
        <Select
          allowClear
          placeholder="全部类型"
          style={{ width: 140 }}
          value={deviceType}
          onChange={(v) => onTypeChange(v ?? undefined)}
          options={(typeOptions ?? []).map((t) => ({ value: t, label: t }))}
        />
      ) : null}
      {scopeLabel && scopeLabel !== "全部" ? (
        <Typography.Text type="secondary">范围：{scopeLabel}</Typography.Text>
      ) : null}
      {updatedAt ? (
        <Typography.Text type="secondary">
          更新时间：{updatedAt.replace("T", " ").slice(0, 16)}
        </Typography.Text>
      ) : null}
    </Space>
  );
}
