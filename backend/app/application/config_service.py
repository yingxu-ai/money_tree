from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundException
from app.models.infra import SysConfig


class ConfigService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_configs(self, scope_type: str | None = None) -> list[dict]:
        query = select(SysConfig)
        if scope_type:
            query = query.where(SysConfig.scope_type == scope_type)
        result = await self.session.execute(query.order_by(SysConfig.config_key))
        return [self._serialize(c) for c in result.scalars().all()]

    async def upsert_config(self, data: dict, user_id: int) -> dict:
        result = await self.session.execute(
            select(SysConfig).where(
                SysConfig.scope_type == data["scope_type"],
                SysConfig.scope_id == data.get("scope_id"),
                SysConfig.config_key == data["config_key"],
            )
        )
        config = result.scalar_one_or_none()
        if config is None:
            config = SysConfig(**{k: v for k, v in data.items() if k != "scope_id" or v is not None})
            if data.get("scope_id") is not None:
                config.scope_id = data["scope_id"]
            self.session.add(config)
        else:
            config.config_value = data["config_value"]
            config.value_type = data.get("value_type", config.value_type)
            config.description = data.get("description", config.description)
            config.version += 1
            config.updated_by = user_id
        await self.session.flush()
        return self._serialize(config)

    async def get_system_value(self, config_key: str) -> str | None:
        result = await self.session.execute(
            select(SysConfig).where(
                SysConfig.config_key == config_key,
                SysConfig.scope_type == "SYSTEM",
                SysConfig.scope_id.is_(None),
            ).limit(1)
        )
        config = result.scalar_one_or_none()
        return config.config_value if config else None

    async def get_resolved(self, config_key: str, tenant_id: int, user_id: int) -> str | None:
        """按 用户 > 租户 > 系统 优先级叠加。"""
        for scope_type, scope_id in [("USER", user_id), ("TENANT", tenant_id), ("SYSTEM", None)]:
            query = select(SysConfig).where(
                SysConfig.config_key == config_key, SysConfig.scope_type == scope_type
            )
            if scope_id is not None:
                query = query.where(SysConfig.scope_id == scope_id)
            else:
                query = query.where(SysConfig.scope_id.is_(None))
            result = await self.session.execute(query.limit(1))
            config = result.scalar_one_or_none()
            if config:
                return config.config_value
        return None

    async def delete_config(self, config_id: int) -> None:
        result = await self.session.execute(select(SysConfig).where(SysConfig.id == config_id))
        config = result.scalar_one_or_none()
        if config is None:
            raise NotFoundException("配置不存在")
        await self.session.delete(config)

    def _serialize(self, config: SysConfig) -> dict:
        return {
            "id": config.id,
            "scope_type": config.scope_type,
            "scope_id": config.scope_id,
            "config_key": config.config_key,
            "config_value": config.config_value,
            "value_type": config.value_type,
            "description": config.description,
            "version": config.version,
            "updated_at": config.updated_at.isoformat(),
        }
