from pydantic import BaseModel, Field


class TenantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=1, max_length=64)
    enabled_modules: str = Field(default="*", max_length=512)
    status: str = "active"
    remark: str | None = None
    root_dept_name: str | None = Field(
        default=None,
        max_length=128,
        description="自动创建的组织根节点名称，默认与租户名称相同",
    )


class TenantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    code: str | None = Field(default=None, min_length=1, max_length=64)
    enabled_modules: str | None = Field(default=None, max_length=512)
    status: str | None = None
    remark: str | None = None
