"""租户（客户）开通与模块 SKU 管理 — 仅平台账号。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.factory_code_service import ensure_factory_code
from app.application.tenant_sku import enabled_modules_as_list, parse_enabled_modules
from app.auth.tenant_context import PLATFORM_TENANT_ID, is_platform_user
from app.core.exceptions import NotFoundException, PermissionException, ValidationException
from app.models.system import SysDept, SysTenant, SysUser


class TenantService:
    def __init__(self, session: AsyncSession):
        self.session = session

    @staticmethod
    def assert_platform_operator(user: SysUser) -> None:
        if not is_platform_user(user):
            raise PermissionException("仅平台管理员可管理租户")

    async def list_tenants(self, operator: SysUser) -> list[dict]:
        self.assert_platform_operator(operator)
        result = await self.session.execute(
            select(SysTenant)
            .where(SysTenant.is_deleted.is_(False))
            .order_by(SysTenant.id)
        )
        return [self._serialize(t) for t in result.scalars().all()]

    async def get_tenant(self, tenant_id: int, operator: SysUser) -> dict:
        self.assert_platform_operator(operator)
        return self._serialize(await self._get_tenant(tenant_id))

    async def create_tenant(self, data, operator: SysUser) -> dict:
        self.assert_platform_operator(operator)
        code = (data.code or "").strip()
        if not code:
            raise ValidationException("租户编码不能为空")
        exists = await self.session.execute(
            select(SysTenant).where(SysTenant.code == code, SysTenant.is_deleted.is_(False))
        )
        if exists.scalar_one_or_none():
            raise ValidationException("租户编码已存在")

        modules = (data.enabled_modules or "*").strip() or "*"
        row = SysTenant(
            name=data.name.strip(),
            code=code,
            enabled_modules=modules,
            status=data.status or "active",
            remark=data.remark,
        )
        self.session.add(row)
        await self.session.flush()
        await ensure_factory_code(self.session, row)

        root_name = (getattr(data, "root_dept_name", None) or f"{row.name}").strip()
        root_code = f"{code}-HQ"
        self.session.add(
            SysDept(
                parent_id=None,
                name=root_name,
                code=root_code,
                sort=1,
                status="active",
                tenant_id=row.id,  # type: ignore[arg-type]
            )
        )
        await self.session.flush()
        return self._serialize(row)

    async def update_tenant(self, tenant_id: int, data, operator: SysUser) -> dict:
        self.assert_platform_operator(operator)
        row = await self._get_tenant(tenant_id)
        payload = data.model_dump(exclude_unset=True)
        if "code" in payload and payload["code"]:
            code = payload["code"].strip()
            dup = await self.session.execute(
                select(SysTenant).where(
                    SysTenant.code == code,
                    SysTenant.id != tenant_id,
                    SysTenant.is_deleted.is_(False),
                )
            )
            if dup.scalar_one_or_none():
                raise ValidationException("租户编码已存在")
            row.code = code
        if "name" in payload and payload["name"] is not None:
            row.name = payload["name"].strip()
        if "enabled_modules" in payload and payload["enabled_modules"] is not None:
            row.enabled_modules = payload["enabled_modules"].strip() or "*"
        if "status" in payload and payload["status"] is not None:
            row.status = payload["status"]
        if "remark" in payload:
            row.remark = payload["remark"]
        row.updated_at = datetime.utcnow()
        return self._serialize(row)

    async def delete_tenant(self, tenant_id: int, operator: SysUser) -> None:
        self.assert_platform_operator(operator)
        if tenant_id == PLATFORM_TENANT_ID:
            raise ValidationException("不能删除平台租户")
        row = await self._get_tenant(tenant_id)
        users = await self.session.execute(
            select(SysUser.id).where(
                SysUser.tenant_id == tenant_id,
                SysUser.is_deleted.is_(False),
            )
        )
        if users.first() is not None:
            raise ValidationException("租户下仍有用户，无法删除")
        row.is_deleted = True
        row.updated_at = datetime.utcnow()

    async def _get_tenant(self, tenant_id: int) -> SysTenant:
        result = await self.session.execute(
            select(SysTenant).where(
                SysTenant.id == tenant_id,
                SysTenant.is_deleted.is_(False),
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise NotFoundException("租户不存在")
        return row

    def _serialize(self, row: SysTenant) -> dict:
        enabled = parse_enabled_modules(row.enabled_modules)
        return {
            "id": row.id,
            "name": row.name,
            "code": row.code,
            "factory_code": row.factory_code,
            "enabled_modules": row.enabled_modules,
            "enabled_module_list": enabled_modules_as_list(enabled),
            "status": row.status,
            "remark": row.remark,
            "created_at": row.created_at.isoformat(),
            "updated_at": row.updated_at.isoformat(),
        }
