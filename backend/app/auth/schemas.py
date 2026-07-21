from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserInfo(BaseModel):
    id: int
    username: str
    display_name: str
    email: str | None
    tenant_id: int
    dept_id: int | None = None
    data_scope: str = "ALL"
    roles: list[str]
    permissions: list[str]


class MenuNode(BaseModel):
    id: int
    name: str
    type: str
    path: str | None = None
    component: str | None = None
    icon: str | None = None
    permissions: list[str] = Field(default_factory=list)
    children: list["MenuNode"] = Field(default_factory=list)


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    display_name: str = Field(default="", max_length=128)
    email: str | None = None
    status: str = "active"
    dept_id: int | None = None
    role_ids: list[int] = Field(default_factory=list)


class UserUpdate(BaseModel):
    display_name: str | None = None
    email: str | None = None
    status: str | None = None
    dept_id: int | None = None
    role_ids: list[int] | None = None
    # 可选：填写则重置密码
    password: str | None = Field(default=None, min_length=6, max_length=128)


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str
    email: str | None
    status: str
    dept_id: int | None = None
    dept_name: str | None = None
    tenant_id: int
    role_ids: list[int] = Field(default_factory=list)
    role_names: list[str] = Field(default_factory=list)
    created_at: str


class RoleCreate(BaseModel):
    name: str
    code: str
    status: str = "active"
    data_scope: str = "ALL"
    menu_ids: list[int] = Field(default_factory=list)
    permission_ids: list[int] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    name: str | None = None
    status: str | None = None
    data_scope: str | None = None
    menu_ids: list[int] | None = None
    permission_ids: list[int] | None = None


class RoleOut(BaseModel):
    id: int
    name: str
    code: str
    status: str
    data_scope: str
    menu_ids: list[int] = Field(default_factory=list)
    permission_ids: list[int] = Field(default_factory=list)


class MenuCreate(BaseModel):
    parent_id: int | None = None
    name: str
    path: str | None = None
    component: str | None = None
    type: str
    sort: int = 0
    visible: bool = True
    icon: str | None = None


class MenuUpdate(BaseModel):
    parent_id: int | None = None
    name: str | None = None
    path: str | None = None
    component: str | None = None
    type: str | None = None
    sort: int | None = None
    visible: bool | None = None
    icon: str | None = None


class MenuOut(BaseModel):
    id: int
    parent_id: int | None
    name: str
    path: str | None
    component: str | None
    type: str
    sort: int
    visible: bool
    icon: str | None
    children: list["MenuOut"] = Field(default_factory=list)
