"""接口权限：稳定 key 同步 + 路径匹配鉴权。"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from fastapi import FastAPI
from fastapi.routing import APIRoute
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import NotFoundException, ValidationException
from app.core.permission_menu import menu_id_for_api_path
from app.models.system import SysApiPermission, SysRole, SysRoleApiPermission

# 不走接口权限表的公开/认证路径（相对 api_prefix）
PUBLIC_API_PREFIXES = (
    "/public",
    "/auth/login",
)

# 登录后本人信息/菜单/改密等：任意已登录用户可访问，不按角色勾接口
AUTH_SELF_API_PREFIXES = (
    "/auth/me",
)

# method+path → 展示名 / 兼容权限码（仅作覆盖，不是主键）
API_META_OVERLAYS: dict[tuple[str, str], dict[str, str]] = {
    ("GET", "/users"): {"name": "查看账号", "permission_code": "user:view"},
    ("POST", "/users"): {"name": "新增账号", "permission_code": "user:create"},
    ("PUT", "/users/{user_id}"): {"name": "编辑账号", "permission_code": "user:update"},
    ("DELETE", "/users/{user_id}"): {"name": "删除账号", "permission_code": "user:delete"},
    ("GET", "/roles"): {"name": "查看角色", "permission_code": "role:view"},
    ("POST", "/roles"): {"name": "新增角色", "permission_code": "role:assign"},
    ("PUT", "/roles/{role_id}"): {"name": "编辑角色", "permission_code": "role:assign"},
    ("DELETE", "/roles/{role_id}"): {"name": "删除角色", "permission_code": "role:assign"},
    ("GET", "/permissions"): {"name": "权限码列表", "permission_code": "role:view"},
    ("GET", "/permissions/assign-tree"): {"name": "角色配权树", "permission_code": "role:view"},
    ("GET", "/menus"): {"name": "查看菜单", "permission_code": "menu:view"},
    ("POST", "/menus"): {"name": "新增菜单", "permission_code": "menu:view"},
    ("PUT", "/menus/{menu_id}"): {"name": "编辑菜单", "permission_code": "menu:view"},
    ("DELETE", "/menus/{menu_id}"): {"name": "删除菜单", "permission_code": "menu:view"},
    ("GET", "/tenants"): {"name": "查看租户", "permission_code": "tenant:view"},
    ("POST", "/tenants"): {"name": "新建租户", "permission_code": "tenant:create"},
    ("PUT", "/tenants/{tenant_id}"): {"name": "编辑租户", "permission_code": "tenant:update"},
    ("DELETE", "/tenants/{tenant_id}"): {"name": "删除租户", "permission_code": "tenant:delete"},
    ("GET", "/depts"): {"name": "查看部门", "permission_code": "dept:view"},
    ("POST", "/depts"): {"name": "新增部门", "permission_code": "dept:create"},
    ("PUT", "/depts/{dept_id}"): {"name": "编辑部门", "permission_code": "dept:update"},
    ("DELETE", "/depts/{dept_id}"): {"name": "删除部门", "permission_code": "dept:delete"},
    ("GET", "/dicts/types"): {"name": "查看字典类型", "permission_code": "dict:view"},
    ("POST", "/dicts/types"): {"name": "新增字典类型", "permission_code": "dict:create"},
    ("PUT", "/dicts/types/{type_id}"): {"name": "编辑字典类型", "permission_code": "dict:update"},
    ("DELETE", "/dicts/types/{type_id}"): {"name": "删除字典类型", "permission_code": "dict:delete"},
    ("GET", "/dicts/items"): {"name": "查看字典项", "permission_code": "dict:view"},
    ("POST", "/dicts/items"): {"name": "新增字典项", "permission_code": "dict:create"},
    ("PUT", "/dicts/items/{item_id}"): {"name": "编辑字典项", "permission_code": "dict:update"},
    ("DELETE", "/dicts/items/{item_id}"): {"name": "删除字典项", "permission_code": "dict:delete"},
    ("GET", "/api-permissions"): {"name": "查看接口权限", "permission_code": "api_perm:view"},
    ("GET", "/api-permissions/routes"): {"name": "已注册路由目录", "permission_code": "api_perm:view"},
    ("POST", "/api-permissions/sync"): {"name": "同步路由到配置台", "permission_code": "api_perm:manage"},
    ("POST", "/api-permissions"): {"name": "新增接口权限", "permission_code": "api_perm:manage"},
    ("PUT", "/api-permissions/{rule_id}"): {"name": "编辑接口权限", "permission_code": "api_perm:manage"},
    ("DELETE", "/api-permissions/{rule_id}"): {"name": "删除接口权限", "permission_code": "api_perm:manage"},
    ("POST", "/scheduling/reset"): {
        "name": "恢复排产测试数据",
        "permission_code": "scheduling:baseline:restore",
    },
    ("GET", "/scheduling/master"): {"name": "排产基础数据", "permission_code": "scheduling:view"},
    ("POST", "/scheduling/resources"): {"name": "新增班组", "permission_code": "scheduling:view"},
    ("PUT", "/scheduling/resources/{resource_id}"): {
        "name": "编辑班组",
        "permission_code": "scheduling:view",
    },
    ("DELETE", "/scheduling/resources/{resource_id}"): {
        "name": "删除班组",
        "permission_code": "scheduling:view",
    },
    ("POST", "/scheduling/skills"): {"name": "新增技能", "permission_code": "scheduling:view"},
    ("PUT", "/scheduling/skills/{skill_id}"): {
        "name": "编辑技能",
        "permission_code": "scheduling:view",
    },
    ("DELETE", "/scheduling/skills/{skill_id}"): {
        "name": "删除技能",
        "permission_code": "scheduling:view",
    },
    ("POST", "/scheduling/equipments"): {"name": "新增设备", "permission_code": "scheduling:view"},
    ("PUT", "/scheduling/equipments/{equipment_id}"): {
        "name": "编辑设备",
        "permission_code": "scheduling:view",
    },
    ("DELETE", "/scheduling/equipments/{equipment_id}"): {
        "name": "删除设备",
        "permission_code": "scheduling:view",
    },
    ("GET", "/scheduling/gantt"): {"name": "查看甘特", "permission_code": "scheduling:view"},
    ("GET", "/scheduling/report"): {"name": "工序报工/今日任务", "permission_code": "scheduling:view"},
    ("GET", "/scheduling/work-orders"): {"name": "工单列表", "permission_code": "scheduling:view"},
    ("GET", "/scheduling/roster/week"): {"name": "周排班", "permission_code": "scheduling:view"},
    ("GET", "/scheduling/roster/analysis"): {
        "name": "排班人数分析",
        "permission_code": "scheduling:view",
    },
    ("PUT", "/scheduling/gantt/tasks/{op_id}"): {
        "name": "调整工序计划",
        "permission_code": "scheduling:gantt:edit",
    },
    ("POST", "/scheduling/gantt/tasks/{op_id}/resolve-variance"): {
        "name": "偏差处置",
        "permission_code": "scheduling:variance:resolve",
    },
    ("POST", "/scheduling/gantt/tasks/{op_id}/ack-busy"): {
        "name": "确认并行",
        "permission_code": "scheduling:gantt:edit",
    },
    ("POST", "/scheduling/report/{op_id}/start"): {
        "name": "工序开工",
        "permission_code": "scheduling:report:start",
    },
    ("POST", "/scheduling/report/{op_id}/finish"): {
        "name": "工序完工",
        "permission_code": "scheduling:report:start",
    },
    ("POST", "/scheduling/report/{op_id}/pause"): {
        "name": "工序暂停",
        "permission_code": "scheduling:report:start",
    },
    ("POST", "/scheduling/report/daily-log"): {
        "name": "下班确认签字",
        "permission_code": "scheduling:report:start",
    },
    ("DELETE", "/scheduling/report/daily-log/{log_id}"): {
        "name": "删除报工记录",
        "permission_code": "scheduling:report:start",
    },
    ("GET", "/scheduling/shop-floor-reports"): {
        "name": "生产日报列表",
        "permission_code": "scheduling:view",
    },
    ("GET", "/scheduling/shop-floor-reports/progress"): {
        "name": "生产日报工单进度",
        "permission_code": "scheduling:view",
    },
    ("POST", "/scheduling/shop-floor-reports"): {
        "name": "提交生产日报",
        "permission_code": "scheduling:report:start",
    },
    ("POST", "/scheduling/shop-floor-reports/batch"): {
        "name": "批量提交生产日报",
        "permission_code": "scheduling:report:start",
    },
    ("GET", "/scheduling/shop-floor-reports/shift-hint"): {
        "name": "生产日报班次提示",
        "permission_code": "scheduling:view",
    },
    ("POST", "/scheduling/shop-floor-reports/{report_id}/review"): {
        "name": "确认/驳回生产日报",
        "permission_code": "scheduling:shop_floor:review",
    },
    ("DELETE", "/scheduling/shop-floor-reports/{report_id}"): {
        "name": "删除生产日报",
        "permission_code": "scheduling:report:start",
    },
    # ----- 生产进度（并行菜单，不改排产） -----
    ("GET", "/production-progress/master"): {
        "name": "生产进度基础数据",
        "permission_code": "production_progress:view",
    },
    ("GET", "/production-progress/processes"): {
        "name": "生产进度工序列表",
        "permission_code": "production_progress:view",
    },
    ("POST", "/production-progress/processes"): {
        "name": "新增工序",
        "permission_code": "production_progress:view",
    },
    ("PUT", "/production-progress/processes/{process_id}"): {
        "name": "更新工序",
        "permission_code": "production_progress:view",
    },
    ("DELETE", "/production-progress/processes/{process_id}"): {
        "name": "删除工序",
        "permission_code": "production_progress:view",
    },
    ("GET", "/production-progress/products"): {
        "name": "生产进度产品列表",
        "permission_code": "production_progress:view",
    },
    ("POST", "/production-progress/products"): {
        "name": "新增产品工艺",
        "permission_code": "production_progress:view",
    },
    ("PUT", "/production-progress/products/{product_id}"): {
        "name": "更新产品工艺",
        "permission_code": "production_progress:view",
    },
    ("DELETE", "/production-progress/products/{product_id}"): {
        "name": "删除产品",
        "permission_code": "production_progress:view",
    },
    ("GET", "/production-progress/work-orders"): {
        "name": "生产进度工单列表",
        "permission_code": "production_progress:view",
    },
    ("GET", "/production-progress/cockpit"): {
        "name": "生产进度全局看板",
        "permission_code": "production_progress:view",
    },
    ("GET", "/production-progress/shop-floor-reports"): {
        "name": "生产进度日报列表",
        "permission_code": "production_progress:view",
    },
    ("GET", "/production-progress/shop-floor-reports/shift-hint"): {
        "name": "生产进度班次提示",
        "permission_code": "production_progress:view",
    },
    ("GET", "/production-progress/shop-floor-reports/progress"): {
        "name": "生产进度看板",
        "permission_code": "production_progress:view",
    },
    ("GET", "/production-progress/shop-floor-reports/progress/detail"): {
        "name": "生产进度下钻明细",
        "permission_code": "production_progress:view",
    },
    ("GET", "/production-progress/shop-floor-reports/stats"): {
        "name": "生产进度日报统计",
        "permission_code": "production_progress:view",
    },
    ("POST", "/production-progress/shop-floor-reports"): {
        "name": "生产进度提交报工",
        "permission_code": "production_progress:report",
    },
    ("POST", "/production-progress/shop-floor-reports/batch"): {
        "name": "生产进度批量报工",
        "permission_code": "production_progress:report",
    },
    ("POST", "/production-progress/shop-floor-reports/finished-confirm"): {
        "name": "生产进度成品确认",
        "permission_code": "production_progress:review",
    },
    ("GET", "/production-progress/shop-floor-settings"): {
        "name": "生产进度报工口径配置",
        "permission_code": "production_progress:view",
    },
    ("PUT", "/production-progress/shop-floor-settings"): {
        "name": "修改生产进度报工口径",
        "permission_code": "production_progress:review",
    },
    ("POST", "/production-progress/shop-floor-reports/review-batch"): {
        "name": "生产进度日报批量确认",
        "permission_code": "production_progress:review",
    },
    ("POST", "/production-progress/shop-floor-reports/{report_id}/review"): {
        "name": "生产进度日报确认",
        "permission_code": "production_progress:review",
    },
    ("DELETE", "/production-progress/shop-floor-reports/{report_id}"): {
        "name": "生产进度删除报工",
        "permission_code": "production_progress:report",
    },
}


def normalize_api_path(path: str) -> str:
    """去掉 api_prefix，统一为 /xxx 形式。"""
    settings = get_settings()
    prefix = (settings.api_prefix or "").rstrip("/")
    raw = path.split("?")[0]
    if prefix and raw.startswith(prefix):
        raw = raw[len(prefix) :] or "/"
    if not raw.startswith("/"):
        raw = "/" + raw
    if len(raw) > 1 and raw.endswith("/"):
        raw = raw.rstrip("/")
    return raw


def _pattern_to_regex(pattern: str) -> re.Pattern[str]:
    parts: list[str] = []
    for seg in pattern.strip("/").split("/"):
        if not seg:
            continue
        if seg.startswith("{") and seg.endswith("}"):
            parts.append(r"[^/]+")
        elif seg == "*":
            parts.append(r"[^/]+")
        else:
            parts.append(re.escape(seg))
    body = "/".join(parts)
    return re.compile(rf"^/{body}$" if body else r"^/$")


def path_matches(pattern: str, path: str) -> bool:
    return bool(_pattern_to_regex(normalize_api_path(pattern)).match(normalize_api_path(path)))


def is_public_api_path(path: str) -> bool:
    p = normalize_api_path(path)
    for prefix in PUBLIC_API_PREFIXES:
        if p == prefix or p.startswith(prefix + "/"):
            return True
    return False


def is_auth_self_api_path(path: str) -> bool:
    """当前用户资料/菜单等自服务接口。"""
    p = normalize_api_path(path)
    for prefix in AUTH_SELF_API_PREFIXES:
        if p == prefix or p.startswith(prefix + "/"):
            return True
    return False


def make_stable_key(method: str, endpoint: Any, path_pattern: str) -> str:
    """同一处理函数 + 方法 = 同一条权限；改 URL 不换身份。"""
    method_u = (method or "GET").upper()
    if endpoint is not None:
        mod = getattr(endpoint, "__module__", "") or ""
        qual = getattr(endpoint, "__qualname__", "") or getattr(endpoint, "__name__", "") or ""
        if mod and qual:
            return f"{method_u}:{mod}.{qual}"[:255]
    return f"{method_u}:{normalize_api_path(path_pattern)}"[:255]


class ApiPermissionService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_rules(self) -> list[dict[str, Any]]:
        result = await self.session.execute(
            select(SysApiPermission).order_by(SysApiPermission.sort, SysApiPermission.id)
        )
        return [self._serialize(r) for r in result.scalars().all()]

    async def create_rule(self, data: dict[str, Any]) -> dict[str, Any]:
        payload = self._normalize_payload(data)
        if not payload.get("stable_key"):
            payload["stable_key"] = make_stable_key(
                payload["method"], None, payload["path_pattern"]
            )
        rule = SysApiPermission(**payload)
        self.session.add(rule)
        await self.session.flush()
        return self._serialize(rule)

    async def update_rule(self, rule_id: int, data: dict[str, Any]) -> dict[str, Any]:
        rule = await self._get(rule_id)
        payload = self._normalize_payload(data, partial=True)
        # 不允许通过普通编辑改掉 stable_key（身份）
        payload.pop("stable_key", None)
        for k, v in payload.items():
            setattr(rule, k, v)
        rule.updated_at = datetime.utcnow()
        await self.session.flush()
        return self._serialize(rule)

    async def delete_rule(self, rule_id: int) -> None:
        rule = await self._get(rule_id)
        await self.session.execute(
            select(SysRoleApiPermission).where(SysRoleApiPermission.api_permission_id == rule_id)
        )
        links = (
            await self.session.execute(
                select(SysRoleApiPermission).where(
                    SysRoleApiPermission.api_permission_id == rule_id
                )
            )
        ).scalars().all()
        for link in links:
            await self.session.delete(link)
        await self.session.delete(rule)
        await self.session.flush()

    async def find_required_permission(self, method: str, path: str) -> SysApiPermission | None:
        """返回最具体的一条启用规则；无配置则 None（不额外拦）。"""
        if is_public_api_path(path) or is_auth_self_api_path(path):
            return None
        method_u = (method or "GET").upper()
        path_n = normalize_api_path(path)
        result = await self.session.execute(
            select(SysApiPermission).where(SysApiPermission.enabled.is_(True))
        )
        rules = list(result.scalars().all())
        matched: list[SysApiPermission] = []
        for rule in rules:
            m = (rule.method or "*").upper()
            if m not in ("*", method_u):
                continue
            if path_matches(rule.path_pattern, path_n):
                matched.append(rule)
        if not matched:
            return None
        matched.sort(
            key=lambda r: (
                len(normalize_api_path(r.path_pattern).strip("/").split("/")),
                0 if (r.method or "*").upper() == "*" else 1,
                len(r.path_pattern),
            ),
            reverse=True,
        )
        return matched[0]

    @staticmethod
    def _default_permission_code(method: str, path: str) -> str:
        """无 overlay 时按模块给默认权限码，避免启用规则但码为空导致角色无法匹配。"""
        p = normalize_api_path(path)
        if p.startswith("/scheduling"):
            if p == "/scheduling/reset":
                return "scheduling:baseline:restore"
            return "scheduling:view"
        if p.startswith("/equipment-analysis"):
            return "dashboard:view"
        return ""

    async def sync_from_app(self, app: FastAPI) -> dict[str, Any]:
        """
        按 stable_key upsert：
        - 新路由 → 插入
        - 已存在 → 更新 method/path；名称/权限码仅在空时用 overlay 填充；menu_id 空时推断
        """
        existing_rows = list(
            (await self.session.execute(select(SysApiPermission))).scalars().all()
        )
        by_key = {r.stable_key: r for r in existing_rows if r.stable_key}
        # 旧数据无 stable_key：用 method+path 兜底认领一次
        by_method_path = {
            ((r.method or "*").upper(), normalize_api_path(r.path_pattern)): r
            for r in existing_rows
        }

        catalog = self.list_app_routes(app)
        created = 0
        updated = 0
        seen_keys: set[str] = set()

        for item in catalog:
            if is_public_api_path(item["path_pattern"]):
                continue
            stable_key = item["stable_key"]
            seen_keys.add(stable_key)
            method = item["method"]
            path = item["path_pattern"]
            overlay = API_META_OVERLAYS.get((method, path), {})
            inferred_menu = menu_id_for_api_path(path)
            default_code = self._default_permission_code(method, path)
            resolved_code = overlay.get("permission_code") or default_code

            rule = by_key.get(stable_key)
            if rule is None:
                rule = by_method_path.get((method, path))
                if rule is not None and not rule.stable_key:
                    rule.stable_key = stable_key
                    by_key[stable_key] = rule

            if rule is None:
                has_meta = bool(overlay) or bool(default_code)
                self.session.add(
                    SysApiPermission(
                        stable_key=stable_key,
                        method=method,
                        path_pattern=path,
                        permission_code=resolved_code,
                        name=overlay.get("name") or item.get("name") or path,
                        menu_id=inferred_menu,
                        # 新发现默认不启用，避免未授权角色被突然拦住；有 overlay/默认码的常用接口默认启用
                        enabled=has_meta,
                        sort=100,
                    )
                )
                created += 1
                continue

            changed = False
            if rule.method != method:
                rule.method = method
                changed = True
            if normalize_api_path(rule.path_pattern) != path:
                rule.path_pattern = path
                changed = True
            if not (rule.stable_key or "").strip():
                rule.stable_key = stable_key
                changed = True
            # 名称：仅空时自动填；已人工改过的不覆盖
            if not (rule.name or "").strip():
                rule.name = overlay.get("name") or item.get("name") or path
                changed = True
            elif overlay.get("name") and rule.name in (path, item.get("name"), rule.path_pattern):
                # 仍是自动名时，允许 overlay 升级成中文
                rule.name = overlay["name"]
                changed = True
            if not (rule.permission_code or "").strip() and resolved_code:
                rule.permission_code = resolved_code
                changed = True
            if path == "/scheduling/reset" and overlay.get("permission_code"):
                if not rule.enabled:
                    rule.enabled = True
                    changed = True
                if (rule.permission_code or "") != overlay["permission_code"]:
                    rule.permission_code = overlay["permission_code"]
                    changed = True
            if rule.menu_id is None and inferred_menu is not None:
                rule.menu_id = inferred_menu
                changed = True
            if changed:
                rule.updated_at = datetime.utcnow()
                updated += 1

        await self.session.flush()
        # 把「旧版只勾了权限码」的角色，自动补上对应接口规则 id
        migrated = await self._migrate_role_api_from_permission_codes()
        # 管理员角色自动拥有全部接口（按 id，改路径不丢）
        granted = await self._grant_all_to_admin_roles()
        return {
            "created": created,
            "updated": updated,
            "total_routes": len(catalog),
            "migrated_role_apis": migrated,
            "admin_granted": granted,
        }

    async def _migrate_role_api_from_permission_codes(self) -> int:
        """SysRolePermission.code → 同 permission_code 的接口规则，写入 role_api。"""
        from app.models.system import SysPermission, SysRolePermission

        links = list(
            (
                await self.session.execute(
                    select(SysRolePermission.role_id, SysPermission.code).join(
                        SysPermission, SysPermission.id == SysRolePermission.permission_id
                    )
                )
            ).all()
        )
        if not links:
            return 0
        code_to_apis: dict[str, list[int]] = {}
        for rule in (await self.session.execute(select(SysApiPermission))).scalars().all():
            code = (rule.permission_code or "").strip()
            if code and rule.id is not None:
                code_to_apis.setdefault(code, []).append(rule.id)

        added = 0
        for role_id, code in links:
            if not code:
                continue
            existing = set(
                (
                    await self.session.execute(
                        select(SysRoleApiPermission.api_permission_id).where(
                            SysRoleApiPermission.role_id == role_id
                        )
                    )
                )
                .scalars()
                .all()
            )
            for api_id in code_to_apis.get(code, []):
                if api_id in existing:
                    continue
                self.session.add(
                    SysRoleApiPermission(role_id=role_id, api_permission_id=api_id)
                )
                existing.add(api_id)
                added += 1
        if added:
            await self.session.flush()
        return added

    async def _grant_all_to_admin_roles(self) -> int:
        admin_roles = list(
            (
                await self.session.execute(
                    select(SysRole).where(
                        SysRole.is_deleted.is_(False),
                        SysRole.code.in_(["admin", "Administrator", "ADMIN"]),
                    )
                )
            )
            .scalars()
            .all()
        )
        if not admin_roles:
            # 兜底：编码含 admin
            admin_roles = [
                r
                for r in (
                    await self.session.execute(
                        select(SysRole).where(SysRole.is_deleted.is_(False))
                    )
                )
                .scalars()
                .all()
                if (r.code or "").lower() in ("admin", "administrator")
            ]
        if not admin_roles:
            return 0
        all_ids = list(
            (await self.session.execute(select(SysApiPermission.id))).scalars().all()
        )
        granted = 0
        for role in admin_roles:
            existing = set(
                (
                    await self.session.execute(
                        select(SysRoleApiPermission.api_permission_id).where(
                            SysRoleApiPermission.role_id == role.id
                        )
                    )
                )
                .scalars()
                .all()
            )
            for api_id in all_ids:
                if api_id in existing:
                    continue
                self.session.add(
                    SysRoleApiPermission(role_id=role.id, api_permission_id=api_id)  # type: ignore[arg-type]
                )
                granted += 1
        if granted:
            await self.session.flush()
        return granted

    @staticmethod
    def list_app_routes(app: FastAPI) -> list[dict[str, Any]]:
        settings = get_settings()
        api_prefix = (settings.api_prefix or "").rstrip("/")
        rows: list[dict[str, Any]] = []

        def walk(routes: list[Any], prefixes: list[str]) -> None:
            for route in routes:
                # FastAPI 新版本：include_router 挂成 _IncludedRouter，需递归展开
                if type(route).__name__ == "_IncludedRouter":
                    ctx = getattr(route, "include_context", None)
                    sub_prefix = ""
                    if ctx is not None:
                        sub_prefix = (getattr(ctx, "prefix", None) or "").rstrip("/")
                    original = getattr(route, "original_router", None)
                    if original is not None:
                        walk(list(getattr(original, "routes", []) or []), [*prefixes, sub_prefix])
                    continue
                if not isinstance(route, APIRoute):
                    # Mount / 其它容器
                    nested = getattr(route, "routes", None)
                    if nested:
                        mount_path = (getattr(route, "path", None) or "").rstrip("/")
                        walk(list(nested), [*prefixes, mount_path] if mount_path else prefixes)
                    continue

                path = "".join(p for p in prefixes if p) + (route.path or "")
                if api_prefix and path.startswith(api_prefix):
                    path = path[len(api_prefix) :] or "/"
                path = normalize_api_path(path)
                endpoint = route.endpoint
                for method in sorted(route.methods or []):
                    if method in ("HEAD", "OPTIONS"):
                        continue
                    rows.append(
                        {
                            "method": method,
                            "path_pattern": path,
                            "name": route.name or path,
                            "tags": list(route.tags or []),
                            "stable_key": make_stable_key(method, endpoint, path),
                        }
                    )

        walk(list(app.routes), [])
        # 去重（同一 endpoint 可能被挂多次）
        uniq: dict[str, dict[str, Any]] = {}
        for row in rows:
            uniq[row["stable_key"]] = row
        out = list(uniq.values())
        out.sort(key=lambda x: (x["path_pattern"], x["method"]))
        return out

    async def _get(self, rule_id: int) -> SysApiPermission:
        result = await self.session.execute(
            select(SysApiPermission).where(SysApiPermission.id == rule_id)
        )
        rule = result.scalar_one_or_none()
        if rule is None:
            raise NotFoundException("接口权限规则不存在")
        return rule

    def _normalize_payload(self, data: dict[str, Any], *, partial: bool = False) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if "stable_key" in data and data.get("stable_key") is not None:
            out["stable_key"] = str(data.get("stable_key") or "")[:255]
        if "method" in data or not partial:
            method = str(data.get("method") or "GET").upper().strip()
            if method != "*" and method not in ("GET", "POST", "PUT", "DELETE", "PATCH"):
                raise ValidationException("method 仅支持 GET/POST/PUT/DELETE/PATCH/*")
            out["method"] = method
        if "path_pattern" in data or not partial:
            path = normalize_api_path(str(data.get("path_pattern") or ""))
            if not path or path == "/":
                raise ValidationException("path_pattern 不能为空")
            out["path_pattern"] = path
        if "permission_code" in data or not partial:
            out["permission_code"] = str(data.get("permission_code") or "").strip()
        if "name" in data or not partial:
            out["name"] = str(data.get("name") or out.get("path_pattern") or "")[:128]
        if "menu_id" in data:
            mid = data.get("menu_id")
            out["menu_id"] = int(mid) if mid is not None and mid != "" else None
        if "enabled" in data or not partial:
            out["enabled"] = bool(data.get("enabled", True))
        if "sort" in data:
            out["sort"] = int(data.get("sort") or 0)
        elif not partial:
            out["sort"] = int(data.get("sort") or 0)
        return out

    @staticmethod
    def _serialize(rule: SysApiPermission) -> dict[str, Any]:
        return {
            "id": rule.id,
            "stable_key": rule.stable_key,
            "method": rule.method,
            "path_pattern": rule.path_pattern,
            "permission_code": rule.permission_code,
            "name": rule.name,
            "menu_id": rule.menu_id,
            "enabled": rule.enabled,
            "sort": rule.sort,
            "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
        }
