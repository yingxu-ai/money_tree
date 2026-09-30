from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.tenant_sku import (
    enabled_modules_as_list,
    get_tenant_enabled_modules,
    module_for_menu_path,
)
from app.auth.context import CurrentUser
from app.auth.data_scope import apply_user_scope, resolve_effective_scope, resolve_scope_filter
from app.auth.schemas import MenuNode, UserInfo
from app.core.exceptions import AuthException, NotFoundException, ValidationException
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)
from app.models.system import (
    SysDept,
    SysLoginLog,
    SysMenu,
    SysPermission,
    SysRole,
    SysRoleMenu,
    SysRolePermission,
    SysUser,
    SysUserRole,
)


class AuthService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def login(self, username: str, password: str, ip: str | None) -> tuple[str, str, UserInfo]:
        result = await self.session.execute(
            select(SysUser).where(SysUser.username == username, SysUser.is_deleted.is_(False))
        )
        user = result.scalar_one_or_none()
        log = SysLoginLog(username=username, ip=ip, result="failed")

        if user is None or not verify_password(password, user.password_hash):
            self.session.add(log)
            await self.session.flush()
            raise AuthException("用户名或密码错误")

        if user.status != "active":
            log.user_id = user.id
            self.session.add(log)
            await self.session.flush()
            raise AuthException("用户已禁用")

        log.user_id = user.id
        log.result = "success"
        self.session.add(log)

        current = await self._build_current_user(user)
        access = create_access_token(str(user.id), {"tenant_id": user.tenant_id})
        refresh = create_refresh_token(str(user.id))
        return access, refresh, await self._to_user_info(current)

    async def get_me(self, current: CurrentUser) -> UserInfo:
        return await self._to_user_info(current)

    async def update_profile(self, current: CurrentUser, data) -> UserInfo:
        user = current.user
        if data.display_name is not None:
            user.display_name = data.display_name.strip()
        if "email" in data.model_fields_set:
            user.email = data.email
        if "avatar_url" in data.model_fields_set:
            self._validate_avatar_url(data.avatar_url)
            user.avatar_url = data.avatar_url
        await self.session.flush()
        refreshed = await self._build_current_user(user)
        return await self._to_user_info(refreshed)

    async def change_password(self, current: CurrentUser, old_password: str, new_password: str) -> None:
        user = current.user
        if not verify_password(old_password, user.password_hash):
            raise ValidationException("当前密码不正确")
        if old_password == new_password:
            raise ValidationException("新密码不能与当前密码相同")
        user.password_hash = hash_password(new_password)
        await self.session.flush()

    async def update_avatar_file(self, current: CurrentUser, file_id: int) -> UserInfo:
        from app.application.file_service import FileService

        file_service = FileService(self.session)
        record = await file_service.get_file(file_id, current.tenant_id)
        mime = (record.mime_type or "").lower()
        if not mime.startswith("image/"):
            raise ValidationException("头像仅支持图片文件")
        current.user.avatar_url = f"file:{file_id}"
        await self.session.flush()
        refreshed = await self._build_current_user(current.user)
        return await self._to_user_info(refreshed)

    def _validate_avatar_url(self, avatar_url: str | None) -> None:
        if avatar_url is None or avatar_url == "":
            return
        if avatar_url.startswith("/avatars/") and avatar_url.endswith((".svg", ".png", ".jpg", ".jpeg", ".webp")):
            return
        if avatar_url.startswith("file:") and avatar_url[5:].isdigit():
            return
        raise ValidationException("头像地址不合法")

    async def get_menus(self, current: CurrentUser) -> list[MenuNode]:
        menu_ids_result = await self.session.execute(
            select(SysRoleMenu.menu_id)
            .join(SysUserRole, SysUserRole.role_id == SysRoleMenu.role_id)
            .where(SysUserRole.user_id == current.id)
        )
        allowed_menu_ids = set(menu_ids_result.scalars().all())
        if not allowed_menu_ids:
            return []

        menus_result = await self.session.execute(
            select(SysMenu)
            .where(SysMenu.is_deleted.is_(False), SysMenu.visible.is_(True))
            .order_by(SysMenu.sort, SysMenu.id)
        )
        menus = [m for m in menus_result.scalars().all() if m.id in allowed_menu_ids]

        # 按租户 SKU 再裁一刀（模式 B）
        enabled = await get_tenant_enabled_modules(self.session, current.tenant_id)
        if enabled is not None:
            menus = [
                m
                for m in menus
                if m.type == "CATALOG"
                or module_for_menu_path(m.path) is None
                or module_for_menu_path(m.path) in enabled
            ]

        perm_map = await self._menu_permissions(allowed_menu_ids)
        tree = self._build_menu_tree(menus, perm_map)
        return self._prune_empty_catalogs(tree)

    @staticmethod
    def _prune_empty_catalogs(nodes: list[MenuNode]) -> list[MenuNode]:
        out: list[MenuNode] = []
        for node in nodes:
            children = AuthService._prune_empty_catalogs(node.children)
            if node.type == "CATALOG" and not children and not node.path:
                continue
            out.append(node.model_copy(update={"children": children}))
        return out

    async def _to_user_info(self, current: CurrentUser) -> UserInfo:
        user = current.user
        dept_name = await self._dept_name(user.dept_id)
        enabled = await get_tenant_enabled_modules(self.session, user.tenant_id)
        return UserInfo(
            id=user.id,  # type: ignore[arg-type]
            username=user.username,
            display_name=user.display_name,
            email=user.email,
            avatar_url=getattr(user, "avatar_url", None),
            tenant_id=user.tenant_id,
            dept_id=user.dept_id,
            dept_name=dept_name,
            status=user.status,
            data_scope=current.data_scope,
            roles=current.roles,
            role_names=current.role_names,
            permissions=sorted(current.permissions),
            enabled_modules=enabled_modules_as_list(enabled),
            created_at=user.created_at.isoformat() if user.created_at else None,
        )

    async def _build_current_user(self, user: SysUser) -> CurrentUser:
        role_result = await self.session.execute(
            select(SysRole.code, SysRole.name, SysRole.data_scope)
            .join(SysUserRole, SysUserRole.role_id == SysRole.id)
            .where(SysUserRole.user_id == user.id, SysRole.is_deleted.is_(False))
        )
        role_rows = list(role_result.all())
        roles = [row[0] for row in role_rows]
        role_names = [row[1] for row in role_rows]
        data_scope = resolve_effective_scope([row[2] for row in role_rows])

        perm_result = await self.session.execute(
            select(SysPermission.code)
            .join(SysRolePermission, SysRolePermission.permission_id == SysPermission.id)
            .join(SysUserRole, SysUserRole.role_id == SysRolePermission.role_id)
            .where(SysUserRole.user_id == user.id)
        )
        permissions = set(perm_result.scalars().all())
        return CurrentUser(
            user=user,
            roles=roles,
            role_names=role_names,
            permissions=permissions,
            data_scope=data_scope,
        )

    async def _menu_permissions(self, menu_ids: set[int]) -> dict[int, list[str]]:
        # 按钮权限挂在 MENU 节点下，通过 path/component 关联
        result = await self.session.execute(select(SysMenu).where(SysMenu.id.in_(menu_ids)))
        menus = {m.id: m for m in result.scalars().all()}

        perm_result = await self.session.execute(
            select(SysPermission.code, SysPermission.resource)
            .join(SysRolePermission, SysRolePermission.permission_id == SysPermission.id)
        )
        # 简化：按 resource 前缀匹配菜单 path
        mapping: dict[int, list[str]] = {mid: [] for mid in menu_ids}
        for code, resource in perm_result.all():
            for mid, menu in menus.items():
                if menu.path and resource in menu.path:
                    mapping[mid].append(code)
        return mapping

    def _build_menu_tree(
        self, menus: list[SysMenu], perm_map: dict[int, list[str]], parent_id: int | None = None
    ) -> list[MenuNode]:
        nodes: list[MenuNode] = []
        for menu in menus:
            if menu.parent_id == parent_id:
                children = self._build_menu_tree(menus, perm_map, menu.id)
                nodes.append(
                    MenuNode(
                        id=menu.id,  # type: ignore[arg-type]
                        name=menu.name,
                        type=menu.type,
                        path=menu.path,
                        component=menu.component,
                        icon=menu.icon,
                        permissions=perm_map.get(menu.id, []),  # type: ignore[arg-type]
                        children=children,
                    )
                )
        return nodes

    async def _dept_name(self, dept_id: int | None) -> str | None:
        if dept_id is None:
            return None
        result = await self.session.execute(
            select(SysDept.name).where(SysDept.id == dept_id, SysDept.is_deleted.is_(False))
        )
        return result.scalar_one_or_none()


class UserService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_users(
        self,
        page: int,
        page_size: int,
        current: CurrentUser | None = None,
    ) -> tuple[list[dict], int]:
        base = select(SysUser).where(SysUser.is_deleted.is_(False))
        if current is not None:
            scope = await resolve_scope_filter(
                self.session,
                data_scope=current.data_scope,
                user_id=current.id,
                dept_id=current.dept_id,
            )
            scoped = apply_user_scope(base, scope)
            if scoped is None:
                return [], 0
            base = scoped

        count_stmt = select(func.count()).select_from(base.subquery())
        total = await self.session.scalar(count_stmt)
        result = await self.session.execute(
            base.order_by(SysUser.id).offset((page - 1) * page_size).limit(page_size)
        )
        users = result.scalars().all()
        items = []
        for user in users:
            role_ids = await self._user_role_ids(user.id)  # type: ignore[arg-type]
            role_names = await self._role_names(role_ids)
            dept_name = await self._dept_name(user.dept_id)
            items.append(self._serialize(user, role_ids, dept_name, role_names))
        return items, total or 0

    async def create_user(self, data) -> dict:
        exists = await self.session.execute(
            select(SysUser).where(SysUser.username == data.username)
        )
        if exists.scalar_one_or_none():
            raise AuthException("用户名已存在")
        if data.dept_id is not None:
            await self._ensure_dept(data.dept_id)
        await self._ensure_roles(data.role_ids)

        user = SysUser(
            username=data.username,
            password_hash=hash_password(data.password),
            display_name=data.display_name or data.username,
            email=data.email,
            status=data.status,
            dept_id=data.dept_id,
        )
        self.session.add(user)
        await self.session.flush()
        await self._sync_roles(user.id, data.role_ids)  # type: ignore[arg-type]
        dept_name = await self._dept_name(user.dept_id)
        role_names = await self._role_names(data.role_ids)
        return self._serialize(user, data.role_ids, dept_name, role_names)

    async def update_user(self, user_id: int, data) -> dict:
        user = await self._get_user(user_id)
        if data.display_name is not None:
            user.display_name = data.display_name
        if data.email is not None:
            user.email = data.email
        if data.status is not None:
            user.status = data.status
        if data.password:
            user.password_hash = hash_password(data.password)
        if "dept_id" in data.model_fields_set:
            if data.dept_id is not None:
                await self._ensure_dept(data.dept_id)
            user.dept_id = data.dept_id
        if data.role_ids is not None:
            await self._ensure_roles(data.role_ids)
            await self._sync_roles(user_id, data.role_ids)
        role_ids = await self._user_role_ids(user_id)
        role_names = await self._role_names(role_ids)
        dept_name = await self._dept_name(user.dept_id)
        return self._serialize(user, role_ids, dept_name, role_names)

    async def delete_user(self, user_id: int) -> None:
        user = await self._get_user(user_id)
        user.is_deleted = True

    async def _get_user(self, user_id: int) -> SysUser:
        result = await self.session.execute(
            select(SysUser).where(SysUser.id == user_id, SysUser.is_deleted.is_(False))
        )
        user = result.scalar_one_or_none()
        if user is None:
            raise NotFoundException("用户不存在")
        return user

    async def _user_role_ids(self, user_id: int) -> list[int]:
        result = await self.session.execute(
            select(SysUserRole.role_id).where(SysUserRole.user_id == user_id)
        )
        return list(result.scalars().all())

    async def _sync_roles(self, user_id: int, role_ids: list[int]) -> None:
        existing = await self.session.execute(
            select(SysUserRole).where(SysUserRole.user_id == user_id)
        )
        for row in existing.scalars().all():
            await self.session.delete(row)
        for role_id in role_ids:
            self.session.add(SysUserRole(user_id=user_id, role_id=role_id))

    async def _ensure_dept(self, dept_id: int) -> None:
        result = await self.session.execute(
            select(SysDept).where(SysDept.id == dept_id, SysDept.is_deleted.is_(False))
        )
        if result.scalar_one_or_none() is None:
            raise NotFoundException("部门不存在")

    async def _ensure_roles(self, role_ids: list[int]) -> None:
        if not role_ids:
            return
        result = await self.session.execute(
            select(SysRole.id).where(SysRole.id.in_(role_ids), SysRole.is_deleted.is_(False))
        )
        found = set(result.scalars().all())
        missing = [rid for rid in role_ids if rid not in found]
        if missing:
            raise NotFoundException(f"角色不存在: {missing}")

    async def _dept_name(self, dept_id: int | None) -> str | None:
        if dept_id is None:
            return None
        result = await self.session.execute(
            select(SysDept.name).where(SysDept.id == dept_id, SysDept.is_deleted.is_(False))
        )
        return result.scalar_one_or_none()

    async def _role_names(self, role_ids: list[int]) -> list[str]:
        if not role_ids:
            return []
        result = await self.session.execute(
            select(SysRole.name).where(SysRole.id.in_(role_ids), SysRole.is_deleted.is_(False))
        )
        return list(result.scalars().all())

    def _serialize(
        self,
        user: SysUser,
        role_ids: list[int],
        dept_name: str | None = None,
        role_names: list[str] | None = None,
    ) -> dict:
        return {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "email": user.email,
            "avatar_url": getattr(user, "avatar_url", None),
            "status": user.status,
            "dept_id": user.dept_id,
            "dept_name": dept_name,
            "tenant_id": user.tenant_id,
            "role_ids": role_ids,
            "role_names": role_names or [],
            "created_at": user.created_at.isoformat(),
        }
