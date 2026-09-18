"""生成设备分析 Demo 的唯一数据源 catalog.json。

铁律：所有页面数字均从本脚本 DEVICES 推导，禁止在各页 JSON 手写第二套数。
运行：python backend/scripts/gen_equipment_analysis_fixtures.py
"""
from __future__ import annotations

import json
import random
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "equipment_analysis"
OUT.mkdir(parents=True, exist_ok=True)

# 与 seed DEPTS 对齐（用于范围筛选：选父部门含子孙）
CATALOG_DEPTS = [
    {"id": 1, "parent_id": None, "name": "总部", "code": "HQ"},
    {"id": 2, "parent_id": 1, "name": "生产部", "code": "PROD"},
    {"id": 3, "parent_id": 1, "name": "技术部", "code": "TECH"},
    {"id": 11, "parent_id": 1, "name": "质量部", "code": "QA"},
    {"id": 4, "parent_id": 2, "name": "一车间", "code": "PROD-1"},
    {"id": 5, "parent_id": 2, "name": "二车间", "code": "PROD-2"},
    {"id": 6, "parent_id": 2, "name": "动力部", "code": "POWER"},
    {"id": 7, "parent_id": 2, "name": "三车间", "code": "PROD-3"},
    {"id": 8, "parent_id": 2, "name": "仓储物流部", "code": "WH"},
    {"id": 9, "parent_id": 3, "name": "实验室", "code": "LAB"},
    {"id": 10, "parent_id": 3, "name": "设备工程部", "code": "ENG"},
    {"id": 12, "parent_id": 11, "name": "质检中心", "code": "QC"},
    {"id": 13, "parent_id": 11, "name": "计量站", "code": "MET"},
]

DEPT_POWER = next(d for d in CATALOG_DEPTS if d["code"] == "POWER")
DEPT_LINE1 = next(d for d in CATALOG_DEPTS if d["code"] == "PROD-1")

SOURCES = [
    {
        "id": "SRC-SIM-01",
        "name": "空压站采集",
        "kind": "simulator",
        "interval_sec": 5,
        "enabled": True,
        "dept_id": DEPT_POWER["id"],
    },
    {
        "id": "SRC-SIM-02",
        "name": "生产车间采集",
        "kind": "simulator",
        "interval_sec": 5,
        "enabled": True,
        "dept_id": DEPT_LINE1["id"],
    },
    {
        "id": "SRC-SIM-03",
        "name": "实验室采集",
        "kind": "simulator",
        "interval_sec": 10,
        "enabled": True,
        "dept_id": next(d for d in CATALOG_DEPTS if d["code"] == "LAB")["id"],
    },
]

# 测点字典：id 全局唯一；category = plc | elec | env
# 螺杆压缩机对外展示名与对照/示意四测点对齐：主机振动 · 轴承温度 · 电机电流 · 排气温度
POINTS = [
    {"id": "PT-RPM", "code": "rpm", "name": "转速", "unit": "rpm", "category": "plc"},
    {"id": "PT-PRESS", "code": "pressure", "name": "排气压力", "unit": "MPa", "category": "plc"},
    {"id": "PT-TEMP", "code": "temp", "name": "轴承温度", "unit": "℃", "category": "plc"},
    {"id": "PT-VIB", "code": "vibration", "name": "主机振动", "unit": "mm/s", "category": "plc"},
    {"id": "PT-CUR", "code": "current", "name": "电机电流", "unit": "A", "category": "elec"},
    {"id": "PT-EXH", "code": "exhaust_temp", "name": "排气温度", "unit": "℃", "category": "plc"},
    {"id": "PT-PWR", "code": "power", "name": "功率", "unit": "kW", "category": "elec"},
    {"id": "PT-HUM", "code": "humidity", "name": "环境湿度", "unit": "%RH", "category": "env"},
    {"id": "PT-ATMP", "code": "ambient_temp", "name": "环境温度", "unit": "℃", "category": "env"},
]

# 螺杆压缩机主叙事四测点（对照 / 证据 / 示意 / 列表实时摘要统一用这套名称）
COMPRESSOR_CORE_METRICS = ("vibration", "temp", "current", "exhaust_temp")
COMPRESSOR_POINT_IDS = [
    "PT-RPM",
    "PT-PRESS",
    "PT-TEMP",
    "PT-VIB",
    "PT-CUR",
    "PT-EXH",
    "PT-PWR",
    "PT-HUM",
    "PT-ATMP",
]

POINT_BY_ID = {p["id"]: p for p in POINTS}


def _series(labels: list[str], values: list[float]) -> list[dict]:
    return [{"label": a, "value": round(b, 2) if isinstance(b, float) else b} for a, b in zip(labels, values)]


# —— 三台演示设备（完整剧本；现场约 12 台离心机，Demo 用 3 台差异化即可）——
ANCHOR_IDS = frozenset({"EQ-C01", "EQ-C02", "EQ-P01"})
FLEET_SIZE = 3  # 只保留锚点三台，不再灌水全厂假数据

ANCHOR_DEVICES = [
    {
        "id": "EQ-C01",
        "code": "EQ-C01",
        "name": "1#压缩机",
        "type": "螺杆压缩机",
        "dept_id": DEPT_POWER["id"],
        "dept_name": DEPT_POWER["name"],
        "source_id": "SRC-SIM-01",
        "point_ids": COMPRESSOR_POINT_IDS,
        "run_status": "running",
        "comm_status": "online",
        "analysis_status": "normal",
        "summary": "工况稳定，测点在正常带内",
        "realtime": {
            "rpm": 1480,
            "pressure": 0.82,
            "temp": 68.0,
            "vibration": 2.3,
            "current": 82.0,
            "exhaust_temp": 86.0,
            "power": 145.0,
            "humidity": 48.0,
            "ambient_temp": 26.0,
        },
        "display_metrics": list(COMPRESSOR_CORE_METRICS),
        "output_today": 320,
        "energy_score": 91,
        "last_sample_at": "2026-08-27T21:00:00+08:00",
        "current": {
            "verdict": "正常",
            "one_liner": "主机振动、轴承温度、电机电流与排气温度均在正常带，未见短窗偏离。",
            "evidence": [
                {"metric": "主机振动", "text": "2.3 mm/s，近 7 日均值附近波动"},
                {"metric": "轴承温度", "text": "68℃，相对同负荷段正常"},
                {"metric": "电机电流", "text": "82 A，与负荷匹配"},
                {"metric": "排气温度", "text": "86℃，冷却与负荷正常"},
            ],
            "causes": [],
            "worsen_if_ignored": None,
            "trend_24h": {
                "temp": _series(
                    ["0h", "4h", "8h", "12h", "16h", "20h", "24h"],
                    [66, 67, 68, 67, 68, 69, 68],
                ),
                "vibration": _series(
                    ["0h", "4h", "8h", "12h", "16h", "20h", "24h"],
                    [2.1, 2.2, 2.3, 2.2, 2.4, 2.3, 2.3],
                ),
                "current": _series(
                    ["0h", "4h", "8h", "12h", "16h", "20h", "24h"],
                    [80, 81, 82, 81, 83, 82, 82],
                ),
                "exhaust_temp": _series(
                    ["0h", "4h", "8h", "12h", "16h", "20h", "24h"],
                    [84, 85, 86, 85, 86, 87, 86],
                ),
                "power": _series(
                    ["0h", "4h", "8h", "12h", "16h", "20h", "24h"],
                    [140, 142, 145, 144, 146, 145, 145],
                ),
            },
        },
        "future": {
            "risk_24h": 2,
            "risk_72h": 4,
            "risk_7d": 8,
            "likely_fault": "暂无明显类型",
            "fault_type_probs": [
                {"name": "轴承磨损", "prob": 0.35},
                {"name": "润滑不足", "prob": 0.25},
                {"name": "其他", "prob": 0.40},
            ],
            "rul_days": 120,
            "rul_ci": [100, 140],
            "avoid": [
                "维持常规巡检周期",
                "关注滤芯压差与冷却水温度",
            ],
            "contingency": {
                "steps": "若出现温升与振动同向抬升，按轴承检查标准工序执行",
                "spares": ["SP-882 轴承"],
                "workorder_hint": "预测转单（确认前不记故障台次）",
            },
        },
        "optimize": {
            "eligible": True,
            "goal_options": [
                {"key": "balance", "label": "平衡", "desc": "产量基本保住，适度降耗"},
                {"key": "life", "label": "长寿命", "desc": "优先控温升与磨损"},
                {"key": "output", "label": "高负荷生产", "desc": "优先产量，接受能耗上升"},
                {"key": "energy", "label": "节能", "desc": "优先降功率/单耗"},
            ],
            "constraints": [
                {"name": "排气压力", "current": "0.82 MPa", "limit": "0.75～0.85 MPa", "ok": True},
                {"name": "转速", "current": "1480 rpm", "limit": "1200～1500 rpm", "ok": True},
            ],
            "goal_scenarios": {
                "balance": {
                    "param_advice": "转速建议 1410～1440 rpm（当前 1480）",
                    "delta": {"output": "320→318", "power": "145→132 kW", "risk": "磨损风险不明显上升"},
                },
                "life": {
                    "param_advice": "转速建议 1420～1450 rpm，避免尖峰负载",
                    "delta": {"output": "320→318", "power": "145→136 kW", "risk": "温升与振动风险下调"},
                },
                "output": {
                    "param_advice": "维持 1460～1500 rpm（不越上限）",
                    "delta": {"output": "保产冲高", "power": "145～150 kW", "risk": "温升与磨损风险升高"},
                },
                "energy": {
                    "param_advice": "转速建议 1380～1410 rpm，压力靠下限",
                    "delta": {"output": "320→310", "power": "145→126 kW", "risk": "需盯润滑与温升"},
                },
            },
        },
    },
    {
        "id": "EQ-C02",
        "code": "EQ-C02",
        "name": "2#压缩机",
        "type": "螺杆压缩机",
        "dept_id": DEPT_POWER["id"],
        "dept_name": DEPT_POWER["name"],
        "source_id": "SRC-SIM-01",
        "point_ids": COMPRESSOR_POINT_IDS,
        "run_status": "alarm",
        "comm_status": "online",
        "analysis_status": "abnormal",
        "summary": "主机振动与轴承温升同向抬升，疑似轴承润滑问题",
        "realtime": {
            "rpm": 1510,
            "pressure": 0.79,
            "temp": 92.0,
            "vibration": 6.2,
            "current": 96.0,
            "exhaust_temp": 118.0,
            "power": 168.0,
            "humidity": 48.0,
            "ambient_temp": 26.0,
        },
        "display_metrics": list(COMPRESSOR_CORE_METRICS),
        "output_today": 286,
        "energy_score": 78,
        "last_sample_at": "2026-08-27T21:00:00+08:00",
        "alarm_code": "AL-1001",
        "current": {
            "verdict": "异常",
            "one_liner": "主机振动与排气温度同向升高，疑似轴承润滑问题；已关联 AL-1001。",
            "evidence": [
                {"metric": "主机振动", "text": "6.2 mm/s，较近 7 日均值约 +32%"},
                {"metric": "轴承温度", "text": "92℃，相对同负荷段偏高"},
                {"metric": "电机电流", "text": "96 A，同转速段偏高"},
                {"metric": "排气温度", "text": "118℃，与轴承温升同向"},
                {"metric": "关联报警", "text": "AL-1001 温度过高 / 振动越限"},
            ],
            "causes": [
                {"name": "轴承磨损", "prob": 76, "tag": "累积磨损类"},
                {"name": "润滑不足", "prob": 18, "tag": "累积磨损类"},
                {"name": "紧固松动冲击", "prob": 6, "tag": "冲击/越限类"},
            ],
            "worsen_if_ignored": {
                "summary": "若暂不处理：主机振动与温升同向加重，可能由可计划更换升级为非计划停机。",
                "horizon": "建议 24～72 小时内安排机旁确认与窗口检修",
                "risk_level": "高",
            },
            "trend_24h": {
                "temp": _series(
                    ["0h", "4h", "8h", "12h", "16h", "20h", "24h"],
                    [78, 81, 84, 86, 89, 91, 92],
                ),
                "vibration": _series(
                    ["0h", "4h", "8h", "12h", "16h", "20h", "24h"],
                    [4.1, 4.5, 4.9, 5.3, 5.7, 6.0, 6.2],
                ),
                "current": _series(
                    ["0h", "4h", "8h", "12h", "16h", "20h", "24h"],
                    [88, 90, 91, 93, 94, 95, 96],
                ),
                "exhaust_temp": _series(
                    ["0h", "4h", "8h", "12h", "16h", "20h", "24h"],
                    [102, 105, 108, 111, 114, 116, 118],
                ),
                "power": _series(
                    ["0h", "4h", "8h", "12h", "16h", "20h", "24h"],
                    [152, 155, 158, 161, 164, 166, 168],
                ),
            },
        },
        "future": {
            "risk_24h": 18,
            "risk_72h": 45,
            "risk_7d": 72,
            "likely_fault": "轴承异常",
            "fault_type_probs": [
                {"name": "轴承磨损", "prob": 0.72},
                {"name": "润滑不足", "prob": 0.18},
                {"name": "电机过热", "prob": 0.06},
                {"name": "其他", "prob": 0.04},
            ],
            "rul_days": 5,
            "rul_ci": [3, 9],
            "avoid": [
                "72 小时内安排机旁检查轴承及润滑",
                "预留备件 SP-882 轴承",
                "适当降载运行至窗口检修",
            ],
            "contingency": {
                "steps": "确认报警复现 → 检查轴承与润滑 → 按标准工序更换 → 试车复核振动/温升",
                "spares": ["SP-882 轴承", "润滑脂 LG-02"],
                "workorder_hint": "建议开维修单（来源：预测/现状，确认前不记故障台次）",
            },
        },
        "optimize": {
            "eligible": False,
            "block_reason": "存在未关闭报警 AL-1001，暂缓激进调优；先完成现状处置。",
            "goal_options": [
                {"key": "balance", "label": "平衡", "desc": "产量基本保住，适度降耗"},
                {"key": "life", "label": "长寿命", "desc": "优先控温升与磨损"},
                {"key": "output", "label": "高负荷生产", "desc": "优先产量，接受能耗上升"},
                {"key": "energy", "label": "节能", "desc": "优先降功率/单耗"},
            ],
            "constraints": [
                {"name": "排气压力", "current": "0.79 MPa", "limit": "0.75～0.85 MPa", "ok": True},
                {"name": "转速", "current": "1510 rpm", "limit": "1200～1500 rpm", "ok": False},
            ],
            "goal_scenarios": {
                "life": {
                    "param_advice": "优先降载：转速建议不超过 1400 rpm，待报警关闭后再评估节能",
                    "delta": {"output": "286→约 270", "power": "168→约 150 kW", "risk": "温升风险下调（测算）"},
                },
                "balance": {
                    "param_advice": "报警未关闭前仅建议维持安全下限运行",
                    "delta": {"output": "暂缓优化测算", "power": "—", "risk": "先治已病"},
                },
                "output": {
                    "param_advice": "不建议高负荷；当前转速已近/越上限",
                    "delta": {"output": "不推荐", "power": "—", "risk": "加重磨损"},
                },
                "energy": {
                    "param_advice": "报警关闭前暂不进行节能调参",
                    "delta": {"output": "—", "power": "—", "risk": "先处置异常"},
                },
            },
        },
    },
    {
        "id": "EQ-P01",
        "code": "EQ-P01",
        "name": "1#注塑机",
        "type": "注塑机",
        "dept_id": DEPT_LINE1["id"],
        "dept_name": DEPT_LINE1["name"],
        "source_id": "SRC-SIM-02",
        "point_ids": ["PT-TEMP", "PT-CUR", "PT-PWR", "PT-HUM", "PT-ATMP"],
        "run_status": "running",
        "comm_status": "online",
        "analysis_status": "watch",
        "summary": "单耗偏高且温升斜率偏大，纳入关注",
        "realtime": {
            "rpm": 0,
            "pressure": 95.0,
            "temp": 183.0,
            "vibration": 1.8,
            "current": 70.0,
            "power": 112.0,
            "humidity": 52.0,
            "ambient_temp": 28.0,
        },
        "display_metrics": ["temp", "power"],
        "output_today": 410,
        "energy_score": 84,
        "last_sample_at": "2026-08-27T21:00:00+08:00",
        "current": {
            "verdict": "关注",
            "one_liner": "工艺温度与功率相对标杆偏高，尚未触发硬报警，建议加密观察。",
            "evidence": [
                {"metric": "工艺温度", "text": "183℃，近 24h 斜率偏正"},
                {"metric": "功率", "text": "112 kW，同产量段略偏高"},
                {"metric": "环境温湿度", "text": "28℃ / 52%RH，未见异常贡献"},
            ],
            "causes": [
                {"name": "工艺设定偏高", "prob": 48, "tag": "运行类"},
                {"name": "加热回路效率下降", "prob": 32, "tag": "电气类"},
                {"name": "传感器漂移", "prob": 20, "tag": "仪表类"},
            ],
            "worsen_if_ignored": {
                "summary": "若持续偏高运行，能耗上升并可能加速加热元件老化。",
                "horizon": "建议本周内复核工艺设定与加热回路",
                "risk_level": "中",
            },
            "trend_24h": {
                "temp": _series(
                    ["0h", "4h", "8h", "12h", "16h", "20h", "24h"],
                    [178, 179, 180, 181, 182, 182, 183],
                ),
                "vibration": _series(
                    ["0h", "4h", "8h", "12h", "16h", "20h", "24h"],
                    [1.6, 1.7, 1.7, 1.8, 1.8, 1.8, 1.8],
                ),
                "power": _series(
                    ["0h", "4h", "8h", "12h", "16h", "20h", "24h"],
                    [105, 107, 108, 110, 111, 112, 112],
                ),
            },
        },
        "future": {
            "risk_24h": 8,
            "risk_72h": 18,
            "risk_7d": 35,
            "likely_fault": "过热 / 加热异常",
            "fault_type_probs": [
                {"name": "加热异常", "prob": 0.45},
                {"name": "工艺漂移", "prob": 0.30},
                {"name": "其他", "prob": 0.25},
            ],
            "rul_days": 45,
            "rul_ci": [30, 60],
            "avoid": [
                "本周复核工艺温度设定与加热回路",
                "对比同线标杆机单耗",
                "必要时加密班次点检",
            ],
            "contingency": {
                "steps": "确认温控回路 → 校验传感器 → 调整设定或更换加热元件",
                "spares": ["加热圈 HC-120"],
                "workorder_hint": "建议转点检/维修（来源：关注）",
            },
        },
        "optimize": {
            "eligible": True,
            "goal_options": [
                {"key": "balance", "label": "平衡", "desc": "产量基本保住，适度降耗"},
                {"key": "life", "label": "长寿命", "desc": "优先控温升与磨损"},
                {"key": "output", "label": "高负荷生产", "desc": "优先产量，接受能耗上升"},
                {"key": "energy", "label": "节能", "desc": "优先降功率/单耗"},
            ],
            "constraints": [
                {"name": "工艺温度", "current": "183℃", "limit": "≤190℃", "ok": True},
                {"name": "功率", "current": "112 kW", "limit": "≤130 kW", "ok": True},
            ],
            "goal_scenarios": {
                "balance": {
                    "param_advice": "工艺温度建议下调 2～3℃（仍满足成型窗口）",
                    "delta": {"output": "410→405", "power": "112→105 kW", "risk": "温升压力下降"},
                },
                "life": {
                    "param_advice": "避免长时间顶温运行，设定靠工艺下限",
                    "delta": {"output": "410→400", "power": "112→100 kW", "risk": "加热元件寿命利好"},
                },
                "output": {
                    "param_advice": "维持高产周期，接受单耗偏高",
                    "delta": {"output": "保产", "power": "112～118 kW", "risk": "关注温升斜率"},
                },
                "energy": {
                    "param_advice": "温度再降 3～5℃ + 优化保压参数（须工艺确认）",
                    "delta": {"output": "410→395", "power": "112→98 kW", "risk": "需验证良品率"},
                },
            },
        },
    },
]


DEPT_BY_ID = {d["id"]: d for d in CATALOG_DEPTS}
DEPT_LINE2 = next(d for d in CATALOG_DEPTS if d["code"] == "PROD-2")

_DEVICE_TYPE_ROOTS = [
    "螺杆压缩机",
    "离心压缩机",
    "活塞压缩机",
    "注塑机",
    "冲压机",
    "焊接机器人",
    "数控机床",
    "磨床",
    "车床",
    "叉车",
    "AGV",
    "输送带",
    "包装机",
    "贴标机",
    "冷却塔",
    "冷水机组",
    "空调末端",
    "新风机组",
    "排风机",
    "除尘风机",
    "变压器",
    "配电柜",
    "UPS",
    "发电机",
    "水泵",
    "真空泵",
    "锅炉",
    "燃烧器",
    "干燥机",
    "混合机",
    "反应釜",
    "搅拌罐",
    "挤出机",
    "压延机",
    "检测仪",
    "光谱仪",
    "三坐标",
    "激光切割",
    "等离子切割",
    "清洗机",
]
assert len(_DEVICE_TYPE_ROOTS) == 40

_rng_types = random.Random(20260828)
_shuffled_types = list(_DEVICE_TYPE_ROOTS)
_rng_types.shuffle(_shuffled_types)
DEVICE_TYPE_WEIGHTS = [
    (name, 1.0 / (i + 1) ** 0.65) for i, name in enumerate(_shuffled_types)
]

_parent_ids = {d["parent_id"] for d in CATALOG_DEPTS if d.get("parent_id")}
DEPT_LEAVES = [d for d in CATALOG_DEPTS if d["id"] not in _parent_ids]
DEPT_LEAF_WEIGHTS = [(d, 1.0) for d in DEPT_LEAVES]

_DEPT_SOURCE = {
    "POWER": "SRC-SIM-01",
    "LAB": "SRC-SIM-03",
    "ENG": "SRC-SIM-03",
}
_DEFAULT_SOURCE = "SRC-SIM-02"


def _dept_source_id(dept: dict) -> str:
    return _DEPT_SOURCE.get(dept["code"], _DEFAULT_SOURCE)


def _pick_weighted(rng: random.Random, items: list[tuple]) -> tuple:
    total = sum(w for _, w in items)
    r = rng.random() * total
    acc = 0.0
    for item, w in items:
        acc += w
        if r <= acc:
            return item
    return items[-1][0]


def _minimal_future(analysis_status: str, rng: random.Random) -> dict:
    """基础未来块；归因/劣化/残差由 API `_project_future_attribution` 投影。"""
    if analysis_status == "abnormal":
        risk_7d = rng.randint(55, 85)
        rul_days = rng.randint(3, 14)
    elif analysis_status == "watch":
        risk_7d = rng.randint(22, 48)
        rul_days = rng.randint(15, 60)
    else:
        risk_7d = rng.randint(2, 18)
        rul_days = rng.randint(60, 180)
    return {
        "risk_24h": max(1, risk_7d // 4),
        "risk_72h": max(2, risk_7d // 2),
        "risk_7d": risk_7d,
        "likely_fault": "轴承异常" if analysis_status == "abnormal" else "暂无明显类型",
        "fault_type_probs": [{"name": "轴承磨损", "prob": 0.4}, {"name": "其他", "prob": 0.6}],
        "rul_days": rul_days,
        "rul_ci": [max(1, rul_days - 5), rul_days + 10],
        "avoid": ["维持巡检", "关注趋势变化"],
        "contingency": {
            "steps": "机旁确认后按标准工序处置",
            "spares": [],
            "workorder_hint": "预测转单（确认前不记故障台次）",
        },
    }


def _minimal_optimize(eligible: bool) -> dict:
    return {
        "eligible": eligible,
        "block_reason": None if eligible else "工况异常或报警未关闭，暂缓调优",
        "goal_options": [
            {"key": "energy", "label": "节能", "desc": "优先降功率/单耗"},
            {"key": "balance", "label": "平衡", "desc": "产量与能耗折中"},
            {"key": "output", "label": "高负荷生产", "desc": "优先产量，接受能耗上升"},
            {"key": "life", "label": "长寿命", "desc": "优先控温升与磨损"},
        ],
        "constraints": [],
        "goal_scenarios": {},
    }


def _minimal_current(device: dict, rng: random.Random) -> dict:
    st = device["analysis_status"]
    triggers: list[str] = []
    if device.get("alarm_code"):
        triggers.append("硬报警")
    if st in ("abnormal", "watch"):
        triggers.append("短窗偏离")
    if st == "abnormal":
        triggers.append("多源一致")
    verdict = {"normal": "正常", "watch": "关注", "abnormal": "异常"}[st]
    one_liner = {
        "normal": "关键测点在正常带内，未见明显偏离。",
        "watch": "短窗偏离升高，建议纳入本班关注。",
        "abnormal": "多测点同向异常，须机旁确认并安排处置。",
    }[st]
    return {
        "verdict": verdict,
        "one_liner": one_liner,
        "evidence": [],
        "causes": [],
        "worsen_if_ignored": None
        if st == "normal"
        else {
            "summary": "若不处理，异常可能在 24～72h 内加重。",
            "horizon": "24～72h",
            "risk_level": "高" if st == "abnormal" else "中",
        },
        "trend_24h": {},
        "deviation_score": 88 if st == "abnormal" else 52 if st == "watch" else 12,
        "duration_hours": round(rng.uniform(0.6, 4.5), 1) if st != "normal" else 0,
        "triggers": triggers,
    }


def _build_fleet_devices(n: int) -> list[dict]:
    rng = random.Random(20260828)
    abnormal_n = 31
    watch_n = 51
    offline_n = 37
    normal_n = n - abnormal_n - watch_n
    status_pool = ["abnormal"] * abnormal_n + ["watch"] * watch_n + ["normal"] * normal_n
    comm_pool = ["offline"] * offline_n + ["online"] * (n - offline_n)
    rng.shuffle(status_pool)
    rng.shuffle(comm_pool)

    devices: list[dict] = []
    for i in range(1, n + 1):
        dept = _pick_weighted(rng, DEPT_LEAF_WEIGHTS)
        dtype = _pick_weighted(rng, DEVICE_TYPE_WEIGHTS)
        analysis_status = status_pool[i - 1]
        comm_status = comm_pool[i - 1]
        if analysis_status == "abnormal":
            run_status = "alarm"
            alarm_code = f"AL-{2000 + i}"
        else:
            alarm_code = None
            if comm_status == "offline":
                run_status = "stopped"
            else:
                run_status = rng.choices(
                    ["running", "idle", "stopped"], weights=[65, 20, 15], k=1
                )[0]

        power = round(rng.uniform(45, 180), 1)
        temp = round(rng.uniform(55, 95), 1)
        device_id = f"EQ-F{i:04d}"
        source_id = _dept_source_id(dept)
        eligible = analysis_status != "abnormal" and comm_status == "online"
        devices.append(
            {
                "id": device_id,
                "code": device_id,
                "name": f"{dtype}-{i:04d}",
                "type": dtype,
                "dept_id": dept["id"],
                "dept_name": dept["name"],
                "source_id": source_id,
                "point_ids": ["PT-TEMP", "PT-PWR", "PT-CUR"],
                "run_status": run_status,
                "comm_status": comm_status,
                "analysis_status": analysis_status,
                "summary": _minimal_current({"analysis_status": analysis_status, "alarm_code": alarm_code}, rng)[
                    "one_liner"
                ],
                "realtime": {
                    "rpm": rng.randint(1200, 1500),
                    "pressure": round(rng.uniform(0.7, 0.9), 2),
                    "temp": temp,
                    "vibration": round(rng.uniform(1.5, 6.5), 1),
                    "current": round(rng.uniform(40, 100), 1),
                    "power": power,
                    "humidity": round(rng.uniform(40, 60), 1),
                    "ambient_temp": round(rng.uniform(24, 30), 1),
                },
                "display_metrics": ["temp", "power"],
                "output_today": rng.randint(180, 420),
                "energy_score": rng.randint(72, 96),
                "last_sample_at": None if comm_status == "offline" else "2026-08-27T21:00:00+08:00",
                "alarm_code": alarm_code,
                "current": _minimal_current(
                    {"analysis_status": analysis_status, "alarm_code": alarm_code}, rng
                ),
                "future": _minimal_future(analysis_status, rng),
                "optimize": _minimal_optimize(eligible),
            }
        )
    return devices


def _compute_fleet_trend(devices: list[dict]) -> list[dict]:
    leaf_ids = [d["id"] for d in DEPT_LEAVES]
    issue_by_dept = {
        did: sum(
            1
            for d in devices
            if d["dept_id"] == did and d["analysis_status"] in {"watch", "abnormal"}
        )
        for did in leaf_ids
    }
    labels = ["08-21", "08-22", "08-23", "08-24", "08-25", "08-26", "08-27"]
    factors = [0.62, 0.68, 0.74, 0.81, 0.88, 0.94, 1.0]
    trend: list[dict] = []
    for label, factor in zip(labels, factors):
        by_dept = {did: max(0, int(issue_by_dept[did] * factor)) for did in leaf_ids}
        trend.append({"label": label, "by_dept": by_dept})
    return trend


def _metric_status(value: float, low: float, high: float) -> str:
    if value > high:
        return "alarm"
    if value > low * 1.15 or value < low * 0.85:
        return "warn"
    return "normal"


def _enrich_current_blocks(devices: list[dict]) -> None:
    """为锚点设备现状 Tab 补充图表/卡片字段。"""
    for d in devices:
        if d["id"] not in ANCHOR_IDS:
            continue
        cur = d["current"]
        rt = d["realtime"]
        st = d["analysis_status"]
        triggers: list[str] = []
        if d.get("alarm_code"):
            triggers.append("硬报警")
        if st in ("abnormal", "watch"):
            triggers.append("短窗偏离")
        if st == "abnormal":
            triggers.append("多源一致")

        vib_pts = [p["value"] for p in cur["trend_24h"].get("vibration", [])]
        temp_pts = [p["value"] for p in cur["trend_24h"].get("temp", [])]

        if d["type"] in ("螺杆压缩机", "离心压缩机", "活塞压缩机"):
            cur["metric_cards"] = [
                {
                    "code": "vibration",
                    "label": "主机振动",
                    "value": rt["vibration"],
                    "unit": "mm/s",
                    "band_low": 1.5,
                    "band_high": 4.0,
                    "status": _metric_status(rt["vibration"], 1.5, 4.0),
                    "delta_pct": 32 if d["id"] == "EQ-C02" else 2,
                },
                {
                    "code": "temp",
                    "label": "轴承温度",
                    "value": rt["temp"],
                    "unit": "℃",
                    "band_low": 55,
                    "band_high": 80,
                    "status": _metric_status(rt["temp"], 55, 80),
                    "delta_pct": 28 if d["id"] == "EQ-C02" else 1,
                },
                {
                    "code": "current",
                    "label": "电机电流",
                    "value": rt["current"],
                    "unit": "A",
                    "band_low": 70,
                    "band_high": 90,
                    "status": _metric_status(rt["current"], 70, 90),
                    "delta_pct": 12 if d["id"] == "EQ-C02" else 0,
                },
                {
                    "code": "exhaust_temp",
                    "label": "排气温度",
                    "value": rt.get("exhaust_temp", rt["temp"] + 18),
                    "unit": "℃",
                    "band_low": 75,
                    "band_high": 105,
                    "status": _metric_status(float(rt.get("exhaust_temp", rt["temp"] + 18)), 75, 105),
                    "delta_pct": 18 if d["id"] == "EQ-C02" else 1,
                },
            ]
            cur["band_trend"] = {
                "code": "vibration",
                "label": "主机振动 · 近 24h",
                "unit": "mm/s",
                "band_low": 1.5,
                "band_high": 4.0,
                "points": cur["trend_24h"]["vibration"],
            }
            cur["multi_source"] = [
                {"dim": "主机振动", "score": min(100, int(rt["vibration"] / 6.2 * 100)) if d["id"] == "EQ-C02" else 25},
                {"dim": "电机电流", "score": 78 if d["id"] == "EQ-C02" else 30},
                {"dim": "轴承温度", "score": 85 if d["id"] == "EQ-C02" else 28},
                {"dim": "排气温度", "score": 80 if d["id"] == "EQ-C02" else 22},
            ]
            cur["peer_compare"] = (
                "同站 1#压缩机主机振动 2.3 mm/s、轴承温度 68℃，本机振动与温升明显偏高。"
                if d["id"] == "EQ-C02"
                else "同站 2#压缩机异常中，本机四测点均在正常带内。"
            )
        else:
            cur["metric_cards"] = [
                {
                    "code": "temp",
                    "label": "工艺温度",
                    "value": rt["temp"],
                    "unit": "℃",
                    "band_low": 175,
                    "band_high": 188,
                    "status": "warn",
                    "delta_pct": 8,
                },
                {
                    "code": "power",
                    "label": "功率",
                    "value": rt["power"],
                    "unit": "kW",
                    "band_low": 95,
                    "band_high": 115,
                    "status": "warn",
                    "delta_pct": 12,
                },
            ]
            cur["band_trend"] = {
                "code": "temp",
                "label": "工艺温度 · 近 24h",
                "unit": "℃",
                "band_low": 175,
                "band_high": 188,
                "points": cur["trend_24h"]["temp"],
            }
            cur["multi_source"] = [
                {"dim": "工艺(温度)", "score": 72},
                {"dim": "电气(功率)", "score": 58},
                {"dim": "环境", "score": 18},
            ]
            cur["peer_compare"] = "同线暂无第二台注塑机对标；与车间能耗标杆比单耗偏高。"

        cur["triggers"] = triggers
        cur["deviation_score"] = (
            88 if st == "abnormal" else 52 if st == "watch" else 12
        )
        cur["duration_hours"] = 3.2 if st == "abnormal" else 1.5 if st == "watch" else 0
        cur["sparkline"] = vib_pts if d["type"] in ("螺杆压缩机", "离心压缩机", "活塞压缩机") else temp_pts

        if d["id"] == "EQ-C02":
            cur["contributions"] = [
                {"name": "主机振动", "value": 36},
                {"name": "轴承温度", "value": 28},
                {"name": "排气温度", "value": 20},
                {"name": "电机电流", "value": 16},
            ]
            cur["evidence_compare"] = [
                {"metric": "主机振动", "baseline": 4.7, "current": 6.2, "unit": "mm/s"},
                {"metric": "轴承温度", "baseline": 78, "current": 92, "unit": "℃"},
                {"metric": "电机电流", "baseline": 88, "current": 96, "unit": "A"},
                {"metric": "排气温度", "baseline": 102, "current": 118, "unit": "℃"},
            ]
            cur["action_steps"] = [
                "机旁确认 AL-1001 是否仍活跃",
                "复测主机振动 / 轴承温度 / 电机电流 / 排气温度",
                "安排 24～72h 窗口检修，预留 SP-882",
            ]
        elif d["id"] == "EQ-P01":
            cur["contributions"] = [
                {"name": "工艺温度", "value": 42},
                {"name": "功率", "value": 28},
                {"name": "单耗", "value": 18},
            ]
            cur["evidence_compare"] = [
                {"metric": "工艺温度", "baseline": 178, "current": 183, "unit": "℃"},
                {"metric": "功率", "baseline": 105, "current": 112, "unit": "kW"},
            ]
            cur["action_steps"] = [
                "本周复核工艺温度设定",
                "对比同线标杆单耗",
                "加密班次点检",
            ]
        else:
            cur["contributions"] = []
            cur["evidence_compare"] = [
                {"metric": "主机振动", "baseline": 2.2, "current": 2.3, "unit": "mm/s"},
                {"metric": "轴承温度", "baseline": 67, "current": 68, "unit": "℃"},
                {"metric": "电机电流", "baseline": 81, "current": 82, "unit": "A"},
                {"metric": "排气温度", "baseline": 85, "current": 86, "unit": "℃"},
            ]
            cur["action_steps"] = ["维持常规巡检", "关注未来风险页 RUL 变化"]


def _assert_anchor_consistency(devices: list[dict]) -> None:
    """锚点设备自检。"""
    for d in devices:
        if d["id"] not in ANCHOR_IDS:
            continue
        rt = d["realtime"]
        # 摘要与分析状态一致
        assert d["analysis_status"] in {"normal", "watch", "abnormal"}
        if d["analysis_status"] == "abnormal":
            assert d["run_status"] == "alarm" or d.get("alarm_code")
        # 未来风险与现状量级匹配（异常机风险应高）
        if d["id"] == "EQ-C02":
            assert d["future"]["risk_7d"] == 72
            assert d["future"]["rul_days"] == 5
            assert rt["temp"] == 92.0
            assert rt["vibration"] == 6.2
            assert rt["current"] == 96.0
            assert rt["exhaust_temp"] == 118.0
            assert rt["power"] == 168.0
            assert d["current"]["causes"][0]["prob"] == 76
            assert d["display_metrics"] == list(COMPRESSOR_CORE_METRICS)
        if d["id"] == "EQ-C01":
            assert rt["power"] == 145.0
            assert d["output_today"] == 320
            assert d["future"]["risk_7d"] == 8
        if d["id"] == "EQ-P01":
            assert d["analysis_status"] == "watch"
            assert d["future"]["risk_7d"] == 35
            assert rt["temp"] == 183.0


def build_catalog() -> dict:
    # Demo 只保留三台差异化设备：正常 / 异常 / 关注
    devices = list(ANCHOR_DEVICES)
    assert len(devices) == FLEET_SIZE
    _enrich_current_blocks(devices)
    _assert_anchor_consistency(devices)
    # 测点挂到采集源：按设备 source 归属（演示：空压站源挂机械/电气点，车间源同）
    points_out = []
    for p in POINTS:
        # 演示：所有点模板可被两源引用；绑定在设备 point_ids
        points_out.append({**p, "source_id": "SRC-SIM-01"})
    # 车间侧复用同一测点定义（避免重复 id）；绑定靠设备 point_ids
    return {
        "version": "1.0.0",
        "generated_note": "单一数据源；页面接口仅投影本 catalog",
        "depts": CATALOG_DEPTS,
        "sources": SOURCES,
        "points": points_out,
        "point_categories": [
            {"key": "plc", "label": "PLC/工况"},
            {"key": "elec", "label": "电气"},
            {"key": "env", "label": "环境"},
        ],
        "status_label": {
            "online": "在线",
            "offline": "离线",
            "running": "运行",
            "idle": "空闲",
            "stopped": "停止",
            "fault": "故障",
            "alarm": "告警",
            "normal": "正常",
            "watch": "关注",
            "abnormal": "异常",
        },
        "status_color": {
            "online": "green",
            "offline": "default",
            "running": "green",
            "idle": "blue",
            "stopped": "default",
            "fault": "red",
            "alarm": "red",
            "normal": "green",
            "watch": "orange",
            "abnormal": "red",
        },
        "metric_labels": {
            "rpm": "转速",
            "pressure": "排气压力",
            "temp": "轴承温度",
            "vibration": "主机振动",
            "current": "电机电流",
            "exhaust_temp": "排气温度",
            "power": "功率",
            "humidity": "湿度",
            "ambient_temp": "环境温度",
        },
        "devices": devices,
        "fleet_abnormal_trend_7d": _compute_fleet_trend(devices),
    }


def main() -> None:
    catalog = build_catalog()
    path = OUT / "catalog.json"
    path.write_text(
        json.dumps(catalog, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print("wrote", path)
    print("devices:", len(catalog["devices"]))
    print(
        "sample:",
        [d["id"] for d in catalog["devices"][:3]],
        "...",
        catalog["devices"][-1]["id"],
    )


if __name__ == "__main__":
    main()
