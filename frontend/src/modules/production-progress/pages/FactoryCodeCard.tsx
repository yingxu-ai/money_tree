import { DownloadOutlined, QrcodeOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Space, Typography, theme } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { notifyError } from "@/components/kit/feedback";
import { getAccessToken } from "@/utils/tokenStorage";
import { getOperatingTenantId } from "@/utils/operatingTenantStorage";
import {
  FACTORY_WXACODE_URL,
  fetchFactoryCodeInfo,
  type FactoryCodeInfo,
} from "../api/progress";

/**
 * 基础信息顶栏：本厂车间厂码。工人界面不展示短码入口；短码仅供运营制码。
 */
export default function FactoryCodeCard() {
  const { token } = theme.useToken();
  const [info, setInfo] = useState<FactoryCodeInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const imgUrlRef = useRef<string | null>(null);

  const revokeImg = useCallback(() => {
    if (imgUrlRef.current) {
      URL.revokeObjectURL(imgUrlRef.current);
      imgUrlRef.current = null;
    }
    setImgUrl(null);
  }, []);

  const loadWxacode = useCallback(async () => {
    setImgError(null);
    revokeImg();
    const access = getAccessToken();
    const headers: Record<string, string> = {};
    if (access) headers.Authorization = `Bearer ${access}`;
    const op = getOperatingTenantId();
    if (op != null) headers["X-Operating-Tenant-Id"] = String(op);

    try {
      const res = await fetch(FACTORY_WXACODE_URL, { headers });
      if (!res.ok) {
        let msg = "无法生成小程序码";
        try {
          const body = await res.json();
          msg = body?.message || msg;
        } catch {
          /* ignore */
        }
        setImgError(msg);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      imgUrlRef.current = url;
      setImgUrl(url);
    } catch (err) {
      setImgError(err instanceof Error ? err.message : "网络异常");
    }
  }, [revokeImg]);

  const loadInfo = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchFactoryCodeInfo();
      setInfo(data);
      if (data.wxacode_ready) {
        await loadWxacode();
      } else {
        revokeImg();
        setImgError(null);
      }
    } catch (err) {
      notifyError(err, "加载厂码失败");
      setInfo(null);
      revokeImg();
    } finally {
      setLoading(false);
    }
  }, [loadWxacode, revokeImg]);

  useEffect(() => {
    void loadInfo();
    return () => {
      if (imgUrlRef.current) {
        URL.revokeObjectURL(imgUrlRef.current);
        imgUrlRef.current = null;
      }
    };
  }, [loadInfo]);

  const downloadPng = () => {
    if (!imgUrl || !info) return;
    const a = document.createElement("a");
    a.href = imgUrl;
    a.download = `车间厂码-${info.tenant_name || "factory"}.png`;
    a.click();
  };

  return (
    <Card
      size="small"
      loading={loading && !info}
      style={{ marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
      title={
        <Space>
          <QrcodeOutlined />
          <span>车间厂码</span>
        </Space>
      }
      extra={
        <Button type="link" size="small" icon={<ReloadOutlined />} onClick={() => void loadInfo()}>
          刷新
        </Button>
      }
    >
      {info ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 24,
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: "1 1 280px", minWidth: 240 }}>
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              <Typography.Text type="secondary">车间</Typography.Text>
              <br />
              <Typography.Text strong style={{ fontSize: 16 }}>
                {info.tenant_name}
              </Typography.Text>
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              {info.tip || "请用微信扫一扫扫描小程序码；贴在车间入口。工人无需填写租户。"}
            </Typography.Paragraph>
            {!info.wxacode_ready ? (
              <Alert
                type="warning"
                showIcon
                message="未配置微信小程序凭据"
                description={
                  <div>
                    <div>
                      可在微信公众平台用下列参数手动生成「小程序码」，再打印张贴：
                    </div>
                    <div style={{ marginTop: 8, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                      <div>页面路径：{info.mp_page || "—"}</div>
                      <div>scene：{info.scene || "—"}</div>
                    </div>
                  </div>
                }
              />
            ) : imgError ? (
              <Alert type="error" showIcon message={imgError} />
            ) : (
              <Space>
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  disabled={!imgUrl}
                  onClick={downloadPng}
                >
                  下载小程序码
                </Button>
                <Button onClick={() => window.print()}>打印本页</Button>
              </Space>
            )}
          </div>
          {info.wxacode_ready && imgUrl ? (
            <div
              style={{
                padding: 12,
                background: token.colorBgLayout,
                borderRadius: 8,
                border: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <img
                src={imgUrl}
                alt="车间厂码"
                style={{ width: 180, height: 180, display: "block" }}
              />
              <Typography.Text
                type="secondary"
                style={{ display: "block", textAlign: "center", marginTop: 8, fontSize: 12 }}
              >
                贴在车间入口
              </Typography.Text>
            </div>
          ) : null}
        </div>
      ) : (
        !loading && <Typography.Text type="secondary">暂无法加载厂码信息</Typography.Text>
      )}
    </Card>
  );
}
