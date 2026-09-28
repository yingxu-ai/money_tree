import { Alert, Button, Card, Col, Drawer, Row, Space, Table, Tabs, Tag, Tree, message } from "antd";
import type { DataNode } from "antd/es/tree";
import { useMemo, useState } from "react";
import { DataTable, PageHeader } from "@/components/kit";
import { fetchDepts } from "@/api/system";
import {
  fetchCollectPage,
  triggerCollectTick,
  type CollectPageData,
} from "@/modules/equipment-analysis/api/equipmentAnalysis";
import { useRequest } from "@/hooks/useRequest";
import type { DeptItem } from "@/types";

function toTreeData(nodes: DeptItem[]): DataNode[] {
  return nodes.map((n) => ({
    key: String(n.id),
    title: n.name,
    children: n.children?.length ? toTreeData(n.children) : undefined,
  }));
}

function collectDeptIds(node: DeptItem, acc: Set<number>) {
  acc.add(node.id);
  node.children?.forEach((c) => collectDeptIds(c, acc));
}

function findDeptSubtree(nodes: DeptItem[], id: number): DeptItem | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = n.children ? findDeptSubtree(n.children, id) : null;
    if (hit) return hit;
  }
  return null;
}

export default function CollectConfigPage() {
  const { data, loading, refresh } = useRequest(fetchCollectPage);
  const { data: depts } = useRequest(fetchDepts);
  const [deptKey, setDeptKey] = useState<string | undefined>();
  const [bindOpen, setBindOpen] = useState(false);
  const [activeBind, setActiveBind] = useState<CollectPageData["bindings"][0] | null>(null);
  const [ticking, setTicking] = useState(false);

  const deptFilterIds = useMemo(() => {
    if (!deptKey || !depts?.length) return null;
    const sub = findDeptSubtree(depts, Number(deptKey));
    if (!sub) return null;
    const ids = new Set<number>();
    collectDeptIds(sub, ids);
    return ids;
  }, [deptKey, depts]);

  const bindings = useMemo(() => {
    const items = data?.bindings ?? [];
    if (!deptFilterIds) return items;
    return items.filter((b) => deptFilterIds.has(b.dept_id));
  }, [data?.bindings, deptFilterIds]);

  const categoryLabel = useMemo(() => {
    const m: Record<string, string> = {};
    data?.point_categories?.forEach((c) => {
      m[c.key] = c.label;
    });
    return m;
  }, [data?.point_categories]);

  return (
    <div>
      <PageHeader
        title={data?.title ?? "采集配置"}
        subtitle={data?.subtitle}
        extra={
          <Space>
            <Button
              loading={ticking}
              onClick={async () => {
                setTicking(true);
                try {
                  const res = await triggerCollectTick();
                  message.success(res.message);
                  await refresh();
                } finally {
                  setTicking(false);
                }
              }}
            >
              触发一轮采集
            </Button>
            <Button onClick={() => void refresh()} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      />

      {data?.note ? (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={data.note} />
      ) : null}

      <Row gutter={16}>
        <Col xs={24} md={6}>
          <Card size="small" title="部门（系统同源）" loading={!depts}>
            <Tree
              treeData={toTreeData(depts ?? [])}
              selectedKeys={deptKey ? [deptKey] : []}
              onSelect={(keys) => setDeptKey(keys[0] ? String(keys[0]) : undefined)}
              defaultExpandAll
            />
            {deptKey ? (
              <Button type="link" size="small" onClick={() => setDeptKey(undefined)} style={{ paddingLeft: 0 }}>
                清除筛选
              </Button>
            ) : null}
          </Card>
        </Col>
        <Col xs={24} md={18}>
          <Card size="small">
            <Tabs
              items={[
                {
                  key: "sources",
                  label: "采集源",
                  children: (
                    <DataTable
                      rowKey="id"
                      loading={loading}
                      dataSource={data?.sources ?? []}
                      pagination={false}
                      columns={[
                        { title: "名称", dataIndex: "name" },
                        {
                          title: "类型",
                          dataIndex: "kind",
                          render: (v) => (v === "simulator" ? "采集器" : String(v)),
                        },
                        { title: "间隔(秒)", dataIndex: "interval_sec" },
                        {
                          title: "启用",
                          dataIndex: "enabled",
                          render: (v) => (v ? <Tag color="green">是</Tag> : <Tag>否</Tag>),
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: "points",
                  label: "测点",
                  children: (
                    <DataTable
                      rowKey="id"
                      loading={loading}
                      dataSource={data?.points ?? []}
                      pagination={false}
                      columns={[
                        { title: "编码", dataIndex: "code" },
                        { title: "名称", dataIndex: "name" },
                        { title: "单位", dataIndex: "unit" },
                        {
                          title: "分类",
                          dataIndex: "category",
                          render: (v) => categoryLabel[String(v)] ?? String(v),
                        },
                        { title: "所属采集源", dataIndex: "source_id" },
                      ]}
                    />
                  ),
                },
                {
                  key: "bindings",
                  label: "设备绑定",
                  children: (
                    <DataTable
                      rowKey="id"
                      loading={loading}
                      dataSource={bindings}
                      pagination={false}
                      columns={[
                        { title: "设备", dataIndex: "name" },
                        { title: "编码", dataIndex: "code" },
                        { title: "部门", dataIndex: "dept_name" },
                        { title: "已绑测点数", dataIndex: "point_count" },
                        { title: "最近采样", dataIndex: "last_sample_at" },
                        {
                          title: "操作",
                          key: "op",
                          render: (_, row) => (
                            <Button
                              type="link"
                              size="small"
                              onClick={() => {
                                setActiveBind(row);
                                setBindOpen(true);
                              }}
                            >
                              查看测点
                            </Button>
                          ),
                        },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Drawer
        title={activeBind ? `${activeBind.name} · 已绑测点` : "测点"}
        open={bindOpen}
        onClose={() => setBindOpen(false)}
        width={420}
      >
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={(data?.points ?? []).filter((p) => activeBind?.point_ids.includes(p.id))}
          columns={[
            { title: "名称", dataIndex: "name" },
            { title: "编码", dataIndex: "code" },
            { title: "单位", dataIndex: "unit" },
            {
              title: "分类",
              dataIndex: "category",
              render: (v) => categoryLabel[String(v)] ?? String(v),
            },
          ]}
        />
      </Drawer>
    </div>
  );
}
