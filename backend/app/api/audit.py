from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.audit_service import AuditService
from app.auth.deps import get_current_user
from app.core.database import get_session
from app.core.response import ok
from app.models.system import SysLoginLog, SysOperationLog

router = APIRouter(prefix="/audit", tags=["审计日志"])


@router.get("/operations")
async def list_operation_logs(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    service = AuditService(session)
    items, total = await service.list_operations(page, page_size)
    return ok(
        request,
        {"page": page, "page_size": page_size, "total": total, "items": items},
    )


@router.get("/logins")
async def list_login_logs(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    service = AuditService(session)
    items, total = await service.list_logins(page, page_size)
    return ok(
        request,
        {"page": page, "page_size": page_size, "total": total, "items": items},
    )
