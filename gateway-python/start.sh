#!/bin/bash
# CaseBuddy Python 网关服务启动脚本

cd "$(dirname "$0")"

echo "========================================"
echo "CaseBuddy Python 网关服务"
echo "========================================"
echo ""

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "[错误] 未找到 Python3，请先安装"
    exit 1
fi

# 安装依赖
echo "[1/3] 安装依赖..."
pip3 install -r requirements.txt -q

# 启动服务
echo "[2/3] 启动网关服务 (端口 3002)..."
echo "[3/3] 按 Ctrl+C 停止服务"
echo ""

python3 gateway_server.py 3002
