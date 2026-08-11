@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] 未找到 .venv，请先在项目根目录创建虚拟环境。
  pause
  exit /b 1
)

cd /d "%~dp0backend"
echo [backend] 启动 uvicorn http://127.0.0.1:8000
echo [backend] API 文档: http://127.0.0.1:8000/docs
echo.

"%~dp0.venv\Scripts\python.exe" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
if errorlevel 1 pause
