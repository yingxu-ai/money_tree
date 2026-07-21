from sqlalchemy.ext.asyncio import AsyncSession

from app.application.config_service import ConfigService
from app.core.config import get_settings

BRANDING_KEYS = ("app.title", "app.subtitle", "app.sidebar_title", "app.logo_url", "app.theme")


class BrandingService:
    def __init__(self, session: AsyncSession | None = None):
        self.session = session
        self.settings = get_settings()

    async def get_public_settings(self) -> dict:
        """环境变量默认值 + 数据库 SYSTEM 配置叠加。"""
        result = {
            "app_name": self.settings.app_name,
            "app_env": self.settings.app_env,
            **self.settings.branding_defaults(),
        }

        if self.session is None:
            return result

        config_service = ConfigService(self.session)
        for key in BRANDING_KEYS:
            value = await config_service.get_system_value(key)
            if value:
                result[key] = value
        return result

    async def get_document_title(self) -> str:
        settings = await self.get_public_settings()
        return settings.get("app.title", self.settings.app_title)
