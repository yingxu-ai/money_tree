from datetime import datetime
from enum import Enum

from sqlmodel import Field, SQLModel


class TimestampMixin(SQLModel):
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class MenuType(str, Enum):
    CATALOG = "CATALOG"
    MENU = "MENU"
    BUTTON = "BUTTON"


class DataScope(str, Enum):
    ALL = "ALL"
    ORG = "ORG"
    SELF_ORG = "SELF_ORG"
    CUSTOM = "CUSTOM"
    SELF = "SELF"


class UserStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"


class RoleStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"


class DashboardStatus(str, Enum):
    DRAFT = "draft"
    ONLINE = "online"
    OFFLINE = "offline"


class ConfigScopeType(str, Enum):
    SYSTEM = "SYSTEM"
    TENANT = "TENANT"
    USER = "USER"
    BUSINESS = "BUSINESS"
