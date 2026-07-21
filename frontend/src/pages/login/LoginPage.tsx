import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, Typography, message } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/errors";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import { getThemePreset } from "@/config/themes";
import { useAppConfig, useDocumentTitle } from "@/hooks/useAppConfig";
import { useAuthStore } from "@/stores/authStore";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const { appTitle, appSubtitle, theme } = useAppConfig();
  const preset = getThemePreset(theme);
  useDocumentTitle("登录");

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      await login(values.username, values.password);
      message.success("登录成功");
      navigate("/dashboards");
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "登录失败";
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div style={{ position: "absolute", top: 16, right: 16 }}>
        <ThemeSwitcher />
      </div>
      <Card
        className={`login-card${preset.layout.loginCardBlur ? " login-card--blur" : ""}`}
      >
        <Typography.Title level={3} className="login-title">
          {appTitle}
        </Typography.Title>
        <Typography.Paragraph className="login-subtitle">
          {appSubtitle}
        </Typography.Paragraph>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}
