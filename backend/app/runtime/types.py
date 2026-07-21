from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class RouteType(str, Enum):
    FIXED_API = "fixed_api"
    SINGLE_TOOL = "single_tool"
    FIXED_SKILL = "fixed_skill"
    PLANNER = "planner"
    UNKNOWN = "unknown"


@dataclass
class QueryIntent:
    raw_query: str
    route: RouteType
    target: str | None = None
    inputs: dict[str, Any] = field(default_factory=dict)
    reason: str = ""
    confidence: float = 0.0


@dataclass
class QueryResult:
    status: str
    route: str
    target: str | None
    summary: str
    data: Any = None
    evidence: list[dict[str, Any]] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)
    trace_id: str = ""
    intent: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "route": self.route,
            "target": self.target,
            "summary": self.summary,
            "data": self.data,
            "evidence": self.evidence,
            "recommendations": self.recommendations,
            "trace_id": self.trace_id,
            "intent": self.intent,
        }
