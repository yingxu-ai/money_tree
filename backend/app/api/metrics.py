from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from app.auth.deps import get_current_user, require_permission
from app.core.response import ok
from app.providers.base import MetricQuery
from app.providers.metric import get_metric_provider

router = APIRouter(prefix="/metrics", tags=["指标数据"])


class MetricQueryBody(BaseModel):
    metric_code: str
    start_time: str | None = None
    end_time: str | None = None
    dimensions: dict = Field(default_factory=dict)


@router.get("", dependencies=[Depends(require_permission("dashboard:view"))])
async def list_metrics(request: Request, current=Depends(get_current_user)):
    provider = get_metric_provider()
    return ok(request, await provider.list_metrics(current.tenant_id))


@router.get("/{metric_code}", dependencies=[Depends(require_permission("dashboard:view"))])
async def get_metric(
    metric_code: str,
    request: Request,
    start_time: str | None = None,
    end_time: str | None = None,
    factory_id: int | None = Query(None),
    current=Depends(get_current_user),
):
    provider = get_metric_provider()
    dimensions = {}
    if factory_id is not None:
        dimensions["factory_id"] = factory_id
    result = await provider.query(
        MetricQuery(
            metric_code=metric_code,
            start_time=start_time,
            end_time=end_time,
            dimensions=dimensions,
            tenant_id=current.tenant_id,
        )
    )
    return ok(request, result.to_dict())


@router.post("/query", dependencies=[Depends(require_permission("dashboard:view"))])
async def query_metric(
    payload: MetricQueryBody,
    request: Request,
    current=Depends(get_current_user),
):
    provider = get_metric_provider()
    result = await provider.query(
        MetricQuery(
            metric_code=payload.metric_code,
            start_time=payload.start_time,
            end_time=payload.end_time,
            dimensions=payload.dimensions,
            tenant_id=current.tenant_id,
        )
    )
    return ok(request, result.to_dict())
