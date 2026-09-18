# 设备分析 — 角色兼顾实施计划（中层卖优先级 · 一线卖可执行）

> 状态：**Phase A～D 主路径已落地** · 最后更新：2026-09-04  
> 关联：[`equipment-analysis-product.md`](./equipment-analysis-product.md)、[`equipment-analysis-future-plan.md`](./equipment-analysis-future-plan.md)、[`equipment-analysis-next-focus.md`](./equipment-analysis-next-focus.md)  
> 背景：商业上中层「先管谁」更稀缺；体验上一线「怎么干」更友好。**兼顾，但一条钻取链，不做三套门户。**

---

## 1. 定位与原则

### 1.1 三角色与产品分工

| 角色 | 商业价值 | 使用频率 | 产品承载 | 交付物 |
|------|----------|----------|----------|--------|
| **中层管理** | **主买单叙事**（设备多、人少、怕非计划停机） | 班 / 日 | `/analysis/current`、`/analysis/future` 舰队页 | 优先级清单、态势摘要 |
| **一线运维** | 验收与口碑（现场信不信） | 班中高频 | `/devices/:id` 现状/未来/调优 Tab | 结论、证据、动作、时间线 |
| **高层决策** | 预算 / ROI 叙事（附属） | 周 / 月 | **不单独做门户**；从舰队/单机抽出一页摘要 | 可少损、案例、回溯 |

### 1.2 硬原则

1. **中层页卖优先级，一线页卖可执行，高层只吃摘要。**
2. **一条钻取链**：舰队 → 单机 →（可选）健康报告 / 汇报摘要；禁止三套平行信息架构。
3. **Demo/售前讲舰队价值；交付验收盯单机是否能干活。**
4. **不新增角色体系**：继续用现有部门数据范围；可用「默认落地页 / 视图密度」区分，不必做权限角色产品。
5. **刻意不做**：独立高层大屏、集团多工厂门户、完整 CMMS；手机独立 App 另案（响应式优先）。

---

## 2. 信息架构（目标态）

```text
中层舰队（要不要管 / 先管谁）
    ↓ 点设备（带 from + 筛选 URL）
一线单机（任务条 + 结论 + 动作）
    ↓ 汇报摘要 / 健康报告
高层一页账（可少损 · 优先设备 · 案例）
```

---

## 3. 分阶段计划与完成度

### Phase A — 钻取闭环 ✅

| # | 任务 | 状态 |
|---|------|------|
| A1 | `from` + `dept_id`/`type`/`group_by`/`page` 深链；返回还原范围 | ✅ `deviceNav.ts` + `useFleetScopeParams` |
| A2 | 单机顶栏任务条：分级 / HI / 24h / 检修日 / 一句话 / 主因 | ✅ `DeviceDetailPage` |
| A3 | 清单与单机字段同源（继续用 `_project_future_metrics`） | ✅ |
| A4 | 现状「↓ 建议动作」跳转 + 动作卡前置 | ✅ `DeviceCurrentPanel` |

### Phase B — 中层「先管谁」 ✅

| # | 任务 | 状态 |
|---|------|------|
| B1 | 「本班优先」Top5 卡片 + 可少损 | ✅ `PriorityWatchCard` |
| B2 | 重点异常：偏离度+持续时长排序；行上「建议动作」摘要 | ✅ API + `FocusDevicesTable` |
| B3 | 态势文案 + 优先设备可点进单机 | ✅ `FutureSituationCard` |
| B4 | 筛选条 URL 记忆 + 清单分页写回 URL | ✅ |

### Phase C — 一线可执行 ✅

| # | 任务 | 状态 |
|---|------|------|
| C1 | 现状结论一屏：趋势+时间线+动作；证据折叠 | ✅ |
| C2 | 未来「处置优先」置顶；成本/芯片墙后置 | ✅ `FutureDevicePanel` |
| C3 | 相近案例改为告警→处置→回落时间线 | ✅ |
| C4 | 单机健康报告抽屉（可打印） | ✅ |
| C5 | 设备示意 + 测点落点 | ✅ 草案见 [`equipment-analysis-schematic-plan.md`](./equipment-analysis-schematic-plan.md)；螺杆压缩机可点 UI 已落地，水泵/冷机预览热区已备 |

### Phase D — 高层摘要 ✅

| # | 任务 | 状态 |
|---|------|------|
| D1 | 未来页「汇报摘要」抽屉 | ✅ |
| D2 | 与 C4 共用 `RoleBriefing` 组件 | ✅ |
| D3 | 不做集团大屏 / 经营门户 | ✅ 边界保留 |

### Phase E — 可选增强 ⏸

响应式卡片、告警深链推送、阈值真改写 — 另开迭代。

### Phase F — 决策闭环 ✅

见 [`equipment-analysis-next-focus.md`](./equipment-analysis-next-focus.md)：改名不拆站；未来决策卡；调优对照表；对比推荐顺序。

---

## 4. 关键文件

| 文件 | 作用 |
|------|------|
| `frontend/.../deviceNav.ts` | 深链 / 返回 / from 扩展 |
| `frontend/.../useFleetScopeParams.ts` | 舰队筛选 URL 同步 |
| `frontend/.../RoleBriefing.tsx` | 本班优先 · 汇报摘要 · 健康报告 |
| `frontend/.../AnalysisFleetPages.tsx` | 舰队接入 A/B/D |
| `frontend/.../DeviceDetailPage.tsx` | 任务条 · 报告 |
| `frontend/.../CurrentAnalysisBlocks.tsx` | 现状一屏 · 态势可点 |
| `frontend/.../FutureDevicePanel.tsx` | 处置优先重排 · 案例时间线 |
| `backend/.../equipment_analysis.py` | focus 排序 + `action_preview` |

---

## 5. 验收速查

1. `/analysis/future`：见「本班优先」→ 点设备 → 返回仍带部门筛选。  
2. 单机顶栏任务条可见 HI / 分级 / 检修日。  
3. 现状 Tab：动作在时间线旁；证据在折叠里。  
4. 未来 Tab：第二节即「如何避免」；成本在第五节。  
5. 「汇报摘要」「健康报告」可打开并打印。

---

## 6. 变更记录

| 日期 | 内容 |
|------|------|
| 2026-09-04 | 初版计划 |
| 2026-09-04 | 落地 Phase A～D 主路径；C5/E 留待按需 |
| 2026-09-09 | C5：示意草案入库；螺杆压缩机可点示意 + 水泵/冷机预览 |
| 2026-09-09 | 下一阶段聚焦：决策闭环；侧栏改名 + 未来决策卡 |
| 2026-09-09 | F4～F7：调优对照表、概况去重、对比运行顺序、结构图决策语气 |
| 2026-09-09 | F8：运行调优舰队分流 + 单机建议/对照/步骤 |
| 2026-09-09 | F9：调优推荐对齐、演示三台入口、列表筛选进 URL |
| 2026-09-11 | 现场转向：核心机深挖；catalog 仅 3 台；下一阶段见 next-focus G0～G4 |
