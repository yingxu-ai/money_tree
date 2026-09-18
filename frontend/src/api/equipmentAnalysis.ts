import { getData, postData } from "@/api/client";
import type { ChartBlockItem, KpiItem } from "@/components/blocks";

export type RunStatus = "running" | "stopped" | "alarm" | string;
export type AnalysisStatus = "normal" | "watch" | "abnormal" | string;

export interface StatusMaps {
  status_label?: Record<string, string>;
  status_color?: Record<string, string>;
}

export interface DeviceListItem {
  id: string;
  code: string;
  name: string;
  type?: string;
  dept_id: number;
  dept_name: string;
  run_status: RunStatus;
  analysis_status: AnalysisStatus;
  summary: string;
  realtime_display: string;
  risk_7d: number;
  rul_days: number;
  /** 未来分析 Phase 1 投影字段 */
  health_index?: number;
  health_band?: "green" | "yellow" | "red" | string;
  alert_level?: "normal" | "warning" | "alarm" | "paused" | string;
  alert_label?: string;
  confidence?: "low" | "medium" | "high" | string;
  confidence_label?: string;
  data_valid?: boolean;
  data_valid_reason?: string | null;
  prediction_paused?: boolean;
  maintain_by?: string | null;
  rul_range_label?: string;
  review_required?: boolean;
  primary_cause?: string;
  degradation_ratio?: number;
  degradation_label?: string;
  residual_score?: number;
  residual_label?: string;
  attribution_top3?: FutureAttributionItem[];
  downtime_planned_h?: number;
  downtime_unplanned_h?: number;
  downtime_avoidable_h?: number;
  downtime_planned_label?: string;
  downtime_unplanned_label?: string;
  downtime_avoidable_label?: string;
  energy_score?: number;
  output_today?: number;
  power?: number;
  eligible_optimize?: boolean;
  severity?: number;
  verdict?: string;
  one_liner?: string;
  likely_fault?: string;
  risk_24h?: number;
  risk_72h?: number;
  rul_ci?: [number, number];
  avoid_preview?: string;
  eligible?: boolean;
  block_reason?: string;
  opt_summary?: string;
  severity_rank?: number;
  deviation_score?: number;
  duration_hours?: number;
  triggers?: string[];
  sparkline?: number[];
  comm_status?: string;
  run_bucket?: string;
  duration_text?: string;
  action_preview?: string;
  rec_strategy?: string | null;
  rec_strategy_label?: string;
  rec_reason?: string;
  rec_energy_label?: string;
  is_anchor?: boolean;
}

export interface CollectPageData extends StatusMaps {
  title: string;
  subtitle?: string;
  note?: string;
  sources: Array<{
    id: string;
    name: string;
    kind: string;
    interval_sec: number;
    enabled: boolean;
    dept_id: number;
  }>;
  points: Array<{
    id: string;
    code: string;
    name: string;
    unit: string;
    category: string;
    source_id: string;
  }>;
  point_categories: Array<{ key: string; label: string }>;
  bindings: Array<{
    id: string;
    name: string;
    code: string;
    dept_id: number;
    dept_name: string;
    source_id: string;
    point_count: number;
    point_ids: string[];
    last_sample_at?: string;
  }>;
}

export interface FleetSunburstNode {
  name: string;
  value?: number;
  itemStyle?: { color?: string; opacity?: number };
  children?: FleetSunburstNode[];
}

export interface FleetSankeyData {
  nodes: { name: string }[];
  links: { source: string; target: string; value: number }[];
}

export interface DevicesPageData extends StatusMaps {
  title: string;
  subtitle?: string;
  scope_dept_id?: number | null;
  scope_label?: string;
  kpis: KpiItem[];
  fleet_status_trends?: FleetStatusTrends;
  fleet_type_trends?: FleetTypeTrends;
  fleet_sunburst?: FleetSunburstNode[];
  fleet_sankey?: FleetSankeyData;
  demo_items?: DeviceListItem[];
  items: DeviceListItem[];
}

export interface OptimizeFleetBrief {
  headline: string;
  stance: string;
  mix: Array<{ key: string; label: string; count: number }>;
  power_drop_kw?: number;
  if_act?: string;
}

export interface GroupLevelOption {
  value: string;
  label: string;
}

export interface AnalysisPageData extends StatusMaps {
  title: string;
  subtitle?: string;
  scope_dept_id?: number | null;
  scope_label?: string;
  scope_device_type?: string | null;
  group_by?: string;
  group_by_resolved?: string;
  group_by_label?: string;
  group_by_options?: GroupLevelOption[];
  /** @deprecated 使用 group_by */
  group_level?: string;
  group_level_label?: string;
  group_level_options?: GroupLevelOption[];
  updated_at?: string;
  type_options?: string[];
  note?: string;
  situation?: string;
  kpis: KpiItem[];
  items: DeviceListItem[];
  charts?: ChartBlockItem[];
  health_distribution?: Array<{ label: string; value: number }>;
  run_distribution?: Array<{ label: string; value: number }>;
  summary_rates?: {
    online_rate: number;
    running_rate: number;
    health_rate: number;
    issue_rate: number;
  };
  dept_ranking?: DeptRankingRow[];
  type_stats?: TypeStatRow[];
  focus_items?: DeviceListItem[];
  future_narrative?: FutureNarrative;
  optimize_brief?: OptimizeFleetBrief;
  blocked_items?: DeviceListItem[];
  demo_items?: DeviceListItem[];
  item_total?: number;
  page?: number;
  page_size?: number;
  fleet_status_trends?: FleetStatusTrends;
  fleet_type_trends?: FleetTypeTrends;
  fleet_issue_views?: FleetIssueViews;
  /** @deprecated 使用 fleet_issue_views */
  fleet_dept_issue_trends?: FleetDeptIssueTrends;
}

export interface DeptRankingRow {
  dept_id: number;
  dept_name: string;
  device_count: number;
  online_count: number;
  online_rate: number;
  running_count: number;
  watch_count: number;
  abnormal_count: number;
  fault_count: number;
  issue_count: number;
}

export interface TypeStatRow {
  type: string;
  total: number;
  issue: number;
  issue_rate: number;
}

export interface FutureAttributionItem {
  metric: string;
  name: string;
  contribution_pct: number;
  text: string;
}

export interface FutureDecisionBrief {
  headline: string;
  stance: string;
  severity?: string;
  causes: string[];
  if_ignore: string;
  if_act: string;
  downtime_planned_h?: number;
  downtime_unplanned_h?: number;
  downtime_avoidable_h?: number;
  downtime_planned_label?: string;
  downtime_unplanned_label?: string;
  downtime_avoidable_label?: string;
}

export interface FutureFaultCoverageItem {
  key: string;
  name: string;
  status: "hit" | "covered" | "gap" | string;
  prob?: number | null;
  hint?: string | null;
}

export interface FutureFaultCoverageGroup {
  key: string;
  label: string;
  desc: string;
  items: FutureFaultCoverageItem[];
}

export interface FutureFaultCoverageWall {
  summary: string;
  hit_count: number;
  covered_count: number;
  groups: FutureFaultCoverageGroup[];
}

export interface FutureSimilarCase {
  id: string;
  title: string;
  when: string;
  action: string;
  outcome: string;
  avoided_downtime_h?: number;
  avoided_downtime_label?: string | null;
  is_counterfactual?: boolean;
}

export interface FutureThresholdOption {
  key: string;
  label: string;
  desc: string;
  alarm_risk_24h: number;
  warning_risk_7d: number;
}

export interface FutureBacktestStory {
  id: string;
  title: string;
  summary: string;
}

export interface FuturePriorityDevice {
  id: string;
  name: string;
  dept_name: string;
  risk_7d: number;
  likely_fault: string;
  rul_days: number;
}

export interface FutureNarrative {
  situation?: string;
  paragraphs: string[];
  action_hints: string[];
  priority_devices: FuturePriorityDevice[];
  backtest_stories?: FutureBacktestStory[];
  fleet_downtime_avoidable_h?: number;
  fleet_downtime_avoidable_label?: string;
}

export type FleetStatusTrendPeriod = "week" | "month" | "quarter" | "year";

export type IssueViewTab = "abnormal" | "watch" | "fault" | "all";

export interface FleetIssueViewSlice {
  device: Partial<Record<FleetStatusTrendPeriod, FleetStatusTrendData>>;
  dept: Partial<Record<FleetStatusTrendPeriod, FleetStatusTrendData>>;
}

export type FleetIssueViews = Partial<Record<IssueViewTab, FleetIssueViewSlice>>;

export interface FleetStatusTrendSeries {
  key: string;
  name: string;
  values: number[];
}

export interface FleetStatusTrendData {
  labels: string[];
  day_labels?: string[];
  tick_indices?: number[];
  series: FleetStatusTrendSeries[];
  summary?: string;
}

export type FleetStatusTrends = Partial<Record<FleetStatusTrendPeriod, FleetStatusTrendData>>;

export type FleetTypeTrends = FleetStatusTrends;

export type FleetDeptIssueTrendData = FleetStatusTrendData;
export type FleetDeptIssueTrends = FleetStatusTrends;

export interface DeviceTreeNode {
  key: string;
  title: string;
  type: "dept" | "device";
  dept_id?: number;
  device_id?: string;
  code?: string;
  device_type?: string;
  analysis_status?: AnalysisStatus;
  run_status?: RunStatus;
  isLeaf?: boolean;
  children?: DeviceTreeNode[];
}

export interface DeviceTreePageData {
  title: string;
  scope_dept_id?: number | null;
  scope_label?: string;
  tree: DeviceTreeNode[];
  max_select: number;
}

export interface DeviceStatusSegment {
  status: string;
  start_index: number;
  end_index: number;
  start_date: string;
  end_date: string;
  days: number;
}

export interface CompareDeviceRow {
  id: string;
  code: string;
  name: string;
  type?: string;
  dept_id: number;
  dept_name: string;
  current_status: string;
  segments: DeviceStatusSegment[];
  health_index?: number;
  risk_7d?: number;
  energy_score?: number;
  alert_level?: string;
  alert_label?: string;
  advice?: string;
  advice_rank?: number;
  advice_reason?: string;
  run_order?: number;
}

export interface CompareRunOrderItem {
  run_order: number;
  id: string;
  name: string;
  advice: string;
  advice_reason?: string;
  health_index?: number;
  risk_7d?: number;
}

export interface StatusLegendItem {
  key: string;
  label: string;
  color: string;
}

export interface CompareAxisMeta {
  labels: string[];
  day_labels?: string[];
  tick_indices?: number[];
  period: FleetStatusTrendPeriod;
  day_count: number;
  start_date: string;
  end_date: string;
}

export interface DeviceComparePageData extends StatusMaps {
  title: string;
  subtitle?: string;
  period: FleetStatusTrendPeriod;
  period_label: string;
  axis: CompareAxisMeta;
  devices: CompareDeviceRow[];
  run_order?: CompareRunOrderItem[];
  status_legend: StatusLegendItem[];
  max_devices: number;
  error?: string;
  message?: string;
}

export type CurrentAnalysisPageData = AnalysisPageData;

export interface DeviceDetailData extends StatusMaps {
  title: string;
  subtitle?: string;
  id: string;
  code: string;
  name: string;
  type?: string;
  dept_id: number;
  dept_name: string;
  run_status: RunStatus;
  analysis_status: AnalysisStatus;
  summary: string;
  realtime: Record<string, number>;
  realtime_display: string;
  points: Array<{
    id: string;
    code: string;
    name: string;
    unit: string;
    category: string;
    value?: number;
    source_id?: string;
  }>;
  point_count?: number;
  comm_status?: string;
  source_id?: string;
  source_name?: string;
  source_kind?: string;
  source_interval_sec?: number;
  last_sample_at?: string;
  output_today?: number;
  energy_score?: number;
  alarm_code?: string;
  metric_labels?: Record<string, string>;
  current: {
    verdict: string;
    one_liner: string;
    evidence: Array<{ metric: string; text: string }>;
    causes: Array<{ name: string; prob: number; tag?: string }>;
    worsen_if_ignored?: {
      summary: string;
      horizon: string;
      risk_level: string;
    } | null;
    trend_24h: Record<string, Array<{ label: string; value: number }>>;
    action_steps?: string[];
    anomaly_windows?: Array<{
      start_index: number;
      end_index: number;
      start_label: string;
      end_label: string;
      level: string;
      label: string;
    }>;
    timeline_events?: Array<{
      step: number;
      at_index: number;
      at_label: string;
      kind: string;
      title: string;
      detail: string;
    }>;
    diagnostics?: {
      summary: string;
      rpm: number;
      f0_hz: number;
      channels: Array<{
        code: string;
        label: string;
        unit?: string;
        points: Array<{ f: number; amp: number }>;
      }>;
      markers?: Array<{ f: number; label: string; kind?: string }>;
      characteristic_bands: Array<{
        name: string;
        order?: number;
        freq_hz: number;
        amp: number;
        limit: number;
        unit: string;
        status: string;
        note?: string;
      }>;
      order_spectrum?: Array<{
        order: number;
        label: string;
        amp: number;
        baseline: number;
        unit: string;
      }>;
      waterfall?: {
        freq_hz: number[];
        time_labels: string[];
        grid: number[][];
        unit: string;
        highlight_freq_hz?: number;
        caption?: string;
      };
      metric_trends?: Array<{
        code: string;
        label: string;
        unit: string;
        points: Array<{ label: string; value: number }>;
      }>;
    };
  };
  future: {
    risk_24h: number;
    risk_72h: number;
    risk_7d: number;
    likely_fault: string;
    fault_type_probs: Array<{ name: string; prob: number }>;
    rul_days: number;
    rul_ci: [number, number];
    rul_range_label?: string;
    health_index?: number;
    health_band?: string;
    alert_level?: string;
    alert_label?: string;
    confidence?: string;
    confidence_label?: string;
    data_valid?: boolean;
    data_valid_reason?: string | null;
    prediction_paused?: boolean;
    maintain_by?: string | null;
    model_coverage?: string[];
    fault_coverage_wall?: FutureFaultCoverageWall;
    review_required?: boolean;
    attribution_top3?: FutureAttributionItem[];
    degradation_ratio?: number;
    degradation_week?: number[];
    degradation_label?: string;
    residual_score?: number;
    residual_label?: string;
    primary_cause?: string;
    downtime_planned_h?: number;
    downtime_unplanned_h?: number;
    downtime_avoidable_h?: number;
    downtime_planned_label?: string;
    downtime_unplanned_label?: string;
    downtime_avoidable_label?: string;
    downtime_hint?: string;
    threshold_profile?: string;
    threshold_options?: FutureThresholdOption[];
    similar_cases?: FutureSimilarCase[];
    backtest_summary?: string;
    decision_brief?: FutureDecisionBrief;
    avoid: string[];
    contingency: {
      steps: string;
      spares: string[];
      workorder_hint: string;
    };
  };
  optimize: {
    eligible: boolean;
    block_reason?: string;
    goal_options: Array<{ key: string; label: string; desc: string }>;
    constraints: Array<{ name: string; current: string; limit: string; ok: boolean }>;
    goal_scenarios: Record<
      string,
      { param_advice: string; delta: { output: string; power: string; risk: string } }
    >;
    strategy_table?: OptimizeStrategyRow[];
    current_run?: OptimizeCurrentRun;
    recommended_key?: string | null;
    recommended_reason?: string;
    decision_line?: string | null;
  };
  error?: string;
}

export interface OptimizeStrategyRow {
  key: string;
  label: string;
  desc?: string;
  output_pct?: number;
  energy_pct?: number;
  wear_pct?: number;
  output_label?: string;
  energy_label?: string;
  wear_label?: string;
  risk?: string;
  param_advice?: string;
  delta?: { output: string; power: string; risk: string };
  why?: string;
  steps?: string[];
  tradeoff?: string;
  est_power?: number;
  est_output?: number;
  recommended?: boolean;
}

export interface OptimizeCurrentRun {
  mode_label?: string;
  rpm?: number;
  power?: number;
  pressure?: number;
  temp?: number;
  vibration?: number;
  output_today?: number;
  energy_score?: number;
  health_index?: number;
  health_band?: string;
}

const deptParams = (deptId?: number) =>
  deptId != null ? { dept_id: deptId } : undefined;

export const fetchCollectPage = () => getData<CollectPageData>("/equipment-analysis/collect");
export const fetchDevicesPage = (deptId?: number) =>
  getData<DevicesPageData>("/equipment-analysis/devices", deptParams(deptId));
export const fetchDeviceDetail = (id: string) =>
  getData<DeviceDetailData>(`/equipment-analysis/devices/${id}`);
export const fetchCurrentAnalysis = (
  deptId?: number,
  deviceType?: string,
  groupBy = "auto",
) => {
  const params: Record<string, unknown> = { group_by: groupBy };
  if (deptId != null) params.dept_id = deptId;
  if (deviceType) params.device_type = deviceType;
  return getData<CurrentAnalysisPageData>("/equipment-analysis/analysis/current", params);
};
export const fetchFutureAnalysis = (deptId?: number) =>
  getData<AnalysisPageData>("/equipment-analysis/analysis/future", deptParams(deptId));
export const fetchOptimizeAnalysis = (deptId?: number, page = 1, pageSize = 10) => {
  const params: Record<string, unknown> = { page, page_size: pageSize };
  if (deptId != null) params.dept_id = deptId;
  return getData<AnalysisPageData>("/equipment-analysis/analysis/optimize", params);
};

export interface DiagnosisOverviewDevice extends DeviceListItem {
  run_bucket?: string;
  current_issue_count?: number;
  future_risk_count?: number;
  load_label?: string;
  current_one_liner?: string;
  future_one_liner?: string;
}

export interface DiagnosisEventItem {
  id: string;
  kind: "current" | "future" | string;
  kind_label: string;
  device_id: string;
  device_name: string;
  dept_name?: string;
  component: string;
  point: string;
  level: string;
  level_label: string;
  description: string;
  advice: string;
  handle_status: string;
  handle_status_label: string;
}

export interface DiagnosisOverviewData extends StatusMaps {
  title: string;
  subtitle?: string;
  note?: string;
  scope_label?: string;
  period?: string;
  period_label?: string;
  period_options?: Array<{ value: string; label: string }>;
  run_status_options?: Array<{ value: string; label: string }>;
  type_options?: string[];
  kpis: KpiItem[];
  health_distribution: Array<{
    key: string;
    label: string;
    count: number;
    color: string;
  }>;
  devices: DiagnosisOverviewDevice[];
  events: DiagnosisEventItem[];
  demo_items?: DeviceListItem[];
  updated_at?: string;
}

export const fetchDiagnosisOverview = (opts?: {
  deptId?: number;
  deviceType?: string;
  runStatus?: string;
  period?: string;
}) => {
  const params: Record<string, unknown> = {};
  if (opts?.deptId != null) params.dept_id = opts.deptId;
  if (opts?.deviceType) params.device_type = opts.deviceType;
  if (opts?.runStatus) params.run_status = opts.runStatus;
  if (opts?.period) params.period = opts.period;
  return getData<DiagnosisOverviewData>("/equipment-analysis/analysis/diagnosis", params);
};

export const fetchDeviceCompareTree = (deptId?: number) =>
  getData<DeviceTreePageData>("/equipment-analysis/analysis/devices/tree", deptParams(deptId));
export const fetchDeviceCompare = (deviceIds: string[], period: FleetStatusTrendPeriod = "year") =>
  getData<DeviceComparePageData>("/equipment-analysis/analysis/devices/compare", {
    device_ids: deviceIds.join(","),
    period,
  });
export const triggerCollectTick = () =>
  postData<{ ok: boolean; message: string; last_sample_at?: string; device_count: number }>(
    "/equipment-analysis/collect/tick",
  );
