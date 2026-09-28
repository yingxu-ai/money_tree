#!/usr/bin/env python3
"""按 edition 导出可交付目录（模式 A 骨架）。

用法（仓库根目录）:
  python scripts/export_edition.py editions/sku-scheduling-local.json
  python scripts/export_edition.py editions/sku-scheduling-local.json --out dist/export/scheduling

说明：
  - 复制 platform 必需路径 + MANIFEST 中列出的已购模块路径
  - 未购模块不会出现在导出目录
  - 一期为「目录拷贝」骨架，导出后仍需按 README 安装依赖并配置环境
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# 模式 A 必带：平台壳（随交付物）
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
    "frontend/src/App.tsx",
    "frontend/src/main.tsx",
    "frontend/package.json",
    "frontend/vite.config.ts",
    "frontend/tsconfig.json",
    "frontend/index.html",
    "backend/app/core",
    "backend/app/auth",
    "backend/app/models",
    "backend/app/application",
    "backend/app/api/auth.py",
    "backend/app/api/public.py",
    "backend/app/api/router.py",
    "backend/app/main.py",
    "backend/requirements.txt",
    "editions",
    "modules/README.md",
]


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def copy_path(src_rel: str, dest_root: Path) -> None:
    src = ROOT / src_rel
    dest = dest_root / src_rel
    if not src.exists():
        print(f"  skip (missing): {src_rel}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(src, dest)
    else:
        shutil.copy2(src, dest)
    print(f"  + {src_rel}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Export edition package (mode A)")
    parser.add_argument("edition", type=Path, help="path to editions/*.json")
    parser.add_argument("--out", type=Path, default=None, help="output directory")
    args = parser.parse_args()

    edition_path = args.edition if args.edition.is_absolute() else ROOT / args.edition
    if not edition_path.exists():
        print(f"edition not found: {edition_path}", file=sys.stderr)
        return 1

    edition = load_json(edition_path)
    sku_id = edition.get("id") or edition_path.stem
    out = args.out or (ROOT / "dist" / "export" / sku_id)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    print(f"Export SKU={sku_id} -> {out}")
    print("Platform:")
    for p in PLATFORM_PATHS:
        copy_path(p, out)

    enabled = edition.get("enabled_modules") or []
    print(f"Modules: {enabled}")
    for mid in enabled:
        manifest_path = ROOT / "modules" / mid / "MANIFEST.json"
        if not manifest_path.exists():
            print(f"  ! missing MANIFEST: {mid}")
            continue
        manifest = load_json(manifest_path)
        # 复制 MANIFEST 本身
        copy_path(f"modules/{mid}/MANIFEST.json", out)
        for key in ("frontend_paths", "frontend_api_paths", "backend_paths"):
            for p in manifest.get(key) or []:
                copy_path(p, out)

    # 写入本包 edition
    (out / "editions").mkdir(parents=True, exist_ok=True)
    (out / "editions" / f"{sku_id}.json").write_text(
        json.dumps(edition, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (out / "EXPORT_README.md").write_text(
        f"""# 导出包 · {edition.get("name", sku_id)}

- delivery_mode: `{edition.get("delivery_mode")}`
- layout_mode: `{edition.get("layout_mode")}`
- enabled_modules: {", ".join(enabled)}

## 说明

本目录由 `scripts/export_edition.py` 按 MANIFEST 裁剪生成，**未购模块源码不在包内**。

1. 安装前后端依赖并配置数据库（参见主仓文档）
2. 前端设置 `VITE_EDITION={sku_id}`
3. 后端设置 `ENABLED_MODULES={",".join(enabled)}`
4. 需要无壳嵌入时：URL 加 `?embed=1` 或 `layout_mode=embed`

一期导出为骨架拷贝，完整可启动包将在模块目录迁完后继续补齐。
""",
        encoding="utf-8",
    )
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
