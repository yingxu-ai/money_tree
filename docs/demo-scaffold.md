# Demo 快速脚手架

基座提供两类可复制范本，用于从 `master` 拉出 `demo/<场景>` 后快速搭页面。

## 范本一览

| 类型 | 前端页面 | 接口 | Fixture |
|------|----------|------|---------|
| Overview 总览 | `frontend/src/pages/demo/OverviewTemplatePage.tsx` | `GET /api/v1/demo/overview` | `backend/fixtures/overview.json` |
| QueryTable 查询表 | `frontend/src/pages/demo/QueryTableTemplatePage.tsx` | `GET /api/v1/demo/query-table` | `backend/fixtures/query_table.json` |

侧栏入口：**Demo 范本**（seed 同步后可见）。需重新执行：

```bash
# 在仓库根目录也可，sqlite 路径已锚定到 backend/
python backend/scripts/seed.py
```

## 复制步骤（新业务 Demo）

1. 从 `master` 拉分支：`git checkout -b demo/<场景>`
2. 复制对应范本页到 `pages/<场景>/...`，改组件名
3. 在 `App.tsx` 注册路由
4. 在 `backend/scripts/seed.py` 的 `MENUS` 增加菜单（或菜单管理里加），并 seed
5. **优先改 fixture JSON**；列定义 / 状态映射在页面里改
6. 后期接真数据：只换 `api/*.ts` 的请求目标或后端 service，尽量保持页面结构

## 区块组件

Overview 使用 `frontend/src/components/blocks/`：

- `KpiRow`：KPI 卡片行
- `ChartGrid`：折线 / 柱状 / 饼图栅格（`span` 控制宽度）
- `ScrollFeed`：滚动信息流

数量与布局由 JSON 数组驱动，不必为「4 卡 5 图」单独写死模板。

## 约定

- 假数据放后端 fixture，前端仍走 `useRequest` + `api/`，与正式页一致
- 业务 Demo 页不要合回 `master`；仅把通用 blocks / 壳子改进合回 base
- 特殊布局可手写该页，但仍建议一页一接口、稳定 JSON 结构
