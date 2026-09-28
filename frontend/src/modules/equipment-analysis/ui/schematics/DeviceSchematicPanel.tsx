import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, Col, Empty, Row, Space, Tag, Typography } from "antd";
import type { FutureAttributionItem } from "@/modules/equipment-analysis/api/equipmentAnalysis";
import { ChillerSvg } from "./ChillerSvg";
import { SCREW_COMPRESSOR_ASPECT, ScrewCompressorSvg } from "./ScrewCompressorSvg";
import { WaterPumpSvg } from "./WaterPumpSvg";
import { resolveHotspotViews, STATUS_STYLE, type HotspotView } from "./resolveHotspotStatus";
import { resolveSchematicDef } from "./types";

function SchematicCanvas({
  views,
  selectedId,
  onSelect,
  bg,
  aspectRatio = "1000 / 400",
}: {
  views: HotspotView[];
  selectedId?: string;
  onSelect: (id: string) => void;
  bg: ReactNode;
  aspectRatio?: string;
}) {
  return (
    <div style={{ position: "relative", width: "100%", borderRadius: 8, overflow: "hidden", background: "#f5f5f5" }}>
      <div style={{ width: "100%", aspectRatio }}>{bg}</div>
      {views.map((h) => {
        const st = STATUS_STYLE[h.status];
        const selected = selectedId === h.id;
        return (
          <button
            key={h.id}
            type="button"
            title={h.label}
            onClick={() => onSelect(h.id)}
            style={{
              position: "absolute",
              left: `${h.box.x}%`,
              top: `${h.box.y}%`,
              width: `${h.box.w}%`,
              height: `${h.box.h}%`,
              margin: 0,
              padding: 0,
              border: selected ? `2px solid #1677ff` : `1.5px ${h.status === "dashed" ? "dashed" : "solid"} ${st.stroke}`,
              borderRadius: 6,
              background: st.fill,
              cursor: "pointer",
              boxShadow: selected ? "0 0 0 2px rgba(22,119,255,0.35)" : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

function BgByType({ type }: { type: string }) {
  if (type === "螺杆压缩机") return <ScrewCompressorSvg />;
  if (type === "水泵") return <WaterPumpSvg />;
  if (type === "冷水机组") return <ChillerSvg />;
  return null;
}

export function DeviceSchematicPanel({
  deviceType,
  attribution,
  likelyFault,
  primaryCause,
  alertLevel,
  confidenceLabel,
  interactive = true,
}: {
  deviceType?: string;
  attribution?: FutureAttributionItem[];
  likelyFault?: string;
  primaryCause?: string;
  alertLevel?: string;
  confidenceLabel?: string;
  /** false 时仍可点查看说明，但不强调「处置」文案 */
  interactive?: boolean;
}) {
  const def = resolveSchematicDef(deviceType);
  const views = useMemo(
    () =>
      def
        ? resolveHotspotViews(def, { attribution, likelyFault, primaryCause, alertLevel })
        : [],
    [def, attribution, likelyFault, primaryCause, alertLevel],
  );

  const defaultId =
    views.find((v) => v.status === "red")?.id ??
    views.find((v) => v.status === "orange")?.id ??
    views[0]?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  useEffect(() => {
    setSelectedId(defaultId);
  }, [defaultId, deviceType]);

  const selected = views.find((v) => v.id === (selectedId ?? defaultId)) ?? views[0];

  if (!def) {
    return (
      <Card size="small" title="设备健康示意" style={{ marginBottom: 12 }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={`「${deviceType ?? "未知类型"}」示意开发中（当前支持：螺杆压缩机 / 水泵 / 冷水机组）`}
        />
      </Card>
    );
  }

  return (
    <Card
      size="small"
      title={def.title}
      style={{ marginBottom: 12 }}
      extra={
        <Space size={4} wrap>
          {(Object.keys(STATUS_STYLE) as (keyof typeof STATUS_STYLE)[])
            .filter((k) => k !== "dashed")
            .map((k) => (
              <Tag key={k} color={k === "red" ? "red" : k === "orange" ? "gold" : "default"}>
                {STATUS_STYLE[k].label}
              </Tag>
            ))}
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
        整站系统示意 · 点击色块查看部件。红=预测/归因命中 · 橙=关注 · 灰=已覆盖正常
        {deviceType === "螺杆压缩机" && interactive ? "（本机可点联动处置建议）" : "（预览）"}
      </Typography.Paragraph>
      <Row gutter={16}>
        <Col xs={24} lg={16}>
          <SchematicCanvas
            views={views}
            selectedId={selected?.id}
            onSelect={setSelectedId}
            bg={<BgByType type={def.type} />}
            aspectRatio={def.type === "螺杆压缩机" ? SCREW_COMPRESSOR_ASPECT : "1000 / 400"}
          />
        </Col>
        <Col xs={24} lg={8}>
          {selected ? (
            <div>
              <Space wrap style={{ marginBottom: 8 }}>
                <Typography.Text type="secondary">异常部件</Typography.Text>
                <Typography.Text strong>{selected.label}</Typography.Text>
                <Tag color={selected.status === "red" ? "red" : selected.status === "orange" ? "gold" : "default"}>
                  风险
                  {selected.status === "red" ? "高" : selected.status === "orange" ? "中" : "低"}
                </Tag>
                {selected.contribution_pct != null ? (
                  <Tag>贡献 {selected.contribution_pct}%</Tag>
                ) : null}
                {confidenceLabel ? <Tag>置信度 {confidenceLabel}</Tag> : null}
              </Space>
              <Typography.Paragraph style={{ marginBottom: 8 }}>
                {selected.status === "red" || selected.status === "orange"
                  ? selected.reason ?? "部件贡献命中当前预测。"
                  : "当前无异常命中，部件处于模型覆盖监视中。"}
              </Typography.Paragraph>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                依据 / 关联测点
              </Typography.Text>
              <div style={{ marginBottom: 8 }}>
                {selected.points.map((p) => (
                  <Tag key={p}>{p}</Tag>
                ))}
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                建议动作
              </Typography.Text>
              <Typography.Paragraph style={{ marginTop: 4, marginBottom: 0 }}>
                {selected.actionHint}
              </Typography.Paragraph>
            </div>
          ) : null}
        </Col>
      </Row>
    </Card>
  );
}
