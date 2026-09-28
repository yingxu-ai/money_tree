"""表格数据分析：将 Excel / CSV 解析为光谱式曲线数据。

规则（兼容处理）：
- 列头可转为 float → 优先作为曲线 X（如波长）
- 列值大多无法转为 float/int → 默认不选入曲线，放入 meta，并返回 tips
- 分组 label 候选为 meta 列；默认图例用 Excel 行号
"""

from __future__ import annotations

import csv
import io
import math
from pathlib import Path
from typing import Any

from app.core.exceptions import ValidationException

ANALYZE_EXTS = {".xlsx", ".xlsm", ".csv"}
MAX_ROWS = 500
# 一列中至少该比例的非空单元格能转成数值，才选入曲线
NUMERIC_RATIO = 0.6


def is_analyzable_name(filename: str | None, mime: str | None = None) -> bool:
    name = (filename or "").lower()
    ext = Path(name).suffix
    if ext in ANALYZE_EXTS:
        return True
    mime = (mime or "").lower()
    return mime in {
        "text/csv",
        "application/csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }


def _try_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return None
        return float(value)
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null", "-", "—", "n/a", "#n/a"}:
        return None
    # 去掉千分位逗号
    text = text.replace(",", "")
    try:
        return float(text)
    except ValueError:
        return None


def _cell_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return ""
    return str(value).strip()


def _header_name(value: Any, index: int) -> str:
    text = _cell_str(value)
    return text if text else f"列{index + 1}"


def _read_matrix(path: Path) -> tuple[str, list[list[Any]]]:
    ext = path.suffix.lower()
    if ext == ".csv":
        raw = path.read_bytes()
        for encoding in ("utf-8-sig", "utf-8", "gbk", "gb2312", "latin-1"):
            try:
                text = raw.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            text = raw.decode("utf-8", errors="replace")
        reader = csv.reader(io.StringIO(text))
        rows = [list(r) for r in reader if any(_cell_str(c) for c in r)]
        return "CSV", rows

    if ext in {".xlsx", ".xlsm"}:
        try:
            from openpyxl import load_workbook
        except ImportError as exc:  # pragma: no cover
            raise ValidationException("服务端缺少 openpyxl，无法解析 Excel") from exc
        # data_only：尽量读计算后的值
        wb = load_workbook(path, read_only=True, data_only=True)
        try:
            ws = wb[wb.sheetnames[0]]
            sheet = ws.title
            rows: list[list[Any]] = []
            for row in ws.iter_rows(values_only=True):
                cells = list(row)
                if any(_cell_str(c) for c in cells):
                    rows.append(cells)
            return sheet, rows
        finally:
            wb.close()

    if ext == ".xls":
        raise ValidationException("暂不支持旧版 .xls，请另存为 .xlsx 或导出 CSV")

    raise ValidationException("仅支持 Excel（.xlsx）或 CSV")


def build_table_grid(path: Path, *, source_name: str) -> dict[str, Any]:
    """通用表格网格：列元数据 + 行记录，供前端自选行列出图。"""
    sheet, matrix = _read_matrix(path)
    if not matrix:
        raise ValidationException("文件没有可读数据")

    headers = [_header_name(v, i) for i, v in enumerate(matrix[0])]
    data_rows = matrix[1:]
    if not data_rows:
        raise ValidationException("只有表头，没有数据行")

    tips: list[str] = []
    truncated = False
    if len(data_rows) > MAX_ROWS:
        data_rows = data_rows[:MAX_ROWS]
        truncated = True
        tips.append(f"数据超过 {MAX_ROWS} 行，仅解析前 {MAX_ROWS} 行")

    def column_numeric_ok(col_idx: int) -> tuple[bool, int, int]:
        ok = 0
        total = 0
        for row in data_rows:
            if col_idx >= len(row):
                continue
            raw = row[col_idx]
            if _cell_str(raw) == "":
                continue
            total += 1
            if _try_float(raw) is not None:
                ok += 1
        if total == 0:
            return False, 0, 0
        return (ok / total) >= NUMERIC_RATIO, ok, total

    columns: list[dict[str, Any]] = []
    for i, h in enumerate(headers):
        good, ok, total = column_numeric_ok(i)
        columns.append(
            {
                "key": f"c{i}",
                "name": h,
                "index": i,
                "type": "number" if good else "string",
                "numeric_ratio": round((ok / total), 3) if total else 0,
            }
        )

    records: list[dict[str, Any]] = []
    for ridx, row in enumerate(data_rows):
        excel_row = ridx + 2
        rec: dict[str, Any] = {"__row": excel_row}
        empty = True
        for col in columns:
            idx = int(col["index"])
            raw = row[idx] if idx < len(row) else None
            num = _try_float(raw)
            if col["type"] == "number":
                rec[col["key"]] = num
                if num is not None:
                    empty = False
            else:
                if num is not None:
                    rec[col["key"]] = num
                    empty = False
                else:
                    text = _cell_str(raw)
                    rec[col["key"]] = text if text else None
                    if text:
                        empty = False
        if not empty:
            records.append(rec)

    if not records:
        raise ValidationException("没有有效数据行")

    return {
        "source": source_name,
        "sheet": sheet,
        "columns": columns,
        "records": records,
        "tips": tips,
        "row_count": len(records),
        "column_count": len(columns),
        "truncated": truncated,
    }


def analyze_table_file(path: Path, *, source_name: str) -> dict[str, Any]:
    # 先产出通用网格（P0 图表构建器用）
    grid = build_table_grid(path, source_name=source_name)

    sheet, matrix = _read_matrix(path)
    if not matrix:
        raise ValidationException("文件没有可读数据")

    headers = [_header_name(v, i) for i, v in enumerate(matrix[0])]
    data_rows = matrix[1:]
    if not data_rows:
        raise ValidationException("只有表头，没有数据行")
    if len(data_rows) > MAX_ROWS:
        data_rows = data_rows[:MAX_ROWS]
        truncated = True
    else:
        truncated = False

    tips: list[str] = []
    skipped_columns: list[str] = []

    # 1) 列头可解析为数值 → 候选曲线点（光谱波长类）
    wave_candidates: list[tuple[int, float, str]] = []
    other_indices: list[int] = []
    for i, h in enumerate(headers):
        wave = _try_float(h)
        if wave is not None:
            wave_candidates.append((i, wave, h))
        else:
            other_indices.append(i)

    def column_numeric_ok(col_idx: int) -> tuple[bool, int, int]:
        ok = 0
        total = 0
        for row in data_rows:
            if col_idx >= len(row):
                continue
            raw = row[col_idx]
            if _cell_str(raw) == "":
                continue
            total += 1
            if _try_float(raw) is not None:
                ok += 1
        if total == 0:
            return False, 0, 0
        return (ok / total) >= NUMERIC_RATIO, ok, total

    series_cols: list[tuple[int, float, str]] = []
    for col_idx, wave, header in wave_candidates:
        good, ok, total = column_numeric_ok(col_idx)
        if good:
            series_cols.append((col_idx, wave, header))
        else:
            other_indices.append(col_idx)
            skipped_columns.append(header)
            tips.append(
                f"列「{header}」无法稳定转为数值（{ok}/{total or 0}），已默认不选入曲线坐标"
            )

    # 2) 没有数值列头时：把「值大多是数值」的列选入，X 用列序号
    if not series_cols:
        auto_series: list[tuple[int, float, str]] = []
        still_other: list[int] = []
        for col_idx in other_indices:
            good, ok, total = column_numeric_ok(col_idx)
            header = headers[col_idx]
            if good:
                auto_series.append((col_idx, float(len(auto_series) + 1), header))
            else:
                still_other.append(col_idx)
                if total > 0:
                    skipped_columns.append(header)
                    tips.append(
                        f"列「{header}」为非数值类型（{ok}/{total}），已默认不选入曲线"
                    )
        other_indices = still_other
        series_cols = auto_series
        if series_cols:
            tips.insert(
                0,
                "未检测到数值列头（如波长），已将可转为数值的列作为曲线点，X 轴使用列序号",
            )

    if not series_cols:
        tips.append("未识别到自动光谱曲线列；请用图表构建器自选 X / Y")
        return {
            "source": source_name,
            "sheet": sheet,
            "waves": [],
            "x_labels": None,
            "meta_cols": [c["name"] for c in grid["columns"] if c["type"] != "number"],
            "label_options": [{"key": "__excel_row__", "label": "Excel 行号（默认）"}],
            "rows": [],
            "tips": list(dict.fromkeys([*(grid.get("tips") or []), *tips])),
            "skipped_columns": [],
            "series_count": 0,
            "row_count": grid["row_count"],
            "grid": grid,
        }

    # 列头是数值时按波长排序；否则保持原顺序
    if all(_try_float(h) is not None for _, _, h in series_cols):
        series_cols.sort(key=lambda x: x[1])

    waves = [w for _, w, _ in series_cols]
    # 若自动序号模式，用原始列名作为类别 X，便于 hover
    use_category_x = any(_try_float(h) is None for _, _, h in series_cols)
    x_labels = [h for _, _, h in series_cols] if use_category_x else None

    meta_cols = [headers[i] for i in sorted(set(other_indices))]
    # 去重保持顺序
    seen: set[str] = set()
    meta_cols_unique: list[str] = []
    for name in meta_cols:
        if name not in seen:
            seen.add(name)
            meta_cols_unique.append(name)
    meta_cols = meta_cols_unique

    rows_out: list[dict[str, Any]] = []
    for ridx, row in enumerate(data_rows):
        excel_row = ridx + 2  # 含表头
        meta: dict[str, Any] = {}
        for col_idx in sorted(set(other_indices)):
            if col_idx >= len(headers):
                continue
            key = headers[col_idx]
            raw = row[col_idx] if col_idx < len(row) else None
            num = _try_float(raw)
            if num is not None:
                meta[key] = num
            else:
                text = _cell_str(raw)
                meta[key] = text if text else None

        y: list[float | None] = []
        for col_idx, _, _ in series_cols:
            raw = row[col_idx] if col_idx < len(row) else None
            y.append(_try_float(raw))

        # 整行全空则跳过
        if all(v is None for v in y) and all(v is None or v == "" for v in meta.values()):
            continue
        rows_out.append({"excel_row": excel_row, "meta": meta, "y": y})

    if not rows_out:
        raise ValidationException("没有有效数据行")

    label_options = [
        {"key": "__excel_row__", "label": "Excel 行号（默认）"},
    ]
    for name in meta_cols:
        label_options.append({"key": name, "label": name})

    if truncated:
        tips.append(f"数据超过 {MAX_ROWS} 行，仅解析前 {MAX_ROWS} 行")

    # 去重 tips / skipped
    tips = list(dict.fromkeys([*(grid.get("tips") or []), *tips]))
    skipped_columns = list(dict.fromkeys(skipped_columns))

    return {
        "source": source_name,
        "sheet": sheet,
        "waves": waves,
        "x_labels": x_labels,
        "meta_cols": meta_cols,
        "label_options": label_options,
        "rows": rows_out,
        "tips": tips,
        "skipped_columns": skipped_columns,
        "series_count": len(series_cols),
        "row_count": len(rows_out),
        "grid": grid,
    }
