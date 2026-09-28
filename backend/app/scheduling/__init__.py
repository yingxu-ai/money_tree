"""过渡期兼容：原 app.scheduling → app.modules.scheduling"""

from app.modules.scheduling.store import store

__all__ = ["store"]
