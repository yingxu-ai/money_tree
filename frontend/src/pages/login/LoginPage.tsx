import { EyeInvisibleOutlined, EyeOutlined } from "@ant-design/icons";
import { message } from "antd";
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/errors";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import { useAppConfig, useDocumentTitle } from "@/hooks/useAppConfig";
import { useAuthStore } from "@/stores/authStore";
import {
  getRememberedUsername,
  isRememberLogin,
} from "@/utils/tokenStorage";
import "./login.css";

/** 与后端 seed / DEFAULT_ADMIN_* 保持一致，便于本地开箱试用 */
const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin123";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState(
    () => getRememberedUsername() || DEFAULT_USERNAME,
  );
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(isRememberLogin);
  const [error, setError] = useState("");

  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const { appTitle, appSubtitle } = useAppConfig();
  useDocumentTitle("登录");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    const name = username.trim();
    if (!name) {
      setError("请输入账号");
      return;
    }
    if (!password) {
      setError("请输入密码");
      return;
    }

    setLoading(true);
    try {
      await login(name, password, remember);
      message.success("登录成功");
      navigate("/dashboards");
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "登录失败";
      setError(msg);
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-gate">
      <div className="login-gate-theme">
        <ThemeSwitcher />
      </div>

      <div className="login-gate-header">
        <h1>{appTitle}</h1>
        <p>{appSubtitle}</p>
      </div>

      <div className="login-gate-core">
        <div className="login-gate-door">
          <div className="login-gate-panel is-left" />
          <div className="login-gate-panel is-right" />

          <form className="login-gate-form" onSubmit={onSubmit}>
            <h2>身份认证</h2>

            <input
              type="text"
              name="username"
              autoComplete="username"
              placeholder="账号"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
            />

            <div className="login-gate-password">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
              <button
                type="button"
                className="login-gate-eye"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                title="显示/隐藏密码"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOutlined /> : <EyeInvisibleOutlined />}
              </button>
            </div>

            <label className="login-gate-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                disabled={loading}
              />
              记住登录状态
            </label>

            {error ? <div className="login-gate-error">{error}</div> : null}

            <button type="submit" className="login-gate-submit" disabled={loading}>
              {loading ? "启动中..." : "启动"}
            </button>

            <p className="login-gate-hint">
              默认账号 {DEFAULT_USERNAME} / {DEFAULT_PASSWORD}
            </p>
          </form>
        </div>
      </div>

      <div className="login-gate-footer">AI · RAG · Agent · Model Service · Digital Twin</div>
      <div className="login-gate-status">系统安全认证中...</div>
    </div>
  );
}
