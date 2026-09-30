from collections.abc import Callable

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.api_permission_service import ApiPermissionService, is_public_api_path
from app.auth.context import CurrentUser
from app.auth.data_scope import resolve_effective_scope
from app.core.database import get_session
from app.core.exceptions import AuthException, PermissionException
from app.core.module_guard import assert_module_allowed
from app.core.security import decode_token
from app.models.system import SysPermission, SysRole, SysRolePermission, SysUser, SysUserRole

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> CurrentUser:
    if credentials is None or not credentials.credentials:
        raise AuthException("未提供认证令牌")

    try:
        payload = decode_token(credentials.credentials)
    except ValueError as exc:
        raise AuthException("令牌无效或已过期") from exc

    if payload.get("type") != "access":
        raise AuthException("令牌类型错误")

    user_id = payload.get("sub")
    if not user_id:
        raise AuthException("令牌载荷无效")

    result = await session.execute(
        select(SysUser).where(SysUser.id == int(user_id), SysUser.is_deleted.is_(False))
    )
    user = result.scalar_one_or_none()
    if user is None or user.status != "active":
        raise AuthException("用户不存在或已禁用")

    role_result = await session.execute(
        select(SysRole.code, SysRole.name, SysRole.data_scope)
        .join(SysUserRole, SysUserRole.role_id == SysRole.id)
        .where(SysUserRole.user_id == user.id, SysRole.is_deleted.is_(False))
    )
    role_rows = list(role_result.all())
    roles = [row[0] for row in role_rows]
    role_names = [row[1] for row in role_rows]
    data_scope = resolve_effective_scope([row[2] for row in role_rows])

    perm_result = await session.execute(
        select(SysPermission.code)
        .join(SysRolePermission, SysRolePermission.permission_id == SysPermission.id)
        .join(SysUserRole, SysUserRole.role_id == SysRolePermission.role_id)
        .where(SysUserRole.user_id == user.id)
    )
    permissions = set(perm_result.scalars().all())

    request.state.user_id = user.id
    return CurrentUser(
        user=user,
        roles=roles,
        role_names=role_names,
        permissions=permissions,
        data_scope=data_scope,
    )


def require_permission(code: str) -> Callable:
    """兼容旧写法；新接口优先走 sys_api_permission 配置台。"""

    async def checker(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not current.has_permission(code):
            raise PermissionException(f"缺少权限: {code}")
        return current

    return checker


async def enforce_api_permission(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> None:
    """
    全局接口权限：若配置台有启用规则，则校验对应权限码。
    无规则 / 未启用 → 不拦截（由各接口自己的 Depends 决定是否登录）。
    另：按租户 / ENABLED_MODULES 做模块级拦截（售卖模式 B）。
    """
    await assert_module_allowed(request, session, credentials)

    if is_public_api_path(request.url.path):
        return

    service = ApiPermissionService(session)
    rule = await service.find_required_permission(request.method, request.url.path)
    if rule is None:
        return
    code = (rule.permission_code or "").strip()
    if not code:
        return

    current = await get_current_user(request, credentials, session)
    if not current.has_permission(code):
        raise PermissionException(f"缺少权限: {code}（接口 {rule.method} {rule.path_pattern}）")
