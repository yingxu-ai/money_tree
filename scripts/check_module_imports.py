#!/usr/bin/env python3
"""粗查：业务模块目录之间是否互相引用（禁止 modules/A → modules/B）。

用法（仓库根）:
  python scripts/check_module_imports.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FE_MODULES = ROOT / "frontend" / "src" / "modules"
BE_MODULES = ROOT / "backend" / "app" / "modules"

# @/modules/<id>/... 或相对路径中的 modules/<id>
FE_PAT = re.compile(r"""['"]@/modules/([a-z0-9-]+)""")
BE_PAT = re.compile(r"""from\s+app\.modules\.([a-z0-9_]+)|import\s+app\.modules\.([a-z0-9_]+)""")


def fe_module_id_from_path(path: Path) -> str | None:
    try:
        rel = path.relative_to(FE_MODULES)
    except ValueError:
        return None
    return rel.parts[0] if rel.parts else None


def be_module_id_from_path(path: Path) -> str | None:
    try:
        rel = path.relative_to(BE_MODULES)
    except ValueError:
        return None
    return rel.parts[0] if rel.parts else None


def main() -> int:
    errors: list[str] = []

    if FE_MODULES.exists():
        for path in FE_MODULES.rglob("*"):
            if path.suffix not in {".ts", ".tsx"}:
                continue
            owner = fe_module_id_from_path(path)
            if not owner:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            for m in FE_PAT.finditer(text):
                other = m.group(1)
                if other != owner:
                    errors.append(f"FE {path.relative_to(ROOT)}: imports @/modules/{other}")

    if BE_MODULES.exists():
        for path in BE_MODULES.rglob("*.py"):
            owner = be_module_id_from_path(path)
            if not owner:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            for m in BE_PAT.finditer(text):
                other = m.group(1) or m.group(2)
                if other and other != owner:
                    errors.append(f"BE {path.relative_to(ROOT)}: imports app.modules.{other}")

    if errors:
        print("CROSS-MODULE IMPORTS FOUND:")
        for e in errors:
            print(" ", e)
        return 1
    print("OK: no cross-module imports detected under frontend/backend modules/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
