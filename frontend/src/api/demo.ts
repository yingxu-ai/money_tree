import { getData } from "@/api/client";
import type { ChartBlockItem, FeedItem, KpiItem } from "@/components/blocks";

export interface DemoOverviewData {
  title: string;
  subtitle?: string;
  kpis: KpiItem[];
  charts: ChartBlockItem[];
  feed: FeedItem[];
}

export interface DemoQueryTableItem {
  id: number;
  code: string;
  name: string;
  dept: string;
  status: string;
  owner: string;
  updated_at: string;
}

export interface DemoQueryTableData {
  title: string;
  subtitle?: string;
  keyword_placeholder?: string;
  items: DemoQueryTableItem[];
}

export const fetchDemoOverview = () => getData<DemoOverviewData>("/demo/overview");

export const fetchDemoQueryTable = () => getData<DemoQueryTableData>("/demo/query-table");
