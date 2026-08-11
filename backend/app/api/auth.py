from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.auth_service import AuthService
from app.application.file_service import FileService
from app.auth.deps import get_current_user
from app.auth.schemas import ChangePasswordRequest, LoginRequest, ProfileUpdateRequest
from app.core.database import get_session
from app.core.response import ok

router = APIRouter(prefix="/auth", tags=["认证"])


@router.post("/login")
async def login(
    payload: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    service = AuthService(session)
    access, refresh, user = await service.login(
        payload.username, payload.password, request.client.host if request.client else None
    )
    return ok(
        request,
        {
            "access_token": access,
            "refresh_token": refresh,
            "token_type": "bearer",
            "user": user.model_dump(),
        },
    )


@router.get("/me")
async def me(
    request: Request,
    current=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    service = AuthService(session)
    user = await service.get_me(current)
    return ok(request, user.model_dump())


@router.put("/me/profile")
async def update_profile(
    payload: ProfileUpdateRequest,
    request: Request,
    current=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    service = AuthService(session)
    user = await service.update_profile(current, payload)
    return ok(request, user.model_dump())


@router.post("/me/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    current=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    service = AuthService(session)
    await service.change_password(current, payload.old_password, payload.new_password)
    return ok(request, None, message="密码修改成功，请重新登录")


@router.post("/me/avatar")
async def upload_avatar(
    request: Request,
    file: UploadFile = File(...),
    current=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """个人头像上传：复用文件存储，不要求 file:upload 权限。"""
    file_service = FileService(session)
    uploaded = await file_service.upload(
        file,
        tenant_id=current.tenant_id,
        user_id=current.id,
        image_only=True,
        max_bytes=2 * 1024 * 1024,
    )
    auth_service = AuthService(session)
    user = await auth_service.update_avatar_file(current, int(uploaded["id"]))
    return ok(request, user.model_dump())


@router.get("/me/menus")
async def my_menus(
    request: Request,
    current=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    service = AuthService(session)
    menus = await service.get_menus(current)
    return ok(request, [m.model_dump() for m in menus])
