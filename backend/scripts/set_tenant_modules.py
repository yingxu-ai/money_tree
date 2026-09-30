#!/usr/bin/env python3
"""本地改租户开通模块（售卖模式 B）。

用法（在 backend 目录或仓库根均可）:
  python scripts/set_tenant_modules.py 2 scheduling
  python scripts/set_tenant_modules.py 2 scheduling,toolbox
  python scripts/set_tenant_modules.py 2 "*"
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from sqlalchemy import select

from app.core.database import async_session_factory, init_db
from app.models.system import SysTenant


async def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    tenant_id = int(sys.argv[1])
    modules = sys.argv[2].strip()
    await init_db()
    async with async_session_factory() as session:
        row = (
            await session.execute(select(SysTenant).where(SysTenant.id == tenant_id))
        ).scalar_one_or_none()
        if row is None:
            print(f"tenant {tenant_id} not found，请先 python scripts/seed.py")
            return 2
        row.enabled_modules = modules
        row.updated_at = datetime.utcnow()
        await session.commit()
        print(f"OK tenant_id={tenant_id} code={row.code} enabled_modules={modules}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
