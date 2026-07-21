"""意图识别与路由：Demo 用规则引擎；正式版可替换为 LLM Intent Recognizer。"""

from datetime import date
import re

from app.runtime.types import QueryIntent, RouteType

# 关键字 -> Skill
SKILL_RULES: list[tuple[list[str], str, str]] = [
    (["异常", "原因", "分析", "根因", "下降原因"], "production_anomaly_analysis", "命中生产异常分析 Skill"),
]

# 关键字 -> Tool + metric
TOOL_RULES: list[tuple[list[str], str, str, str]] = [
    (["产量", "产出", "产量多少"], "query_metric", "daily_output", "命中产量指标查询"),
    (["发气", "气量"], "query_metric", "gas_volume", "命中发气量查询"),
    (["稼动", "开机率", "设备状态"], "query_metric", "device_uptime", "命中设备稼动率查询"),
    (["告警", "报警"], "query_metric", "alarm_count", "命中告警次数查询"),
]

# 固定 API 场景（确定性查询）
API_RULES: list[tuple[list[str], str, str]] = [
    (["驾驶舱列表", "有哪些驾驶舱"], "/api/v1/dashboards", "命中固定驾驶舱列表 API"),
]


class IntentRouter:
    def recognize(self, query: str, *, factory_id: int = 1) -> QueryIntent:
        text = (query or "").strip()
        today = date.today().isoformat()

        if not text:
            return QueryIntent(
                raw_query=text,
                route=RouteType.UNKNOWN,
                reason="空查询",
                confidence=0.0,
            )

        # 高风险写操作禁止自由 Planner
        if any(k in text for k in ("删除", "停机指令", "下发控制", "强制启动")):
            return QueryIntent(
                raw_query=text,
                route=RouteType.FIXED_SKILL,
                target="production_anomaly_analysis",
                inputs={"factory_id": factory_id, "date": today},
                reason="高风险表述，强制收敛到固定 Skill（需人工确认，不开放 Planner）",
                confidence=0.9,
            )

        for keywords, skill_name, reason in SKILL_RULES:
            if any(k in text for k in keywords):
                return QueryIntent(
                    raw_query=text,
                    route=RouteType.FIXED_SKILL,
                    target=skill_name,
                    inputs={"factory_id": factory_id, "date": today},
                    reason=reason,
                    confidence=0.88,
                )

        for keywords, tool_name, metric_code, reason in TOOL_RULES:
            if any(k in text for k in keywords):
                return QueryIntent(
                    raw_query=text,
                    route=RouteType.SINGLE_TOOL,
                    target=tool_name,
                    inputs={
                        "metric_code": metric_code,
                        "start_time": today,
                        "end_time": today,
                        "dimensions": {"factory_id": factory_id},
                    },
                    reason=reason,
                    confidence=0.85,
                )

        for keywords, api_path, reason in API_RULES:
            if any(k in text for k in keywords):
                return QueryIntent(
                    raw_query=text,
                    route=RouteType.FIXED_API,
                    target=api_path,
                    inputs={},
                    reason=reason,
                    confidence=0.8,
                )

        # 开放式问题：Demo 走受约束 Planner（固定为异常分析 Skill + 标记）
        if re.search(r"(怎么样|如何|帮我看|分析一下|情况)", text):
            return QueryIntent(
                raw_query=text,
                route=RouteType.PLANNER,
                target="production_anomaly_analysis",
                inputs={"factory_id": factory_id, "date": today},
                reason="开放式问题，Demo Planner 收敛到受约束 Skill 计划",
                confidence=0.7,
            )

        return QueryIntent(
            raw_query=text,
            route=RouteType.UNKNOWN,
            reason="未识别到可用路由，请换用更明确的业务问题",
            confidence=0.3,
        )
