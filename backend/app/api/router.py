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
    production_progress,
    scheduling,
    system,
)
from app.auth.deps import enforce_api_permission

api_router = APIRouter(dependencies=[Depends(enforce_api_permission)])
api_router.include_router(public.router)
api_router.include_router(auth.router)
api_router.include_router(runtime.router)

# 多租户模式：路由全量挂载，按租户 SKU 在 module_guard 拦截
api_router.include_router(system.users_router)
api_router.include_router(system.roles_router)
api_router.include_router(system.menus_router)
api_router.include_router(system.permissions_router)
api_router.include_router(system.api_permissions_router)
api_router.include_router(system.depts_router)
api_router.include_router(system.dicts_router)
api_router.include_router(system.tenants_router)
api_router.include_router(audit.router)
api_router.include_router(dashboard.router)
api_router.include_router(metrics.router)
api_router.include_router(files.router)
api_router.include_router(config.router)
api_router.include_router(demo.router)
api_router.include_router(equipment_analysis.router)
api_router.include_router(scheduling.router)
api_router.include_router(production_progress.router)
