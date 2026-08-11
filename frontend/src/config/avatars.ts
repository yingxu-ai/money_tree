/** 内置默认头像（放在 frontend/public/avatars） */
export const DEFAULT_AVATARS = [
  "/avatars/01.svg",
  "/avatars/02.svg",
  "/avatars/03.svg",
  "/avatars/04.svg",
  "/avatars/05.svg",
  "/avatars/06.svg",
] as const;

export const DEFAULT_AVATAR = DEFAULT_AVATARS[0];

/** avatar_url 约定：内置 /avatars/xx.svg ；上传 file:{id} */
export function parseFileAvatarId(avatarUrl?: string | null): number | null {
  if (!avatarUrl?.startsWith("file:")) return null;
  const id = Number(avatarUrl.slice(5));
  return Number.isFinite(id) ? id : null;
}

export function isStaticAvatar(avatarUrl?: string | null): boolean {
  return !!avatarUrl && (avatarUrl.startsWith("/avatars/") || avatarUrl.startsWith("http"));
}

export function fileContentPath(fileId: number): string {
  return `/api/v1/files/${fileId}/content`;
}

export function resolveAvatarRef(avatarUrl?: string | null): string {
  if (!avatarUrl) return DEFAULT_AVATAR;
  const fileId = parseFileAvatarId(avatarUrl);
  if (fileId != null) return fileContentPath(fileId);
  return avatarUrl;
}
