from typing import Any

from app.providers.base import MetricQuery
from app.providers.metric import get_metric_provider
from app.tools.base import BaseTool, ToolContext, ToolMeta


class QueryMetricTool(BaseTool):
    meta = ToolMeta(
        name="query_metric",
        version="1.1.0",
        description="查询指定指标在时间范围内的数据（经 MetricProvider，可无缝切换数据源）",
        input_schema={
            "metric_code": "string",
            "start_time": "datetime",
            "end_time": "datetime",
            "dimensions": "object",
        },
        output_schema={
            "columns": "array",
            "rows": "array",
            "unit": "string",
            "summary": "object",
        },
        permission="tool:execute:query_metric",
        timeout_seconds=10,
        read_only=True,
    )

    async def execute(self, inputs: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
        provider = get_metric_provider()
        result = await provider.query(
            MetricQuery(
                metric_code=str(inputs.get("metric_code") or "daily_output"),
                start_time=inputs.get("start_time"),
                end_time=inputs.get("end_time"),
                dimensions=inputs.get("dimensions") or {},
                tenant_id=ctx.tenant_id,
            )
        )
        payload = result.to_dict()
        payload["tenant_id"] = ctx.tenant_id
        payload["trace_id"] = ctx.trace_id
        return payload
