@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0frontend"

if not exist "package.json" (
  echo [ERROR] 未找到 frontend\package.json
  pause
  exit /b 1
)

where pnpm >nul 2>&1
if !errorlevel!==0 (
  set "PKG=pnpm"
) else (
  set "PKG=npm"
)

if not exist "node_modules" (
  echo [frontend] 未检测到 node_modules，正在用 !PKG! 安装依赖...
  if "!PKG!"=="pnpm" (
    call pnpm i
  ) else (
    call npm i
  )
  if errorlevel 1 (
    echo [ERROR] 依赖安装失败
    pause
    exit /b 1
  )
)

echo [frontend] 使用 !PKG! 启动 Vite http://127.0.0.1:5173
echo.

if "!PKG!"=="pnpm" (
  call pnpm dev
) else (
  call npm run dev
)
if errorlevel 1 pause
