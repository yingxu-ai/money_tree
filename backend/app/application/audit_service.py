import json
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.system import SysLoginLog, SysOperationLog


class AuditService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def write_operation(
        self,
        *,
        user_id: int | None,
        resource: str,
        action: str,
        request_body: str | None = None,
        result: str = "success",
        trace_id: str | None = None,
    ) -> None:
        self.session.add(
            SysOperationLog(
                user_id=user_id,
                resource=resource[:128],
                action=action[:64],
                request=(request_body[:2000] if request_body else None),
                result=result,
                trace_id=trace_id,
            )
        )
        await self.session.flush()

    async def list_operations(self, page: int, page_size: int) -> tuple[list[dict], int]:
        from sqlalchemy import func, select

        total = await self.session.scalar(select(func.count()).select_from(SysOperationLog))
        result = await self.session.execute(
            select(SysOperationLog)
            .order_by(SysOperationLog.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = [
            {
                "id": log.id,
                "user_id": log.user_id,
                "resource": log.resource,
                "action": log.action,
                "request": log.request,
                "result": log.result,
                "trace_id": log.trace_id,
                "created_at": log.created_at.isoformat(),
            }
            for log in result.scalars().all()
        ]
        return items, total or 0

    async def list_logins(self, page: int, page_size: int) -> tuple[list[dict], int]:
        from sqlalchemy import func, select

        total = await self.session.scalar(select(func.count()).select_from(SysLoginLog))
        result = await self.session.execute(
            select(SysLoginLog)
            .order_by(SysLoginLog.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = [
            {
                "id": log.id,
                "user_id": log.user_id,
                "username": log.username,
                "ip": log.ip,
                "result": log.result,
                "created_at": log.created_at.isoformat(),
            }
            for log in result.scalars().all()
        ]
        return items, total or 0


def summarize_body(body: Any, limit: int = 500) -> str | None:
    if body is None:
        return None
    try:
        text = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False, default=str)
    except TypeError:
        text = str(body)
    return text[:limit]
