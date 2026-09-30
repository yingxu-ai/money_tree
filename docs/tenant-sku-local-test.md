# 租户开通模块 — 本地测试（售卖模式 B）

## 现状说明

- 用户表已有 `tenant_id`。
- 现已增加 **`sys_tenant.enabled_modules`**：按租户开通业务模块。
- API / 菜单 / 前端路由均按登录用户的租户 SKU 拦截。

## 售卖故事（示例）

| 角色 | 账号 | 租户 | 开通模块 |
|------|------|------|----------|
| 你们自己 / 演示 | `admin` / `admin123` | 1 演示租户 | `*` 全开 |
| 客户 A（买了排产） | `tenant_a` / `tenant_a123` | 2 `customer_a` | `scheduling` |

### 客户怎么用

1. 打开前端（如 `http://localhost:5173`），**不要**依赖 `VITE_EDITION` 裁剪（本地默认全量注册路由）。
2. 用 `tenant_a` / `tenant_a123` 登录。
3. 侧栏应只剩 **生产排产**（及壳里未映射的项会被滤掉）。
4. 直接访问 `/devices` 会进「模块未开通」。
5. 调设备分析 API 会返回 **403 模块未开通**。

### 你怎么「卖」给租户 A

种子已写好租户 2 = 仅排产。若要改开通范围：

```bash
cd backend
python scripts/seed.py
# 只开排产（默认）
python scripts/set_tenant_modules.py 2 scheduling
# 排产 + 工具箱
python scripts/set_tenant_modules.py 2 scheduling,toolbox
# 恢复全开
python scripts/set_tenant_modules.py 2 "*"
```

改完后让该租户用户 **重新登录**（JWT 里带 tenant_id；模块列表以 `/auth/me` 为准）。

## 本地步骤 Checklist

1. 启动后端、前端（与平时相同）。
2. `python backend/scripts/seed.py`（会建 `sys_tenant` + `tenant_a`）。
3. 浏览器登录 `tenant_a` → 只应看到排产。
4. 另开无痕窗口登录 `admin` → 应看到全模块。
5. （可选）对 `tenant_a` 的 Token 调 `GET /api/v1/equipment-analysis/...` → 403。

## 和「拷代码交付」的区别

| | 模式 B（本页） | 模式 A |
|--|----------------|--------|
| 代码在哪 | 你们服务器 | 拷给客户本地 |
| 开通方式 | 改租户 `enabled_modules` | 导出包只含已购模块 |
| 同一套部署 | 多租户共用 | 每客户一份裁剪包 |
