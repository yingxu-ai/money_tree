import { getData, postData } from "@/api/client";

export type AnalyticsDimKey =
  | "work_date"
  | "shift"
  | "team"
  | "person"
  | "equipment"
  | "process"
  | "work_order"
  | "product"
  | "order";

export type AnalyticsMetricKey =
  | "output_qty"
  | "production_hours"
  | "hourly_output"
  | "unit_time"
  | "unit_minutes"
  | "achieve_pct";

export interface AnalyticsFilterOption {
  value: string;
  label: string;
}

export interface AnalyticsMeta {
  dimensions: Array<{ key: AnalyticsDimKey; label: string }>;
  metrics: Array<{
    key: AnalyticsMetricKey;
    label: string;
    unit: string;
    kind: string;
    rankable?: boolean;
    needs_std?: boolean;
  }>;
  default_date_from: string;
  default_date_to: string;
  max_group_by: number;
  max_limit: number;
  filters: {
    teams: AnalyticsFilterOption[];
    persons: AnalyticsFilterOption[];
    equipments: AnalyticsFilterOption[];
    processes: AnalyticsFilterOption[];
    products: AnalyticsFilterOption[];
    shifts: AnalyticsFilterOption[];
    work_orders: AnalyticsFilterOption[];
    orders: AnalyticsFilterOption[];
  };
  note?: string;
  std_process_count?: number;
}

export interface AnalyticsFilters {
  team_ids?: string[];
  person_ids?: string[];
  equipment_ids?: string[];
  process_names?: string[];
  work_order_ids?: string[];
  products?: string[];
  order_ids?: string[];
  shift_family_ids?: string[];
}

export interface AnalyticsQueryRequest {
  date_from?: string;
  date_to?: string;
  filters?: AnalyticsFilters;
  group_by: AnalyticsDimKey[];
  metrics: AnalyticsMetricKey[];
  sort?: { field?: string; order?: "asc" | "desc" };
  limit?: number;
}

export interface AnalyticsQueryResponse {
  date_from: string;
  date_to: string;
  group_by: AnalyticsDimKey[];
  metrics: AnalyticsMetricKey[];
  columns: Array<{ key: string; label: string; unit?: string; role: string }>;
  rows: Array<Record<string, unknown>>;
  totals: Record<string, number | null>;
  row_count: number;
  truncated: boolean;
  fact_count: number;
  note?: string;
}

export function fetchAnalyticsMeta() {
  return getData<AnalyticsMeta>("/progress-analytics/meta");
}

export function queryAnalytics(payload: AnalyticsQueryRequest) {
  return postData<AnalyticsQueryResponse>("/progress-analytics/query", payload);
}
