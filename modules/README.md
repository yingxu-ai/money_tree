# 业务模块约定

> 对应执行计划：[modular-platform-plan.md](../modular-platform-plan.md)  
> 售卖：**模式 A** 按 MANIFEST 拷贝目录；**模式 B** 按 `module_id` 限制页面与接口。

## 模块一览（首批）

| module_id | 说明 | 售卖 |
|-----------|------|------|
| `platform` | 登录、布局、鉴权、品牌（壳） | 不单卖，模式 A 必带 |
| `system` | 系统管理（用户/角色/菜单等） | 默认随壳；远程可关 |
| `dashboard` | 驾驶舱 + AI 助手 + 配置/文件中心等基座页 | 默认随壳 |
| `demo` | Demo 范本 | 一般不售卖 |
| `equipment-analysis` | 设备分析 | 可售 |
| `scheduling` | 生产排产 | 可售 |
| `toolbox` | 工具箱（ROI、单位换算、文件分析等） | 可售 |

## 目录约定（目标态）

- 前端业务：`frontend/src/modules/<module_id>/`
- 后端业务：`backend/app/modules/<module_id>/`（迁完后）
- 壳：`frontend/src/platform/`、`backend/app` 中平台能力
- SKU：`editions/*.json`

过渡期允许页面仍在 `frontend/src/pages/...`，但必须在模块 `routes` / `MANIFEST` 登记。

## MANIFEST.json 字段

```json
{
  "module_id": "scheduling",
  "name": "生产排产",
  "frontend_paths": ["frontend/src/pages/scheduling"],
  "frontend_api_paths": ["frontend/src/api/scheduling.ts"],
  "backend_paths": ["backend/app/api/scheduling.py", "backend/app/scheduling"],
  "menu_ids": [60, 61, 62, 63, 64],
  "api_path_prefixes": ["/api/v1/scheduling"],
  "route_prefixes": ["/scheduling"]
}
```

## 硬规则

1. 禁止 `modules/A` 业务代码 import `modules/B`（共享下沉 platform）。
2. 每个 HTTP API 归属一个 `module_id`（模式 B 守卫用）。
3. 新业务必须：补 MANIFEST + routes 注册 + editions 可选启用。
