"""租户上下文：平台运维账号 vs 租户内账号。"""

from __future__ import annotations

from fastapi import Request

from app.core.exceptions import ValidationException
from app.models.system import SysUser

# 平台账号不归属任何客户租户（sys_user.tenant_id=0）
PLATFORM_TENANT_ID = 0
OPERATING_TENANT_HEADER = "X-Operating-Tenant-Id"


def is_platform_user(user: SysUser) -> bool:
    return int(user.tenant_id) == PLATFORM_TENANT_ID


def parse_operating_tenant_header(request: Request) -> int | None:
    raw = request.headers.get(OPERATING_TENANT_HEADER)
    if raw is None or str(raw).strip() == "":
        return None
    try:
        tid = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValidationException("X-Operating-Tenant-Id 无效") from exc
    if tid <= 0:
        raise ValidationException("X-Operating-Tenant-Id 须为正整数")
    return tid


def effective_tenant_id(user: SysUser, operating_tenant_id: int | None) -> int:
    """业务数据读写使用的租户 id。"""
    if is_platform_user(user):
        if operating_tenant_id is None:
            raise ValidationException("请先在顶栏选择要代管的租户")
        return operating_tenant_id
    return int(user.tenant_id)


def try_effective_tenant_id(user: SysUser, operating_tenant_id: int | None) -> int | None:
    """列表类接口用：平台未选代管租户时返回 None（空结果），不抛错。"""
    if is_platform_user(user):
        return operating_tenant_id
    return int(user.tenant_id)


def sku_tenant_id(user: SysUser, operating_tenant_id: int | None) -> int | None:
    """模块 SKU / 菜单裁剪用的租户 id；平台未选租户时不按 SKU 限制。"""
    if is_platform_user(user):
        return operating_tenant_id
    return int(user.tenant_id)
