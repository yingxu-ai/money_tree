from datetime import datetime

from sqlmodel import Field, SQLModel


class SysConfig(SQLModel, table=True):
    __tablename__ = "sys_config"

    id: int | None = Field(default=None, primary_key=True)
    scope_type: str = Field(max_length=32, index=True)
    scope_id: int | None = Field(default=None, index=True)
    config_key: str = Field(max_length=128, index=True)
    config_value: str = Field(default="")
    value_type: str = Field(default="string", max_length=32)
    description: str | None = Field(default=None)
    version: int = Field(default=1)
    updated_by: int | None = Field(default=None)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SysFile(SQLModel, table=True):
    __tablename__ = "sys_file"

    id: int | None = Field(default=None, primary_key=True)
    original_name: str = Field(max_length=255)
    object_key: str = Field(max_length=512)
    mime_type: str = Field(max_length=128)
    size: int = Field(default=0)
    sha256: str | None = Field(default=None, max_length=64)
    status: str = Field(default="active", max_length=32)
    tenant_id: int = Field(default=1, index=True)
    created_by: int | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SysTask(SQLModel, table=True):
    __tablename__ = "sys_task"

    id: int | None = Field(default=None, primary_key=True)
    task_type: str = Field(max_length=64, index=True)
    status: str = Field(default="pending", max_length=32)
    progress: int = Field(default=0)
    input_json: str = Field(default="{}")
    result_json: str | None = Field(default=None)
    error_message: str | None = Field(default=None)
    retry_count: int = Field(default=0)
    trace_id: str | None = Field(default=None, max_length=64)
    idempotency_key: str | None = Field(default=None, max_length=128, index=True)
    created_by: int | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: datetime | None = Field(default=None)
