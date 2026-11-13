/** 按创建时间倒序；无创建时间时按 id 倒序 */
export function sortByCreatedDesc<T extends { created_at?: string | null; id?: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const ca = a.created_at || "";
    const cb = b.created_at || "";
    if (ca !== cb) return cb.localeCompare(ca);
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}
