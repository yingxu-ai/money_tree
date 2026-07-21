from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.tools.registry import ToolRegistry


@dataclass
class SkillContext:
    tenant_id: int
    user_id: int
    trace_id: str
    permissions: set[str] = field(default_factory=set)


@dataclass
class SkillMeta:
    name: str
    version: str
    description: str
    permissions: list[str]
    inputs: dict[str, str]
    tools: list[str]
    execution_mode: str = "deterministic"
    timeout_seconds: int = 60


class BaseSkill(ABC):
    meta: SkillMeta

    @abstractmethod
    async def execute(
        self, inputs: dict[str, Any], ctx: SkillContext, tools: "ToolRegistry"
    ) -> dict[str, Any]:
        ...
