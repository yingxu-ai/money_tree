import { Button, Space } from "antd";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/kit";
import { DiagnosisOverviewPane } from "@/modules/equipment-analysis/ui/DiagnosisOverviewPane";

/**
 * 分析诊断 = 单页总览（筛选 / KPI / 分布 / 设备 / 事件）。
 * 深度看单机「对照 / 证据 / 处置」；旧舰队看板 Tabs 已去掉。
 */
export default function AnalysisDiagnosisPage() {
  return (
    <div>
      <PageHeader
        title="分析诊断"
        subtitle="实测分析 + 预测判断 · 少设备深看 · 点进单机对照"
        extra={
          <Space>
            <Button>
              <Link to="/analysis/compare">设备对比</Link>
            </Button>
            <Button>
              <Link to="/devices">设备台账</Link>
            </Button>
          </Space>
        }
      />
      <DiagnosisOverviewPane />
    </div>
  );
}
