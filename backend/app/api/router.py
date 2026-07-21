from fastapi import APIRouter

from app.api import audit, auth, config, dashboard, files, metrics, public, runtime, system

api_router = APIRouter()
api_router.include_router(public.router)
api_router.include_router(auth.router)
api_router.include_router(system.users_router)
api_router.include_router(system.roles_router)
api_router.include_router(system.menus_router)
api_router.include_router(system.permissions_router)
api_router.include_router(system.depts_router)
api_router.include_router(system.dicts_router)
api_router.include_router(dashboard.router)
api_router.include_router(metrics.router)
api_router.include_router(files.router)
api_router.include_router(config.router)
api_router.include_router(runtime.router)
api_router.include_router(audit.router)
