"""组织数据范围：按角色 data_scope 解析可见部门 / 本人。"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import DataScope
from app.models.system import SysDept, SysUser

# 多角色取最宽（数值越大权限越大）
_SCOPE_RANK: dict[str, int] = {
    DataScope.SELF.value: 0,
    DataScope.CUSTOM.value: 1,  # 一期未实现自定义部门集，暂等同「无可选部门」
    DataScope.SELF_ORG.value: 2,
    DataScope.ORG.value: 3,
    DataScope.ALL.value: 4,
}


def resolve_effective_scope(scopes: list[str]) -> str:
    if not scopes:
        return DataScope.SELF.value
    return max(scopes, key=lambda s: _SCOPE_RANK.get(s, -1))


def collect_subtree_ids(root_id: int, pairs: list[tuple[int, int | None]]) -> set[int]:
    children: dict[int | None, list[int]] = {}
    for dept_id, parent_id in pairs:
        children.setdefault(parent_id, []).append(dept_id)
    out = {root_id}
    stack = [root_id]
    while stack:
        current = stack.pop()
        for child_id in children.get(current, []):
            if child_id not in out:
                out.add(child_id)
                stack.append(child_id)
    return out


@dataclass(frozen=True)
class ScopeFilter:
    """allowed_dept_ids=None 表示不限制部门；空集合表示无可见部门。"""

    data_scope: str
    allowed_dept_ids: set[int] | None
    only_self_user_id: int | None = None

    @property
    def is_unrestricted(self) -> bool:
        return self.allowed_dept_ids is None and self.only_self_user_id is None


def build_scope_filter(
    data_scope: str,
    *,
    user_id: int,
    dept_id: int | None,
    dept_pairs: list[tuple[int, int | None]],
) -> ScopeFilter:
    if data_scope == DataScope.ALL.value:
        return ScopeFilter(data_scope=data_scope, allowed_dept_ids=None)

    if data_scope == DataScope.SELF.value:
        return ScopeFilter(
            data_scope=data_scope,
            allowed_dept_ids=None,
            only_self_user_id=user_id,
        )

    if data_scope == DataScope.SELF_ORG.value:
        if dept_id is None:
            return ScopeFilter(data_scope=data_scope, allowed_dept_ids=set())
        return ScopeFilter(data_scope=data_scope, allowed_dept_ids={dept_id})

    if data_scope == DataScope.ORG.value:
        if dept_id is None:
            return ScopeFilter(data_scope=data_scope, allowed_dept_ids=set())
        return ScopeFilter(
            data_scope=data_scope,
            allowed_dept_ids=collect_subtree_ids(dept_id, dept_pairs),
        )

    # CUSTOM：一期无自定义部门表，返回空集（安全默认）
    return ScopeFilter(data_scope=data_scope, allowed_dept_ids=set())


async def load_dept_pairs(session: AsyncSession) -> list[tuple[int, int | None]]:
    result = await session.execute(
        select(SysDept.id, SysDept.parent_id).where(SysDept.is_deleted.is_(False))
    )
    return [(row[0], row[1]) for row in result.all()]


async def resolve_scope_filter(
    session: AsyncSession,
    *,
    data_scope: str,
    user_id: int,
    dept_id: int | None,
) -> ScopeFilter:
    pairs = await load_dept_pairs(session)
    return build_scope_filter(
        data_scope,
        user_id=user_id,
        dept_id=dept_id,
        dept_pairs=pairs,
    )


def apply_user_scope(stmt: Select, scope: ScopeFilter) -> Select | None:
    """返回 None 表示结果必为空，调用方应直接返回空列表。"""
    if scope.only_self_user_id is not None:
        return stmt.where(SysUser.id == scope.only_self_user_id)
    if scope.allowed_dept_ids is None:
        return stmt
    if not scope.allowed_dept_ids:
        return None
    return stmt.where(SysUser.dept_id.in_(scope.allowed_dept_ids))
