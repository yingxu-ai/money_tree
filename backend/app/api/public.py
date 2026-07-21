from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.branding_service import BrandingService
from app.core.database import get_session
from app.core.response import ok

router = APIRouter(prefix="/public", tags=["公开配置"])


@router.get("/settings")
async def public_settings(request: Request, session: AsyncSession = Depends(get_session)):
    """无需登录，供登录页与前端启动时拉取品牌配置。"""
    service = BrandingService(session)
    return ok(request, await service.get_public_settings())
