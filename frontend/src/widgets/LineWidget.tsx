import WidgetShell from "@/widgets/WidgetShell";
import { useWidgetData } from "@/hooks/useWidgetData";
import { LineChart } from "@/charts";
import type { WidgetProps } from "@/types/widget";

export default function LineWidget({
  title = "趋势",
  metricCode,
  config,
  refreshToken,
}: WidgetProps) {
  const { loading, error, empty, data, reload } = useWidgetData({
    config,
    metricCode,
    refreshToken,
  });

  const values = (data?.rows || []).map((row) => Number(row[1]));
  const labels = (data?.rows || []).map(
    (row) => String(row[0]).slice(11, 16) || String(row[0]).slice(5, 10),
  );
  const unit = config?.unit || data?.unit || "";

  return (
    <WidgetShell
      title={config?.title || title}
      loading={loading}
      error={error}
      empty={empty}
      onRefresh={reload}
      minHeight={220}
    >
      <LineChart data={{ labels, values }} unit={unit} height={180} />
    </WidgetShell>
  );
}
