# Customer embedding / 远程嵌入接入说明

对应售卖模式 B（远程托管）与模式 A 导出包中的 `layout_mode=embed`。

## 布局

| 方式 | 做法 |
|------|------|
| URL | 业务地址加 `?embed=1` |
| 环境变量 | `VITE_LAYOUT_MODE=embed` |
| Edition | `editions/*.json` 中 `"layout_mode": "embed"` |

embed 下不渲染顶栏与左侧导航，只输出业务内容区。

## 模块开通（模式 B）

后端环境变量：

```env
ENABLED_MODULES=scheduling
# 多个：scheduling,toolbox
# 全开：* 或缺省
```

前端构建 / 开发：

```env
VITE_EDITION=sku-scheduling-remote
```

未开通模块：前端路由进 403 页；后端对应 API 返回 403。

## 接入对方门户

1. 对方菜单链到我们的业务 URL（可带 `embed=1`）
2. 登录：一期使用我方登录页拿 JWT；二期再接 SSO
3. 子路径部署时配置前端 `basename`（edition 字段，后续接 BrowserRouter）

## 模式 A 导出

```bash
python scripts/export_edition.py editions/sku-scheduling-local.json
python scripts/export_edition.py editions/sku-scheduling-local.json --check-only
```

详见导出目录内 `EXPORT_README.md`。
