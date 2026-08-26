import { Button, Space } from "antd";
import { ChartGrid, KpiRow, ScrollFeed } from "@/components/blocks";
import { PageHeader } from "@/components/kit";
import { fetchDemoOverview } from "@/api/demo";
import { useRequest } from "@/hooks/useRequest";

/**
 * Overview 骨架范本：KPI → 图表栅格 → 滚动动态。
 * 新 Demo：复制本文件 → 改路由/菜单 → 改 fixtures/overview.json（或换真实接口）。
 */
export default function OverviewTemplatePage() {
  const { data, loading, refresh } = useRequest(fetchDemoOverview);

  return (
    <div>
      <PageHeader
        title={data?.title ?? "总览范本"}
        subtitle={data?.subtitle ?? "加载中…"}
        extra={
          <Space>
            <Button onClick={() => void refresh()} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      />
      <KpiRow items={data?.kpis ?? []} loading={loading && !data} />
      <ChartGrid items={data?.charts ?? []} loading={loading && !data} />
      <ScrollFeed items={data?.feed ?? []} loading={loading && !data} />
    </div>
  );
}
