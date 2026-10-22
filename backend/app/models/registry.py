# 确保所有表模型被 SQLModel metadata 注册
from app.models.dashboard import Dashboard, DashboardLayout, DashboardWidget, WidgetDefinition
from app.models.infra import SysConfig, SysFile, SysTask
from app.models.scheduling import SchedulingSnapshot
from app.models.system import (
    SysDept,
    SysDictItem,
    SysDictType,
    SysLoginLog,
    SysMenu,
    SysOperationLog,
    SysApiPermission,
    SysPermission,
    SysRole,
    SysRoleApiPermission,
    SysRoleMenu,
    SysRolePermission,
    SysTenant,
    SysUser,
    SysUserRole,
)

__all__ = [
    "SysTenant",
    "SysUser",
    "SysRole",
    "SysUserRole",
    "SysDept",
    "SysDictType",
    "SysDictItem",
    "SysMenu",
    "SysPermission",
    "SysApiPermission",
    "SysRoleMenu",
    "SysRolePermission",
    "SysRoleApiPermission",
    "SysLoginLog",
    "SysOperationLog",
    "Dashboard",
    "DashboardLayout",
    "DashboardWidget",
    "WidgetDefinition",
    "SysConfig",
    "SysFile",
    "SysTask",
    "SchedulingSnapshot",
]
