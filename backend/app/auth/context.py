from dataclasses import dataclass, field

from app.models.enums import DataScope
from app.models.system import SysUser


@dataclass
class CurrentUser:
    user: SysUser
    roles: list[str] = field(default_factory=list)
    permissions: set[str] = field(default_factory=set)
    # 多角色取最宽后的有效数据范围
    data_scope: str = DataScope.ALL.value

    @property
    def id(self) -> int:
        return self.user.id  # type: ignore[return-value]

    @property
    def tenant_id(self) -> int:
        return self.user.tenant_id

    @property
    def dept_id(self) -> int | None:
        return self.user.dept_id

    def has_permission(self, code: str) -> bool:
        return code in self.permissions
