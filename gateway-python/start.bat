@echo off
chcp 65001 >nul
echo ========================================
echo CaseBuddy Python 网关服务
echo ========================================
echo.

cd /d "%~dp0"

REM 检查 Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.8+
    pause
    exit /b 1
)

REM 安装依赖
echo [1/3] 检查依赖...
pip install -r requirements.txt -q
if errorlevel 1 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
)

REM 启动服务
echo [2/3] 启动网关服务 (端口 3002)...
echo [3/3] 按 Ctrl+C 停止服务
echo.

python gateway_server.py 3002

pause
