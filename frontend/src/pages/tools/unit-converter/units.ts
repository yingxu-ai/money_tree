/** 单位定义：线性量用 toBase（相对基准）；温度单独处理。 */

export type UnitKind =
  | "length"
  | "energy"
  | "area"
  | "temperature"
  | "volume"
  | "weight"
  | "power"
  | "pressure";

export interface UnitDef {
  id: string;
  name: string;
  symbol: string;
  /** 1 该单位 = toBase 个基准单位（温度无此字段） */
  toBase?: number;
}

export interface CategoryDef {
  kind: UnitKind;
  title: string;
  baseLabel: string;
  units: UnitDef[];
}

export const CATEGORIES: CategoryDef[] = [
  {
    kind: "length",
    title: "长度",
    baseLabel: "米 (m)",
    units: [
      { id: "km", name: "公里", symbol: "km", toBase: 1000 },
      { id: "m", name: "米", symbol: "m", toBase: 1 },
      { id: "dm", name: "分米", symbol: "dm", toBase: 0.1 },
      { id: "cm", name: "厘米", symbol: "cm", toBase: 0.01 },
      { id: "mm", name: "毫米", symbol: "mm", toBase: 0.001 },
      { id: "um", name: "微米", symbol: "μm", toBase: 1e-6 },
      { id: "li", name: "里", symbol: "里", toBase: 500 },
      { id: "zhang", name: "丈", symbol: "丈", toBase: 10 / 3 },
      { id: "chi", name: "尺", symbol: "尺", toBase: 1 / 3 },
      { id: "cun", name: "寸", symbol: "寸", toBase: 1 / 30 },
      { id: "fen", name: "分", symbol: "分", toBase: 1 / 300 },
      { id: "li_cn", name: "厘", symbol: "厘", toBase: 1 / 3000 },
      { id: "nmi", name: "海里", symbol: "nmi", toBase: 1852 },
      { id: "fathom", name: "英寻", symbol: "fm", toBase: 1.8288 },
      { id: "mi", name: "英里", symbol: "mi", toBase: 1609.344 },
      { id: "fur", name: "弗隆", symbol: "fur", toBase: 201.168 },
      { id: "yd", name: "码", symbol: "yd", toBase: 0.9144 },
      { id: "ft", name: "英尺", symbol: "ft", toBase: 0.3048 },
      { id: "in", name: "英寸", symbol: "in", toBase: 0.0254 },
    ],
  },
  {
    kind: "energy",
    title: "功 / 能 / 热量",
    baseLabel: "焦耳 (J)",
    units: [
      { id: "J", name: "焦耳", symbol: "J", toBase: 1 },
      { id: "kgm", name: "公斤·米", symbol: "kg·m", toBase: 9.80665 },
      { id: "PSh", name: "米制马力·时", symbol: "PS·h", toBase: 735.49875 * 3600 },
      { id: "HPh", name: "英制马力·时", symbol: "HP·h", toBase: 745.6998715822702 * 3600 },
      { id: "kWh", name: "千瓦·时", symbol: "kW·h", toBase: 3.6e6 },
      { id: "kcal", name: "千卡", symbol: "kcal", toBase: 4184 },
      { id: "Btu", name: "英热单位", symbol: "Btu", toBase: 1055.05585262 },
      { id: "ftlb", name: "英尺·磅", symbol: "ft·lb", toBase: 1.3558179483314004 },
    ],
  },
  {
    kind: "area",
    title: "面积",
    baseLabel: "平方米 (m²)",
    units: [
      { id: "km2", name: "平方公里", symbol: "km²", toBase: 1e6 },
      { id: "ha", name: "公顷", symbol: "ha", toBase: 1e4 },
      { id: "mu", name: "市亩", symbol: "亩", toBase: 2000 / 3 },
      { id: "m2", name: "平方米", symbol: "m²", toBase: 1 },
      { id: "dm2", name: "平方分米", symbol: "dm²", toBase: 0.01 },
      { id: "cm2", name: "平方厘米", symbol: "cm²", toBase: 1e-4 },
      { id: "mm2", name: "平方毫米", symbol: "mm²", toBase: 1e-6 },
      { id: "sqmi", name: "平方英里", symbol: "sq mi", toBase: 2589988.110336 },
      { id: "acre", name: "英亩", symbol: "acre", toBase: 4046.8564224 },
      { id: "sqrd", name: "平方竿", symbol: "sq rd", toBase: 25.29285264 },
      { id: "sqyd", name: "平方码", symbol: "sq yd", toBase: 0.83612736 },
      { id: "sqft", name: "平方英尺", symbol: "sq ft", toBase: 0.09290304 },
      { id: "sqin", name: "平方英寸", symbol: "sq in", toBase: 0.00064516 },
    ],
  },
  {
    kind: "temperature",
    title: "温度",
    baseLabel: "摄氏度 (°C)",
    units: [
      { id: "C", name: "摄氏度", symbol: "°C" },
      { id: "F", name: "华氏度", symbol: "°F" },
      { id: "K", name: "开氏度", symbol: "K" },
      { id: "R", name: "兰氏度", symbol: "°R" },
      { id: "Re", name: "列氏度", symbol: "°Ré" },
    ],
  },
  {
    kind: "volume",
    title: "体积 / 容量",
    baseLabel: "立方米 (m³)",
    units: [
      { id: "m3", name: "立方米", symbol: "m³", toBase: 1 },
      { id: "hl", name: "公石", symbol: "hl", toBase: 0.1 },
      { id: "dal", name: "十升", symbol: "dal", toBase: 0.01 },
      { id: "dm3", name: "立方分米", symbol: "dm³", toBase: 0.001 },
      { id: "L", name: "升", symbol: "L", toBase: 0.001 },
      { id: "dL", name: "分升", symbol: "dL", toBase: 1e-4 },
      { id: "cL", name: "厘升", symbol: "cL", toBase: 1e-5 },
      { id: "cm3", name: "立方厘米", symbol: "cm³", toBase: 1e-6 },
      { id: "mL", name: "毫升", symbol: "mL", toBase: 1e-6 },
      { id: "mm3", name: "立方毫米", symbol: "mm³", toBase: 1e-9 },
      { id: "bbl", name: "桶（美制石油）", symbol: "bbl", toBase: 0.158987294928 },
      { id: "bu", name: "蒲式耳", symbol: "bu", toBase: 0.03523907016688 },
      { id: "pk", name: "配克", symbol: "pk", toBase: 0.00880976754172 },
      { id: "gal", name: "加仑（美）", symbol: "gal", toBase: 0.003785411784 },
      { id: "qt", name: "夸脱（美）", symbol: "qt", toBase: 0.000946352946 },
      { id: "pt", name: "品脱（美）", symbol: "pt", toBase: 0.000473176473 },
      { id: "floz", name: "液盎司（美）", symbol: "fl oz", toBase: 2.95735295625e-5 },
      { id: "fldr", name: "打兰（液）", symbol: "fl dr", toBase: 3.6966911953125e-6 },
      { id: "min", name: "量滴", symbol: "min", toBase: 6.1611519921875e-8 },
      { id: "yd3", name: "立方码", symbol: "yd³", toBase: 0.764554857984 },
      { id: "ft3", name: "立方英尺", symbol: "ft³", toBase: 0.028316846592 },
      { id: "in3", name: "立方英寸", symbol: "in³", toBase: 1.6387064e-5 },
    ],
  },
  {
    kind: "weight",
    title: "重量",
    baseLabel: "公斤 (kg)",
    units: [
      { id: "t", name: "吨", symbol: "t", toBase: 1000 },
      { id: "kg", name: "公斤", symbol: "kg", toBase: 1 },
      { id: "g", name: "克", symbol: "g", toBase: 0.001 },
      { id: "mg", name: "毫克", symbol: "mg", toBase: 1e-6 },
      { id: "jin", name: "市斤", symbol: "斤", toBase: 0.5 },
      { id: "dan", name: "担", symbol: "担", toBase: 50 },
      { id: "liang", name: "两", symbol: "两", toBase: 0.05 },
      { id: "qian", name: "钱", symbol: "钱", toBase: 0.005 },
      { id: "lb", name: "磅", symbol: "lb", toBase: 0.45359237 },
      { id: "oz", name: "盎司", symbol: "oz", toBase: 0.028349523125 },
      { id: "dwt", name: "英钱", symbol: "dwt", toBase: 0.00155517384 },
      { id: "gr", name: "格令", symbol: "gr", toBase: 6.479891e-5 },
      { id: "LT", name: "长吨", symbol: "LT", toBase: 1016.0469088 },
      { id: "ST", name: "短吨", symbol: "ST", toBase: 907.18474 },
      { id: "cwt_uk", name: "英担", symbol: "cwt", toBase: 50.80234544 },
      { id: "cwt_us", name: "美担", symbol: "cwt US", toBase: 45.359237 },
      { id: "st", name: "英石", symbol: "st", toBase: 6.35029318 },
      { id: "dr", name: "打兰", symbol: "dr", toBase: 0.0017718451953125 },
    ],
  },
  {
    kind: "power",
    title: "功率",
    baseLabel: "瓦 (W)",
    units: [
      { id: "W", name: "瓦", symbol: "W", toBase: 1 },
      { id: "kW", name: "千瓦", symbol: "kW", toBase: 1000 },
      { id: "HP", name: "英制马力", symbol: "HP", toBase: 745.6998715822702 },
      { id: "PS", name: "米制马力", symbol: "PS", toBase: 735.49875 },
      { id: "kgms", name: "公斤·米/秒", symbol: "kg·m/s", toBase: 9.80665 },
      { id: "kcals", name: "千卡/秒", symbol: "kcal/s", toBase: 4184 },
      { id: "Btus", name: "英热单位/秒", symbol: "Btu/s", toBase: 1055.05585262 },
      { id: "ftlbs", name: "英尺·磅/秒", symbol: "ft·lb/s", toBase: 1.3558179483314004 },
      { id: "Js", name: "焦耳/秒", symbol: "J/s", toBase: 1 },
      { id: "Nms", name: "牛顿·米/秒", symbol: "N·m/s", toBase: 1 },
    ],
  },
  {
    kind: "pressure",
    title: "压力",
    baseLabel: "帕斯卡 (Pa)",
    units: [
      { id: "bar", name: "巴", symbol: "bar", toBase: 1e5 },
      { id: "kPa", name: "千帕", symbol: "kPa", toBase: 1000 },
      { id: "hPa", name: "百帕", symbol: "hPa", toBase: 100 },
      { id: "mbar", name: "毫巴", symbol: "mbar", toBase: 100 },
      { id: "Pa", name: "帕斯卡", symbol: "Pa", toBase: 1 },
      { id: "atm", name: "标准大气压", symbol: "atm", toBase: 101325 },
      { id: "mmHg", name: "毫米汞柱", symbol: "mmHg", toBase: 133.322387415 },
      { id: "psi", name: "磅力/平方英寸", symbol: "psi", toBase: 6894.757293168 },
      { id: "mmH2O", name: "毫米水柱", symbol: "mmH₂O", toBase: 9.80665 },
      { id: "kgfcm2", name: "公斤力/平方厘米", symbol: "kgf/cm²", toBase: 98066.5 },
    ],
  },
];
