import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Button, Space, Tooltip } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

const MIN_SCALE = 1;
const MAX_SCALE = 6;

/** 滚轮真实放大画布并重新渲染图表（非 CSS 拉伸），拖拽平移，一键恢复 */
export function ChartZoomViewport({
  baseHeight,
  children,
  onResetRef,
}: {
  baseHeight: number;
  children: (ctx: { height: number; width: number; scale: number }) => ReactNode;
  onResetRef?: MutableRefObject<(() => void) | null>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [baseWidth, setBaseWidth] = useState(0);
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  scaleRef.current = scale;
  offsetRef.current = offset;

  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  useEffect(() => {
    if (onResetRef) onResetRef.current = reset;
    return () => {
      if (onResetRef) onResetRef.current = null;
    };
  }, [onResetRef]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const sync = () => setBaseWidth(el.clientWidth);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const prev = scaleRef.current;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((prev * factor).toFixed(3))));
      if (next === prev) return;

      const ox = offsetRef.current.x;
      const oy = offsetRef.current.y;
      const nx = mx - ((mx - ox) * next) / prev;
      const ny = my - ((my - oy) * next) / prev;
      setScale(next);
      setOffset(next === 1 ? { x: 0, y: 0 } : { x: nx, y: ny });
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (scaleRef.current <= 1) return;
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        tx: offsetRef.current.x,
        ty: offsetRef.current.y,
      };
      el.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!drag.current) return;
      setOffset({
        x: drag.current.tx + (e.clientX - drag.current.x),
        y: drag.current.ty + (e.clientY - drag.current.y),
      });
    };

    const onPointerUp = () => {
      drag.current = null;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  const width = Math.max(1, Math.round((baseWidth || 800) * scale));
  const height = Math.max(1, Math.round(baseHeight * scale));
  const zoomed = scale !== 1 || offset.x !== 0 || offset.y !== 0;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 0 }}>
      <div
        ref={wrapRef}
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          cursor: scale > 1 ? "grab" : "default",
          touchAction: "none",
          userSelect: "none",
          background: "#fafafa",
        }}
      >
        <div
          style={{
            width,
            height,
            transform: `translate(${offset.x}px, ${offset.y}px)`,
            willChange: "transform",
          }}
        >
          {baseWidth > 0 ? children({ height, width, scale }) : null}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 8,
          bottom: 8,
          display: "flex",
          alignItems: "center",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: "rgba(0,0,0,0.45)",
            background: "rgba(255,255,255,0.92)",
            padding: "2px 8px",
            borderRadius: 4,
          }}
        >
          滚轮放大重绘
          {scale !== 1 ? ` · ${Math.round(scale * 100)}%` : ""}
          {scale > 1 ? " · 拖拽平移" : ""}
        </span>
        <span style={{ pointerEvents: "auto" }}>
          <Tooltip title="恢复默认视图">
            <Button size="small" icon={<ReloadOutlined />} disabled={!zoomed} onClick={reset}>
              恢复
            </Button>
          </Tooltip>
        </span>
      </div>
    </div>
  );
}

export function FullscreenZoomActions({
  resetRef,
}: {
  resetRef: MutableRefObject<(() => void) | null>;
}) {
  return (
    <Space size={8}>
      <Tooltip title="恢复默认缩放与位置">
        <Button size="small" icon={<ReloadOutlined />} onClick={() => resetRef.current?.()}>
          恢复
        </Button>
      </Tooltip>
    </Space>
  );
}
