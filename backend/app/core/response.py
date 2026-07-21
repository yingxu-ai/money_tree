from typing import Any, Generic, TypeVar

from fastapi import Request
from pydantic import BaseModel, Field

from app.core import codes

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    code: int = codes.SUCCESS
    message: str = "success"
    data: T | None = None
    trace_id: str = ""


class PageData(BaseModel, Generic[T]):
    page: int = 1
    page_size: int = 20
    total: int = 0
    items: list[T] = Field(default_factory=list)


def get_trace_id(request: Request) -> str:
    return getattr(request.state, "trace_id", "")


def success(
    data: Any = None,
    message: str = codes.DEFAULT_MESSAGES[codes.SUCCESS],
    trace_id: str = "",
) -> dict:
    return {"code": codes.SUCCESS, "message": message, "data": data, "trace_id": trace_id}


def error(code: int, message: str | None = None, trace_id: str = "") -> dict:
    return {
        "code": code,
        "message": message or codes.DEFAULT_MESSAGES.get(code, "未知错误"),
        "data": None,
        "trace_id": trace_id,
    }


def ok(request: Request, data: Any = None, message: str = "success") -> dict:
    """路由层统一成功响应。"""
    return success(data, message, get_trace_id(request))
