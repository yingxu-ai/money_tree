from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.file_service import FileService
from app.application.table_analysis import analyze_table_file, is_analyzable_name
from app.auth.deps import get_current_user, require_permission
from app.core.database import get_session
from app.core.exceptions import ValidationException
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


@router.get("/{file_id}/content")
async def file_content(
    file_id: int,
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    """登录用户可读本租户文件内容（图片预览 / 头像等通用场景，不要求 file:view）。"""
    service = FileService(session)
    record = await service.get_file(file_id, current.tenant_id)
    path = await service.resolve_path(record)
    return FileResponse(
        path,
        media_type=record.mime_type,
        filename=record.original_name,
        content_disposition_type="inline",
    )


@router.get("/{file_id}/analyze", dependencies=[Depends(require_permission("file:view"))])
async def analyze_file(
    file_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    """解析 Excel / CSV 为曲线分析数据（非数值列默认不选，tips 提示）。"""
    service = FileService(session)
    record = await service.get_file(file_id, current.tenant_id)
    if not is_analyzable_name(record.original_name, record.mime_type):
        raise ValidationException("暂仅支持 Excel / CSV 数据分析，PDF 等格式请先转换")
    path = await service.resolve_path(record)
    data = analyze_table_file(path, source_name=record.original_name)
    return ok(request, data)


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
