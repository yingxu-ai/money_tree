import { useCallback, useEffect, useState } from "react";
import { executeTool } from "@/api/system";
import { fetchMetric } from "@/api/metrics";
import type { MetricResult, WidgetConfig } from "@/types/widget";

interface UseWidgetDataOptions {
  config?: WidgetConfig;
  metricCode?: string;
  refreshToken?: number;
}

export function useWidgetData({ config, metricCode, refreshToken = 0 }: UseWidgetDataOptions) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MetricResult | null>(null);
  const [tick, setTick] = useState(0);

  const code =
    metricCode ||
    (config?.data_source?.params?.metric_code as string | undefined) ||
    "daily_output";

  const refreshSeconds = config?.refresh_seconds ?? 0;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const mode = config?.data_source?.mode || "api";
      let result: MetricResult;
      if (mode === "tool") {
        result = (await executeTool("query_metric", {
          metric_code: code,
          ...(config?.data_source?.params || {}),
        })) as MetricResult;
      } else {
        result = await fetchMetric(code);
      }
      setData(result);
      if (!result.rows?.length) {
        setError(null);
      }
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [code, config]);

  useEffect(() => {
    load();
  }, [load, refreshToken, tick]);

  useEffect(() => {
    if (!refreshSeconds || refreshSeconds <= 0) return;
    const id = window.setInterval(() => setTick((t) => t + 1), refreshSeconds * 1000);
    return () => window.clearInterval(id);
  }, [refreshSeconds]);

  return {
    loading,
    error,
    data,
    empty: !loading && !error && (!data || !data.rows?.length),
    reload: load,
    metricCode: code,
  };
}
