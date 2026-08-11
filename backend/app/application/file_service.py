import hashlib
import uuid
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import NotFoundException, ValidationException
from app.models.infra import SysFile

settings = get_settings()

# 图片上传通用限制（头像 / 封面等可复用）
IMAGE_MIME_PREFIX = "image/"
DEFAULT_IMAGE_MAX_BYTES = 2 * 1024 * 1024


class FileService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.upload_root = Path("./data/uploads")
        self.upload_root.mkdir(parents=True, exist_ok=True)

    async def list_files(
        self, tenant_id: int, page: int, page_size: int, keyword: str | None = None
    ) -> tuple[list[dict], int]:
        query = select(SysFile).where(
            SysFile.tenant_id == tenant_id,
            SysFile.status == "active",
        )
        if keyword:
            query = query.where(SysFile.original_name.contains(keyword))
        total = await self.session.scalar(select(func.count()).select_from(query.subquery()))
        result = await self.session.execute(
            query.order_by(SysFile.id.desc()).offset((page - 1) * page_size).limit(page_size)
        )
        return [self._serialize(f) for f in result.scalars().all()], total or 0

    async def upload(
        self,
        file: UploadFile,
        *,
        tenant_id: int,
        user_id: int,
        image_only: bool = False,
        max_bytes: int | None = None,
    ) -> dict:
        content = await file.read()
        mime = file.content_type or "application/octet-stream"
        if image_only and not mime.lower().startswith(IMAGE_MIME_PREFIX):
            raise ValidationException("仅支持上传图片")
        limit = max_bytes if max_bytes is not None else (DEFAULT_IMAGE_MAX_BYTES if image_only else None)
        if limit is not None and len(content) > limit:
            raise ValidationException(f"文件大小不能超过 {limit // (1024 * 1024)}MB")

        digest = hashlib.sha256(content).hexdigest()
        ext = Path(file.filename or "file").suffix
        object_key = f"{tenant_id}/{uuid.uuid4().hex}{ext}"
        target = self.upload_root / object_key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

        record = SysFile(
            original_name=file.filename or "unnamed",
            object_key=object_key.replace("\\", "/"),
            mime_type=mime,
            size=len(content),
            sha256=digest,
            status="active",
            tenant_id=tenant_id,
            created_by=user_id,
        )
        self.session.add(record)
        await self.session.flush()
        return self._serialize(record)

    async def get_file(self, file_id: int, tenant_id: int) -> SysFile:
        result = await self.session.execute(
            select(SysFile).where(
                SysFile.id == file_id,
                SysFile.tenant_id == tenant_id,
                SysFile.status == "active",
            )
        )
        record = result.scalar_one_or_none()
        if record is None:
            raise NotFoundException("文件不存在")
        return record

    async def resolve_path(self, record: SysFile) -> Path:
        path = self.upload_root / record.object_key
        if not path.exists():
            raise NotFoundException("文件内容不存在")
        return path

    async def delete_file(self, file_id: int, tenant_id: int) -> None:
        record = await self.get_file(file_id, tenant_id)
        record.status = "deleted"

    def _serialize(self, record: SysFile) -> dict:
        return {
            "id": record.id,
            "original_name": record.original_name,
            "object_key": record.object_key,
            "mime_type": record.mime_type,
            "size": record.size,
            "sha256": record.sha256,
            "status": record.status,
            "tenant_id": record.tenant_id,
            "created_by": record.created_by,
            "created_at": record.created_at.isoformat(),
            # 通用内容访问地址（需登录，供预览/头像等复用）
            "content_url": f"/api/v1/files/{record.id}/content",
            "ref": f"file:{record.id}",
        }
