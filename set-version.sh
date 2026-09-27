#!/usr/bin/env bash
cd "$(dirname "$0")"

if [ -x "cmcol/bin/python3" ]; then
    PY=cmcol/bin/python3
elif command -v python3 >/dev/null 2>&1; then
    PY=python3
else
    echo "[错误] 未找到 Python"
    exit 1
fi

CUR_VER=$("$PY" -c "import json;print(json.load(open('frontend/package.json')).get('version',''))" 2>/dev/null || true)
[ -n "$CUR_VER" ] && echo "当前版本：$CUR_VER"

read -r -p "请输入新版本号（直接回车取消）：" NEW_VER
[ -z "$NEW_VER" ] && { echo "已取消"; exit 0; }

"$PY" set-version.py "$NEW_VER"
