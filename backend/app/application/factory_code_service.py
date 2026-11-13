"""车间厂码：每租户一张短码，供微信小程序码 scene 使用。"""

from __future__ import annotations

import secrets
import string

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundException, ValidationException
from app.models.system import SysTenant

_ALPHABET = string.ascii_uppercase + string.digits


def _new_factory_code(length: int = 8) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


async def ensure_factory_code(session: AsyncSession, tenant: SysTenant) -> str:
    """保证租户有唯一厂码；已有则直接返回。"""
    existing = (tenant.factory_code or "").strip()
    if existing:
        return existing
    for _ in range(12):
        code = _new_factory_code()
        dup = (
            await session.execute(
                select(SysTenant.id).where(
                    SysTenant.factory_code == code,
                    SysTenant.is_deleted.is_(False),
                )
            )
        ).scalar_one_or_none()
        if dup is None:
            tenant.factory_code = code
            await session.flush()
            return code
    raise ValidationException("无法生成唯一厂码，请重试")


async def get_tenant_by_factory_code(session: AsyncSession, factory_code: str) -> SysTenant:
    code = (factory_code or "").strip().upper()
    if not code:
        raise ValidationException("厂码无效")
    rows = (
        await session.execute(
            select(SysTenant).where(
                SysTenant.is_deleted.is_(False),
                SysTenant.status == "active",
            )
        )
    ).scalars().all()
    hit = next(
        (t for t in rows if (t.factory_code or "").strip().upper() == code),
        None,
    )
    if hit is None:
        raise NotFoundException("厂码无效或已停用，请扫车间正确厂码")
    return hit


async def get_tenant_by_id(session: AsyncSession, tenant_id: int) -> SysTenant:
    row = (
        await session.execute(
            select(SysTenant).where(
                SysTenant.id == int(tenant_id),
                SysTenant.is_deleted.is_(False),
                SysTenant.status == "active",
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundException("客户不存在或已停用")
    return row
