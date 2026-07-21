from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.dashboard_service import DashboardService
from app.auth.deps import require_permission
from app.core.database import get_session
from app.core.response import success

router = APIRouter(prefix="/dashboards", tags=["驾驶舱"])


class DashboardCreate(BaseModel):
    name: str
    code: str
    type: str = "general"
    description: str | None = None
    cover_url: str | None = None


class DashboardUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    description: str | None = None
    cover_url: str | None = None
    status: str | None = None


class LayoutSave(BaseModel):
    layout: dict = Field(default_factory=dict)
    widgets: list[dict] = Field(default_factory=list)


@router.get("", dependencies=[Depends(require_permission("dashboard:view"))])
async def list_dashboards(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    service = DashboardService(session)
    items, total = await service.list_dashboards(page, page_size, keyword)
    return success(
        {"page": page, "page_size": page_size, "total": total, "items": items},
        trace_id=getattr(request.state, "trace_id", ""),
    )


@router.post("", dependencies=[Depends(require_permission("dashboard:create"))])
async def create_dashboard(
    payload: DashboardCreate,
    request: Request,
    current=Depends(require_permission("dashboard:create")),
    session: AsyncSession = Depends(get_session),
):
    service = DashboardService(session)
    data = await service.create_dashboard(payload.model_dump(), current.id)
    return success(data, trace_id=getattr(request.state, "trace_id", ""))


@router.get("/{dashboard_id}", dependencies=[Depends(require_permission("dashboard:view"))])
async def get_dashboard(
    dashboard_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    service = DashboardService(session)
    return success(
        await service.get_dashboard(dashboard_id),
        trace_id=getattr(request.state, "trace_id", ""),
    )


@router.put("/{dashboard_id}", dependencies=[Depends(require_permission("dashboard:update"))])
async def update_dashboard(
    dashboard_id: int,
    payload: DashboardUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    service = DashboardService(session)
    data = await service.update_dashboard(
        dashboard_id, payload.model_dump(exclude_unset=True)
    )
    return success(data, trace_id=getattr(request.state, "trace_id", ""))


@router.put(
    "/{dashboard_id}/layout",
    dependencies=[Depends(require_permission("dashboard:update"))],
)
async def save_layout(
    dashboard_id: int,
    payload: LayoutSave,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    service = DashboardService(session)
    data = await service.save_layout(dashboard_id, payload.layout, payload.widgets)
    return success(data, trace_id=getattr(request.state, "trace_id", ""))


@router.delete("/{dashboard_id}", dependencies=[Depends(require_permission("dashboard:delete"))])
async def delete_dashboard(
    dashboard_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    service = DashboardService(session)
    await service.delete_dashboard(dashboard_id)
    return success(None, trace_id=getattr(request.state, "trace_id", ""))
