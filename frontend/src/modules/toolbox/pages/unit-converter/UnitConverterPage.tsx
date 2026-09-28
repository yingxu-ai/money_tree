import { Button, Card, Col, Input, Row, Space, Tabs, Typography } from "antd";
import { useCallback, useMemo, useState } from "react";
import { PageHeader } from "@/components/kit";
import { formatConvertValue, fromBase, parseInputNumber, toBase } from "./convert";
import { CATEGORIES, type UnitKind } from "./units";

function emptyValues(kind: UnitKind): Record<string, string> {
  const cat = CATEGORIES.find((c) => c.kind === kind)!;
  const out: Record<string, string> = {};
  for (const u of cat.units) out[u.id] = "";
  return out;
}

export default function UnitConverterPage() {
  const [kind, setKind] = useState<UnitKind>("length");
  const [values, setValues] = useState<Record<string, string>>(() => emptyValues("length"));
  const [sourceId, setSourceId] = useState<string | null>(null);

  const category = useMemo(
    () => CATEGORIES.find((c) => c.kind === kind) ?? CATEGORIES[0],
    [kind],
  );

  const onCategoryChange = (key: string) => {
    const next = key as UnitKind;
    setKind(next);
    setValues(emptyValues(next));
    setSourceId(null);
  };

  const onUnitChange = useCallback(
    (unitId: string, raw: string) => {
      setSourceId(unitId);
      const cat = CATEGORIES.find((c) => c.kind === kind);
      if (!cat) return;

      const parsed = parseInputNumber(raw);
      if (parsed == null) {
        // 输入中或已清空：只更新当前格，清空其它
        const next = emptyValues(kind);
        next[unitId] = raw;
        setValues(next);
        return;
      }

      const src = cat.units.find((u) => u.id === unitId);
      if (!src) return;
      const base = toBase(kind, src, parsed);
      const next: Record<string, string> = {};
      for (const u of cat.units) {
        if (u.id === unitId) {
          next[u.id] = raw;
        } else {
          next[u.id] = formatConvertValue(fromBase(kind, u, base));
        }
      }
      setValues(next);
    },
    [kind],
  );

  const clearAll = () => {
    setValues(emptyValues(kind));
    setSourceId(null);
  };

  return (
    <div>
      <PageHeader
        title="单位换算"
        subtitle="纯前端计算。任意单位输入后，同分类其它单位自动换算。"
        extra={
          <Button onClick={clearAll}>清空</Button>
        }
      />

      <Card size="small">
        <Tabs
          activeKey={kind}
          onChange={onCategoryChange}
          items={CATEGORIES.map((c) => ({
            key: c.kind,
            label: c.title,
          }))}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: -4, marginBottom: 16 }}>
          基准：{category.baseLabel}
          {sourceId ? ` · 当前以「${category.units.find((u) => u.id === sourceId)?.name}」为源` : ""}
        </Typography.Paragraph>

        <Row gutter={[16, 12]}>
          {category.units.map((u) => (
            <Col key={u.id} xs={24} sm={12} md={8} lg={6}>
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                <Typography.Text>
                  {u.name}
                  <Typography.Text type="secondary">（{u.symbol}）</Typography.Text>
                </Typography.Text>
                <Input
                  value={values[u.id] ?? ""}
                  placeholder="输入数值"
                  inputMode="decimal"
                  onChange={(e) => onUnitChange(u.id, e.target.value)}
                  style={
                    sourceId === u.id
                      ? { borderColor: "#1677ff", boxShadow: "0 0 0 1px rgba(22,119,255,0.2)" }
                      : undefined
                  }
                />
              </Space>
            </Col>
          ))}
        </Row>
      </Card>
    </div>
  );
}
