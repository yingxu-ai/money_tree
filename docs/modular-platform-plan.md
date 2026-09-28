# 模块化平台与按组售卖 — 执行计划

> 分支：`feat/modular-platform`  
> 状态：待评审（确认后再按阶段实施）  
> 日期：2026-09-28  
> 基线：由 `demo/equipment-analysis` 拉出；现有交付分支不在本计划中大改

---

## 0. 目标与非目标

### 目标

1. **通用能力进平台壳**，**每个业务一个清晰模块边界**（目录 + 注册表）。
2. **按 SKU / 客户裁剪**：只交付已购模块（侧栏可见 + 构建/挂载尽量不含未购业务）。
3. **布局可配**：客户可不要我们的顶栏 / 左侧导航，把业务页嵌进他们自己的系统。
4. **渐进演进**：先同仓模块化 + 配置裁剪（档 A），不强上微服务；现网交付分支可继续用。

### 非目标（本计划不做）

- 不把现有业务拆成多个独立仓库 / 微服务（档 B 留到有明确第二、三付费模块后再议）。
- 不重写排产 / 设备分析业务逻辑；只迁目录与接入方式。
- 不在本阶段做复杂低代码、多租户计费商城。

---

## 1. 问题对照（为什么要做）

| 现状 | 售卖/集成痛点 |
|------|----------------|
| 单体 SPA + 单体 FastAPI，菜单靠 RBAC 隐藏 | 卖一组仍整包代码在制品里 |
| 路由写死在 `App.tsx`，菜单 component 不驱动加载 | 裁剪模块靠改代码，难产品化 |
| 布局写死 MainLayout（顶栏+侧栏） | 客户只要业务页时出现双导航 |
| 模块间偶发交叉引用、权限粒度不均 | 裁剪后易漏依赖或留后门 URL |

---

## 2. 目标架构（心智模型）

```
┌─────────────────────────────────────────────┐
│  Edition / SKU 配置（启用哪些 module）        │
├─────────────────────────────────────────────┤
│  Platform 壳                                 │
│  auth · layout(full|embed) · menu · perm     │
│  branding · 通用 UI / 图表壳 / 文件           │
├──────────┬──────────┬───────────────────────┤
│ module A │ module B │ module C …            │
│ 排产      │ 设备分析  │ 工具箱 / 文件分析 …   │
└──────────┴──────────┴───────────────────────┘
```

**两条正交配置：**

| 维度 | 配置项 | 含义 |
|------|--------|------|
| 卖什么 | `enabled_modules` | 装哪些业务 |
| 怎么嵌 | `layout_mode` | `full` 完整壳 / `embed` 无顶栏侧栏 |

---

## 3. 目标目录（落地形态）

> 实施时以「迁目录 + 注册表」为主，避免一次改爆。名称可在评审时微调。

### 前端（建议）

```
frontend/src/
  platform/                 # 壳：布局、鉴权、菜单渲染、品牌、通用 hooks/kit
    layout/
    auth/
    menu/
  modules/
    scheduling/             # 页面 + 模块路由表 + 菜单声明（可选）
    equipment-analysis/
    toolbox/                # 单位换算、文件分析等工具型
    system/                 # 系统管理也可视为「平台附属模块」，默认随壳
  editions/
    default.json            # 本地/演示：全开
    sku-scheduling.json     # 示例：仅排产
    sku-embed-scheduling.json
  App.tsx                   # 只负责：读 edition → 注册已启用模块路由
```

### 后端（建议）

```
backend/app/
  platform/                 # 或保留现有 core，明确「仅平台」
  modules/
    scheduling/
    equipment_analysis/
    toolbox/
  editions/                 # 或 settings：ENABLED_MODULES
  api/router.py             # 按 enabled_modules include_router
```

### 约定（写进后续 CONTRIBUTING / demo-scaffold 增补）

1. 业务代码只进自己的 `modules/<name>/`，禁止业务 → 业务的跨模块 import（共享能力下沉 platform）。
2. 新菜单 / 路由 / API 由模块 **注册表** 声明，平台汇总；禁止只在全局 `App.tsx` / `seed.py` 手写漏登记。
3. 模块对外只暴露：`routes`、`menus`（或 menu seed 片段）、`api_router`、可选 `permissions`。

---

## 4. 布局模式（embed）— 必须可配置

| `layout_mode` | 表现 | 典型客户 |
|---------------|------|----------|
| `full` | 顶栏 + 左侧导航 + 内容区（现状） | 交钥匙整站 |
| `embed` | 无侧栏、无顶栏（可保留极简安全区），只渲染业务页 | 挂进对方 OA/门户 |
| `content_only`（可选二期） | 更裸的内容区，适合 iframe | 强嵌入 |

**配置来源（优先级建议，实施时定一种主路径 + 一种覆盖）：**

1. 租户 / 系统配置（后台可改）  
2. URL：`?embed=1` 或路径前缀 `/embed/...`（便于联调）  
3. Edition JSON 出厂默认  

**embed 时额外行为：**

- `/auth/me/menus` 可返回空或忽略侧栏渲染（入口由对方系统提供）。
- 支持 Token / SSO 透传（一期可先：已有 JWT 放 localStorage / URL hash 约定；二期正式 SSO）。
- 路由 `basename` 可配置（挂子路径，如 `/oa/ai-scheduling`）。
- 不渲染「退出到我们登录页」的硬导航；提供可选 `postMessage` / 回调（二期）。

---

## 5. 按 SKU 裁剪（档 A）

### 5.1 运行时裁剪（先做，成本低）

- 配置 `ENABLED_MODULES=scheduling,toolbox`
- 前端：未启用模块不注册路由；菜单 seed / 接口只返回启用模块菜单
- 后端：未启用模块不 `include_router`
- 效果：侧栏 + 直接打 URL 都进不去未购模块（需同步加路由守卫：无菜单/无模块 → 403）

### 5.2 构建期裁剪（紧接，增强「交代码也不带别的」）

- 前端：Vite 按 `edition` 做条件编译 / 动态 `import()` 只打入启用模块
- 后端：同 edition 不打包未启用 router（或独立安装 profile）
- 效果：制品体积与源码面更接近「只买了什么」

### 5.3 档 B（本计划仅备案）

独立包 / 独立仓 / 独立授权服务 — 有稳定付费模块后再开专题。

---

## 6. 分阶段执行（确认后按序做）

### Phase 0 — 约定与脚手架（约 0.5～1 天）

- [ ] 定稿模块命名列表（首批建议）：
  - `platform`（壳，不售卖）
  - `system`（系统管理，默认随壳）
  - `scheduling`
  - `equipment-analysis`
  - `toolbox`（单位换算、文件数据分析等）
- [ ] 新增 `docs/modular-platform-plan.md`（本文）与简短 `modules/README` 约定
- [ ] 增加 `editions/default.json` 示例字段：`enabled_modules`、`layout_mode`、`basename`

**验收：** 文档与示例 JSON 评审通过；尚不迁业务代码。

---

### Phase 1 — 平台壳抽出 + layout_mode（约 2～3 天）

- [ ] 将 `MainLayout` / 登录守卫 / 品牌读取收拢到 `platform/`
- [ ] 实现 `layout_mode`：`full` | `embed`（配置 + `?embed=1`）
- [ ] embed 下不渲染 Sider / Header（或 Header 可配）
- [ ] 内容区路由仍可用；全屏类弹窗不受影响

**验收：**  
同账号下 `full` 与 `embed=1` 切换；embed 无左侧导航；业务页可打开。

---

### Phase 2 — 模块注册表（约 2～4 天）

- [ ] 前端：每个模块导出 `register()`（routes 列表）
- [ ] `App.tsx` 改为：读 edition → 合并路由
- [ ] 后端：`ENABLED_MODULES` → 条件 `include_router`
- [ ] 菜单：seed 按模块片段合并，或启动时按启用模块过滤
- [ ] 路由守卫：访问未启用模块 path → 统一 403/404 页

**验收：**  
`enabled_modules=["scheduling"]` 时，设备分析菜单与 API 不可用；排产正常。

---

### Phase 3 — 迁首个样板模块（约 2～3 天）

优先迁 **耦合相对清晰** 的一个（建议 **`toolbox`** 或 **`scheduling`**，评审时二选一）：

- [ ] 页面、api client、后端 router 迁入 `modules/<name>/`
- [ ] 修正 import 路径；消灭对其他业务模块的依赖
- [ ] 更新 seed 菜单归属该模块 id

**验收：** 该模块在「仅启用自己」的 edition 下可独立演示。

---

### Phase 4 — 迁其余业务模块（约 3～5 天，可并行）

- [ ] `equipment-analysis`
- [ ] `scheduling`（若 Phase 3 未选）
- [ ] `system` 明确为平台附属
- [ ] 清理旧路径 re-export（过渡期可留兼容层 1～2 周）

**验收：** `editions` 下至少两份 SKU JSON 可本地切换演示。

---

### Phase 5 — 构建期裁剪 + 嵌入联调清单（约 2～3 天）

- [ ] Vite 按 edition 打包验证（产物中无未启用页的明显 chunk 名）
- [ ] 后端启动日志打印已挂载 modules
- [ ] 输出《客户嵌入接入说明》一页：embed URL、Token 约定、basename、不要双导航
- [ ] （可选）iframe 沙箱页做内部自测

**验收：** 用「仅排产 + embed」SKU 打一包，给模拟客户门户挂一条菜单可打开。

---

### Phase 6 — 收尾（约 1 天）

- [ ] 更新 `demo-scaffold.md`：新业务必须落在 `modules/<场景>`
- [ ] 更新 `开发计划.md` 增加「模块化平台」条目与状态
- [ ] 列出已知债：跨模块依赖清单、设备分析权限码补齐、SSO 二期

---

## 7. 风险与对策

| 风险 | 对策 |
|------|------|
| 大搬迁导致交付分支不稳定 | 本工作只在 `feat/modular-platform`；合并前可 cherry-pick 无业务冲突的壳改动 |
| 隐藏依赖（A 页面 import B） | Phase 3/4 用 lint 边界或简单 import 检查脚本 |
| embed 丢登录态 | 先文档化 Token 方式；联调清单必测 |
| 菜单与路由不一致 | 模块注册表单一来源；seed 与 routes 同模块维护 |
| 一步做构建裁剪失败 | 运行时裁剪先上线能力，构建裁剪作增强 |

---

## 8. 建议排期（灵活）

| 阶段 | 预估 | 依赖 |
|------|------|------|
| Phase 0 | 0.5～1 天 | 评审通过本文 |
| Phase 1 | 2～3 天 | Phase 0 |
| Phase 2 | 2～4 天 | Phase 1 |
| Phase 3 | 2～3 天 | Phase 2 |
| Phase 4 | 3～5 天 | Phase 3 样板验证后 |
| Phase 5 | 2～3 天 | Phase 4 |
| Phase 6 | 1 天 | Phase 5 |

合计约 **2～3 周**（单人主路径；可按模块并行缩短 Phase 4）。

---

## 9. 评审确认清单（请你拍板）

请确认或勾选修改意见后再开工：

1. [ ] 分支策略：现交付继续走原分支；模块化只在 `feat/modular-platform` — **是否同意？**
2. [ ] 首迁样板模块：`toolbox` / `scheduling` / 其他 — **选哪个？**
3. [ ] `layout_mode` 一期是否包含 `embed` + `?embed=1` — **是否同意？**
4. [ ] 档 A 是否先做「运行时裁剪」，构建裁剪放 Phase 5 — **是否同意？**
5. [ ] 系统管理是否默认捆绑平台（不单独售卖）— **是否同意？**
6. [ ] 目录名 `platform` + `modules/*` — **是否要改名？**

---

## 10. 下一步

你确认 §9 后，按 **Phase 0 → 1 → 2…** 顺序在本分支实施；每阶段结束做一次可演示的提交，便于回滚与验收。
