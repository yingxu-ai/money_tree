from pydantic import BaseModel, Field


class DeptCreate(BaseModel):
    parent_id: int | None = None
    name: str = Field(min_length=1, max_length=128)
    code: str | None = Field(default=None, max_length=64)
    sort: int = 0
    status: str = "active"
    leader: str | None = None
    phone: str | None = None


class DeptUpdate(BaseModel):
    parent_id: int | None = None
    name: str | None = None
    code: str | None = None
    sort: int | None = None
    status: str | None = None
    leader: str | None = None
    phone: str | None = None


class DeptOut(BaseModel):
    id: int
    parent_id: int | None
    name: str
    code: str | None
    sort: int
    status: str
    leader: str | None
    phone: str | None
    children: list["DeptOut"] = Field(default_factory=list)


class DictTypeCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    status: str = "active"
    description: str | None = None


class DictTypeUpdate(BaseModel):
    name: str | None = None
    status: str | None = None
    description: str | None = None


class DictTypeOut(BaseModel):
    id: int
    code: str
    name: str
    status: str
    description: str | None


class DictItemCreate(BaseModel):
    type_id: int
    label: str = Field(min_length=1, max_length=128)
    value: str = Field(min_length=1, max_length=128)
    sort: int = 0
    status: str = "active"
    remark: str | None = None


class DictItemUpdate(BaseModel):
    label: str | None = None
    value: str | None = None
    sort: int | None = None
    status: str | None = None
    remark: str | None = None


class DictItemOut(BaseModel):
    id: int
    type_id: int
    label: str
    value: str
    sort: int
    status: str
    remark: str | None
