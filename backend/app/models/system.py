from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models.enums import UserStatus


class SysTenant(SQLModel, table=True):
    """租户（售卖模式 B：按租户开通模块）。"""

    __tablename__ = "sys_tenant"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=128)
    code: str = Field(index=True, unique=True, max_length=64)
    # "*" / "all" = 全开；否则逗号分隔 module_id，如 scheduling,toolbox
    enabled_modules: str = Field(default="*", max_length=512)
    status: str = Field(default="active", max_length=32)
    remark: str | None = Field(default=None, max_length=255)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    is_deleted: bool = Field(default=False)


class SysDept(SQLModel, table=True):
    """组织部门，自关联树（parent_id）。"""

    __tablename__ = "sys_dept"

    id: int | None = Field(default=None, primary_key=True)
    parent_id: int | None = Field(default=None, foreign_key="sys_dept.id", index=True)
    name: str = Field(max_length=128)
    code: str | None = Field(default=None, index=True, max_length=64)
    sort: int = Field(default=0)
    status: str = Field(default="active", max_length=32)
    leader: str | None = Field(default=None, max_length=64)
    phone: str | None = Field(default=None, max_length=32)
    tenant_id: int = Field(default=1, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    is_deleted: bool = Field(default=False)


class SysDictType(SQLModel, table=True):
    __tablename__ = "sys_dict_type"

    id: int | None = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True, max_length=64)
    name: str = Field(max_length=128)
    status: str = Field(default="active", max_length=32)
    description: str | None = Field(default=None, max_length=255)
    tenant_id: int = Field(default=1, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    is_deleted: bool = Field(default=False)


class SysDictItem(SQLModel, table=True):
    __tablename__ = "sys_dict_item"

    id: int | None = Field(default=None, primary_key=True)
    type_id: int = Field(foreign_key="sys_dict_type.id", index=True)
    label: str = Field(max_length=128)
    value: str = Field(max_length=128)
    sort: int = Field(default=0)
    status: str = Field(default="active", max_length=32)
    remark: str | None = Field(default=None, max_length=255)
    tenant_id: int = Field(default=1, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    is_deleted: bool = Field(default=False)


class SysUser(SQLModel, table=True):
    __tablename__ = "sys_user"

    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True, max_length=64)
    password_hash: str = Field(max_length=255)
    display_name: str = Field(default="", max_length=128)
    email: str | None = Field(default=None, max_length=128)
    # 内置: /avatars/01.svg ；上传: file:{sys_file.id}
    avatar_url: str | None = Field(default=None, max_length=255)
    status: str = Field(default=UserStatus.ACTIVE.value, max_length=32)
    dept_id: int | None = Field(default=None, foreign_key="sys_dept.id", index=True)
    tenant_id: int = Field(default=1, index=True)
    data_scope: str = Field(default="ALL", max_length=32)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    is_deleted: bool = Field(default=False)


class SysRole(SQLModel, table=True):
    __tablename__ = "sys_role"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=64)
    code: str = Field(index=True, unique=True, max_length=64)
    status: str = Field(default="active", max_length=32)
    tenant_id: int = Field(default=1, index=True)
    data_scope: str = Field(default="ALL", max_length=32)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    is_deleted: bool = Field(default=False)


class SysUserRole(SQLModel, table=True):
    __tablename__ = "sys_user_role"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="sys_user.id", index=True)
    role_id: int = Field(foreign_key="sys_role.id", index=True)


class SysMenu(SQLModel, table=True):
    __tablename__ = "sys_menu"

    id: int | None = Field(default=None, primary_key=True)
    parent_id: int | None = Field(default=None, index=True)
    name: str = Field(max_length=64)
    path: str | None = Field(default=None, max_length=255)
    component: str | None = Field(default=None, max_length=255)
    type: str = Field(max_length=16)
    sort: int = Field(default=0)
    visible: bool = Field(default=True)
    icon: str | None = Field(default=None, max_length=64)
    tenant_id: int = Field(default=1, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    is_deleted: bool = Field(default=False)


class SysPermission(SQLModel, table=True):
    __tablename__ = "sys_permission"

    id: int | None = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True, max_length=128)
    name: str = Field(max_length=64)
    resource: str = Field(max_length=64)
    action: str = Field(max_length=32)
    tenant_id: int = Field(default=1, index=True)


class SysApiPermission(SQLModel, table=True):
    """接口权限映射：HTTP 方法 + 路径模板 → 权限码。由配置台维护，全局鉴权读取。"""

    __tablename__ = "sys_api_permission"

    id: int | None = Field(default=None, primary_key=True)
    method: str = Field(index=True, max_length=16)  # GET/POST/PUT/DELETE/PATCH 或 *
    path_pattern: str = Field(index=True, max_length=256)  # 相对 api_prefix，如 /scheduling/gantt
    permission_code: str = Field(index=True, max_length=128)
    name: str = Field(default="", max_length=128)
    enabled: bool = Field(default=True)
    sort: int = Field(default=0)
    tenant_id: int = Field(default=1, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SysRoleMenu(SQLModel, table=True):
    __tablename__ = "sys_role_menu"

    id: int | None = Field(default=None, primary_key=True)
    role_id: int = Field(foreign_key="sys_role.id", index=True)
    menu_id: int = Field(foreign_key="sys_menu.id", index=True)


class SysRolePermission(SQLModel, table=True):
    __tablename__ = "sys_role_permission"

    id: int | None = Field(default=None, primary_key=True)
    role_id: int = Field(foreign_key="sys_role.id", index=True)
    permission_id: int = Field(foreign_key="sys_permission.id", index=True)


class SysLoginLog(SQLModel, table=True):
    __tablename__ = "sys_login_log"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int | None = Field(default=None, index=True)
    username: str = Field(max_length=64)
    ip: str | None = Field(default=None, max_length=64)
    result: str = Field(max_length=32)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SysOperationLog(SQLModel, table=True):
    __tablename__ = "sys_operation_log"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int | None = Field(default=None, index=True)
    resource: str = Field(max_length=128)
    action: str = Field(max_length=64)
    request: str | None = Field(default=None)
    result: str = Field(default="success", max_length=32)
    trace_id: str | None = Field(default=None, max_length=64)
    created_at: datetime = Field(default_factory=datetime.utcnow)
