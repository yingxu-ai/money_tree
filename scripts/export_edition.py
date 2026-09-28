#!/usr/bin/env python3
"""按 edition 导出可交付目录（售卖模式 A）。

用法（仓库根目录）:
  python scripts/export_edition.py editions/sku-scheduling-local.json
  python scripts/export_edition.py editions/sku-scheduling-local.json --out dist/export/scheduling
  python scripts/export_edition.py editions/sku-scheduling-local.json --check-only

说明：
  - 复制 platform 壳 + MANIFEST 中已购模块路径
  - 生成仅含已购模块的 registry.ts（避免缺文件导致无法编译）
  - 写入 .env.example / EXPORT_README
  - 校验：未购模块目录不得出现在导出包中
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# 模式 A 必带：平台壳
PLATFORM_PATHS = [
    "frontend/src/platform",
    "frontend/src/components",
    "frontend/src/routes",
    "frontend/src/stores",
    "frontend/src/hooks",
    "frontend/src/config",
    "frontend/src/types",
    "frontend/src/api/client.ts",
    "frontend/src/api/public.ts",
    "frontend/src/api/auth.ts",
    "frontend/src/pages/login",
    "frontend/src/index.css",
    "frontend/src/App.tsx",
    "frontend/src/main.tsx",
    "frontend/src/vite-env.d.ts",
    "frontend/package.json",
    "frontend/package-lock.json",
    "frontend/vite.config.ts",
    "frontend/tsconfig.json",
    "frontend/tsconfig.node.json",
    "frontend/index.html",
    "backend/app/__init__.py",
    "backend/app/core",
    "backend/app/auth",
    "backend/app/models",
    "backend/app/application",
    "backend/app/modules/__init__.py",
    "backend/app/api/__init__.py",
    "backend/app/api/auth.py",
    "backend/app/api/public.py",
    "backend/app/api/router.py",
    "backend/app/api/runtime.py",
    "backend/app/main.py",
    "requirements.txt",
    "editions",
    "modules/README.md",
]

# 导出包内禁止残留的「可售模块」根路径（未购时不得出现）
SELLABLE_MODULE_MARKERS = {
    "scheduling": [
        "frontend/src/modules/scheduling",
        "backend/app/modules/scheduling",
    ],
    "equipment-analysis": [
        "frontend/src/modules/equipment-analysis",
        "backend/app/modules/equipment_analysis",
    ],
    "toolbox": [
        "frontend/src/modules/toolbox",
    ],
    "demo": [
        "frontend/src/modules/demo",
        "frontend/src/pages/demo",
    ],
}

MODULE_IMPORTS = {
    "system": (
        "systemModule",
        "@/modules/system/register",
    ),
    "dashboard": (
        "dashboardModule",
        "@/modules/dashboard/register",
    ),
    "demo": (
        "demoModule",
        "@/modules/demo/register",
    ),
    "equipment-analysis": (
        "equipmentAnalysisModule",
        "@/modules/equipment-analysis/register",
    ),
    "scheduling": (
        "schedulingModule",
        "@/modules/scheduling/register",
    ),
    "toolbox": (
        "toolboxModule",
        "@/modules/toolbox/register",
    ),
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def copy_path(src_rel: str, dest_root: Path) -> bool:
    src = ROOT / src_rel
    dest = dest_root / src_rel
    if not src.exists():
        print(f"  skip (missing): {src_rel}")
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(src, dest)
    else:
        shutil.copy2(src, dest)
    print(f"  + {src_rel}")
    return True


def write_registry(dest_root: Path, enabled: list[str]) -> None:
    """导出包专用：只 import 已购模块，避免缺文件编译失败。"""
    lines = [
        'import { getActiveEdition, isModuleEnabled } from "@/platform/edition";',
        'import type { ModuleRoute } from "@/platform/modules/types";',
        "",
    ]
    names: list[str] = []
    for mid in enabled:
        pair = MODULE_IMPORTS.get(mid)
        if not pair:
            print(f"  ! no registry import mapping for module: {mid}")
            continue
        var_name, import_path = pair
        lines.append(f'import {{ {var_name} }} from "{import_path}";')
        names.append(var_name)

    lines.append("")
    lines.append(f"const ALL_MODULES = [{', '.join(names)}];")
    lines.append("")
    lines.append(
        """/** 按当前 edition.enabled_modules 过滤后的路由 */
export function getEnabledModuleRoutes(): ModuleRoute[] {
  const edition = getActiveEdition();
  return ALL_MODULES.filter((m) => isModuleEnabled(edition, m.moduleId)).flatMap(
    (m) => m.routes,
  );
}

/** 默认首页：优先设备列表，否则已启用模块的第一条路由 */
export function getDefaultHomePath(): string {
  const routes = getEnabledModuleRoutes();
  if (routes.some((r) => r.path === "/devices")) return "/devices";
  if (routes.some((r) => r.path === "/scheduling/gantt")) return "/scheduling/gantt";
  return routes[0]?.path || "/login";
}
"""
    )
    target = dest_root / "frontend/src/platform/modules/registry.ts"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(lines), encoding="utf-8")
    print(f"  * wrote trimmed registry ({len(names)} modules)")


def write_env_examples(dest_root: Path, sku_id: str, enabled: list[str], layout_mode: str) -> None:
    modules_csv = ",".join(enabled)
    (dest_root / "frontend/.env.example").write_text(
        f"VITE_EDITION={sku_id}\nVITE_LAYOUT_MODE={layout_mode}\n",
        encoding="utf-8",
    )
    (dest_root / "backend/.env.example").write_text(
        f"ENABLED_MODULES={modules_csv}\n"
        "DATABASE_URL=sqlite+aiosqlite:///./data/app.db\n"
        "SECRET_KEY=change-me\n",
        encoding="utf-8",
    )
    print("  * wrote frontend/.env.example + backend/.env.example")


def verify_no_forbidden(dest_root: Path, enabled: list[str]) -> list[str]:
    enabled_set = set(enabled)
    errors: list[str] = []
    for mid, markers in SELLABLE_MODULE_MARKERS.items():
        if mid in enabled_set:
            continue
        for rel in markers:
            if (dest_root / rel).exists():
                errors.append(f"未购模块残留: {rel} (module={mid})")
    return errors


def write_readme(
    dest_root: Path,
    edition: dict,
    sku_id: str,
    enabled: list[str],
) -> None:
    (dest_root / "EXPORT_README.md").write_text(
        f"""# 导出包 · {edition.get("name", sku_id)}

| 项 | 值 |
|----|----|
| SKU | `{sku_id}` |
| delivery_mode | `{edition.get("delivery_mode")}` |
| layout_mode | `{edition.get("layout_mode")}` |
| enabled_modules | {", ".join(enabled)} |

## 快速启动（开发）

```bash
# 1) 后端
cd backend
copy .env.example .env   # Windows
# cp .env.example .env   # Linux/macOS
pip install -r ../requirements.txt
# 按主仓方式启动 uvicorn / seed（本包为裁剪源码，需具备可运行的 app 入口依赖）

# 2) 前端
cd frontend
copy .env.example .env
npm install
npm run dev
```

## 嵌入对方系统

- URL 加 `?embed=1`，或 `.env` 中 `VITE_LAYOUT_MODE=embed`
- 无顶栏 / 左侧导航，只渲染业务页

## 说明

本目录由 `scripts/export_edition.py` 按 MANIFEST 裁剪生成，**未购业务模块源码不应存在**。  
若校验失败请勿交付。平台壳 + 已购模块才是本包内容。
""",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Export edition package (mode A)")
    parser.add_argument("edition", type=Path, help="path to editions/*.json")
    parser.add_argument("--out", type=Path, default=None, help="output directory")
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="only validate an existing --out package (no copy)",
    )
    args = parser.parse_args()

    edition_path = args.edition if args.edition.is_absolute() else ROOT / args.edition
    if not edition_path.exists():
        print(f"edition not found: {edition_path}", file=sys.stderr)
        return 1

    edition = load_json(edition_path)
    sku_id = edition.get("id") or edition_path.stem
    enabled: list[str] = list(edition.get("enabled_modules") or [])
    layout_mode = edition.get("layout_mode") or "full"
    out = args.out or (ROOT / "dist" / "export" / sku_id)

    if args.check_only:
        if not out.exists():
            print(f"out not found: {out}", file=sys.stderr)
            return 1
        errs = verify_no_forbidden(out, enabled)
        if errs:
            print("CHECK FAILED:")
            for e in errs:
                print(" ", e)
            return 2
        print(f"CHECK OK: {out}")
        return 0

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    print(f"Export SKU={sku_id} -> {out}")
    print("Platform:")
    for p in PLATFORM_PATHS:
        copy_path(p, out)

    print(f"Modules: {enabled}")
    for mid in enabled:
        manifest_path = ROOT / "modules" / mid / "MANIFEST.json"
        if not manifest_path.exists():
            print(f"  ! missing MANIFEST: {mid}")
            continue
        manifest = load_json(manifest_path)
        copy_path(f"modules/{mid}/MANIFEST.json", out)
        for key in ("frontend_paths", "frontend_api_paths", "backend_paths"):
            for p in manifest.get(key) or []:
                copy_path(p, out)

    # 覆盖为裁剪后的 registry
    write_registry(out, enabled)
    write_env_examples(out, sku_id, enabled, layout_mode)

    (out / "editions").mkdir(parents=True, exist_ok=True)
    (out / "editions" / f"{sku_id}.json").write_text(
        json.dumps(edition, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    # 同步一份到 frontend 可被 @editions 解析的位置（导出仓需自备 editions）
    write_readme(out, edition, sku_id, enabled)

    errs = verify_no_forbidden(out, enabled)
    if errs:
        print("VERIFY FAILED — 请勿交付:")
        for e in errs:
            print(" ", e)
        return 2

    print("Done. VERIFY OK (未购模块未出现在包内).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
