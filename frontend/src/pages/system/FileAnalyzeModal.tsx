import { FullscreenExitOutlined, FullscreenOutlined } from "@ant-design/icons";
import { Alert, Button, Modal, Spin } from "antd";
import { useEffect, useState } from "react";
import {
  fetchFileAnalyze,
  type FileAnalyzeResult,
  type FileItem,
} from "@/api/files";
import FileChartBuilderPanel from "./FileChartBuilderPanel";

interface Props {
  file: FileItem | null;
  open: boolean;
  onClose: () => void;
}

export default function FileAnalyzeModal({ file, open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FileAnalyzeResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!open || !file) {
      setData(null);
      setLoadError(null);
      setFullscreen(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetchFileAnalyze(file.id)
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message || "分析失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, file]);

  return (
    <Modal
      title={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingRight: 28,
          }}
        >
          <span>{file ? `数据分析 · ${file.original_name}` : "数据分析"}</span>
          <Button
            type="text"
            size="small"
            icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            onClick={() => setFullscreen((v) => !v)}
          >
            {fullscreen ? "退出全屏" : "全屏"}
          </Button>
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={fullscreen ? "100vw" : "min(1180px, 96vw)"}
      destroyOnHidden
      centered={!fullscreen}
      style={
        fullscreen
          ? { top: 0, paddingBottom: 0, maxWidth: "100vw", margin: 0 }
          : undefined
      }
      styles={{
        body: {
          paddingTop: 8,
          height: fullscreen ? "calc(100vh - 56px)" : undefined,
          maxHeight: fullscreen ? "calc(100vh - 56px)" : "78vh",
          overflow: "auto",
        },
        content: fullscreen ? { borderRadius: 0, height: "100vh" } : undefined,
      }}
    >
      {loading ? (
        <div style={{ textAlign: "center", padding: 48 }}>
          <Spin tip="解析表格中…" />
        </div>
      ) : loadError ? (
        <Alert type="error" showIcon message={loadError} />
      ) : !data ? null : !data.grid ? (
        <Alert type="warning" showIcon message="未返回表格网格，请检查文件" />
      ) : (
        <FileChartBuilderPanel
          data={data}
          exportName={(file?.original_name || "chart").replace(/\.[^.]+$/, "")}
          active={open}
          fullscreen={fullscreen}
        />
      )}
    </Modal>
  );
}
