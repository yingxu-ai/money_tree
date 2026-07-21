from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.file_service import FileService
from app.auth.deps import get_current_user, require_permission
from app.core.database import get_session
from app.core.response import ok

router = APIRouter(prefix="/files", tags=["文件中心"])


@router.get("", dependencies=[Depends(require_permission("file:view"))])
async def list_files(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    service = FileService(session)
    items, total = await service.list_files(current.tenant_id, page, page_size, keyword)
    return ok(
        request,
        {"page": page, "page_size": page_size, "total": total, "items": items},
    )


@router.post("", dependencies=[Depends(require_permission("file:upload"))])
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    service = FileService(session)
    data = await service.upload(file, tenant_id=current.tenant_id, user_id=current.id)
    return ok(request, data)


@router.get("/{file_id}/download", dependencies=[Depends(require_permission("file:view"))])
async def download_file(
    file_id: int,
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    service = FileService(session)
    record = await service.get_file(file_id, current.tenant_id)
    path = await service.resolve_path(record)
    return FileResponse(
        path,
        filename=record.original_name,
        media_type=record.mime_type,
    )


@router.delete("/{file_id}", dependencies=[Depends(require_permission("file:delete"))])
async def delete_file(
    file_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    service = FileService(session)
    await service.delete_file(file_id, current.tenant_id)
    return ok(request, None)
