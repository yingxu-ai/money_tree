import { getData, postData } from "./client";
import type { MetricResult } from "@/types/widget";

export const fetchMetric = (metricCode: string, params?: Record<string, unknown>) =>
  getData<MetricResult>(`/metrics/${metricCode}`, params);

export const queryMetric = (body: {
  metric_code: string;
  start_time?: string;
  end_time?: string;
  dimensions?: Record<string, unknown>;
}) => postData<MetricResult>("/metrics/query", body);

export const listMetrics = () =>
  getData<Array<{ metric_code: string; name: string; unit: string }>>("/metrics");
