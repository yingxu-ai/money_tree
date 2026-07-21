from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.auth_service import UserService
from app.application.dept_service import DeptService
from app.application.dict_service import DictService
from app.application.rbac_service import MenuService, RoleService
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
depts_router = APIRouter(prefix="/depts", tags=["部门管理"])
dicts_router = APIRouter(prefix="/dicts", tags=["字典管理"])


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


@users_router.post("", dependencies=[Depends(require_permission("user:create"))])
async def create_user(
    payload: UserCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    service = UserService(session)
    user = await service.create_user(payload)
    return success(user, trace_id=getattr(request.state, "trace_id", ""))


@users_router.put("/{user_id}", dependencies=[Depends(require_permission("user:update"))])
async def update_user(
    user_id: int,
    payload: UserUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    service = UserService(session)
    user = await service.update_user(user_id, payload)
    return success(user, trace_id=getattr(request.state, "trace_id", ""))


@users_router.delete("/{user_id}", dependencies=[Depends(require_permission("user:delete"))])
async def delete_user(
    user_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    service = UserService(session)
    await service.delete_user(user_id)
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


@depts_router.post("", dependencies=[Depends(require_permission("dept:create"))])
async def create_dept(
    payload: DeptCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    return success(
        await DeptService(session).create_dept(payload),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@depts_router.put("/{dept_id}", dependencies=[Depends(require_permission("dept:update"))])
async def update_dept(
    dept_id: int,
    payload: DeptUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    return success(
        await DeptService(session).update_dept(dept_id, payload),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@depts_router.delete("/{dept_id}", dependencies=[Depends(require_permission("dept:delete"))])
async def delete_dept(
    dept_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    await DeptService(session).delete_dept(dept_id)
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
