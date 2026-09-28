import { Card, Space, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import type { DeviceListItem } from "@/modules/equipment-analysis/api/equipmentAnalysis";
import {
  buildDeviceDetailHref,
  type DeviceDetailNavContext,
  type DeviceDetailTab,
} from "@/modules/equipment-analysis/ui/deviceNav";

const STATUS_COLOR: Record<string, string> = {
  abnormal: "red",
  watch: "gold",
  normal: "green",
};

const STATUS_LABEL: Record<string, string> = {
  abnormal: "异常",
  watch: "关注",
  normal: "正常",
};

function tabFor(_row: DeviceListItem): DeviceDetailTab {
  return "analysis";
}

export function DemoAnchorBar({
  items,
  navCtx,
}: {
  items?: DeviceListItem[];
  navCtx: DeviceDetailNavContext;
}) {
  if (!items?.length) return null;
  return (
    <Card size="small" title="重点设备" style={{ marginBottom: 12 }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        建议优先查看：2# 异常处置 → 1# 健康参考 → 注塑机长寿命关注。
      </Typography.Paragraph>
      <Space wrap size={12}>
        {items.map((d) => (
          <Link
            key={d.id}
            to={buildDeviceDetailHref(d.id, { ...navCtx, tab: tabFor(d) })}
          >
            <Space size={6}>
              <Typography.Text strong>{d.name}</Typography.Text>
              <Tag color={STATUS_COLOR[d.analysis_status] ?? "default"}>
                {STATUS_LABEL[d.analysis_status] ?? d.analysis_status}
              </Tag>
              {d.rec_strategy_label ? <Tag>{d.rec_strategy_label}</Tag> : null}
            </Space>
          </Link>
        ))}
      </Space>
    </Card>
  );
}
