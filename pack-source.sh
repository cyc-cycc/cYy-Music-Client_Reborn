#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "============================================"
echo "  cYy Music Client - 源代码打包脚本 (macOS/Linux)"
echo "============================================"

DETAIL=""
read -r -t 5 -p "是否添加备份详情？[y/N] (5 秒默认 N): " DETAIL_CHOICE || true
echo
if [[ "$DETAIL_CHOICE" =~ ^[Yy]$ ]]; then
    read -r -p "请输入备份详情: " user_detail
    if [ -n "$user_detail" ]; then
        user_detail=$(printf '%s' "$user_detail" | tr -d ':/\\*?<>|"')
        DETAIL="-$user_detail"
    fi
fi

mkdir -p backup
TS=$(date +%Y-%m-%d_%H-%M-%S)
OUTPUT_NAME="cYy-Music-Client_source_${TS}${DETAIL}.tar.gz"
OUTPUT_PATH="backup/${OUTPUT_NAME}"

echo
echo "正在打包源代码为 ${OUTPUT_PATH} ..."
echo

tar \
    --exclude='node_modules' \
    --exclude='electron_cache' \
    --exclude='.CMC' \
    --exclude='download' \
    --exclude='cover_cache' \
    --exclude='cmcol' \
    --exclude='build' \
    --exclude='dist' \
    --exclude='dist-app' \
    --exclude='__pycache__' \
    --exclude='musicdl_outputs' \
    --exclude='logs' \
    --exclude='*.pyc' \
    --exclude='*.pyo' \
    --exclude='.git' \
    --exclude='.env' \
    --exclude='*.log' \
    --exclude='*.7z' \
    --exclude='*.tar.gz' \
    --exclude='backup' \
    --exclude='backup_macos_compat' \
    -czf "$OUTPUT_PATH" .

echo
echo "打包完成：$OUTPUT_PATH"
echo "文件位置：$(pwd)/$OUTPUT_PATH"
