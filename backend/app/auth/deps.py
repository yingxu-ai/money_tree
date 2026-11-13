from collections.abc import Callable
from types import SimpleNamespace

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.api_permission_service import (
    ApiPermissionService,
    is_auth_self_api_path,
    is_public_api_path,
)
from app.auth.context import CurrentUser
from app.auth.data_scope import resolve_effective_scope
from app.auth.tenant_context import parse_operating_tenant_header
from app.core.database import get_session
from app.core.exceptions import AuthException, PermissionException
from app.core.module_guard import assert_module_allowed
from app.core.security import decode_token
from app.models.enums import DataScope
from app.models.system import (
    SysApiPermission,
    SysPermission,
    SysRole,
    SysRoleApiPermission,
    SysRolePermission,
    SysUser,
    SysUserRole,
)

bearer_scheme = HTTPBearer(auto_error=False)

# 现场作业人小程序令牌：仅报工相关
_MP_WORKER_PERMISSIONS = {
    "production_progress:view",
    "production_progress:report",
}


def _mp_worker_current_user(payload: dict) -> CurrentUser:
    tenant_id = payload.get("tenant_id")
    person_id = (payload.get("person_id") or "").strip()
    person_name = (payload.get("person_name") or "").strip() or "现场作业人"
    person_code = (payload.get("person_code") or "").strip()
    if tenant_id is None or not person_id:
        raise AuthException("作业人令牌载荷无效")
    try:
        tid = int(tenant_id)
    except (TypeError, ValueError) as exc:
        raise AuthException("作业人令牌租户无效") from exc
    user = SimpleNamespace(
        id=0,
        tenant_id=tid,
        username=f"mp:{person_code or person_id}",
        display_name=person_name,
        status="active",
        dept_id=None,
        is_deleted=False,
    )
    return CurrentUser(
        user=user,  # type: ignore[arg-type]
        roles=["mp_worker"],
        role_names=["现场作业人"],
        permissions=set(_MP_WORKER_PERMISSIONS),
        api_permission_ids=set(),
        data_scope=DataScope.ALL.value,
        operating_tenant_id=None,
        person_id=person_id,
        is_mp_worker=True,
    )


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

    if payload.get("kind") == "mp_worker":
        current = _mp_worker_current_user(payload)
        request.state.user_id = 0
        request.state.operating_tenant_id = None
        request.state.mp_person_id = current.person_id
        return current

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

    api_id_result = await session.execute(
        select(SysRoleApiPermission.api_permission_id)
        .join(SysUserRole, SysUserRole.role_id == SysRoleApiPermission.role_id)
        .where(SysUserRole.user_id == user.id)
    )
    api_permission_ids = {int(x) for x in api_id_result.scalars().all() if x is not None}

    # 勾了接口规则时，把规则上的 permission_code 并入，供 AuthButton 使用
    if api_permission_ids:
        code_from_api = await session.execute(
            select(SysApiPermission.permission_code).where(
                SysApiPermission.id.in_(api_permission_ids)
            )
        )
        for code in code_from_api.scalars().all():
            if code and str(code).strip():
                permissions.add(str(code).strip())

    request.state.user_id = user.id
    operating_tenant_id = parse_operating_tenant_header(request)
    request.state.operating_tenant_id = operating_tenant_id
    return CurrentUser(
        user=user,
        roles=roles,
        role_names=role_names,
        permissions=permissions,
        api_permission_ids=api_permission_ids,
        data_scope=data_scope,
        operating_tenant_id=operating_tenant_id,
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
    全局接口权限：若配置台有启用规则，则校验角色是否勾选了该规则 id。
    无规则 / 未启用 → 不拦截（由各接口自己的 Depends 决定是否登录）。
    另：按租户 / ENABLED_MODULES 做模块级拦截（售卖模式 B）。
    """
    await assert_module_allowed(request, session, credentials)

    if is_public_api_path(request.url.path):
        return
    # 本人资料/菜单：只需登录，不要求角色勾接口规则
    if is_auth_self_api_path(request.url.path):
        return

    service = ApiPermissionService(session)
    rule = await service.find_required_permission(request.method, request.url.path)
    if rule is None:
        return

    current = await get_current_user(request, credentials, session)
    if current.has_api_permission(rule.id):
        return
    # 兼容：尚未迁移到 role_api 时，仍可用 permission_code
    code = (rule.permission_code or "").strip()
    if code and current.has_permission(code):
        return
    raise PermissionException(
        f"缺少接口权限: {rule.name or rule.path_pattern}（#{rule.id} {rule.method} {rule.path_pattern}）"
    )
