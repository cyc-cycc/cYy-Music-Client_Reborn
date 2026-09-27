@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul

title cYy Music Client 编译打包工具

:: PyPI 镜像（供自动安装 PyInstaller 用）
set "PYPI_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple"

echo ========================================
echo   cYy Music Client 编译打包脚本
echo ========================================
echo 请选择操作:
echo   【1】 NSIS 安装包（全应用）
echo   【2】 便携版 (Portable)
echo   【3】 仅编译 Py 后端 (PyInstaller)
echo   【4】 编译 Py + NSIS
echo   【5】 编译 Py + Portable
echo   【6】 编译 Py + NSIS + Portable
echo.
echo 默认选择 【1】 (3秒后自动选择)

choice /C 123456 /N /T 3 /D 1 /M "请选择 (1-6): "
if errorlevel 6 goto opt6
if errorlevel 5 goto opt5
if errorlevel 4 goto opt4
if errorlevel 3 goto opt3
if errorlevel 2 goto opt2
if errorlevel 1 goto opt1

:: ================= 选项 1：仅 NSIS =================
:opt1
call :pack_electron dist:nsis "NSIS 安装包"
goto end

:: ================= 选项 2：仅 Portable =================
:opt2
call :pack_electron dist:portable "便携版 (Portable)"
goto end

:: ================= 选项 3：仅编译后端 =================
:opt3
call :compile_backend
if errorlevel 1 goto end

echo.
echo 是否继续打包前端？

echo   【1】 NSIS 安装包
echo   【2】 便携版 (Portable)
echo   【N】 不打包，直接退出
echo.
echo 默认选择 【N】 (3秒后自动退出)

choice /C 12N /N /T 3 /D N /M "请选择 (1/2/N): "
if errorlevel 3 goto end
if errorlevel 2 call :pack_electron dist:portable "便携版 (Portable)"
if errorlevel 1 call :pack_electron dist:nsis "NSIS 安装包"
goto end

:: ================= 选项 4：Py + NSIS =================
:opt4
call :compile_backend
if errorlevel 1 goto end
call :pack_electron dist:nsis "NSIS 安装包"
goto end

:: ================= 选项 5：Py + Portable =================
:opt5
call :compile_backend
if errorlevel 1 goto end
call :pack_electron dist:portable "便携版 (Portable)"
goto end

:: ================= 选项 6：Py + NSIS + Portable =================
:opt6
call :compile_backend
if errorlevel 1 goto end
call :pack_electron dist:nsis "NSIS 安装包"
call :pack_electron dist:portable "便携版 (Portable)"
goto end

:: ================= 结束 =================
:end
echo ========================================
echo   操作完成！
echo ========================================
pause > nul
exit /b 0

:: ================= 子程序：编译后端 =================
:compile_backend
:: ---- 确保不激活虚拟环境（避免干扰） ----
call cmcol\Scripts\deactivate.bat 2>nul

if not exist "cmcol\Scripts\python.exe" (
    echo [错误] 虚拟环境 cmcol 不存在，请先运行 env_setup.bat 创建环境
    pause
    exit /b 1
)
call cmcol\Scripts\activate.bat
if errorlevel 1 (
    echo 激活虚拟环境失败
    pause
    exit /b 1
)

:: ---- 确保 PyInstaller 已安装（缺失则自动装） ----
where pyinstaller >nul 2>&1
if errorlevel 1 (
    echo.
    echo [提示] 未检测到 PyInstaller，正在自动安装 ...
    pip install pyinstaller --index-url %PYPI_INDEX%
    if errorlevel 1 (
        echo [错误] PyInstaller 安装失败，请检查网络或手动执行:
        echo        cmcol\Scripts\activate.bat ^&^& pip install pyinstaller
        call cmcol\Scripts\deactivate.bat
        pause
        exit /b 1
    )
    echo [提示] PyInstaller 安装完成
    echo.
)

echo 正在执行 PyInstaller 打包后端 ...
if exist "server.spec" (
    pyinstaller --noconfirm server.spec
    if errorlevel 1 (
        echo PyInstaller 打包失败
        call cmcol\Scripts\deactivate.bat
        pause
        exit /b 1
    )
) else (
    echo [错误] server.spec 文件不存在
    call cmcol\Scripts\deactivate.bat
    pause
    exit /b 1
)

call cmcol\Scripts\deactivate.bat
echo ========================================
echo   后端编译完成！产物位于 dist\cyy_backend
echo ========================================
exit /b 0

:: ================= 子程序：打包 Electron =================
:pack_electron
:: 参数 %1 = BUILD_CMD (dist:nsis 或 dist:portable)
:: 参数 %2 = 显示名称
set "BUILD_CMD=%~1"
set "BUILD_TARGET=%~2"

:: 确保退出虚拟环境，避免使用虚拟环境中的 npm
call cmcol\Scripts\deactivate.bat 2>nul

echo.
echo 您选择了: %BUILD_TARGET%
echo 开始构建...

:: ---- 检查后端是否存在 ----
if not exist "dist\cyy_backend\cyy_backend.exe" (
    echo [错误] 后端 cyy_backend.exe 不存在！
    echo 请先选择 【3】 编译 Py 后端，然后再执行本选项。
    pause
    exit /b 1
)

:: ---- 设置 Electron 镜像加速 ----
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

:: ---- 进入前端目录，执行打包 ----
cd frontend
if not exist "package.json" (
    echo [错误] frontend\package.json 不存在
    cd ..
    pause
    exit /b 1
)

echo 开始执行 npm run %BUILD_CMD% ...
call npm run %BUILD_CMD%
if errorlevel 1 (
    echo 打包失败
    cd ..
    pause
    exit /b 1
)

cd ..
echo ========================================
echo   打包完成！产物位于 dist-app 目录
echo ========================================
exit /b 0