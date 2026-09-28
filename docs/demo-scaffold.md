# Demo 快速脚手架

基座提供两类可复制范本，用于从 `master` 拉出 `demo/<场景>` 后快速搭页面。

> **模块化（`feat/modular-platform`）**：正式业务不要散落在 `pages/<场景>` 后只改 `App.tsx`。  
> 新业务应落在 `frontend/src/modules/<module_id>/`，并登记仓库根 `modules/<module_id>/MANIFEST.json`。详见 [modular-platform-plan.md](./modular-platform-plan.md)、[modules/README.md](../modules/README.md)。

## 范本一览

| 类型 | 前端页面 | 接口 | Fixture |
|------|----------|------|---------|
| Overview 总览 | `frontend/src/pages/demo/OverviewTemplatePage.tsx`（或 `modules/demo/`） | `GET /api/v1/demo/overview` | `backend/fixtures/overview.json` |
| QueryTable 查询表 | `frontend/src/pages/demo/QueryTableTemplatePage.tsx` | `GET /api/v1/demo/query-table` | `backend/fixtures/query_table.json` |

侧栏入口：**Demo 范本**（seed 同步后可见）。需重新执行：

```bash
# 在仓库根目录也可，sqlite 路径已锚定到 backend/
python backend/scripts/seed.py
```

## 复制步骤（新业务 — 模块化）

1. 从基线拉分支：`git checkout -b demo/<场景>` 或在 `feat/modular-platform` 上开任务分支  
2. 新建 `frontend/src/modules/<module_id>/`：页面 + `register.tsx`（导出路由）  
3. 后端对应能力放 `backend/app/modules/<module_id>/`（或先 API 再迁）  
4. 仓库根增加 `modules/<module_id>/MANIFEST.json`（前后端路径、menu_ids、api/route 前缀）  
5. 在 `frontend/src/platform/modules/registry.ts` 登记该模块（全量仓）  
6. `backend/scripts/seed.py` 的 `MENUS` 增加菜单并 seed  
7. 需要按 SKU 售卖时：增加 `editions/sku-....json` 的 `enabled_modules`  
8. **优先改 fixture JSON**；后期接真数据只换 api/service  

### 旧步骤（仅 Demo 范本快速试，勿用于可售模块）

1. 复制范本页到临时目录改名  
2. 临时挂路由验证交互  
3. 验证通过后按上面「模块化」步骤收拢进 `modules/<id>/`

## 区块组件

Overview 使用 `frontend/src/components/blocks/`：

- `KpiRow`：KPI 卡片行
- `ChartGrid`：折线 / 柱状 / 饼图栅格（`span` 控制宽度）
- `ScrollFeed`：滚动信息流

数量与布局由 JSON 数组驱动，不必为「4 卡 5 图」单独写死模板。

## 售卖相关

| 模式 | 文档 / 工具 |
|------|-------------|
| A 代码交付 | `python scripts/export_edition.py editions/<sku>.json` |
| B 远程限制 | `ENABLED_MODULES` + `VITE_EDITION`；见 [customer-embed-guide.md](./customer-embed-guide.md) |
| 无壳嵌入 | `?embed=1` 或 `layout_mode: embed` |

## 约定

- 假数据放后端 fixture，前端仍走 `useRequest` + api，与正式页一致  
- **禁止** `modules/A` 业务代码直接 import `modules/B`（共享下沉 `platform/`）  
- 业务 Demo 页不要合回 `master`；通用 blocks / 壳子改进可合回 base  
- 特殊布局可手写该页，但仍建议一页一接口、稳定 JSON 结构  
