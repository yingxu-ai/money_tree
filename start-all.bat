@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo [start-all] 将分别打开后端、前端两个窗口
echo [start-all] 后端: http://127.0.0.1:8000
echo [start-all] 前端: http://127.0.0.1:5173
echo.

start "industry-ai-backend" cmd /k "%~dp0start-backend.bat"
timeout /t 2 /nobreak >nul
start "industry-ai-frontend" cmd /k "%~dp0start-frontend.bat"

echo 已启动。关闭对应窗口即可停止服务。
timeout /t 3 /nobreak >nul
