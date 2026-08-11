import { UserOutlined } from "@ant-design/icons";
import { Avatar } from "antd";
import AuthImage from "@/components/kit/AuthImage";
import { DEFAULT_AVATAR, resolveAvatarRef } from "@/config/avatars";

interface UserAvatarProps {
  avatarUrl?: string | null;
  name?: string;
  size?: number;
  className?: string;
}

/** 通用用户头像展示（支持内置路径与 file:{id} 鉴权内容） */
export default function UserAvatar({
  avatarUrl,
  name,
  size = 32,
  className,
}: UserAvatarProps) {
  const src = resolveAvatarRef(avatarUrl || DEFAULT_AVATAR);
  const letter = (name || "?").trim().charAt(0).toUpperCase();

  return (
    <Avatar
      className={className}
      size={size}
      icon={<UserOutlined />}
      src={
        <AuthImage
          src={src}
          alt={name || "avatar"}
          fallbackSrc={DEFAULT_AVATAR}
          style={{ width: size, height: size, objectFit: "cover" }}
        />
      }
    >
      {letter}
    </Avatar>
  );
}
