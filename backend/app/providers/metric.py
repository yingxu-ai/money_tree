"""Demo 指标 Provider：内存可复现数据，正式版可替换为 DB/Redis/时序库。"""

from datetime import datetime, timedelta
from typing import Any

from app.providers.base import MetricProvider, MetricQuery, MetricResult

# 模拟指标目录
METRIC_CATALOG: dict[str, dict[str, str]] = {
    "daily_output": {"name": "日产量", "unit": "吨"},
    "gas_volume": {"name": "发气量", "unit": "m³"},
    "device_uptime": {"name": "设备稼动率", "unit": "%"},
    "alarm_count": {"name": "告警次数", "unit": "次"},
}


class DemoMetricProvider(MetricProvider):
    """按 metric_code 生成稳定可演示的时间序列与汇总。"""

    async def list_metrics(self, tenant_id: int = 1) -> list[dict[str, str]]:
        return [
            {"metric_code": code, "name": meta["name"], "unit": meta["unit"]}
            for code, meta in METRIC_CATALOG.items()
        ]

    async def query(self, q: MetricQuery) -> MetricResult:
        meta = METRIC_CATALOG.get(q.metric_code, {"name": q.metric_code, "unit": ""})
        rows = self._series(q.metric_code, q.start_time, q.end_time)
        values = [float(r[1]) for r in rows]
        latest = values[-1] if values else 0.0
        prev = values[-2] if len(values) >= 2 else latest
        delta_pct = ((latest - prev) / prev * 100) if prev else 0.0

        return MetricResult(
            metric_code=q.metric_code,
            name=meta["name"],
            columns=["timestamp", "value"],
            rows=rows,
            unit=meta["unit"],
            summary={
                "latest": round(latest, 2),
                "avg": round(sum(values) / len(values), 2) if values else 0,
                "min": round(min(values), 2) if values else 0,
                "max": round(max(values), 2) if values else 0,
                "delta_pct": round(delta_pct, 2),
                "tenant_id": q.tenant_id,
                "factory_id": q.dimensions.get("factory_id"),
            },
        )

    def _series(
        self, metric_code: str, start_time: str | None, end_time: str | None
    ) -> list[list[Any]]:
        end = self._parse_time(end_time) or datetime.utcnow().replace(minute=0, second=0, microsecond=0)
        start = self._parse_time(start_time) or (end - timedelta(hours=11))
        # 保证至少 12 个点（今日趋势）
        points = max(12, int((end - start).total_seconds() // 3600) + 1)
        points = min(points, 24)

        base = {
            "daily_output": 130.0,
            "gas_volume": 850.0,
            "device_uptime": 92.0,
            "alarm_count": 3.0,
        }.get(metric_code, 100.0)

        # 可复现波动：下午略降，突出「异常」演示
        pattern = [0, 1.5, 2.0, 1.2, -0.5, -1.0, -2.5, -4.0, -3.2, -1.5, 0.5, 1.0]
        rows: list[list[Any]] = []
        for i in range(points):
            ts = end - timedelta(hours=points - 1 - i)
            wave = pattern[i % len(pattern)]
            # 不同指标尺度
            scale = 1.0 if metric_code != "alarm_count" else 0.3
            value = round(base + wave * (5 if metric_code != "device_uptime" else 0.8) * scale, 2)
            if metric_code == "device_uptime":
                value = max(60.0, min(99.5, value))
            if metric_code == "alarm_count":
                value = max(0, round(base + wave))
            rows.append([ts.strftime("%Y-%m-%dT%H:00:00"), value])
        return rows

    def _parse_time(self, value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            if "T" in value:
                return datetime.fromisoformat(value.replace("Z", ""))
            return datetime.strptime(value[:10], "%Y-%m-%d")
        except ValueError:
            return None


# 全局单例：正式版可改为工厂按配置选择 Redis/DB Provider
metric_provider: MetricProvider = DemoMetricProvider()


def get_metric_provider() -> MetricProvider:
    return metric_provider
