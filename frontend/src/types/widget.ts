export interface MetricResult {
  metric_code: string;
  name?: string;
  columns: string[];
  rows: Array<[string, number] | Array<string | number>>;
  unit: string;
  summary?: {
    latest?: number;
    avg?: number;
    min?: number;
    max?: number;
    delta_pct?: number;
  };
}

export interface WidgetDataSource {
  mode?: "api" | "tool";
  target?: string;
  params?: Record<string, unknown>;
}

export interface WidgetConfig {
  title?: string;
  unit?: string;
  refresh_seconds?: number;
  data_source?: WidgetDataSource;
}

export interface WidgetInstance {
  widget_code: string;
  type: string;
  position: Record<string, number>;
  config: WidgetConfig;
}

export interface WidgetProps {
  title?: string;
  metricCode?: string;
  config?: WidgetConfig;
  refreshToken?: number;
}
