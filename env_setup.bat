@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

title cYy Music Client 环境搭建

echo ========================================
echo   cYy Music Client 环境搭建脚本
echo ========================================

:: ---- 检查 Python ----
where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.10+ 并加入 PATH
    pause
    exit /b 1
)
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PY_VER=%%i
echo Python 版本: %PY_VER%

:: ---- 检查 Node.js ----
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 并加入 PATH
    pause
    exit /b 1
)
for /f "tokens=1" %%i in ('node -v') do set NODE_VER=%%i
echo Node.js 版本: %NODE_VER%

:: ---- 设置镜像加速 ----
set PYPI_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

:: ---- 创建/激活虚拟环境 ----
if not exist "cmcol\Scripts\python.exe" (
    echo [1/3] 创建虚拟环境 cmcol ...
    python -m venv cmcol
    if errorlevel 1 (
        echo 创建虚拟环境失败
        pause
        exit /b 1
    )
) else (
    echo [1/3] 虚拟环境已存在，跳过创建
)

echo [2/3] 激活虚拟环境并安装后端依赖 ...
call cmcol\Scripts\activate.bat
if errorlevel 1 (
    echo 激活虚拟环境失败
    pause
    exit /b 1
)

pip install --upgrade pip
pip install -r requirements.txt --index-url %PYPI_INDEX%
if errorlevel 1 (
    echo 后端依赖安装失败，请检查网络或 requirements.txt
    pause
    exit /b 1
)

call cmcol\Scripts\deactivate.bat
:: ---- 安装前端依赖 ----
echo [3/3] 安装前端依赖 (npm install) ...
cd frontend
if not exist "package.json" (
    echo frontend\package.json 不存在，请确认目录结构
    cd ..
    pause
    exit /b 1
)

call npm install
if errorlevel 1 (
    echo 前端依赖安装失败
    cd ..
    pause
    exit /b 1
)
cd ..

echo ========================================
echo   环境搭建完成！
echo ========================================

pause > nul