from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundException, ValidationException
from app.models.system import SysMenu, SysPermission, SysRole, SysRoleMenu, SysRolePermission


class RoleService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_roles(self) -> list[dict]:
        result = await self.session.execute(
            select(SysRole).where(SysRole.is_deleted.is_(False)).order_by(SysRole.id)
        )
        roles = result.scalars().all()
        items = []
        for role in roles:
            menu_ids, permission_ids = await self._role_relations(role.id)  # type: ignore[arg-type]
            items.append(self._serialize(role, menu_ids, permission_ids))
        return items

    async def create_role(self, data) -> dict:
        role = SysRole(
            name=data.name,
            code=data.code,
            status=data.status,
            data_scope=data.data_scope,
        )
        self.session.add(role)
        await self.session.flush()
        await self._sync_relations(role.id, data.menu_ids, data.permission_ids)  # type: ignore[arg-type]
        return self._serialize(role, data.menu_ids, data.permission_ids)

    async def update_role(self, role_id: int, data) -> dict:
        role = await self._get_role(role_id)
        if data.name is not None:
            role.name = data.name
        if data.status is not None:
            role.status = data.status
        if data.data_scope is not None:
            role.data_scope = data.data_scope
        menu_ids, permission_ids = await self._role_relations(role_id)
        if data.menu_ids is not None:
            menu_ids = data.menu_ids
        if data.permission_ids is not None:
            permission_ids = data.permission_ids
        await self._sync_relations(role_id, menu_ids, permission_ids)
        return self._serialize(role, menu_ids, permission_ids)

    async def delete_role(self, role_id: int) -> None:
        role = await self._get_role(role_id)
        role.is_deleted = True

    async def _get_role(self, role_id: int) -> SysRole:
        result = await self.session.execute(
            select(SysRole).where(SysRole.id == role_id, SysRole.is_deleted.is_(False))
        )
        role = result.scalar_one_or_none()
        if role is None:
            raise NotFoundException("角色不存在")
        return role

    async def _role_relations(self, role_id: int) -> tuple[list[int], list[int]]:
        menu_result = await self.session.execute(
            select(SysRoleMenu.menu_id).where(SysRoleMenu.role_id == role_id)
        )
        perm_result = await self.session.execute(
            select(SysRolePermission.permission_id).where(SysRolePermission.role_id == role_id)
        )
        return list(menu_result.scalars().all()), list(perm_result.scalars().all())

    async def _sync_relations(
        self, role_id: int, menu_ids: list[int], permission_ids: list[int]
    ) -> None:
        for model, ids, field in [
            (SysRoleMenu, menu_ids, "menu_id"),
            (SysRolePermission, permission_ids, "permission_id"),
        ]:
            existing = await self.session.execute(
                select(model).where(model.role_id == role_id)  # type: ignore[attr-defined]
            )
            for row in existing.scalars().all():
                await self.session.delete(row)
            for item_id in ids:
                self.session.add(model(role_id=role_id, **{field: item_id}))  # type: ignore[call-arg]

    def _serialize(self, role: SysRole, menu_ids: list[int], permission_ids: list[int]) -> dict:
        return {
            "id": role.id,
            "name": role.name,
            "code": role.code,
            "status": role.status,
            "data_scope": role.data_scope,
            "menu_ids": menu_ids,
            "permission_ids": permission_ids,
        }


class MenuService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_menus(self) -> list[dict]:
        result = await self.session.execute(
            select(SysMenu).where(SysMenu.is_deleted.is_(False)).order_by(SysMenu.sort, SysMenu.id)
        )
        menus = result.scalars().all()
        return self._build_tree(menus)

    async def create_menu(self, data) -> dict:
        menu = SysMenu(**data.model_dump())
        self.session.add(menu)
        await self.session.flush()
        return self._serialize(menu)

    async def update_menu(self, menu_id: int, data) -> dict:
        menu = await self._get_menu(menu_id)
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(menu, key, value)
        return self._serialize(menu)

    async def delete_menu(self, menu_id: int) -> None:
        menu = await self._get_menu(menu_id)
        children = await self.session.execute(
            select(SysMenu).where(SysMenu.parent_id == menu_id, SysMenu.is_deleted.is_(False))
        )
        if children.scalars().first() is not None:
            raise ValidationException("请先删除子菜单")
        menu.is_deleted = True

    async def list_permissions(self) -> list[dict]:
        result = await self.session.execute(select(SysPermission).order_by(SysPermission.id))
        return [
            {
                "id": p.id,
                "code": p.code,
                "name": p.name,
                "resource": p.resource,
                "action": p.action,
            }
            for p in result.scalars().all()
        ]

    async def _get_menu(self, menu_id: int) -> SysMenu:
        result = await self.session.execute(
            select(SysMenu).where(SysMenu.id == menu_id, SysMenu.is_deleted.is_(False))
        )
        menu = result.scalar_one_or_none()
        if menu is None:
            raise NotFoundException("菜单不存在")
        return menu

    def _build_tree(self, menus: list[SysMenu], parent_id: int | None = None) -> list[dict]:
        nodes = []
        for menu in menus:
            if menu.parent_id == parent_id:
                nodes.append(
                    {
                        **self._serialize(menu),
                        "children": self._build_tree(menus, menu.id),
                    }
                )
        return nodes

    def _serialize(self, menu: SysMenu) -> dict:
        return {
            "id": menu.id,
            "parent_id": menu.parent_id,
            "name": menu.name,
            "path": menu.path,
            "component": menu.component,
            "type": menu.type,
            "sort": menu.sort,
            "visible": menu.visible,
            "icon": menu.icon,
            "children": [],
        }
