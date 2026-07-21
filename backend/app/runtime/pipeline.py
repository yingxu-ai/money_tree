"""Query Pipeline：身份上下文已在 API 层完成；此处负责意图 -> 路由执行 -> 结构化结果。"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dashboard import Dashboard
from app.runtime.router import IntentRouter
from app.runtime.types import QueryIntent, QueryResult, RouteType
from app.skills.base import SkillContext
from app.skills.registry import skill_registry
from app.tools.base import ToolContext
from app.tools.registry import tool_registry


class QueryPipeline:
    def __init__(self, session: AsyncSession | None = None):
        self.session = session
        self.intent_router = IntentRouter()

    async def run(
        self,
        *,
        query: str,
        tenant_id: int,
        user_id: int,
        permissions: set[str],
        trace_id: str,
        factory_id: int = 1,
    ) -> QueryResult:
        intent = self.intent_router.recognize(query, factory_id=factory_id)
        intent_payload = {
            "raw_query": intent.raw_query,
            "route": intent.route.value,
            "target": intent.target,
            "reason": intent.reason,
            "confidence": intent.confidence,
            "inputs": intent.inputs,
        }

        if intent.route == RouteType.UNKNOWN:
            return QueryResult(
                status="failed",
                route=intent.route.value,
                target=None,
                summary=intent.reason or "无法路由该问题",
                trace_id=trace_id,
                intent=intent_payload,
                recommendations=[
                    "试试：今日产量多少？",
                    "试试：分析今日生产异常原因",
                    "试试：设备稼动率怎么样？",
                ],
            )

        if intent.route == RouteType.FIXED_API:
            data = await self._run_fixed_api(intent, tenant_id)
            return QueryResult(
                status="success",
                route=intent.route.value,
                target=intent.target,
                summary=f"已通过固定 API 查询：{intent.target}",
                data=data,
                evidence=[{"source": "fixed_api", "ref": intent.target, "data": data}],
                trace_id=trace_id,
                intent=intent_payload,
            )

        if intent.route in (RouteType.SINGLE_TOOL,):
            tool_ctx = ToolContext(
                tenant_id=tenant_id,
                user_id=user_id,
                trace_id=trace_id,
                permissions=permissions,
            )
            data = await tool_registry.execute(intent.target or "", intent.inputs, tool_ctx)
            latest = (data.get("summary") or {}).get("latest")
            unit = data.get("unit") or ""
            name = data.get("name") or data.get("metric_code") or intent.target
            return QueryResult(
                status="success",
                route=intent.route.value,
                target=intent.target,
                summary=f"{name} 最新值：{latest}{unit}",
                data=data,
                evidence=[{"source": "tool", "ref": intent.target, "data": data}],
                trace_id=trace_id,
                intent=intent_payload,
            )

        # FIXED_SKILL / PLANNER：均走受约束 Skill
        skill_ctx = SkillContext(
            tenant_id=tenant_id,
            user_id=user_id,
            trace_id=trace_id,
            permissions=permissions,
        )
        skill_name = intent.target or "production_anomaly_analysis"
        data = await skill_registry.execute(skill_name, intent.inputs, skill_ctx)
        return QueryResult(
            status=data.get("status", "success"),
            route=intent.route.value,
            target=skill_name,
            summary=str(data.get("summary") or f"已执行 Skill：{skill_name}"),
            data=data,
            evidence=list(data.get("evidence") or []),
            recommendations=list(data.get("recommendations") or []),
            trace_id=trace_id,
            intent=intent_payload,
        )

    async def _run_fixed_api(self, intent: QueryIntent, tenant_id: int) -> Any:
        if intent.target == "/api/v1/dashboards" and self.session is not None:
            result = await self.session.execute(
                select(Dashboard)
                .where(Dashboard.is_deleted.is_(False), Dashboard.tenant_id == tenant_id)
                .order_by(Dashboard.id)
            )
            items = [
                {
                    "id": d.id,
                    "name": d.name,
                    "code": d.code,
                    "status": d.status,
                    "description": d.description,
                }
                for d in result.scalars().all()
            ]
            return {"total": len(items), "items": items}
        return {"message": f"固定 API 未实现本地处理：{intent.target}"}
