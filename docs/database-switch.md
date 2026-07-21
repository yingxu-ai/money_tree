# 数据库切换说明（SQLite ↔ PostgreSQL）

本基座通过 **`DATABASE_URL` 环境变量** 切换数据库，业务代码无需改动。

## 默认：SQLite（开箱即用）

```env
DATABASE_URL=sqlite+aiosqlite:///./data/app.db
```

在 `backend` 目录：

```powershell
python scripts/seed.py
uvicorn app.main:app --reload --port 8000
```

## 切换到 PostgreSQL

### 1. 准备 Postgres

任选一种：

**A. 本机已安装 PostgreSQL（本次验证路径）**

```powershell
# 创建业务库（密码按本机实际填写）
$env:PGPASSWORD = "postgresql"
& "D:\dbs\postgres\bin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -c "CREATE DATABASE industrial_ai;"
```

**B. Docker Compose**

```powershell
cd E:\git_base
docker compose --profile pg up -d postgres
```

默认账号 / 库（Docker）：`postgres` / `postgres`，库名 `industrial_ai`，端口 `5432`。

### 2. 配置环境变量

在 `backend/.env`（可参考 `.env.example`），或仅当前会话：

```powershell
# 本机实例示例（账号 postgres / 密码 postgresql）
$env:DATABASE_URL = "postgresql+asyncpg://postgres:postgresql@127.0.0.1:5432/industrial_ai"

# Docker 默认示例
# $env:DATABASE_URL = "postgresql+asyncpg://postgres:postgres@localhost:5432/industrial_ai"
```

> 异步驱动用 `asyncpg`；Alembic 同步 URL 会自动换成 `psycopg`。

### 3. 初始化表结构与种子

```powershell
cd E:\git_base\backend
python scripts/seed.py

# 可选：标记 Alembic 基线（0001_initial 为空迁移，表由 create_all 创建）
alembic stamp head
```

### 4. 启动 API 或跑自动化冒烟

```powershell
$env:DATABASE_URL = "postgresql+asyncpg://postgres:postgresql@127.0.0.1:5432/industrial_ai"
uvicorn app.main:app --reload --port 8000
```

验收清单：

- [x] `GET /health` 正常
- [x] `POST /api/v1/auth/login`（admin / admin123）成功
- [x] 菜单含「账号管理」、部门/用户可读（含 `dept_id` / `role_names`）
- [x] 驾驶舱列表可读

自动化冒烟：

```powershell
cd E:\git_base\backend
$env:DATABASE_URL = "postgresql+asyncpg://postgres:postgresql@127.0.0.1:5432/industrial_ai"
python scripts/smoke_pg.py
```

**验证记录（2026-07-15）：** 本机 PostgreSQL 17.5 + 上述 URL，`smoke_pg.py` 通过。

## 切回 SQLite

```env
DATABASE_URL=sqlite+aiosqlite:///./data/app.db
```

两套库数据相互独立，不会自动迁移业务数据。

## 说明

| 项 | SQLite | PostgreSQL |
|----|--------|------------|
| 用途 | 本地演示 / 默认 | 联调 / 准生产 |
| 缺列补齐 | `_ensure_sqlite_columns`（如 `dept_id`） | 靠 create_all / 后续 Alembic 增量 |
| Alembic | `render_as_batch=True` | 标准迁移 |

后续 schema 变更：优先 `alembic revision --autogenerate`，两端都跑 `alembic upgrade head`。
