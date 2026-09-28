import { Button, Space } from "antd";
import { useEffect, useRef } from "react";

export interface SignaturePadProps {
  onChange?: (dataUrl: string | null) => void;
  height?: number;
  resetKey?: string | number;
  /** 已有签字（重开确认时回显） */
  initialDataUrl?: string | null;
}

/**
 * 鼠标/触控手写签字板，导出 PNG dataURL。
 */
export default function SignaturePad({
  onChange,
  height = 160,
  resetKey,
  initialDataUrl,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const inkRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const setupCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.width, height);
    ctx.strokeStyle = "#1a202c";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  };

  const paintInitial = (dataUrl: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, rect.width, height);
      ctx.drawImage(img, 0, 0, rect.width, height);
      ctx.strokeStyle = "#1a202c";
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      inkRef.current = true;
      onChangeRef.current?.(canvas.toDataURL("image/png"));
    };
    img.src = dataUrl;
  };

  useEffect(() => {
    inkRef.current = false;
    setupCanvas();
    if (initialDataUrl && initialDataUrl.startsWith("data:image")) {
      paintInitial(initialDataUrl);
    } else {
      onChangeRef.current?.(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随 resetKey / 初始签字变化
  }, [resetKey, height, initialDataUrl]);

  const pos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const t = e.touches[0];
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const emit = () => {
    const canvas = canvasRef.current;
    if (!canvas || !inkRef.current) {
      onChangeRef.current?.(null);
      return;
    }
    onChangeRef.current?.(canvas.toDataURL("image/png"));
  };

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    inkRef.current = true;
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    emit();
  };

  const clear = () => {
    inkRef.current = false;
    setupCanvas();
    onChangeRef.current?.(null);
  };

  return (
    <div>
      <div
        style={{
          border: "1px dashed #cbd5e0",
          borderRadius: 8,
          background: "#fff",
          touchAction: "none",
          position: "relative",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height, display: "block", cursor: "crosshair", borderRadius: 8 }}
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
        />
      </div>
      <Space style={{ marginTop: 8 }}>
        <Button size="small" onClick={clear}>
          清空重签
        </Button>
        <span style={{ fontSize: 12, color: "#718096" }}>
          {initialDataUrl ? "已加载上次签字，可直接提交或清空重签" : "请用鼠标在框内签字"}
        </span>
      </Space>
    </div>
  );
}
