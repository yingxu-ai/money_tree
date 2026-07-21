"""数据 Provider 抽象：Demo 用模拟数据，正式版替换实现即可，上层 API/Tool/Skill 不变。"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class MetricQuery:
    metric_code: str
    start_time: str | None = None
    end_time: str | None = None
    dimensions: dict[str, Any] = field(default_factory=dict)
    tenant_id: int = 1


@dataclass
class MetricResult:
    metric_code: str
    columns: list[str]
    rows: list[list[Any]]
    unit: str = ""
    name: str = ""
    summary: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "metric_code": self.metric_code,
            "name": self.name,
            "columns": self.columns,
            "rows": self.rows,
            "unit": self.unit,
            "summary": self.summary,
        }


class MetricProvider(ABC):
    @abstractmethod
    async def query(self, q: MetricQuery) -> MetricResult:
        ...

    @abstractmethod
    async def list_metrics(self, tenant_id: int = 1) -> list[dict[str, str]]:
        ...
