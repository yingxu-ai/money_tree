import { useCallback, useState } from "react";

import { Button, Col, Row, Segmented, Space, Tabs } from "antd";

import { Link } from "react-router-dom";

import type { FleetIssueViews, FleetStatusTrendPeriod, IssueViewTab } from "@/modules/equipment-analysis/api/equipmentAnalysis";

import { CockpitPanel, stretchCol, stretchWrap } from "@/modules/equipment-analysis/ui/CockpitPanel";

import { FleetDeptIssueTrendChart } from "@/modules/equipment-analysis/ui/FleetDeptIssueTrendChart";

import { FleetIssueDeviceTrendChart } from "@/modules/equipment-analysis/ui/FleetIssueDeviceTrendChart";



const PERIOD_OPTIONS: { label: string; value: FleetStatusTrendPeriod }[] = [

  { label: "周", value: "week" },

  { label: "月", value: "month" },

  { label: "季", value: "quarter" },

  { label: "年", value: "year" },

];



const TAB_ITEMS: { key: IssueViewTab; label: string }[] = [

  { key: "abnormal", label: "异常" },

  { key: "watch", label: "关注" },

  { key: "fault", label: "故障" },

  { key: "all", label: "合计" },

];



export function FleetIssueViewPanel({

  views,

  loading,

}: {

  views?: FleetIssueViews;

  loading?: boolean;

}) {

  const [tab, setTab] = useState<IssueViewTab>("abnormal");

  const [period, setPeriod] = useState<FleetStatusTrendPeriod>("week");

  const [activeDeviceIds, setActiveDeviceIds] = useState<string[]>([]);

  const slice = views?.[tab];

  const tabLabel = TAB_ITEMS.find((t) => t.key === tab)?.label ?? "";



  const onActiveKeysChange = useCallback((keys: string[]) => {

    setActiveDeviceIds(keys);

  }, []);



  const compareHref =

    activeDeviceIds.length > 0

      ? `/analysis/compare?ids=${activeDeviceIds.join(",")}&period=${period}`

      : "/analysis/compare";



  const periodExtra = (

    <Space wrap>

      <Button size="small" type="link">

        <Link to={compareHref}>对比高亮设备</Link>

      </Button>

      <Segmented

        size="small"

        options={PERIOD_OPTIONS}

        value={period}

        onChange={(v) => setPeriod(v as FleetStatusTrendPeriod)}

      />

    </Space>

  );



  return (

    <div style={{ marginBottom: 16 }}>

      <div

        style={{

          display: "flex",

          flexWrap: "wrap",

          alignItems: "center",

          justifyContent: "space-between",

          gap: 12,

          marginBottom: 12,

        }}

      >

        <Tabs

          activeKey={tab}

          onChange={(k) => setTab(k as IssueViewTab)}

          items={TAB_ITEMS.map((t) => ({ key: t.key, label: t.label }))}

          style={{ marginBottom: 0, flex: 1, minWidth: 280 }}

        />

        {periodExtra}

      </div>

      <Row gutter={16} align="stretch">

        <Col xs={24} lg={12} style={stretchCol}>

          <div style={stretchWrap}>

            <CockpitPanel title={`设备趋势 · ${tabLabel}`} loading={loading} bodyMinHeight={320}>

              <FleetIssueDeviceTrendChart

                data={slice?.device?.[period]}

                tab={tab}

                loading={loading}

                onActiveKeysChange={onActiveKeysChange}

              />

            </CockpitPanel>

          </div>

        </Col>

        <Col xs={24} lg={12} style={stretchCol}>

          <div style={stretchWrap}>

            <FleetDeptIssueTrendChart

              title={`部门趋势 · ${tabLabel}`}

              trends={slice?.dept}

              loading={loading}

              period={period}

              onPeriodChange={setPeriod}

              hidePeriodExtra

            />

          </div>

        </Col>

      </Row>

    </div>

  );

}


