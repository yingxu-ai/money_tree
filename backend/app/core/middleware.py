import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging import get_logger

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
AUDIT_SKIP_PREFIXES = (
    "/health",
    "/docs",
    "/redoc",
    "/openapi",
    "/api/v1/public",
    "/api/v1/audit",
)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """注入 trace_id、记录访问日志，并对写操作落库审计。"""

    async def dispatch(self, request: Request, call_next) -> Response:
        trace_id = request.headers.get("X-Trace-Id") or uuid.uuid4().hex
        request.state.trace_id = trace_id
        request.state.start_time = time.perf_counter()

        body_preview = None
        should_audit = request.method in WRITE_METHODS and not any(
            request.url.path.startswith(p) for p in AUDIT_SKIP_PREFIXES
        )
        content_type = request.headers.get("content-type", "")
        # 上传文件不缓存 body，避免大文件内存占用与破坏流
        if should_audit and "multipart/form-data" not in content_type:
            try:
                raw = await request.body()
                body_preview = raw.decode("utf-8", errors="ignore")[:500] if raw else None

                async def receive():
                    return {"type": "http.request", "body": raw, "more_body": False}

                request = Request(request.scope, receive)
                request.state.trace_id = trace_id
                request.state.start_time = time.perf_counter()
            except Exception:
                body_preview = None

        logger = get_logger("access", trace_id)
        response = await call_next(request)

        latency_ms = (time.perf_counter() - request.state.start_time) * 1000
        user_id = getattr(request.state, "user_id", None)
        logger.info(
            "%s %s %s %.1fms user=%s",
            request.method,
            request.url.path,
            response.status_code,
            latency_ms,
            user_id if user_id is not None else "-",
        )

        if should_audit:
            await self._write_audit(
                path=request.url.path,
                method=request.method,
                status_code=response.status_code,
                body_preview=body_preview or (f"[multipart] {request.url.path}" if "multipart" in content_type else None),
                user_id=user_id,
                trace_id=trace_id,
            )

        response.headers["X-Trace-Id"] = trace_id
        return response

    async def _write_audit(
        self,
        *,
        path: str,
        method: str,
        status_code: int,
        body_preview: str | None,
        user_id: int | None,
        trace_id: str,
    ) -> None:
        try:
            from app.application.audit_service import AuditService
            from app.core.database import async_session_factory

            parts = [p for p in path.split("/") if p]
            resource = parts[2] if len(parts) >= 3 else path
            result = "success" if status_code < 400 else "failed"
            async with async_session_factory() as session:
                service = AuditService(session)
                await service.write_operation(
                    user_id=user_id,
                    resource=resource,
                    action=method,
                    request_body=body_preview,
                    result=result,
                    trace_id=trace_id,
                )
                await session.commit()
        except Exception as exc:
            get_logger("audit", trace_id).warning("write audit failed: %s", exc)
