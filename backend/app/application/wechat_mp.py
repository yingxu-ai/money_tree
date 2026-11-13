"""微信小程序：access_token + 无限小程序码（厂码）。"""

from __future__ import annotations

import time
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.exceptions import ValidationException

_token_cache: dict[str, Any] = {"access_token": "", "expires_at": 0.0}


def wechat_mp_configured() -> bool:
    s = get_settings()
    return bool((s.wechat_mp_appid or "").strip() and (s.wechat_mp_secret or "").strip())


async def get_mp_access_token() -> str:
    if not wechat_mp_configured():
        raise ValidationException("未配置微信小程序 AppID/Secret")
    now = time.time()
    if _token_cache["access_token"] and float(_token_cache["expires_at"]) > now + 60:
        return str(_token_cache["access_token"])
    s = get_settings()
    url = "https://api.weixin.qq.com/cgi-bin/token"
    params = {
        "grant_type": "client_credential",
        "appid": s.wechat_mp_appid.strip(),
        "secret": s.wechat_mp_secret.strip(),
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.get(url, params=params)
        data = res.json()
    token = data.get("access_token")
    if not token:
        raise ValidationException(
            f"获取微信 access_token 失败：{data.get('errmsg') or data}"
        )
    _token_cache["access_token"] = token
    _token_cache["expires_at"] = now + int(data.get("expires_in") or 7200)
    return str(token)


async def create_factory_wxacode_png(*, scene: str, page: str) -> bytes:
    """getwxacodeunlimit → PNG bytes。scene 最长 32。"""
    scene_n = (scene or "").strip()
    if not scene_n or len(scene_n) > 32:
        raise ValidationException("厂码 scene 无效")
    page_n = (page or "").strip().lstrip("/")
    token = await get_mp_access_token()
    url = f"https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token={token}"
    body = {
        "scene": scene_n,
        "page": page_n,
        "check_path": False,
        "width": 430,
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post(url, json=body)
        content_type = (res.headers.get("content-type") or "").lower()
        if "image" in content_type or res.content[:8] == b"\x89PNG\r\n\x1a\n":
            return res.content
        try:
            err = res.json()
        except Exception:
            err = {"errmsg": res.text[:200]}
        raise ValidationException(
            f"生成小程序码失败：{err.get('errmsg') or err}"
        )
