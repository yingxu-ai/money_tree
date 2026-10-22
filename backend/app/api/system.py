from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.api_permission_service import ApiPermissionService
from app.application.auth_service import UserService
from app.application.dept_service import DeptService
from app.application.dict_service import DictService
from app.application.rbac_service import MenuService, RoleService
from app.application.tenant_service import TenantService
from app.auth.tenant_schemas import TenantCreate, TenantUpdate
from app.auth.deps import get_current_user, require_permission
from app.auth.context import CurrentUser
from app.auth.org_schemas import (
    DeptCreate,
    DeptUpdate,
    DictItemCreate,
    DictItemUpdate,
    DictTypeCreate,
    DictTypeUpdate,
)
from app.auth.schemas import MenuCreate, MenuUpdate, RoleCreate, RoleUpdate, UserCreate, UserUpdate
from app.core.database import get_session
from app.core.response import success

users_router = APIRouter(prefix="/users", tags=["用户管理"])
roles_router = APIRouter(prefix="/roles", tags=["角色管理"])
menus_router = APIRouter(prefix="/menus", tags=["菜单管理"])
permissions_router = APIRouter(prefix="/permissions", tags=["权限管理"])
api_permissions_router = APIRouter(prefix="/api-permissions", tags=["接口权限"])
depts_router = APIRouter(prefix="/depts", tags=["部门管理"])
dicts_router = APIRouter(prefix="/dicts", tags=["字典管理"])
tenants_router = APIRouter(prefix="/tenants", tags=["租户管理"])


class ApiPermissionUpsert(BaseModel):
    method: str = "GET"
    path_pattern: str
    permission_code: str = ""
    name: str = ""
    menu_id: int | None = None
    enabled: bool = False
    sort: int = 0


class ApiPermissionPatch(BaseModel):
    method: str | None = None
    path_pattern: str | None = None
    permission_code: str | None = None
    name: str | None = None
    menu_id: int | None = None
    enabled: bool | None = None
    sort: int | None = None


@users_router.get("")
async def list_users(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_permission("user:view")),
):
    service = UserService(session)
    items, total = await service.list_users(page, page_size, current)
    return success(
        {"page": page, "page_size": page_size, "total": total, "items": items},
        trace_id=getattr(request.state, "trace_id", ""),
    )


@users_router.post("")
async def create_user(
    payload: UserCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_permission("user:create")),
):
    service = UserService(session)
    user = await service.create_user(payload, tenant_id=current.effective_tenant_id)
    return success(user, trace_id=getattr(request.state, "trace_id", ""))


@users_router.put("/{user_id}")
async def update_user(
    user_id: int,
    payload: UserUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_permission("user:update")),
):
    service = UserService(session)
    user = await service.update_user(user_id, payload, tenant_id=current.effective_tenant_id)
    return success(user, trace_id=getattr(request.state, "trace_id", ""))


@users_router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_permission("user:delete")),
):
    service = UserService(session)
    await service.delete_user(user_id, tenant_id=current.effective_tenant_id)
    return success(None, trace_id=getattr(request.state, "trace_id", ""))


@roles_router.get("", dependencies=[Depends(require_permission("role:view"))])
async def list_roles(request: Request, session: AsyncSession = Depends(get_session)):
    service = RoleService(session)
    return success(await service.list_roles(), trace_id=getattr(request.state, "trace_id", ""))


@roles_router.post("", dependencies=[Depends(require_permission("role:assign"))])
async def create_role(
    payload: RoleCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    service = RoleService(session)
    return success(await service.create_role(payload), trace_id=getattr(request.state, "trace_id", ""))


@roles_router.put("/{role_id}", dependencies=[Depends(require_permission("role:assign"))])
async def update_role(
    role_id: int,
    payload: RoleUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    service = RoleService(session)
    return success(
        await service.update_role(role_id, payload),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@roles_router.delete("/{role_id}", dependencies=[Depends(require_permission("role:assign"))])
async def delete_role(
    role_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    service = RoleService(session)
    await service.delete_role(role_id)
    return success(None, trace_id=getattr(request.state, "trace_id", ""))


@menus_router.get("", dependencies=[Depends(require_permission("menu:view"))])
async def list_menus(request: Request, session: AsyncSession = Depends(get_session)):
    service = MenuService(session)
    return success(await service.list_menus(), trace_id=getattr(request.state, "trace_id", ""))


@menus_router.post("", dependencies=[Depends(require_permission("menu:view"))])
async def create_menu(
    payload: MenuCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    service = MenuService(session)
    return success(await service.create_menu(payload), trace_id=getattr(request.state, "trace_id", ""))


@menus_router.put("/{menu_id}", dependencies=[Depends(require_permission("menu:view"))])
async def update_menu(
    menu_id: int,
    payload: MenuUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    service = MenuService(session)
    return success(
        await service.update_menu(menu_id, payload),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@menus_router.delete("/{menu_id}", dependencies=[Depends(require_permission("menu:view"))])
async def delete_menu(
    menu_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    service = MenuService(session)
    await service.delete_menu(menu_id)
    return success(None, trace_id=getattr(request.state, "trace_id", ""))


@permissions_router.get("", dependencies=[Depends(get_current_user)])
async def list_permissions(request: Request, session: AsyncSession = Depends(get_session)):
    service = MenuService(session)
    return success(await service.list_permissions(), trace_id=getattr(request.state, "trace_id", ""))


@permissions_router.get("/assign-tree", dependencies=[Depends(require_permission("role:view"))])
async def permission_assign_tree(request: Request, session: AsyncSession = Depends(get_session)):
    """角色配权树：菜单（一级/二级）+ 页面下的接口权限规则。"""
    service = MenuService(session)
    return success(await service.assign_tree(), trace_id=getattr(request.state, "trace_id", ""))


@depts_router.get("")
async def list_depts(
    request: Request,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_permission("dept:view")),
):
    return success(
        await DeptService(session).list_tree(current),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@depts_router.post("")
async def create_dept(
    payload: DeptCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_permission("dept:create")),
):
    return success(
        await DeptService(session).create_dept(payload, tenant_id=current.effective_tenant_id),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@depts_router.put("/{dept_id}")
async def update_dept(
    dept_id: int,
    payload: DeptUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_permission("dept:update")),
):
    return success(
        await DeptService(session).update_dept(dept_id, payload, tenant_id=current.effective_tenant_id),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@depts_router.delete("/{dept_id}")
async def delete_dept(
    dept_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_permission("dept:delete")),
):
    await DeptService(session).delete_dept(dept_id, tenant_id=current.effective_tenant_id)
    return success(None, trace_id=getattr(request.state, "trace_id", ""))


@tenants_router.get("")
async def list_tenants(
    request: Request,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_permission("tenant:view")),
):
    return success(
        await TenantService(session).list_tenants(current.user),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@tenants_router.post("")
async def create_tenant(
    payload: TenantCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_permission("tenant:create")),
):
    return success(
        await TenantService(session).create_tenant(payload, current.user),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@tenants_router.put("/{tenant_id}")
async def update_tenant(
    tenant_id: int,
    payload: TenantUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_permission("tenant:update")),
):
    return success(
        await TenantService(session).update_tenant(tenant_id, payload, current.user),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@tenants_router.delete("/{tenant_id}")
async def delete_tenant(
    tenant_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_permission("tenant:delete")),
):
    await TenantService(session).delete_tenant(tenant_id, current.user)
    return success(None, trace_id=getattr(request.state, "trace_id", ""))


@dicts_router.get("/types", dependencies=[Depends(require_permission("dict:view"))])
async def list_dict_types(request: Request, session: AsyncSession = Depends(get_session)):
    return success(await DictService(session).list_types(), trace_id=getattr(request.state, "trace_id", ""))


@dicts_router.post("/types", dependencies=[Depends(require_permission("dict:create"))])
async def create_dict_type(
    payload: DictTypeCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    return success(
        await DictService(session).create_type(payload),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@dicts_router.put("/types/{type_id}", dependencies=[Depends(require_permission("dict:update"))])
async def update_dict_type(
    type_id: int,
    payload: DictTypeUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    return success(
        await DictService(session).update_type(type_id, payload),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@dicts_router.delete("/types/{type_id}", dependencies=[Depends(require_permission("dict:delete"))])
async def delete_dict_type(
    type_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    await DictService(session).delete_type(type_id)
    return success(None, trace_id=getattr(request.state, "trace_id", ""))


@dicts_router.get("/items", dependencies=[Depends(require_permission("dict:view"))])
async def list_dict_items(
    request: Request,
    type_id: int | None = Query(None),
    type_code: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
):
    return success(
        await DictService(session).list_items(type_id=type_id, type_code=type_code),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@dicts_router.post("/items", dependencies=[Depends(require_permission("dict:create"))])
async def create_dict_item(
    payload: DictItemCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    return success(
        await DictService(session).create_item(payload),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@dicts_router.put("/items/{item_id}", dependencies=[Depends(require_permission("dict:update"))])
async def update_dict_item(
    item_id: int,
    payload: DictItemUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    return success(
        await DictService(session).update_item(item_id, payload),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@dicts_router.delete("/items/{item_id}", dependencies=[Depends(require_permission("dict:delete"))])
async def delete_dict_item(
    item_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    await DictService(session).delete_item(item_id)
    return success(None, trace_id=getattr(request.state, "trace_id", ""))


@api_permissions_router.get("", dependencies=[Depends(require_permission("api_perm:view"))])
async def list_api_permissions(request: Request, session: AsyncSession = Depends(get_session)):
    return success(
        await ApiPermissionService(session).list_rules(),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@api_permissions_router.get("/routes", dependencies=[Depends(require_permission("api_perm:view"))])
async def list_registered_routes(request: Request):
    """当前进程已注册的 API 路由目录，供配置台对照。"""
    return success(
        ApiPermissionService.list_app_routes(request.app),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@api_permissions_router.post("/sync", dependencies=[Depends(require_permission("api_perm:manage"))])
async def sync_api_permissions(request: Request, session: AsyncSession = Depends(get_session)):
    """从路由表增量同步：新路由写入且默认未启用，需补权限码后再开。"""
    result = await ApiPermissionService(session).sync_from_app(request.app)
    return success(result, trace_id=getattr(request.state, "trace_id", ""))


@api_permissions_router.post("", dependencies=[Depends(require_permission("api_perm:manage"))])
async def create_api_permission(
    payload: ApiPermissionUpsert,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    row = await ApiPermissionService(session).create_rule(payload.model_dump())
    return success(row, trace_id=getattr(request.state, "trace_id", ""))


@api_permissions_router.put("/{rule_id}", dependencies=[Depends(require_permission("api_perm:manage"))])
async def update_api_permission(
    rule_id: int,
    payload: ApiPermissionPatch,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    row = await ApiPermissionService(session).update_rule(rule_id, data)
    return success(row, trace_id=getattr(request.state, "trace_id", ""))


@api_permissions_router.delete(
    "/{rule_id}", dependencies=[Depends(require_permission("api_perm:manage"))]
)
async def delete_api_permission(
    rule_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    await ApiPermissionService(session).delete_rule(rule_id)
    return success(None, trace_id=getattr(request.state, "trace_id", ""))
