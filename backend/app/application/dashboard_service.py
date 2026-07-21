import json
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundException
from app.models.dashboard import Dashboard, DashboardLayout, DashboardWidget


class DashboardService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_dashboards(
        self, page: int, page_size: int, keyword: str | None = None
    ) -> tuple[list[dict], int]:
        query = select(Dashboard).where(Dashboard.is_deleted.is_(False))
        if keyword:
            query = query.where(Dashboard.name.contains(keyword))
        total = await self.session.scalar(select(func.count()).select_from(query.subquery()))
        result = await self.session.execute(
            query.order_by(Dashboard.updated_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return [self._serialize(d) for d in result.scalars().all()], total or 0

    async def get_dashboard(self, dashboard_id: int) -> dict:
        dashboard = await self._get(dashboard_id)
        layout_result = await self.session.execute(
            select(DashboardLayout)
            .where(DashboardLayout.dashboard_id == dashboard_id)
            .order_by(DashboardLayout.version.desc())
            .limit(1)
        )
        layout = layout_result.scalar_one_or_none()
        widget_result = await self.session.execute(
            select(DashboardWidget).where(DashboardWidget.dashboard_id == dashboard_id)
        )
        widgets = widget_result.scalars().all()
        return {
            **self._serialize(dashboard),
            "layout": json.loads(layout.layout_json) if layout else {},
            "widgets": [
                {
                    "widget_code": w.widget_code,
                    "type": w.type,
                    "position": json.loads(w.position_json),
                    "config": json.loads(w.config_json),
                }
                for w in widgets
            ],
        }

    async def create_dashboard(self, data: dict, user_id: int) -> dict:
        dashboard = Dashboard(
            name=data["name"],
            code=data["code"],
            type=data.get("type", "general"),
            description=data.get("description"),
            cover_url=data.get("cover_url"),
            created_by=user_id,
        )
        self.session.add(dashboard)
        await self.session.flush()
        return self._serialize(dashboard)

    async def update_dashboard(self, dashboard_id: int, data: dict) -> dict:
        dashboard = await self._get(dashboard_id)
        for key in ("name", "type", "description", "cover_url", "status"):
            if key in data and data[key] is not None:
                setattr(dashboard, key, data[key])
        dashboard.updated_at = datetime.utcnow()
        return self._serialize(dashboard)

    async def save_layout(self, dashboard_id: int, layout: dict, widgets: list[dict]) -> dict:
        await self._get(dashboard_id)
        dashboard = await self._get(dashboard_id)
        dashboard.layout_version += 1
        self.session.add(
            DashboardLayout(
                dashboard_id=dashboard_id,
                version=dashboard.layout_version,
                layout_json=json.dumps(layout, ensure_ascii=False),
                status="draft",
            )
        )
        existing = await self.session.execute(
            select(DashboardWidget).where(DashboardWidget.dashboard_id == dashboard_id)
        )
        for row in existing.scalars().all():
            await self.session.delete(row)
        for widget in widgets:
            self.session.add(
                DashboardWidget(
                    dashboard_id=dashboard_id,
                    widget_code=widget["widget_code"],
                    type=widget["type"],
                    position_json=json.dumps(widget.get("position", {}), ensure_ascii=False),
                    config_json=json.dumps(widget.get("config", {}), ensure_ascii=False),
                )
            )
        return await self.get_dashboard(dashboard_id)

    async def delete_dashboard(self, dashboard_id: int) -> None:
        dashboard = await self._get(dashboard_id)
        dashboard.is_deleted = True

    async def _get(self, dashboard_id: int) -> Dashboard:
        result = await self.session.execute(
            select(Dashboard).where(Dashboard.id == dashboard_id, Dashboard.is_deleted.is_(False))
        )
        dashboard = result.scalar_one_or_none()
        if dashboard is None:
            raise NotFoundException("驾驶舱不存在")
        return dashboard

    def _serialize(self, dashboard: Dashboard) -> dict:
        return {
            "id": dashboard.id,
            "name": dashboard.name,
            "code": dashboard.code,
            "type": dashboard.type,
            "cover_url": dashboard.cover_url,
            "description": dashboard.description,
            "status": dashboard.status,
            "layout_version": dashboard.layout_version,
            "created_by": dashboard.created_by,
            "created_at": dashboard.created_at.isoformat(),
            "updated_at": dashboard.updated_at.isoformat(),
        }
