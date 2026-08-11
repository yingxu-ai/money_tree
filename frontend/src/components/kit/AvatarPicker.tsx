import { UploadOutlined, UserOutlined } from "@ant-design/icons";
import { Avatar, Spin, Upload, message } from "antd";
import { useMemo, useState } from "react";
import { uploadAvatar } from "@/api/auth";
import { uploadFile } from "@/api/files";
import AuthImage from "@/components/kit/AuthImage";
import { DEFAULT_AVATAR, DEFAULT_AVATARS, resolveAvatarRef } from "@/config/avatars";
import { ApiError } from "@/api/errors";
import "./avatarPicker.css";

export interface AvatarPickerProps {
  value?: string | null;
  onChange?: (avatarUrl: string) => void;
  /** profile: 走 /auth/me/avatar；file: 走通用文件上传，返回 file:{id} */
  mode?: "profile" | "file";
  size?: number;
  disabled?: boolean;
}

/**
 * 通用头像/图片选择器：内置预设 + 本地上传。
 * - profile 模式上传后直接绑定当前用户
 * - file 模式复用文件中心，返回 file:{id} 供业务字段存储
 */
export default function AvatarPicker({
  value,
  onChange,
  mode = "profile",
  size = 72,
  disabled = false,
}: AvatarPickerProps) {
  const [uploading, setUploading] = useState(false);
  const current = value || DEFAULT_AVATAR;

  const presets = useMemo(() => [...DEFAULT_AVATARS], []);

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      if (mode === "profile") {
        const user = await uploadAvatar(file);
        onChange?.(user.avatar_url || DEFAULT_AVATAR);
      } else {
        const uploaded = await uploadFile(file);
        onChange?.(uploaded.ref || `file:${uploaded.id}`);
      }
      message.success("头像已更新");
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "上传失败";
      message.error(msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="avatar-picker">
      <div className="avatar-picker-preview">
        <Spin spinning={uploading}>
          <Avatar
            size={size}
            icon={<UserOutlined />}
            src={
              <AuthImage
                src={resolveAvatarRef(current)}
                alt="avatar"
                style={{ width: size, height: size, objectFit: "cover" }}
              />
            }
          />
        </Spin>
        <Upload
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
          showUploadList={false}
          disabled={disabled || uploading}
          beforeUpload={(file) => {
            void onUpload(file);
            return false;
          }}
        >
          <button type="button" className="avatar-picker-upload" disabled={disabled || uploading}>
            <UploadOutlined /> 上传图片
          </button>
        </Upload>
      </div>

      <div className="avatar-picker-presets">
        {presets.map((item) => (
          <button
            key={item}
            type="button"
            className={`avatar-picker-preset${current === item ? " is-active" : ""}`}
            disabled={disabled}
            onClick={() => onChange?.(item)}
            title="选择默认头像"
          >
            <img src={item} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}
