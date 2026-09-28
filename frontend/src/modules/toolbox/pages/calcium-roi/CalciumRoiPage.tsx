import { Card, Col, Form, Input, InputNumber, Row, Space, Table, Typography } from "antd";
import { useMemo, useState } from "react";
import { KpiRow } from "@/components/blocks";
import { PageHeader } from "@/components/kit";
import { calcCalciumRoi, pct, wan } from "./calc";
import { DEFAULT_CALCIUM_ROI_INPUTS } from "./defaults";
import type { CalciumRoiInputs } from "./types";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card size="small" title={title} style={{ marginBottom: 16 }}>
      {children}
    </Card>
  );
}

export default function CalciumRoiPage() {
  const [inputs, setInputs] = useState<CalciumRoiInputs>(DEFAULT_CALCIUM_ROI_INPUTS);
  const result = useMemo(() => calcCalciumRoi(inputs), [inputs]);

  return (
    <div>
      <PageHeader
        title="电石质检 ROI 测算"
        subtitle="算的是：按批定级卖对价，一年能多卖多少钱（相对「一天化验一次、多批共用一次结果」）。"
      />

      <KpiRow
        items={[
          {
            title: "年度可量化价值",
            value: result.totalValueWan,
            unit: "万元",
            ratio: `定级增值 ${wan(result.upliftWan)} + 人工释放 ${wan(result.laborReleaseWan)}`,
          },
          {
            title: "项目投资",
            value: inputs.investmentWan,
            unit: "万元",
          },
          {
            title: "静态回收期",
            value: result.paybackMonths == null ? "—" : result.paybackMonths,
            unit: result.paybackMonths == null ? undefined : "个月",
            ratio: result.paybackMonths != null ? `约 ${result.paybackMonths} 个月` : "请填写投资与价值",
          },
          {
            title: "质量覆盖率",
            value: `${pct(result.coverageManual)} → ${pct(result.coverageAi)}`,
            ratio: `化验 ${result.manualAnnualTests} → ${result.aiAnnualTests} 次/年`,
          },
        ]}
      />

      <Row gutter={16}>
        <Col xs={24} lg={10}>
          <Form
            layout="vertical"
            initialValues={DEFAULT_CALCIUM_ROI_INPUTS}
            onValuesChange={(_, all) => setInputs({ ...DEFAULT_CALCIUM_ROI_INPUTS, ...all })}
          >
            <Section title="① 生产与检测">
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="workshopCount" label="车间数量" rules={[{ required: true }]}>
                    <InputNumber min={1} max={20} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="batchesPerDay"
                    label="每天生产批次"
                    extra="售价按「批」定，不是按化验次数。"
                    rules={[{ required: true }]}
                  >
                    <InputNumber min={1} max={200} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="tonsPerBatch" label="每批产量（吨）" rules={[{ required: true }]}>
                    <InputNumber min={0.1} step={0.1} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="productionDays" label="年生产天数" rules={[{ required: true }]}>
                    <InputNumber min={1} max={366} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="manualTestsPerDay"
                    label="原人工化验（次/天）"
                    extra={`一次结果平均套用 ${result.batchesPerManualTest} 批`}
                  >
                    <InputNumber min={0} step={0.1} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="aiTestsPerDay" label="AI 分析（次/天）">
                    <InputNumber min={0} step={0.1} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="qcStaff" label="质检人员（人）">
                    <InputNumber min={0} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="laborCostWanPerPerson" label="人均综合成本（万元/年）">
                    <InputNumber min={0} step={0.1} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item name="investmentWan" label="项目投资（万元）">
                    <InputNumber min={0} step={1} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
              </Row>
            </Section>

            <Section title="② 质量等级与售价（元/吨）">
              <Row gutter={12}>
                <Col span={8}>
                  <Form.Item name="priceLow" label="低（发气量 <280）">
                    <InputNumber min={0} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="priceMid" label="中（280～300）">
                    <InputNumber min={0} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="priceHigh" label="高（>300）">
                    <InputNumber min={0} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
              </Row>
              <Table
                size="small"
                pagination={false}
                rowKey="key"
                dataSource={[
                  { key: "low", grade: "低", rev: result.batchRevenue.low },
                  { key: "mid", grade: "中", rev: result.batchRevenue.mid },
                  { key: "high", grade: "高", rev: result.batchRevenue.high },
                ]}
                columns={[
                  { title: "质量", dataIndex: "grade", width: 80 },
                  {
                    title: `每批销售额（${inputs.tonsPerBatch} 吨）`,
                    dataIndex: "rev",
                    render: (v: number) => `${v.toLocaleString()} 元`,
                  },
                ]}
              />
              <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                高−中价差 {result.gradeDiffHighMid} 元/吨；一批定错档少卖{" "}
                {(result.batchRevenue.high - result.batchRevenue.mid).toLocaleString()} 元。
              </Typography.Paragraph>
            </Section>

            <Section title="③ 错定级比例（相对生产批次）">
              <Form.Item
                name="misgradeHighToMidRate"
                label="高品按中品卖出的比例"
                extra={`分母是年生产 ${result.annualBatches.toLocaleString()} 批，不是年化验 ${result.manualAnnualTests.toLocaleString()} 次。`}
              >
                <InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} />
              </Form.Item>
              <Row gutter={12}>
                <Col span={8}>
                  <Form.Item name="aiShareLow" label="AI 低档占比">
                    <InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="aiShareMid" label="AI 中档占比">
                    <InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="aiShareHigh" label="AI 高档占比">
                    <InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="misgradeNote" label="口径备注">
                <Input.TextArea rows={2} placeholder="可选，补充现场口径" />
              </Form.Item>
            </Section>
          </Form>
        </Col>

        <Col xs={24} lg={14}>
          <Section title="人工 vs AI：次数 ≠ 批次">
            <Table
              size="small"
              pagination={false}
              rowKey="k"
              dataSource={[
                {
                  k: "prod",
                  metric: "年生产批次",
                  manual: `${result.annualBatches.toLocaleString()} 批`,
                  ai: `${result.annualBatches.toLocaleString()} 批`,
                },
                {
                  k: "tests",
                  metric: "年化验 / 分析次数",
                  manual: `${result.manualAnnualTests.toLocaleString()} 次`,
                  ai: `${result.aiAnnualTests.toLocaleString()} 次`,
                },
                {
                  k: "map",
                  metric: "一次结果代表几批",
                  manual: `${result.batchesPerManualTest} 批`,
                  ai: "按次/按批分析",
                },
                {
                  k: "cov",
                  metric: "质量检测覆盖率",
                  manual: pct(result.coverageManual),
                  ai: pct(result.coverageAi),
                },
              ]}
              columns={[
                { title: "指标", dataIndex: "metric" },
                { title: "原人工", dataIndex: "manual", width: 140 },
                { title: "AI", dataIndex: "ai", width: 160 },
              ]}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              人工每天化验 {inputs.manualTestsPerDay} 次、生产 {inputs.batchesPerDay}{" "}
              批，当天批次共用这一次定级；AI 每天分析 {inputs.aiTestsPerDay}{" "}
              次，可按批（或更密）定级卖价。
            </Typography.Paragraph>
          </Section>

          <Section title="错定级增值（高→中）">
            <Table
              size="small"
              pagination={false}
              rowKey="k"
              dataSource={[
                {
                  k: "0",
                  step: "年生产批次",
                  calc: `${inputs.batchesPerDay} 批/天 × ${inputs.productionDays} 天 × ${inputs.workshopCount} 车间`,
                  val: `${result.annualBatches.toLocaleString()} 批`,
                },
                {
                  k: "1",
                  step: "其中错定级批次",
                  calc: `${result.annualBatches.toLocaleString()} 批 × ${pct(inputs.misgradeHighToMidRate)}`,
                  val: `${result.misgradeBatches.toLocaleString()} 批`,
                },
                {
                  k: "2",
                  step: "对应吨位",
                  calc: `${result.misgradeBatches.toLocaleString()} × ${inputs.tonsPerBatch} 吨`,
                  val: `${result.misgradeTons.toLocaleString()} 吨`,
                },
                {
                  k: "3",
                  step: "年增值",
                  calc: `${result.misgradeTons.toLocaleString()} 吨 × ${result.gradeDiffHighMid} 元`,
                  val: wan(result.upliftWan),
                },
              ]}
              columns={[
                { title: "步骤", dataIndex: "step", width: 130 },
                { title: "计算", dataIndex: "calc" },
                { title: "结果", dataIndex: "val", width: 140 },
              ]}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              年化验只有 {result.manualAnnualTests.toLocaleString()}{" "}
              次，但每天那一次会套到 {result.batchesPerManualTest}{" "}
              批货上；错定级因此按「生产批次」计，才会出现{" "}
              {result.misgradeBatches.toLocaleString()} 批，而不是和{" "}
              {result.manualAnnualTests.toLocaleString()} 次化验比大小。
            </Typography.Paragraph>
          </Section>

          <Section title="AI 等级结构">
            <Table
              size="small"
              pagination={false}
              rowKey="g"
              dataSource={[
                {
                  g: "low",
                  name: "低",
                  share: pct(inputs.aiShareLow),
                  batches: result.aiGradeBatches.low,
                },
                {
                  g: "mid",
                  name: "中",
                  share: pct(inputs.aiShareMid),
                  batches: result.aiGradeBatches.mid,
                },
                {
                  g: "high",
                  name: "高",
                  share: pct(inputs.aiShareHigh),
                  batches: result.aiGradeBatches.high,
                },
              ]}
              columns={[
                { title: "档位", dataIndex: "name", width: 80 },
                { title: "占比", dataIndex: "share", width: 100 },
                { title: "年批次", dataIndex: "batches" },
              ]}
            />
          </Section>

          <Section title="ROI 汇总">
            <Table
              size="small"
              pagination={false}
              rowKey="k"
              dataSource={[
                { k: "a", item: "年生产批次", val: `${result.annualBatches.toLocaleString()} 批` },
                {
                  k: "b",
                  item: "原人工化验",
                  val: `${result.manualAnnualTests.toLocaleString()} 次/年`,
                },
                {
                  k: "c",
                  item: "AI 分析",
                  val: `${result.aiAnnualTests.toLocaleString()} 次/年`,
                },
                {
                  k: "d",
                  item: "质量覆盖率",
                  val: `${pct(result.coverageManual)} → ${pct(result.coverageAi)}`,
                },
                {
                  k: "e",
                  item: "高→中 错定级（占生产批次）",
                  val: pct(inputs.misgradeHighToMidRate),
                },
                {
                  k: "e2",
                  item: "错定级批次",
                  val: `${result.misgradeBatches.toLocaleString()} 批`,
                },
                { k: "f", item: "定级年增值", val: wan(result.upliftWan) },
                { k: "g", item: "人工工作量释放", val: wan(result.laborReleaseWan) },
                { k: "h", item: "年度可量化价值", val: wan(result.totalValueWan) },
                { k: "i", item: "项目投资", val: wan(inputs.investmentWan) },
                {
                  k: "j",
                  item: "静态投资回收期",
                  val: result.paybackMonths == null ? "—" : `约 ${result.paybackMonths} 个月`,
                },
              ]}
              columns={[
                { title: "项目", dataIndex: "item" },
                { title: "结果", dataIndex: "val", width: 200 },
              ]}
            />
            <Space direction="vertical" size={4} style={{ marginTop: 12 }}>
              {result.assumptions.map((a) => (
                <Typography.Text key={a} type="secondary" style={{ fontSize: 12 }}>
                  · {a}
                </Typography.Text>
              ))}
            </Space>
          </Section>
        </Col>
      </Row>
    </div>
  );
}
