from typing import Any

from app.skills.base import BaseSkill, SkillContext, SkillMeta
from app.tools.base import ToolContext
from app.tools.registry import ToolRegistry


class ProductionAnomalyAnalysisSkill(BaseSkill):
    meta = SkillMeta(
        name="production_anomaly_analysis",
        version="1.1.0",
        description="分析生产异常的可能原因（组合 Tool 取证）",
        permissions=["skill:execute:production_anomaly_analysis"],
        inputs={"factory_id": "integer", "date": "date"},
        tools=["query_metric"],
        execution_mode="deterministic",
        timeout_seconds=60,
    )

    async def execute(
        self, inputs: dict[str, Any], ctx: SkillContext, tools: ToolRegistry
    ) -> dict[str, Any]:
        tool_ctx = ToolContext(
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
            trace_id=ctx.trace_id,
            permissions=ctx.permissions,
        )
        date = inputs.get("date")
        dims = {"factory_id": inputs.get("factory_id", 1)}

        output = await tools.execute(
            "query_metric",
            {"metric_code": "daily_output", "start_time": date, "end_time": date, "dimensions": dims},
            tool_ctx,
        )
        uptime = await tools.execute(
            "query_metric",
            {"metric_code": "device_uptime", "start_time": date, "end_time": date, "dimensions": dims},
            tool_ctx,
        )
        alarms = await tools.execute(
            "query_metric",
            {"metric_code": "alarm_count", "start_time": date, "end_time": date, "dimensions": dims},
            tool_ctx,
        )

        output_delta = float((output.get("summary") or {}).get("delta_pct") or 0)
        uptime_latest = float((uptime.get("summary") or {}).get("latest") or 0)
        alarm_latest = float((alarms.get("summary") or {}).get("latest") or 0)

        findings = []
        if output_delta < -2:
            findings.append(
                {
                    "name": "产量较上一时段下降",
                    "confidence": 0.86,
                    "impact": "high",
                    "detail": f"变化 {output_delta}%",
                }
            )
        if uptime_latest < 90:
            findings.append(
                {
                    "name": "设备稼动率偏低",
                    "confidence": 0.79,
                    "impact": "high",
                    "detail": f"当前稼动率 {uptime_latest}%",
                }
            )
        if alarm_latest >= 3:
            findings.append(
                {
                    "name": "告警次数上升",
                    "confidence": 0.72,
                    "impact": "medium",
                    "detail": f"近期告警 {int(alarm_latest)} 次",
                }
            )
        if not findings:
            findings.append(
                {
                    "name": "指标波动在正常范围内",
                    "confidence": 0.65,
                    "impact": "low",
                    "detail": "未检测到显著异常",
                }
            )

        summary = (
            f"产量变化 {output_delta}% ，稼动率 {uptime_latest}% ，告警 {int(alarm_latest)} 次。"
            if findings
            else "未检测到显著生产异常。"
        )

        return {
            "status": "success",
            "summary": summary,
            "findings": findings,
            "evidence": [
                {
                    "source": "query_metric",
                    "ref": f"metric://daily_output/{date}",
                    "label": "产量趋势",
                    "data": output,
                },
                {
                    "source": "query_metric",
                    "ref": f"metric://device_uptime/{date}",
                    "label": "设备稼动率",
                    "data": uptime,
                },
                {
                    "source": "query_metric",
                    "ref": f"metric://alarm_count/{date}",
                    "label": "告警次数",
                    "data": alarms,
                },
            ],
            "recommendations": [
                "检查 3 号产线设备状态与停机记录",
                "复核原料批次质量与投料节奏",
                "对照告警清单确认是否存在重复告警",
            ],
            "trace_id": ctx.trace_id,
        }
