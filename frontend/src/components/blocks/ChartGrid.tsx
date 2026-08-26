import { Card, Col, Row } from "antd";
import { BarChart, LineChart, PieChart, type ChartPoint } from "@/charts";

export type ChartBlockType = "line" | "bar" | "pie";

export interface ChartBlockItem {
  id: string;
  title: string;
  type: ChartBlockType;
  unit?: string;
  /** Ant Design 24 栅格，默认 12 */
  span?: number;
  points: ChartPoint[];
}

export interface ChartGridProps {
  items: ChartBlockItem[];
  loading?: boolean;
  height?: number;
}

function ChartBody({
  item,
  loading,
  height,
}: {
  item: ChartBlockItem;
  loading?: boolean;
  height: number;
}) {
  if (item.type === "bar") {
    return <BarChart data={item.points} unit={item.unit} height={height} loading={loading} />;
  }
  if (item.type === "pie") {
    return <PieChart data={item.points} height={height} loading={loading} />;
  }
  return <LineChart data={item.points} unit={item.unit} height={height} loading={loading} />;
}

/** 图表栅格：几列几张图由 JSON span / 数组长度决定。 */
export default function ChartGrid({ items, loading, height = 240 }: ChartGridProps) {
  if (!items.length) return null;

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      {items.map((item) => (
        <Col key={item.id} xs={24} lg={item.span ?? 12}>
          <Card size="small" title={item.title} loading={loading}>
            <ChartBody item={item} loading={loading} height={height} />
          </Card>
        </Col>
      ))}
    </Row>
  );
}
