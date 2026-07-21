import { Statistic } from "antd";
import WidgetShell, { DeltaBadge } from "@/widgets/WidgetShell";
import { useWidgetData } from "@/hooks/useWidgetData";
import type { WidgetProps } from "@/types/widget";

export default function NumberWidget({
  title = "指标",
  metricCode,
  config,
  refreshToken,
}: WidgetProps) {
  const { loading, error, empty, data, reload } = useWidgetData({
    config,
    metricCode,
    refreshToken,
  });

  const latest = data?.summary?.latest ?? (data?.rows?.length ? Number(data.rows[data.rows.length - 1][1]) : null);
  const unit = config?.unit || data?.unit || "";

  return (
    <WidgetShell
      title={config?.title || title}
      loading={loading}
      error={error}
      empty={empty}
      onRefresh={reload}
      extra={<DeltaBadge value={data?.summary?.delta_pct} />}
    >
      <Statistic value={latest ?? "-"} suffix={unit} precision={1} />
    </WidgetShell>
  );
}
