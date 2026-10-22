from dataclasses import dataclass, field

from app.auth.tenant_context import effective_tenant_id, is_platform_user
from app.models.enums import DataScope
from app.models.system import SysUser


@dataclass
class CurrentUser:
    user: SysUser
    roles: list[str] = field(default_factory=list)
    role_names: list[str] = field(default_factory=list)
    permissions: set[str] = field(default_factory=set)
    api_permission_ids: set[int] = field(default_factory=set)
    # 多角色取最宽后的有效数据范围
    data_scope: str = DataScope.ALL.value
    operating_tenant_id: int | None = None

    @property
    def id(self) -> int:
        return self.user.id  # type: ignore[return-value]

    @property
    def tenant_id(self) -> int:
        return self.user.tenant_id

    @property
    def is_platform_admin(self) -> bool:
        return is_platform_user(self.user)

    @property
    def effective_tenant_id(self) -> int:
        return effective_tenant_id(self.user, self.operating_tenant_id)

    @property
    def dept_id(self) -> int | None:
        return self.user.dept_id

    def has_permission(self, code: str) -> bool:
        return code in self.permissions

    def has_api_permission(self, api_permission_id: int | None) -> bool:
        if api_permission_id is None:
            return False
        return int(api_permission_id) in self.api_permission_ids
