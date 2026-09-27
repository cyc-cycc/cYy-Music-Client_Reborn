#!/usr/bin/env bash
cd "$(dirname "$0")"

echo "============================================"
echo "  更新\"项目结构.txt\""
echo "============================================"
echo

if [ -x "cmcol/bin/python3" ]; then
    cmcol/bin/python3 update_structure.py
elif command -v python3 >/dev/null 2>&1; then
    python3 update_structure.py
else
    echo "[错误] 未找到 Python，请先运行 ./env_setup.sh"
    exit 1
fi

echo
echo "完成。"
