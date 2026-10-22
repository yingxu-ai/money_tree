"""排产状态快照：整包 JSON 落库，兼容现有内存 Store。"""

from datetime import datetime

from sqlalchemy import Column, Text
from sqlmodel import Field, SQLModel


class SchedulingSnapshot(SQLModel, table=True):
    """排产整包快照；主键 id 即 tenant_id，按租户隔离。"""

    __tablename__ = "scheduling_snapshot"

    id: int = Field(default=1, primary_key=True, description="tenant_id")
    payload: str = Field(default="{}", sa_column=Column(Text, nullable=False))
    updated_at: datetime = Field(default_factory=datetime.utcnow)
