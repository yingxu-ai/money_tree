/** 嵌入模式：无顶栏、无侧栏，仅内容区（给客户门户挂载） */
export default function EmbedShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="app-shell app-shell--embed"
      style={{
        minHeight: "100vh",
        background: "var(--ant-color-bg-layout, #f5f5f5)",
      }}
    >
      <div className="app-content app-thin-scroll" style={{ minHeight: "100vh", padding: 0 }}>
        {children}
      </div>
    </div>
  );
}
