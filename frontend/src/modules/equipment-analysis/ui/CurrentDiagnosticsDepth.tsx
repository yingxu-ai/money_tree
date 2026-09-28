import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Card, Col, Collapse, Row, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { LineChart } from "@/charts";
import type { MultidimPanelData } from "@/modules/equipment-analysis/ui/MultiDimDiagnosisPanel";

export interface DiagnosticChannel {
  code: string;
  label: string;
  unit?: string;
  points: Array<{ f: number; amp: number }>;
}

export interface CharacteristicBand {
  name: string;
  order?: number;
  freq_hz: number;
  amp: number;
  limit: number;
  unit: string;
  status: "normal" | "watch" | "abnormal" | string;
  note?: string;
}

export interface CurrentDiagnostics {
  summary: string;
  rpm: number;
  f0_hz: number;
  channels: DiagnosticChannel[];
  markers?: Array<{ f: number; label: string; kind?: string }>;
  characteristic_bands: CharacteristicBand[];
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
  multidim_panel?: MultidimPanelData;
}

const BAND_STATUS: Record<string, { color: string; text: string }> = {
  normal: { color: "green", text: "正常" },
  watch: { color: "orange", text: "关注" },
  abnormal: { color: "red", text: "异常" },
};

function SpectrumChart({
  channels,
  markers,
  height = 280,
  loading,
}: {
  channels: DiagnosticChannel[];
  markers?: CurrentDiagnostics["markers"];
  height?: number;
  loading?: boolean;
}) {
  const unit = channels[0]?.unit || "mm/s";
  const option: EChartsOption = {
    color: ["#1677ff", "#13c2c2", "#722ed1"],
    legend: { top: 0, data: channels.map((c) => c.label) },
    grid: { left: 48, right: 20, top: 36, bottom: 36 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => `${v}${unit}`,
    },
    xAxis: {
      type: "value",
      name: "Hz",
      nameLocation: "middle",
      nameGap: 24,
      min: 0,
      max: 400,
    },
    yAxis: {
      type: "value",
      name: unit,
      scale: true,
    },
    dataZoom: [
      { type: "inside", xAxisIndex: 0, filterMode: "none" },
      { type: "slider", xAxisIndex: 0, height: 18, bottom: 4 },
    ],
    series: [
      ...channels.map((ch, idx) => ({
        name: ch.label,
        type: "line" as const,
        showSymbol: false,
        sampling: "lttb" as const,
        data: ch.points.map((p) => [p.f, p.amp]),
        lineStyle: { width: 1.4 },
        emphasis: { focus: "series" as const },
        ...(idx === 0 && markers?.length
          ? {
              markLine: {
                silent: true,
                symbol: "none" as const,
                label: { position: "insideEndTop" as const },
                lineStyle: { type: "dashed" as const, color: "#8c8c8c", width: 1 },
                data: markers.map((m) => ({ xAxis: m.f, label: { formatter: m.label } })),
              },
            }
          : {}),
      })),
    ],
  };
  return (
    <ReactECharts option={option} showLoading={loading} style={{ height, width: "100%" }} notMerge lazyUpdate />
  );
}

function OrderBarChart({
  orders,
  height = 220,
  loading,
}: {
  orders: NonNullable<CurrentDiagnostics["order_spectrum"]>;
  height?: number;
  loading?: boolean;
}) {
  const unit = orders[0]?.unit || "mm/s";
  const colors = orders.map((o) => {
    if (o.amp > o.baseline * 2.2) return "#cf1322";
    if (o.amp > o.baseline * 1.5) return "#fa8c16";
    return "#1677ff";
  });
  const option: EChartsOption = {
    grid: { left: 44, right: 16, top: 28, bottom: 28 },
    tooltip: { trigger: "axis" },
    legend: { data: ["当前", "基线"] },
    xAxis: { type: "category", data: orders.map((o) => o.label) },
    yAxis: { type: "value", name: unit },
    series: [
      {
        name: "当前",
        type: "bar",
        data: orders.map((o, i) => ({ value: o.amp, itemStyle: { color: colors[i] } })),
      },
      {
        name: "基线",
        type: "bar",
        data: orders.map((o) => o.baseline),
        itemStyle: { color: "#d9d9d9" },
      },
    ],
  };
  return (
    <ReactECharts option={option} showLoading={loading} style={{ height, width: "100%" }} notMerge lazyUpdate />
  );
}

function WaterfallHeatmap({
  waterfall,
  height = 300,
  loading,
}: {
  waterfall: NonNullable<CurrentDiagnostics["waterfall"]>;
  height?: number;
  loading?: boolean;
}) {
  const { freq_hz, time_labels, grid, unit, highlight_freq_hz } = waterfall;
  const data: number[][] = [];
  let maxV = 0;
  for (let ti = 0; ti < time_labels.length; ti++) {
    const row = grid[ti] || [];
    for (let fi = 0; fi < freq_hz.length; fi++) {
      const v = row[fi] ?? 0;
      if (v > maxV) maxV = v;
      data.push([fi, ti, v]);
    }
  }
  const hiIdx =
    highlight_freq_hz != null
      ? freq_hz.reduce(
          (best, f, i) =>
            Math.abs(f - highlight_freq_hz) < Math.abs(freq_hz[best] - highlight_freq_hz) ? i : best,
          0,
        )
      : null;

  const option: EChartsOption = {
    grid: { left: 56, right: 48, top: 16, bottom: 40 },
    tooltip: {
      position: "top",
      formatter: (p: unknown) => {
        const item = p as { data?: number[] };
        const d = item.data;
        if (!d) return "";
        const [fi, ti, v] = d;
        return `${time_labels[ti]} · ${freq_hz[fi]} Hz<br/>${v} ${unit}`;
      },
    },
    xAxis: {
      type: "category",
      data: freq_hz.map(String),
      name: "Hz",
      nameLocation: "middle",
      nameGap: 22,
      axisLabel: {
        interval: Math.max(0, Math.floor(freq_hz.length / 8) - 1),
      },
    },
    yAxis: {
      type: "category",
      data: time_labels,
      name: "时间",
    },
    visualMap: {
      min: 0,
      max: Math.max(maxV, 0.1),
      calculable: true,
      orient: "vertical",
      right: 4,
      top: "middle",
      inRange: {
        color: ["#f0f5ff", "#69b1ff", "#1677ff", "#003eb3", "#cf1322"],
      },
      text: [unit, ""],
    },
    series: [
      {
        type: "heatmap",
        data,
        emphasis: { itemStyle: { shadowBlur: 4, shadowColor: "rgba(0,0,0,0.25)" } },
      },
      ...(hiIdx != null
        ? [
            {
              type: "line" as const,
              markLine: {
                silent: true,
                symbol: "none" as const,
                label: { formatter: "关注频段", color: "#cf1322" },
                lineStyle: { color: "#cf1322", type: "dashed" as const, width: 1.2 },
                data: [{ xAxis: String(freq_hz[hiIdx]) }],
              },
              data: [],
            },
          ]
        : []),
    ],
  };
  return (
    <ReactECharts option={option} showLoading={loading} style={{ height, width: "100%" }} notMerge lazyUpdate />
  );
}

export function CurrentDiagnosticsDepth({
  diagnostics,
  analysisStatus,
  loading,
}: {
  diagnostics?: CurrentDiagnostics | null;
  analysisStatus?: string;
  loading?: boolean;
}) {
  if (!diagnostics) return null;
  if (!diagnostics.channels?.length) return null;

  const defaultOpen = analysisStatus === "abnormal" || analysisStatus === "watch";
  const bandCols: ColumnsType<CharacteristicBand> = [
    { title: "特征", dataIndex: "name", key: "name", width: 140 },
    {
      title: "频率",
      key: "freq",
      width: 100,
      render: (_, r) => `${r.freq_hz} Hz`,
    },
    {
      title: "幅值",
      key: "amp",
      width: 110,
      render: (_, r) => (
        <span style={{ color: r.status === "abnormal" ? "#cf1322" : undefined, fontWeight: r.status === "abnormal" ? 600 : undefined }}>
          {r.amp} {r.unit}
        </span>
      ),
    },
    {
      title: "限值",
      key: "limit",
      width: 100,
      render: (_, r) => `${r.limit} ${r.unit}`,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 80,
      render: (s: string) => {
        const m = BAND_STATUS[s] ?? { color: "default", text: s };
        return <Tag color={m.color}>{m.text}</Tag>;
      },
    },
    { title: "说明", dataIndex: "note", ellipsis: true },
  ];

  const classicOpenKeys = defaultOpen
    ? ["waterfall2d", "orders", "metrics"]
    : ["orders"];

  if (!diagnostics.channels?.length) return null;

  return (
    <div id="ea-current-diagnostics">
      <Card
        size="small"
        style={{ marginBottom: 12 }}
        title={
          <Space wrap>
            <span>频谱与特征频段</span>
            <Tag>{diagnostics.rpm} rpm</Tag>
            <Tag>1× = {diagnostics.f0_hz} Hz</Tag>
          </Space>
        }
        loading={loading}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          {diagnostics.summary}
        </Typography.Paragraph>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={14}>
            <Typography.Text strong>频谱（可缩放 · 标 1×/2×）</Typography.Text>
            <SpectrumChart channels={diagnostics.channels} markers={diagnostics.markers} loading={loading} />
          </Col>
          <Col xs={24} xl={10}>
            <Typography.Text strong>特征频段 · 实际 / 限值 / 状态</Typography.Text>
            <Table
              size="small"
              pagination={false}
              rowKey="name"
              columns={bandCols}
              dataSource={diagnostics.characteristic_bands}
              style={{ marginTop: 8 }}
              rowClassName={(r) => (r.status === "abnormal" ? "ea-band-abnormal" : "")}
            />
          </Col>
        </Row>

        <Collapse
          style={{ marginTop: 12 }}
          defaultActiveKey={classicOpenKeys}
          items={[
            {
              key: "waterfall2d",
              label: diagnostics.waterfall?.caption || "时频瀑布 · 关注峰是否随时间抬升",
              children: diagnostics.waterfall ? (
                <WaterfallHeatmap waterfall={diagnostics.waterfall} loading={loading} />
              ) : (
                <Typography.Text type="secondary">暂无时频数据</Typography.Text>
              ),
            },
            {
              key: "orders",
              label: "阶次谱 · 1×～5× 相对基线",
              children: diagnostics.order_spectrum?.length ? (
                <OrderBarChart orders={diagnostics.order_spectrum} loading={loading} />
              ) : null,
            },
            {
              key: "metrics",
              label: "多测点近 24h（主机振动 / 轴承温度 / 电机电流 / 排气温度）",
              children: diagnostics.metric_trends?.length ? (
                <Row gutter={[12, 12]}>
                  {diagnostics.metric_trends.map((m) => (
                    <Col xs={24} md={8} key={m.code}>
                      <Typography.Text type="secondary">{m.label}</Typography.Text>
                      <LineChart data={m.points} unit={m.unit} height={160} loading={loading} />
                    </Col>
                  ))}
                </Row>
              ) : null,
            },
          ]}
        />
      </Card>
    </div>
  );
}
