"""写入生产进度模块批量演示数据（约 150 人三班倒 + 多日报工）。

用法（在 backend 目录）:
  python scripts/seed_progress_demo.py
  python scripts/seed_progress_demo.py --tenant 1 --persons 150 --days 21
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.modules.scheduling.store import get_store  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="生产进度批量演示数据")
    parser.add_argument("--tenant", type=int, default=1, help="租户 id，默认 1")
    parser.add_argument("--persons", type=int, default=150, help="人数，默认 150")
    parser.add_argument("--days", type=int, default=21, help="报工天数（含今天），默认 21")
    args = parser.parse_args()

    store = get_store(args.tenant)
    result = store.seed_progress_bulk_demo(person_count=args.persons, days=args.days)
    print(result.get("message") or result)
    print(
        "stats:",
        {
            "tenant_id": result.get("tenant_id"),
            "persons": result.get("person_count"),
            "days": result.get("days"),
            "reports": result.get("report_count"),
            "equipments": result.get("equipment_count"),
        },
    )


if __name__ == "__main__":
    main()
