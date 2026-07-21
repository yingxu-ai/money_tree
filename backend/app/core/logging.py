import logging
import sys
from typing import Literal

from app.core.config import get_settings

LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR"]

_configured = False


class TraceFormatter(logging.Formatter):
    """兼容第三方日志（SQLAlchemy 等）未携带 trace_id 的场景。"""

    def format(self, record: logging.LogRecord) -> str:
        if not hasattr(record, "trace_id"):
            record.trace_id = "-"
        return super().format(record)


def setup_logging(level: LogLevel | None = None) -> None:
    global _configured
    if _configured:
        return

    settings = get_settings()
    log_level = (level or settings.log_level).upper()

    formatter = TraceFormatter(
        fmt="%(asctime)s | %(levelname)-7s | %(name)s | trace=%(trace_id)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(log_level)

    # 第三方日志降噪；SQL 明细仅在 debug 且显式开启时输出
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.INFO if settings.debug and settings.sql_echo else logging.WARNING
    )
    _configured = True


class TraceAdapter(logging.LoggerAdapter):
    def process(self, msg, kwargs):
        extra = kwargs.setdefault("extra", {})
        extra.setdefault("trace_id", self.extra.get("trace_id", "-"))
        return msg, kwargs


def get_logger(name: str, trace_id: str = "-") -> TraceAdapter:
    return TraceAdapter(logging.getLogger(name), {"trace_id": trace_id})
