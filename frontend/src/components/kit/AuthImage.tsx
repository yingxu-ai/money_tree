import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { getAccessToken } from "@/utils/tokenStorage";
import { isStaticAvatar } from "@/config/avatars";

interface AuthImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  /** 静态路径、http(s)、或需鉴权的 /api/v1/files/{id}/content */
  src?: string | null;
  fallbackSrc?: string;
}

/**
 * 通用鉴权图片：静态资源直接显示；/api 资源带 Bearer 拉取后转 blob URL。
 * 头像、封面、附件预览等场景可复用。
 */
export default function AuthImage({ src, fallbackSrc, alt = "", ...rest }: AuthImageProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const resolved = src || "";
  const needsAuth = !!resolved && !isStaticAvatar(resolved) && resolved.startsWith("/api/");

  useEffect(() => {
    setFailed(false);
    if (!needsAuth || !resolved) {
      setBlobUrl(null);
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;
    const token = getAccessToken();

    fetch(resolved, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then((res) => {
        if (!res.ok) throw new Error("load failed");
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setBlobUrl(null);
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [needsAuth, resolved]);

  const displaySrc = failed ? fallbackSrc || "" : needsAuth ? blobUrl || "" : resolved || fallbackSrc || "";

  if (!displaySrc) {
    return null;
  }

  return (
    <img
      src={displaySrc}
      alt={alt}
      {...rest}
      onError={(e) => {
        setFailed(true);
        rest.onError?.(e);
      }}
    />
  );
}
