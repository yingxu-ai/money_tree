from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

import app.models.registry  # noqa: F401
from app.api.router import api_router
from app.application.branding_service import BrandingService
from app.core.config import get_settings
from app.core.database import async_session_factory, init_db
from app.core.handlers import register_exception_handlers
from app.core.logging import setup_logging
from app.core.middleware import RequestContextMiddleware
from app.core.response import ok

settings = get_settings()
setup_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # 排产快照：表已就绪后从库加载（或写入初始 seed）
    from app.modules.scheduling.store import store

    store.reload_from_db()

    # 启动时按稳定 key 同步全部路由 → 接口权限表（改路径只更新，不丢 id）
    async with async_session_factory() as session:
        from app.application.api_permission_service import ApiPermissionService
        from app.core.logging import get_logger

        result = await ApiPermissionService(session).sync_from_app(app)
        await session.commit()
        get_logger("startup").info(
            "api permissions synced: created=%s updated=%s total=%s admin_granted=%s",
            result.get("created"),
            result.get("updated"),
            result.get("total_routes"),
            result.get("admin_granted"),
        )
    yield


app = FastAPI(
    title=settings.app_title,
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestContextMiddleware)
register_exception_handlers(app)


@app.get("/health")
async def health(request: Request):
    async with async_session_factory() as session:
        branding = await BrandingService(session).get_public_settings()
    return ok(
        request,
        {
            "status": "ok",
            "app_name": settings.app_name,
            "app_env": settings.app_env,
            **branding,
        },
    )


app.include_router(api_router, prefix=settings.api_prefix)
