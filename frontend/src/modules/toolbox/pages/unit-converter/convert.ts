import type { UnitDef, UnitKind } from "./units";

/** 温度：统一转到摄氏，再转出 */
export function tempToCelsius(id: string, value: number): number {
  switch (id) {
    case "C":
      return value;
    case "F":
      return ((value - 32) * 5) / 9;
    case "K":
      return value - 273.15;
    case "R":
      return ((value - 491.67) * 5) / 9;
    case "Re":
      return value * 1.25;
    default:
      return value;
  }
}

export function celsiusToTemp(id: string, c: number): number {
  switch (id) {
    case "C":
      return c;
    case "F":
      return (c * 9) / 5 + 32;
    case "K":
      return c + 273.15;
    case "R":
      return ((c + 273.15) * 9) / 5;
    case "Re":
      return c * 0.8;
    default:
      return c;
  }
}

export function toBase(kind: UnitKind, unit: UnitDef, value: number): number {
  if (kind === "temperature") return tempToCelsius(unit.id, value);
  const f = unit.toBase;
  if (f == null || !Number.isFinite(f) || f === 0) return NaN;
  return value * f;
}

export function fromBase(kind: UnitKind, unit: UnitDef, base: number): number {
  if (kind === "temperature") return celsiusToTemp(unit.id, base);
  const f = unit.toBase;
  if (f == null || !Number.isFinite(f) || f === 0) return NaN;
  return base / f;
}

/** 展示格式：有效数字，避免科学计数刷屏 */
export function formatConvertValue(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e10 || abs < 1e-6) {
    return n.toExponential(8).replace(/\.?0+e/, "e").replace(/e\+?/, "e");
  }
  // 最多 10 位有效，去掉尾零
  const s = n.toPrecision(10);
  if (s.includes("e") || s.includes("E")) return s;
  return String(parseFloat(s));
}

export function parseInputNumber(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "");
  if (!t || t === "-" || t === "." || t === "-.") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n;
}
