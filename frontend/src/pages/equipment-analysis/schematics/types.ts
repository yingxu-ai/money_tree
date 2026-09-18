/** 设备健康示意热区定义 — 与 docs/equipment-analysis-schematic-plan.md 对齐 */

export type HotspotStatus = "red" | "orange" | "gray" | "dashed";

export interface SchematicHotspot {
  id: string;
  label: string;
  /** 百分比矩形 x,y,w,h（相对整图 0～100） */
  box: { x: number; y: number; w: number; h: number };
  /** 匹配 attribution / likely_fault 的关键词 */
  keywords: string[];
  /** 匹配 attribution.metric */
  metrics?: string[];
  points: string[];
  actionHint: string;
}

export interface SchematicDef {
  type: string;
  title: string;
  coreId: string;
  hotspots: SchematicHotspot[];
}

export const SCREW_COMPRESSOR: SchematicDef = {
  type: "螺杆压缩机",
  title: "螺杆空压机 · 整站健康示意",
  coreId: "sc_airend",
  hotspots: [
    {
      id: "sc_air_filter",
      label: "空滤",
      box: { x: 1, y: 48, w: 11, h: 36 },
      keywords: ["空滤", "进气滤", "滤清", "吸气过滤"],
      metrics: [],
      points: ["空滤压差"],
      actionHint: "检查空滤压差；堵塞则更换滤芯。",
    },
    {
      id: "sc_inlet",
      label: "进气阀",
      box: { x: 12, y: 2, w: 15, h: 24 },
      keywords: ["进气阀", "进气", "吸气", "加载", "阀门"],
      metrics: [],
      points: ["吸气压力", "阀开度"],
      actionHint: "检查进气阀卡滞与加载电磁阀。",
    },
    {
      id: "sc_airend",
      label: "主机（螺杆机头）",
      box: { x: 10, y: 28, w: 27, h: 42 },
      keywords: ["主机", "机头", "轴承", "振动", "转子", "阳转子", "阴转子", "啮合", "电机", "绕组", "电流", "马达"],
      metrics: ["vibration", "temp", "current", "exhaust_temp"],
      points: ["主机振动", "轴承温度", "电机电流", "排气温度"],
      actionHint: "优先复测主机振动 / 轴承温度 / 电机电流 / 排气温度；排查机头轴承、啮合与驱动侧。",
    },
    {
      id: "sc_oil_filter",
      label: "油过滤",
      box: { x: 14, y: 72, w: 15, h: 16 },
      keywords: ["油滤", "油过滤", "油过滤器"],
      metrics: [],
      points: ["油滤压差"],
      actionHint: "核对油滤压差；超限更换滤芯。",
    },
    {
      id: "sc_separator",
      label: "油气分离筒",
      box: { x: 38, y: 16, w: 18, h: 66 },
      keywords: ["油分", "分离", "分离筒", "分离芯", "含油", "压差", "安全阀", "最小压力"],
      metrics: [],
      points: ["油分压差", "油位"],
      actionHint: "检查分离芯压差与油位；超限更换分离芯，并核对安全阀/最小压力阀。",
    },
    {
      id: "sc_oil_cooler",
      label: "油冷却器",
      box: { x: 58, y: 2, w: 36, h: 30 },
      keywords: ["油冷", "油冷却", "油温", "温控"],
      metrics: [],
      points: ["油温", "冷却介质温度"],
      actionHint: "清洗油冷却器；检查温控阀旁通与冷却侧流量。",
    },
    {
      id: "sc_aftercooler",
      label: "空气冷却器",
      box: { x: 62, y: 48, w: 30, h: 36 },
      keywords: ["空冷", "后冷", "空气冷却", "排气", "排气温度", "排气压力", "出口"],
      metrics: ["power"],
      points: ["排气温度", "排气压力"],
      actionHint: "清洗后冷却器；核对排气温度与冷凝排水。",
    },
    {
      id: "sc_control",
      label: "电控",
      box: { x: 28, y: 2, w: 12, h: 18 },
      keywords: ["电控", "控制器", "通讯", "变频", "电气"],
      metrics: [],
      points: ["故障码", "通讯状态"],
      actionHint: "读取控制器故障码与传感器通讯状态。",
    },
  ],
};

export const WATER_PUMP: SchematicDef = {
  type: "水泵",
  title: "离心水泵 · 健康示意",
  coreId: "pump_bearing",
  hotspots: [
    {
      id: "pump_motor",
      label: "电机",
      box: { x: 6, y: 32, w: 18, h: 36 },
      keywords: ["电机", "电流"],
      metrics: ["current", "power"],
      points: ["电机电流", "电机振动"],
      actionHint: "查电机负载与轴承。",
    },
    {
      id: "pump_coupling",
      label: "联轴器",
      box: { x: 26, y: 42, w: 8, h: 18 },
      keywords: ["联轴", "对中"],
      metrics: [],
      points: ["轴振"],
      actionHint: "复查对中与弹性体磨损。",
    },
    {
      id: "pump_bearing",
      label: "泵轴承",
      box: { x: 36, y: 38, w: 10, h: 24 },
      keywords: ["轴承", "振动"],
      metrics: ["temp", "vibration"],
      points: ["泵端振动", "轴承温度"],
      actionHint: "优先处理泵端轴承温振异常。",
    },
    {
      id: "pump_seal",
      label: "机械密封",
      box: { x: 46, y: 48, w: 8, h: 16 },
      keywords: ["密封", "泄漏"],
      metrics: [],
      points: ["泄漏开关", "腔温"],
      actionHint: "检查机封泄漏与冲洗水。",
    },
    {
      id: "pump_impeller",
      label: "叶轮",
      box: { x: 54, y: 30, w: 18, h: 40 },
      keywords: ["叶轮", "汽蚀", "流量"],
      metrics: [],
      points: ["流量", "扬程", "功率"],
      actionHint: "排查汽蚀、堵塞或叶轮磨损。",
    },
    {
      id: "pump_casing",
      label: "泵壳",
      box: { x: 52, y: 28, w: 22, h: 44 },
      keywords: ["泵壳", "壳体"],
      metrics: [],
      points: ["壳体振动"],
      actionHint: "壳体振动高时结合轴承与基础排查。",
    },
    {
      id: "pump_suction",
      label: "进口侧",
      box: { x: 48, y: 70, w: 14, h: 12 },
      keywords: ["入口", "进口", "汽蚀"],
      metrics: [],
      points: ["入口压力"],
      actionHint: "提高入口压力余量，防汽蚀。",
    },
    {
      id: "pump_discharge",
      label: "出口侧",
      box: { x: 78, y: 36, w: 14, h: 16 },
      keywords: ["出口", "扬程"],
      metrics: [],
      points: ["出口压力", "流量"],
      actionHint: "核对出口阀与管路阻力。",
    },
  ],
};

export const CHILLER: SchematicDef = {
  type: "冷水机组",
  title: "冷水机组 · 健康示意",
  coreId: "ch_compressor",
  hotspots: [
    {
      id: "ch_compressor",
      label: "压缩机",
      box: { x: 38, y: 36, w: 22, h: 32 },
      keywords: ["压缩机", "排气过热", "油压"],
      metrics: ["temp", "current", "vibration", "power"],
      points: ["排气温度", "电机电流", "油压"],
      actionHint: "优先核查压缩机过热、油压与电机电流。",
    },
    {
      id: "ch_condenser",
      label: "冷凝器",
      box: { x: 64, y: 18, w: 28, h: 36 },
      keywords: ["冷凝"],
      metrics: [],
      points: ["冷凝压力", "冷却水温差"],
      actionHint: "清洗冷凝器，核冷却水侧。",
    },
    {
      id: "ch_evaporator",
      label: "蒸发器",
      box: { x: 8, y: 22, w: 26, h: 40 },
      keywords: ["蒸发", "冷冻水"],
      metrics: [],
      points: ["蒸发压力", "出水温度"],
      actionHint: "检查冷冻水流量与蒸发压力。",
    },
    {
      id: "ch_expansion",
      label: "膨胀阀",
      box: { x: 34, y: 58, w: 12, h: 14 },
      keywords: ["膨胀", "过热度"],
      metrics: [],
      points: ["过热度", "阀开度"],
      actionHint: "校准过热度与阀动作。",
    },
    {
      id: "ch_cw_pump",
      label: "冷却水泵",
      box: { x: 72, y: 58, w: 18, h: 22 },
      keywords: ["冷却水", "冷却泵"],
      metrics: [],
      points: ["冷却水流量"],
      actionHint: "确认冷却水泵未断流。",
    },
    {
      id: "ch_chw_pump",
      label: "冷冻水泵",
      box: { x: 10, y: 62, w: 18, h: 22 },
      keywords: ["冷冻泵", "冷冻水流量"],
      metrics: [],
      points: ["冷冻水流量"],
      actionHint: "确认冷冻水泵运行与滤网。",
    },
    {
      id: "ch_electrical",
      label: "电控柜",
      box: { x: 86, y: 8, w: 12, h: 20 },
      keywords: ["电气", "通讯", "电控"],
      metrics: [],
      points: ["故障码", "通讯状态"],
      actionHint: "读取故障码与传感器通讯。",
    },
  ],
};

export const SCHEMATIC_BY_TYPE: Record<string, SchematicDef> = {
  [SCREW_COMPRESSOR.type]: SCREW_COMPRESSOR,
  [WATER_PUMP.type]: WATER_PUMP,
  [CHILLER.type]: CHILLER,
};

export function resolveSchematicDef(deviceType?: string): SchematicDef | null {
  if (!deviceType) return null;
  return SCHEMATIC_BY_TYPE[deviceType] ?? null;
}
