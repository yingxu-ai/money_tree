/** 螺杆空压机整站 2D 系统示意图底图（用户选定参考图） */
export function ScrewCompressorSvg({ className }: { className?: string }) {
  return (
    <img
      className={className}
      src="/schematics/screw-compressor-package.png"
      alt="螺杆空压机整站结构示意"
      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#f5f5f5" }}
      draggable={false}
    />
  );
}

/** 底图像素比，供热区容器对齐 */
export const SCREW_COMPRESSOR_ASPECT = "1024 / 608";
