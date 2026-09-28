from fastapi import APIRouter, Depends

from app.api import (
    audit,
    auth,
    config,
    dashboard,
    demo,
    equipment_analysis,
    files,
    metrics,
    public,
    runtime,
    scheduling,
    system,
)
from app.auth.deps import enforce_api_permission
from app.core.config import get_settings
from app.core.module_guard import parse_enabled_modules

api_router = APIRouter(dependencies=[Depends(enforce_api_permission)])
api_router.include_router(public.router)
api_router.include_router(auth.router)

# 壳能力：始终挂载
api_router.include_router(runtime.router)

_settings = get_settings()
_enabled = parse_enabled_modules(_settings.enabled_modules)


def _on(module_id: str) -> bool:
    return _enabled is None or module_id in _enabled


if _on("system"):
    api_router.include_router(system.users_router)
    api_router.include_router(system.roles_router)
    api_router.include_router(system.menus_router)
    api_router.include_router(system.permissions_router)
    api_router.include_router(system.api_permissions_router)
    api_router.include_router(system.depts_router)
    api_router.include_router(system.dicts_router)
    api_router.include_router(audit.router)

if _on("dashboard"):
    api_router.include_router(dashboard.router)
    api_router.include_router(metrics.router)
    api_router.include_router(files.router)
    api_router.include_router(config.router)

if _on("demo"):
    api_router.include_router(demo.router)

if _on("equipment-analysis"):
    api_router.include_router(equipment_analysis.router)

if _on("scheduling"):
    api_router.include_router(scheduling.router)
