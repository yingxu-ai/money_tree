from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models.enums import DashboardStatus


class Dashboard(SQLModel, table=True):
    __tablename__ = "dashboard"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=128)
    code: str = Field(index=True, unique=True, max_length=64)
    type: str = Field(default="general", max_length=64)
    cover_url: str | None = Field(default=None, max_length=512)
    description: str | None = Field(default=None)
    status: str = Field(default=DashboardStatus.DRAFT.value, max_length=32)
    layout_version: int = Field(default=1)
    tenant_id: int = Field(default=1, index=True)
    created_by: int | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    is_deleted: bool = Field(default=False)


class DashboardLayout(SQLModel, table=True):
    __tablename__ = "dashboard_layout"

    id: int | None = Field(default=None, primary_key=True)
    dashboard_id: int = Field(foreign_key="dashboard.id", index=True)
    version: int = Field(default=1)
    layout_json: str = Field(default="{}")
    status: str = Field(default="draft", max_length=32)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class DashboardWidget(SQLModel, table=True):
    __tablename__ = "dashboard_widget"

    id: int | None = Field(default=None, primary_key=True)
    dashboard_id: int = Field(foreign_key="dashboard.id", index=True)
    widget_code: str = Field(max_length=64, index=True)
    type: str = Field(max_length=32)
    position_json: str = Field(default="{}")
    config_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class WidgetDefinition(SQLModel, table=True):
    __tablename__ = "widget_definition"

    id: int | None = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True, max_length=64)
    name: str = Field(max_length=128)
    component: str = Field(max_length=128)
    schema_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
