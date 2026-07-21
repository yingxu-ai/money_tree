from typing import Any

from app.core.exceptions import NotFoundException, PermissionException
from app.skills.base import BaseSkill, SkillContext, SkillMeta
from app.skills.production.anomaly_analysis import ProductionAnomalyAnalysisSkill
from app.tools.base import ToolContext
from app.tools.registry import tool_registry


class SkillRegistry:
    def __init__(self) -> None:
        self._skills: dict[str, BaseSkill] = {}

    def register(self, skill: BaseSkill) -> None:
        self._skills[skill.meta.name] = skill

    def list_skills(self) -> list[SkillMeta]:
        return [s.meta for s in self._skills.values()]

    def get(self, name: str) -> BaseSkill:
        skill = self._skills.get(name)
        if skill is None:
            raise NotFoundException(f"Skill 不存在: {name}")
        return skill

    async def execute(
        self, name: str, inputs: dict[str, Any], ctx: SkillContext
    ) -> dict[str, Any]:
        skill = self.get(name)
        for perm in skill.meta.permissions:
            if perm not in ctx.permissions:
                raise PermissionException(f"缺少 Skill 权限: {perm}")
        return await skill.execute(inputs, ctx, tool_registry)


def build_skill_registry() -> SkillRegistry:
    registry = SkillRegistry()
    registry.register(ProductionAnomalyAnalysisSkill())
    return registry


skill_registry = build_skill_registry()
