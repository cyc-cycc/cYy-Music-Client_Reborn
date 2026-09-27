#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "========================================"
echo "  cYy Music Client 编译打包脚本 (macOS/Linux)"
echo "========================================"
echo "请选择操作:"
echo "  [1] DMG 安装包（全应用）"
echo "  [2] ZIP 压缩包（全应用）"
echo "  [3] 仅编译 Py 后端 (PyInstaller)"
echo "  [4] 编译 Py + DMG"
echo "  [5] 编译 Py + ZIP"
echo "  [6] 编译 Py + DMG + ZIP"
echo
read -r -p "请选择 (1-6，直接回车默认 1): " CHOICE
CHOICE="${CHOICE:-1}"

compile_backend() {
    if [ ! -x "cmcol/bin/python3" ]; then
        echo "[错误] 虚拟环境 cmcol 不存在，请先运行 ./env_setup.sh"
        exit 1
    fi
    # shellcheck disable=SC1091
    source cmcol/bin/activate
    if ! command -v pyinstaller >/dev/null 2>&1; then
        echo "[提示] 未检测到 PyInstaller，正在自动安装 ..."
        pip install pyinstaller
    fi
    if [ ! -f "server.spec" ]; then
        echo "[错误] server.spec 不存在"
        deactivate || true
        exit 1
    fi
    echo "正在执行 PyInstaller 打包后端 ..."
    pyinstaller --noconfirm server.spec
    deactivate
    echo "后端编译完成！产物位于 dist/cyy_backend"
}

pack_electron() {
    local BUILD_CMD="$1" LABEL="$2"
    if [ ! -e "dist/cyy_backend/cyy_backend" ] && [ ! -e "dist/cyy_backend/cyy_backend.exe" ]; then
        echo "[错误] 后端可执行文件不存在！请先编译 Py 后端。"
        exit 1
    fi
    export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
    export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
    echo "您选择了: $LABEL"
    cd frontend
    npm run "$BUILD_CMD"
    cd ..
    echo "打包完成！产物位于 dist-app"
}

case "$CHOICE" in
    1) pack_electron dist:mac:dmg "DMG 安装包" ;;
    2) pack_electron dist:mac:zip "ZIP 压缩包" ;;
    3) compile_backend ;;
    4) compile_backend; pack_electron dist:mac:dmg "DMG 安装包" ;;
    5) compile_backend; pack_electron dist:mac:zip "ZIP 压缩包" ;;
    6) compile_backend
       pack_electron dist:mac:dmg "DMG 安装包"
       pack_electron dist:mac:zip "ZIP 压缩包" ;;
    *) echo "无效选择"; exit 1 ;;
esac
