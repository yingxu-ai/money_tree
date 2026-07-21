from typing import Any

from app.core.exceptions import NotFoundException, PermissionException
from app.tools.base import BaseTool, ToolContext, ToolMeta
from app.tools.metric.query_metric import QueryMetricTool


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        self._tools[tool.meta.name] = tool

    def list_tools(self) -> list[ToolMeta]:
        return [t.meta for t in self._tools.values()]

    def get(self, name: str) -> BaseTool:
        tool = self._tools.get(name)
        if tool is None:
            raise NotFoundException(f"Tool 不存在: {name}")
        return tool

    async def execute(
        self, name: str, inputs: dict[str, Any], ctx: ToolContext
    ) -> dict[str, Any]:
        tool = self.get(name)
        if tool.meta.permission and tool.meta.permission not in ctx.permissions:
            raise PermissionException(f"缺少 Tool 权限: {tool.meta.permission}")
        return await tool.execute(inputs, ctx)


def build_tool_registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(QueryMetricTool())
    return registry


tool_registry = build_tool_registry()
