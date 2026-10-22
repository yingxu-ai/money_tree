const KEY = "operating_tenant_id";

export function getOperatingTenantId(): number | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function setOperatingTenantId(id: number | null): void {
  if (id == null || id <= 0) {
    localStorage.removeItem(KEY);
    return;
  }
  localStorage.setItem(KEY, String(id));
}
