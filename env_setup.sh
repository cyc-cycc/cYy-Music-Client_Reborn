#!/usr/bin/env bash
# macOS / Linux 一键环境搭建
set -e
cd "$(dirname "$0")"

echo "========================================"
echo "  cYy Music Client 环境搭建脚本 (macOS/Linux)"
echo "========================================"

command -v python3 >/dev/null 2>&1 || { echo "[错误] 未找到 python3，请先安装 Python 3.10+"; exit 1; }
echo "Python 版本: $(python3 --version)"

command -v node >/dev/null 2>&1 || { echo "[错误] 未找到 Node.js，请先安装"; exit 1; }
echo "Node.js 版本: $(node -v)"

export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

if [ ! -x "cmcol/bin/python3" ]; then
    echo "[1/3] 创建虚拟环境 cmcol ..."
    python3 -m venv cmcol
else
    echo "[1/3] 虚拟环境已存在，跳过创建"
fi

echo "[2/3] 安装后端依赖 ..."
# shellcheck disable=SC1091
source cmcol/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate

echo "[3/3] 安装前端依赖 (npm install) ..."
cd frontend
npm install
cd ..

echo "========================================"
echo "   环境搭建完成！"
echo "========================================"
