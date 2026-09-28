import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Card, Space, Tooltip } from "antd";
import { CloseOutlined, FullscreenOutlined } from "@ant-design/icons";
import {
  ChartZoomViewport,
  FullscreenZoomActions,
} from "@/modules/equipment-analysis/ui/ChartZoomViewport";

const BODY_MIN = 280;
const FS_HEADER = 52;
const FS_PAD = 24;

export type CockpitPanelChildren =
  | ReactNode
  | ((ctx: {
      height: number | string;
      fullscreen: boolean;
      /** 全屏滚轮缩放倍率；图表应按此重绘而非 CSS 拉伸 */
      viewScale?: number;
      width?: number;
    }) => ReactNode);

function useFullscreenChartHeight(open: boolean) {
  const [height, setHeight] = useState(() =>
    typeof window === "undefined" ? 640 : Math.max(320, window.innerHeight - FS_HEADER - FS_PAD),
  );

  useEffect(() => {
    if (!open) return;
    const update = () => setHeight(Math.max(320, window.innerHeight - FS_HEADER - FS_PAD));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);

  return height;
}

export function CockpitPanel({
  title,
  children,
  loading,
  extra,
  bodyMinHeight = BODY_MIN,
  fullscreenable = false,
}: {
  title: ReactNode;
  children: CockpitPanelChildren;
  loading?: boolean;
  extra?: ReactNode;
  bodyMinHeight?: number;
  /** 右上角全屏按钮；Esc / 关闭退出 */
  fullscreenable?: boolean;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const fsChartHeight = useFullscreenChartHeight(fullscreen);
  const panelHeight = bodyMinHeight;
  const zoomResetRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  const renderBody = (
    height: number | string,
    isFs: boolean,
    viewScale = 1,
    width?: number,
  ) =>
    typeof children === "function"
      ? children({ height, fullscreen: isFs, viewScale, width })
      : children;

  const headerExtra = (
    <Space size={8} wrap>
      {extra}
      {fullscreenable ? (
        <Tooltip title="全屏查看">
          <Button
            type="text"
            size="small"
            aria-label="全屏查看"
            icon={<FullscreenOutlined />}
            onClick={() => setFullscreen(true)}
          />
        </Tooltip>
      ) : null}
    </Space>
  );

  return (
    <>
      <Card
        size="small"
        title={title}
        extra={headerExtra}
        loading={loading}
        style={{ height: "100%", display: "flex", flexDirection: "column" }}
        styles={{
          body: {
            flex: 1,
            minHeight: bodyMinHeight,
            display: "flex",
            flexDirection: "column",
          },
        }}
      >
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {renderBody(panelHeight, false, 1)}
        </div>
      </Card>
      {fullscreenable && fullscreen
        ? createPortal(
            <div
              role="dialog"
              aria-modal
              aria-label={typeof title === "string" ? title : "全屏图表"}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 1100,
                background: "#fff",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  height: FS_HEADER,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "0 16px",
                  borderBottom: "1px solid #f0f0f0",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 16, minWidth: 0 }}>{title}</div>
                <Space size={8}>
                  {extra}
                  <FullscreenZoomActions resetRef={zoomResetRef} />
                  <Tooltip title="退出全屏（Esc）">
                    <Button
                      type="text"
                      aria-label="退出全屏"
                      icon={<CloseOutlined />}
                      onClick={() => setFullscreen(false)}
                    />
                  </Tooltip>
                </Space>
              </div>
              <div style={{ flex: 1, minHeight: 0, padding: 12, boxSizing: "border-box" }}>
                <ChartZoomViewport baseHeight={fsChartHeight} onResetRef={zoomResetRef}>
                  {({ height, width, scale }) => renderBody(height, true, scale, width)}
                </ChartZoomViewport>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export const stretchCol = { display: "flex" as const };
export const stretchWrap = {
  flex: 1,
  width: "100%",
  display: "flex" as const,
  flexDirection: "column" as const,
};
