import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Alert, Button, Card, Col, Descriptions, List, Radio, Row, Space, Table, Tag, Typography } from "antd";
import type { DeviceDetailData } from "@/modules/equipment-analysis/api/equipmentAnalysis";
import type { DeviceDetailTab } from "@/modules/equipment-analysis/ui/deviceNav";

const RISK_COLOR: Record<string, string> = {
  最低: "green",
  低: "green",
  中: "gold",
  高: "red",
};

export function OptimizeDevicePanel({
  data,
  goalKey,
  onGoalChange,
  onOpenTab,
  loading,
}: {
  data?: DeviceDetailData;
  goalKey: string;
  onGoalChange: (key: string) => void;
  onOpenTab?: (tab: DeviceDetailTab) => void;
  loading?: boolean;
}) {
  const opt = data?.optimize;
  const table = opt?.strategy_table ?? [];
  const selected = table.find((r) => r.key === goalKey);
  const current = opt?.current_run;
  const recKey = opt?.recommended_key;

  const chartOption: EChartsOption = useMemo(() => {
    if (!table.length) return {};
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0 },
      grid: { left: 48, right: 16, top: 36, bottom: 28 },
      xAxis: { type: "category", data: table.map((r) => r.label) },
      yAxis: { type: "value", name: "%", axisLabel: { formatter: "{value}%" } },
      series: [
        {
          name: "产量",
          type: "bar",
          data: table.map((r) => r.output_pct ?? 0),
          itemStyle: { color: "#1677ff" },
        },
        {
          name: "能耗",
          type: "bar",
          data: table.map((r) => r.energy_pct ?? 0),
          itemStyle: { color: "#52c41a" },
        },
        {
          name: "寿命损耗",
          type: "bar",
          data: table.map((r) => r.wear_pct ?? 0),
          itemStyle: { color: "#fa8c16" },
        },
      ],
    };
  }, [table]);

  return (
    <div>
      {!opt?.eligible ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={opt?.block_reason ?? "暂不可调优"}
          description="先处置异常或恢复采集，再回到本页选策略。"
          action={
            onOpenTab ? (
              <Space direction="vertical">
                <Button size="small" onClick={() => onOpenTab("current")}>
                  看证据
                </Button>
                <Button size="small" onClick={() => onOpenTab("future")}>
                  看处置
                </Button>
              </Space>
            ) : null
          }
        />
      ) : null}

      {opt?.decision_line ? (
        <Card
          size="small"
          title="AI 运行建议"
          extra={
            recKey ? (
              <Tag color="blue">推荐 {table.find((r) => r.key === recKey)?.label ?? recKey}</Tag>
            ) : null
          }
          loading={loading}
          style={{ marginBottom: 12 }}
        >
          <Typography.Paragraph strong style={{ marginBottom: 8 }}>
            {opt.decision_line}
          </Typography.Paragraph>
          <Typography.Text type="secondary">{opt.recommended_reason}</Typography.Text>
        </Card>
      ) : null}

      <Card size="small" title="当前运行状态" loading={loading} style={{ marginBottom: 12 }}>
        <Descriptions column={{ xs: 2, md: 4 }} size="small">
          <Descriptions.Item label="当前模式">{current?.mode_label ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="产量">{current?.output_today ?? data?.output_today ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="功率">
            {current?.power != null ? `${current.power} kW` : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="健康度">{current?.health_index ?? data?.future?.health_index ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="能耗分">{current?.energy_score ?? data?.energy_score ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="转速">{current?.rpm != null ? `${current.rpm} rpm` : "—"}</Descriptions.Item>
          <Descriptions.Item label="排气压力">
            {current?.pressure != null ? `${current.pressure} MPa` : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="轴承温度">{current?.temp != null ? `${current.temp} ℃` : "—"}</Descriptions.Item>
          <Descriptions.Item label="主机振动">{current?.vibration != null ? `${current.vibration} mm/s` : "—"}</Descriptions.Item>
        </Descriptions>
      </Card>

      {opt?.eligible ? (
        <>
          <Card
            size="small"
            title="运行策略对照"
            loading={loading}
            style={{ marginBottom: 12 }}
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                点击行选择 · 建议不下发 PLC
              </Typography.Text>
            }
          >
            <Table
              size="small"
              rowKey="key"
              pagination={false}
              dataSource={table}
              rowClassName={(row) => (row.key === goalKey ? "ant-table-row-selected" : "")}
              onRow={(row) => ({
                onClick: () => onGoalChange(row.key),
                style: { cursor: "pointer" },
              })}
              columns={[
                {
                  title: "策略",
                  dataIndex: "label",
                  render: (v, row) => (
                    <span>
                      <Typography.Text strong={row.key === goalKey}>{String(v)}</Typography.Text>
                      {row.recommended ? (
                        <Tag color="green" style={{ marginLeft: 8 }}>
                          推荐
                        </Tag>
                      ) : null}
                      {row.key === goalKey ? (
                        <Tag color="blue" style={{ marginLeft: 8 }}>
                          已选
                        </Tag>
                      ) : null}
                    </span>
                  ),
                },
                { title: "产量", dataIndex: "output_label", width: 90 },
                { title: "能耗", dataIndex: "energy_label", width: 90 },
                { title: "寿命损耗", dataIndex: "wear_label", width: 100 },
                {
                  title: "风险",
                  dataIndex: "risk",
                  width: 80,
                  render: (v) => <Tag color={RISK_COLOR[String(v)] ?? "default"}>{String(v)}</Tag>,
                },
              ]}
            />
            <Radio.Group
              optionType="button"
              value={goalKey}
              onChange={(e) => onGoalChange(e.target.value)}
              options={(opt?.goal_options ?? []).map((g) => ({
                label: g.label,
                value: g.key,
              }))}
              style={{ marginTop: 12, marginBottom: 12 }}
            />
            {table.length ? (
              <ReactECharts option={chartOption} style={{ height: 240, width: "100%" }} notMerge lazyUpdate />
            ) : null}
          </Card>

          {selected ? (
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col xs={24} lg={14}>
                <Card size="small" title={`若执行「${selected.label}」`}>
                  <Typography.Paragraph>{selected.why}</Typography.Paragraph>
                  <Descriptions column={1} size="small">
                    <Descriptions.Item label="建议参数">{selected.param_advice || "—"}</Descriptions.Item>
                    <Descriptions.Item label="预计功率">
                      {selected.est_power != null ? `${selected.est_power} kW` : selected.delta?.power ?? "—"}
                    </Descriptions.Item>
                    <Descriptions.Item label="预计产量">
                      {selected.est_output != null ? selected.est_output : selected.delta?.output ?? "—"}
                    </Descriptions.Item>
                    <Descriptions.Item label="取舍">{selected.tradeoff || selected.delta?.risk || "—"}</Descriptions.Item>
                  </Descriptions>
                  <Typography.Title level={5} style={{ marginTop: 12 }}>
                    怎么做
                  </Typography.Title>
                  <List
                    size="small"
                    dataSource={selected.steps ?? []}
                    renderItem={(t, i) => (
                      <List.Item>
                        {i + 1}. {t}
                      </List.Item>
                    )}
                  />
                </Card>
              </Col>
              <Col xs={24} lg={10}>
                <Card size="small" title="相对当前">
                  <Descriptions column={1} size="small">
                    <Descriptions.Item label="产量">{selected.output_label}</Descriptions.Item>
                    <Descriptions.Item label="能耗">{selected.energy_label}</Descriptions.Item>
                    <Descriptions.Item label="寿命损耗">{selected.wear_label}</Descriptions.Item>
                    <Descriptions.Item label="风险">
                      <Tag color={RISK_COLOR[selected.risk ?? ""] ?? "default"}>{selected.risk ?? "—"}</Tag>
                    </Descriptions.Item>
                  </Descriptions>
                  {recKey && goalKey !== recKey ? (
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginTop: 12 }}
                      message="与系统推荐不同"
                      description="可按生产需要改选；系统推荐见上卡「AI 运行建议」。"
                    />
                  ) : null}
                </Card>
              </Col>
            </Row>
          ) : (
            <Typography.Text type="secondary">暂无场景数据</Typography.Text>
          )}
        </>
      ) : null}

      {opt?.constraints?.length ? (
        <Card size="small" title="硬约束" style={{ marginBottom: 12 }}>
          <Descriptions column={{ xs: 1, md: 2 }} size="small">
            {opt.constraints.map((c) => (
              <Descriptions.Item key={c.name} label={c.name}>
                {c.current} / {c.limit}{" "}
                <Tag color={c.ok ? "green" : "red"}>{c.ok ? "满足" : "越限"}</Tag>
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      ) : null}

      <Alert
        type="warning"
        showIcon
        message="纪律"
        description="建议须工艺授权后在现场 HMI 执行；本系统不下发 PLC。"
      />
    </div>
  );
}
