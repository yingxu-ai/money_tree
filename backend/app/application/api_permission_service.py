"""接口权限：路径模板匹配 + CRUD。配置台维护，全局依赖读取。"""

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
from app.models.system import SysApiPermission

# 不走接口权限表的公开/认证路径（相对 api_prefix）
PUBLIC_API_PREFIXES = (
    "/public",
    "/auth/login",
)


def normalize_api_path(path: str) -> str:
    """去掉 api_prefix，统一为 /xxx 形式。"""
    settings = get_settings()
    prefix = (settings.api_prefix or "").rstrip("/")
    raw = path.split("?")[0]
    if prefix and raw.startswith(prefix):
        raw = raw[len(prefix) :] or "/"
    if not raw.startswith("/"):
        raw = "/" + raw
    # 去掉末尾多余 /
    if len(raw) > 1 and raw.endswith("/"):
        raw = raw.rstrip("/")
    return raw


def _pattern_to_regex(pattern: str) -> re.Pattern[str]:
    """
    FastAPI 风格模板：/scheduling/gantt/tasks/{op_id}
    也支持 * 单段通配。
    """
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


class ApiPermissionService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_rules(self) -> list[dict[str, Any]]:
        result = await self.session.execute(
            select(SysApiPermission).order_by(SysApiPermission.sort, SysApiPermission.id)
        )
        return [self._serialize(r) for r in result.scalars().all()]

    async def create_rule(self, data: dict[str, Any]) -> dict[str, Any]:
        rule = SysApiPermission(**self._normalize_payload(data))
        self.session.add(rule)
        await self.session.flush()
        return self._serialize(rule)

    async def update_rule(self, rule_id: int, data: dict[str, Any]) -> dict[str, Any]:
        rule = await self._get(rule_id)
        payload = self._normalize_payload(data, partial=True)
        for k, v in payload.items():
            setattr(rule, k, v)
        rule.updated_at = datetime.utcnow()
        await self.session.flush()
        return self._serialize(rule)

    async def delete_rule(self, rule_id: int) -> None:
        rule = await self._get(rule_id)
        await self.session.delete(rule)
        await self.session.flush()

    async def find_required_permission(self, method: str, path: str) -> SysApiPermission | None:
        """返回最具体的一条启用规则；无配置则 None（不额外拦）。"""
        if is_public_api_path(path):
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
        # 更长路径 / 非 * 方法优先
        matched.sort(
            key=lambda r: (
                len(normalize_api_path(r.path_pattern).strip("/").split("/")),
                0 if (r.method or "*").upper() == "*" else 1,
                len(r.path_pattern),
            ),
            reverse=True,
        )
        return matched[0]

    async def sync_from_app(self, app: FastAPI) -> dict[str, Any]:
        """把当前已注册路由写入表（已存在 method+path 则跳过）。"""
        existing = await self.session.execute(select(SysApiPermission))
        seen = {
            ((r.method or "*").upper(), normalize_api_path(r.path_pattern))
            for r in existing.scalars().all()
        }
        created = 0
        catalog = self.list_app_routes(app)
        for item in catalog:
            key = (item["method"], item["path_pattern"])
            if key in seen:
                continue
            if is_public_api_path(item["path_pattern"]):
                continue
            self.session.add(
                SysApiPermission(
                    method=item["method"],
                    path_pattern=item["path_pattern"],
                    permission_code="",  # 待配置台补齐
                    name=item.get("name") or item["path_pattern"],
                    enabled=False,  # 未配权限码前不启用，避免锁死
                    sort=100,
                )
            )
            seen.add(key)
            created += 1
        await self.session.flush()
        return {"created": created, "total_routes": len(catalog)}

    @staticmethod
    def list_app_routes(app: FastAPI) -> list[dict[str, Any]]:
        settings = get_settings()
        prefix = (settings.api_prefix or "").rstrip("/")
        rows: list[dict[str, Any]] = []
        for route in app.routes:
            if not isinstance(route, APIRoute):
                continue
            path = route.path
            if prefix and path.startswith(prefix):
                path = path[len(prefix) :] or "/"
            path = normalize_api_path(path)
            for method in sorted(route.methods or []):
                if method in ("HEAD", "OPTIONS"):
                    continue
                rows.append(
                    {
                        "method": method,
                        "path_pattern": path,
                        "name": route.name or path,
                        "tags": list(route.tags or []),
                    }
                )
        rows.sort(key=lambda x: (x["path_pattern"], x["method"]))
        return rows

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
            code = str(data.get("permission_code") or "").strip()
            out["permission_code"] = code
        if "name" in data or not partial:
            out["name"] = str(data.get("name") or out.get("path_pattern") or "")[:128]
        if "enabled" in data or not partial:
            enabled = bool(data.get("enabled", False if partial else True))
            code = out.get("permission_code", data.get("permission_code", ""))
            if enabled and not str(code or "").strip():
                raise ValidationException("启用规则前请填写 permission_code")
            out["enabled"] = enabled
        if "sort" in data:
            out["sort"] = int(data.get("sort") or 0)
        elif not partial:
            out["sort"] = int(data.get("sort") or 0)
        return out

    @staticmethod
    def _serialize(rule: SysApiPermission) -> dict[str, Any]:
        return {
            "id": rule.id,
            "method": rule.method,
            "path_pattern": rule.path_pattern,
            "permission_code": rule.permission_code,
            "name": rule.name,
            "enabled": rule.enabled,
            "sort": rule.sort,
            "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
        }
