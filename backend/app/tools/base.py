from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolContext:
    tenant_id: int
    user_id: int
    trace_id: str
    permissions: set[str] = field(default_factory=set)


@dataclass
class ToolMeta:
    name: str
    version: str
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    permission: str
    timeout_seconds: int = 10
    read_only: bool = True


class BaseTool(ABC):
    meta: ToolMeta

    @abstractmethod
    async def execute(self, inputs: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
        ...
