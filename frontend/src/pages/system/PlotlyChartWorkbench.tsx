import { BorderOutlined, CompressOutlined } from "@ant-design/icons";
import { Alert, Button, Space, Typography, message } from "antd";
import { useEffect, useRef, useState } from "react";
import type { PlotlyFigure } from "./fileChartBuilder";
import { usePlotly } from "./usePlotly";

interface Props {
  figure: PlotlyFigure | null;
  exportName: string;
  active: boolean;
  fullscreen?: boolean;
  emptyText?: string;
}

type DragMode = "zoom" | "pan";

interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

const VIEW_RESET: ViewTransform = { scale: 1, x: 0, y: 0 };

/**
 * 数据分析出图工作台（与多曲线对照同引擎）：
 * - 折线/柱/散点/直方图：Plotly 坐标框选 / 平移 / 滚轮
 * - 饼/平行/旭日：画布级伸缩平移（看清细节）+ 图本身交互（钻取/刷选）
 */
export default function PlotlyChartWorkbench({
  figure,
  exportName,
  active,
  fullscreen = false,
  emptyText = "请选择行列映射后出图",
}: Props) {
  const { plotly, error: plotlyError } = usePlotly();
  const chartRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>("zoom");
  const [maximized, setMaximized] = useState(false);
  const [view, setView] = useState<ViewTransform>(VIEW_RESET);
  const panRef = useRef<{
    active: boolean;
    lastX: number;
    lastY: number;
  }>({ active: false, lastX: 0, lastY: 0 });

  const cartesian = !!figure?.cartesian;
  const tall = fullscreen || maximized;
  const height = fullscreen
    ? "calc(100vh - 280px)"
    : tall
      ? "min(78vh, 720px)"
      : "min(62vh, 560px)";
  const minHeight = tall ? 520 : 420;

  // 换图时复位画布变换
  useEffect(() => {
    setView(VIEW_RESET);
  }, [figure]);

  const resetZoom = () => {
    if (!figure) return;
    if (cartesian) {
      if (!plotly || !chartRef.current) return;
      void plotly
        .relayout(chartRef.current, {
          "xaxis.autorange": true,
          "yaxis.autorange": true,
        })
        .then(() => message.success("已重置坐标范围"));
      return;
    }
    // 非笛卡尔：复位画布缩放；旭日再退回根层
    setView(VIEW_RESET);
    if (plotly && chartRef.current) {
      void plotly.restyle(chartRef.current, { level: "" }).catch(() => {
        /* 非旭日忽略 */
      });
    }
    message.success("已重置视图");
  };

  const setChartDragMode = (mode: DragMode) => {
    setDragMode(mode);
    if (cartesian && plotly && chartRef.current) {
      void plotly.relayout(chartRef.current, { dragmode: mode }).then(() => {
        message.info(
          mode === "zoom" ? "已切换：在图内拖框放大" : "已切换：在图内拖动平移",
          1.5,
        );
      });
      return;
    }
    message.info(
      mode === "zoom"
        ? "已切换：滚轮伸缩画布（看细节）"
        : "已切换：按住拖动画布平移",
      1.5,
    );
  };

  // —— 非笛卡尔：滚轮伸缩 ——
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !figure || cartesian) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY > 0 ? 0.9 : 1.12;
      setView((v) => {
        const next = Math.min(8, Math.max(0.35, v.scale * factor));
        // 以指针为缩放中心（相对舞台）
        const rect = stage.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const ratio = next / v.scale;
        return {
          scale: next,
          x: cx - (cx - v.x) * ratio,
          y: cy - (cy - v.y) * ratio,
        };
      });
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [figure, cartesian, active]);

  // —— 非笛卡尔：平移拖拽 ——
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !figure || cartesian) return;

    const onDown = (e: PointerEvent) => {
      if (dragMode !== "pan") return;
      if ((e.target as HTMLElement).closest(".modebar")) return;
      panRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
      stage.setPointerCapture(e.pointerId);
      stage.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      if (!panRef.current.active) return;
      const dx = e.clientX - panRef.current.lastX;
      const dy = e.clientY - panRef.current.lastY;
      panRef.current.lastX = e.clientX;
      panRef.current.lastY = e.clientY;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    };
    const onUp = (e: PointerEvent) => {
      if (!panRef.current.active) return;
      panRef.current.active = false;
      try {
        stage.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      stage.style.cursor = dragMode === "pan" ? "grab" : "default";
    };

    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    stage.style.cursor = dragMode === "pan" ? "grab" : "default";
    return () => {
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
    };
  }, [figure, cartesian, dragMode, active]);

  useEffect(() => {
    if (!active || !plotly || !chartRef.current) return;
    const t = window.setTimeout(() => {
      try {
        plotly.Plots.resize(chartRef.current!);
      } catch {
        /* ignore */
      }
    }, 80);
    return () => window.clearTimeout(t);
  }, [maximized, fullscreen, active, plotly, figure, view.scale]);

  useEffect(() => {
    if (!active || !plotly || !chartRef.current) return;
    if (!figure) {
      chartRef.current.innerHTML = "";
      return;
    }

    const layout = {
      ...figure.layout,
      ...(cartesian ? { dragmode: dragMode } : {}),
    };

    const config = {
      responsive: true,
      displaylogo: false,
      scrollZoom: cartesian,
      modeBarButtonsToRemove: ["lasso2d", "select2d"] as string[],
      toImageButtonOptions: {
        format: "png" as const,
        filename: exportName,
      },
    };

    void plotly.react(chartRef.current, figure.traces, layout, config).catch((e: unknown) => {
      console.error("Plotly 出图失败", e);
      message.error(e instanceof Error ? e.message : "出图失败");
    });
  }, [active, plotly, figure, dragMode, cartesian, exportName]);

  const tip = (() => {
    if (!figure) return "";
    if (cartesian) {
      return "滚轮缩放 · 拖框放大 / 平移 · 「重置缩放」还原 · 点击图例显隐 · 工具栏可导出 PNG";
    }
    const extra = figure.exploreTip ? ` · ${figure.exploreTip}` : "";
    return `滚轮伸缩画布 / 平移查看细节 · 「重置缩放」还原${extra} · 工具栏可导出 PNG`;
  })();

  return (
    <div>
      {plotlyError ? (
        <Alert type="error" showIcon message={plotlyError} style={{ marginBottom: 12 }} />
      ) : null}

      <Space wrap style={{ marginBottom: 12 }}>
        {figure ? (
          <>
            <Button
              type={dragMode === "zoom" ? "primary" : "default"}
              onClick={() => setChartDragMode("zoom")}
            >
              {cartesian ? "框选放大" : "滚轮伸缩"}
            </Button>
            <Button
              type={dragMode === "pan" ? "primary" : "default"}
              onClick={() => setChartDragMode("pan")}
            >
              平移
            </Button>
            <Button onClick={resetZoom}>重置缩放</Button>
          </>
        ) : null}
        {!fullscreen ? (
          <Button
            icon={maximized ? <CompressOutlined /> : <BorderOutlined />}
            onClick={() => setMaximized((v) => !v)}
          >
            {maximized ? "退出放大" : "图表放大"}
          </Button>
        ) : null}
      </Space>

      <div
        ref={stageRef}
        style={{
          height: figure ? height : minHeight,
          minHeight,
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #d5dee8",
          overflow: "hidden",
          position: "relative",
          display: figure ? undefined : "flex",
          alignItems: figure ? undefined : "center",
          justifyContent: figure ? undefined : "center",
          color: "#718096",
          userSelect: !cartesian && dragMode === "pan" ? "none" : undefined,
        }}
      >
        {!figure && !plotlyError ? (
          emptyText
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              transform: cartesian
                ? undefined
                : `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transformOrigin: "center center",
              willChange: cartesian ? undefined : "transform",
            }}
          >
            <div ref={chartRef} style={{ width: "100%", height: "100%" }} />
          </div>
        )}
      </div>

      <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0, fontSize: 12 }}>
        {tip}
      </Typography.Paragraph>
    </div>
  );
}
