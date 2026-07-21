from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.config_service import ConfigService
from app.auth.deps import get_current_user
from app.core.database import get_session
from app.core.response import success

router = APIRouter(prefix="/configs", tags=["配置中心"])


class ConfigUpsert(BaseModel):
    scope_type: str
    scope_id: int | None = None
    config_key: str
    config_value: str
    value_type: str = "string"
    description: str | None = None


@router.get("")
async def list_configs(
    request: Request,
    scope_type: str | None = None,
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    service = ConfigService(session)
    return success(
        await service.list_configs(scope_type),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@router.post("")
async def upsert_config(
    payload: ConfigUpsert,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    service = ConfigService(session)
    data = await service.upsert_config(payload.model_dump(), current.id)
    return success(data, trace_id=getattr(request.state, "trace_id", ""))


@router.delete("/{config_id}")
async def delete_config(
    config_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    service = ConfigService(session)
    await service.delete_config(config_id)
    return success(None, trace_id=getattr(request.state, "trace_id", ""))
