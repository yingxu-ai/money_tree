from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import CurrentUser
from app.auth.data_scope import resolve_scope_filter
from app.auth.tenant_context import try_effective_tenant_id
from app.core.exceptions import NotFoundException, ValidationException
from app.models.system import SysDept, SysUser


class DeptService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_tree(self, current: CurrentUser) -> list[dict]:
        tid = try_effective_tenant_id(current.user, current.operating_tenant_id)
        if tid is None:
            return []
        result = await self.session.execute(
            select(SysDept)
            .where(
                SysDept.is_deleted.is_(False),
                SysDept.tenant_id == tid,
            )
            .order_by(SysDept.sort, SysDept.id)
        )
        depts = list(result.scalars().all())

        scope = await resolve_scope_filter(
            self.session,
            data_scope=current.data_scope,
            user_id=current.id,
            dept_id=current.dept_id,
            tenant_id=tid,
        )
        if scope.allowed_dept_ids is None and scope.only_self_user_id is None:
            return self._build_tree(depts)

        # SELF：仍按所属部门展示（若有）
        if scope.only_self_user_id is not None:
            if current.dept_id is None:
                return []
            allowed = {current.dept_id}
        else:
            allowed = scope.allowed_dept_ids or set()

        if not allowed:
            return []
        scoped = [d for d in depts if d.id in allowed]
        return self._build_scoped_tree(scoped)

    async def create_dept(self, data, *, tenant_id: int) -> dict:
        if data.parent_id is not None:
            await self._get_dept(data.parent_id, tenant_id=tenant_id)
        payload = data.model_dump()
        dept = SysDept(**payload, tenant_id=tenant_id)
        self.session.add(dept)
        await self.session.flush()
        return self._serialize(dept)

    async def update_dept(self, dept_id: int, data, *, tenant_id: int) -> dict:
        dept = await self._get_dept(dept_id, tenant_id=tenant_id)
        payload = data.model_dump(exclude_unset=True)
        if "parent_id" in payload:
            parent_id = payload["parent_id"]
            if parent_id == dept_id:
                raise ValidationException("上级部门不能是自身")
            if parent_id is not None:
                await self._get_dept(parent_id, tenant_id=tenant_id)
                if await self._is_descendant(dept_id, parent_id, tenant_id=tenant_id):
                    raise ValidationException("上级部门不能是当前部门的下级")
        for key, value in payload.items():
            setattr(dept, key, value)
        return self._serialize(dept)

    async def delete_dept(self, dept_id: int, *, tenant_id: int) -> None:
        dept = await self._get_dept(dept_id, tenant_id=tenant_id)
        children = await self.session.execute(
            select(SysDept).where(
                SysDept.parent_id == dept_id,
                SysDept.tenant_id == tenant_id,
                SysDept.is_deleted.is_(False),
            )
        )
        if children.scalars().first() is not None:
            raise ValidationException("请先删除子部门")
        users = await self.session.execute(
            select(SysUser).where(
                SysUser.dept_id == dept_id,
                SysUser.tenant_id == tenant_id,
                SysUser.is_deleted.is_(False),
            )
        )
        if users.scalars().first() is not None:
            raise ValidationException("部门下仍有用户，无法删除")
        dept.is_deleted = True

    async def _get_dept(self, dept_id: int, *, tenant_id: int) -> SysDept:
        result = await self.session.execute(
            select(SysDept).where(
                SysDept.id == dept_id,
                SysDept.tenant_id == tenant_id,
                SysDept.is_deleted.is_(False),
            )
        )
        dept = result.scalar_one_or_none()
        if dept is None:
            raise NotFoundException("部门不存在")
        return dept

    async def _is_descendant(self, ancestor_id: int, node_id: int, *, tenant_id: int) -> bool:
        """判断 node_id 是否在 ancestor_id 的子孙中。"""
        result = await self.session.execute(
            select(SysDept).where(
                SysDept.is_deleted.is_(False),
                SysDept.tenant_id == tenant_id,
            )
        )
        depts = {d.id: d for d in result.scalars().all()}
        current = depts.get(node_id)
        while current and current.parent_id is not None:
            if current.parent_id == ancestor_id:
                return True
            current = depts.get(current.parent_id)
        return False

    def _build_tree(self, depts: list[SysDept], parent_id: int | None = None) -> list[dict]:
        nodes = []
        for dept in depts:
            if dept.parent_id == parent_id:
                nodes.append({**self._serialize(dept), "children": self._build_tree(depts, dept.id)})
        return nodes

    def _build_scoped_tree(self, depts: list[SysDept]) -> list[dict]:
        """父节点不在可见集内时，将该节点作为根展示。"""
        by_id = {d.id: d for d in depts}
        roots = [d for d in depts if d.parent_id is None or d.parent_id not in by_id]

        def children_of(parent_id: int) -> list[dict]:
            nodes = []
            for dept in depts:
                if dept.parent_id == parent_id:
                    nodes.append({**self._serialize(dept), "children": children_of(dept.id)})  # type: ignore[arg-type]
            return nodes

        return [{**self._serialize(d), "children": children_of(d.id)} for d in roots]  # type: ignore[arg-type]

    def _serialize(self, dept: SysDept) -> dict:
        return {
            "id": dept.id,
            "parent_id": dept.parent_id,
            "name": dept.name,
            "code": dept.code,
            "sort": dept.sort,
            "status": dept.status,
            "leader": dept.leader,
            "phone": dept.phone,
            "tenant_id": dept.tenant_id,
            "children": [],
        }
