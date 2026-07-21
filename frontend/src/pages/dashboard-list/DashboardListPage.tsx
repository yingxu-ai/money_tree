import { ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Col, Row, Spin, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchDashboards } from "@/api/system";
import { EmptyState, PageHeader, SearchBar, StatusTag } from "@/components/kit";
import type { DashboardItem } from "@/types";

const statusLabel: Record<string, string> = {
  online: "已发布",
  draft: "草稿",
  offline: "已下线",
};

export default function DashboardListPage() {
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<DashboardItem[]>([]);
  const [total, setTotal] = useState(0);

  const load = useCallback(
    async (kw = keyword) => {
      setLoading(true);
      try {
        const data = await fetchDashboards(1, 50, kw || undefined);
        setItems(data.items);
        setTotal(data.total);
      } finally {
        setLoading(false);
      }
    },
    [keyword],
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="驾驶舱"
        subtitle={`共 ${total} 个`}
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => load()}>
            刷新
          </Button>
        }
      />
      <SearchBar
        placeholder="搜索驾驶舱"
        onSearch={(v) => {
          setKeyword(v);
          load(v);
        }}
      />

      {loading ? (
        <div style={{ textAlign: "center", padding: 48 }}>
          <Spin />
        </div>
      ) : items.length === 0 ? (
        <EmptyState description="暂无驾驶舱" />
      ) : (
        <Row gutter={[16, 16]}>
          {items.map((item) => (
            <Col key={item.id} xs={24} sm={12} lg={8}>
              <Link to={`/dashboards/${item.id}`}>
                <Card
                  hoverable
                  title={item.name}
                  extra={<StatusTag value={item.status} labelMap={statusLabel} />}
                >
                  <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }}>
                    {item.description || "暂无描述"}
                  </Typography.Paragraph>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    更新于 {item.updated_at?.replace("T", " ").slice(0, 19)}
                  </Typography.Text>
                </Card>
              </Link>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
