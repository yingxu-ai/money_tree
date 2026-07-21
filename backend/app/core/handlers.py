import traceback

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core import codes
from app.core.config import get_settings
from app.core.exceptions import AppException
from app.core.logging import get_logger
from app.core.response import error, get_trace_id


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppException)
    async def app_exception_handler(request: Request, exc: AppException):
        trace_id = get_trace_id(request)
        get_logger("app.error", trace_id).warning("AppException code=%s msg=%s", exc.code, exc.message)
        return JSONResponse(status_code=200, content=error(exc.code, exc.message, trace_id))

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        trace_id = get_trace_id(request)
        detail = "; ".join(
            f"{'.'.join(str(p) for p in err.get('loc', []))}: {err.get('msg')}"
            for err in exc.errors()
        )
        message = detail or codes.DEFAULT_MESSAGES[codes.VALIDATION_ERROR]
        get_logger("app.error", trace_id).warning("ValidationError: %s", message)
        return JSONResponse(
            status_code=200,
            content=error(codes.VALIDATION_ERROR, message, trace_id),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        trace_id = get_trace_id(request)
        code_map = {
            401: codes.AUTH_FAILED,
            403: codes.PERMISSION_DENIED,
            404: codes.RESOURCE_NOT_FOUND,
        }
        code = code_map.get(exc.status_code, codes.GENERAL_ERROR)
        return JSONResponse(
            status_code=200,
            content=error(code, str(exc.detail), trace_id),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        trace_id = get_trace_id(request)
        get_logger("app.error", trace_id).error(
            "Unhandled exception: %s\n%s", exc, traceback.format_exc()
        )
        message = str(exc) if get_settings().debug else codes.DEFAULT_MESSAGES[codes.GENERAL_ERROR]
        return JSONResponse(
            status_code=200,
            content=error(codes.GENERAL_ERROR, message, trace_id),
        )
