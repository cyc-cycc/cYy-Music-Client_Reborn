@echo off
setlocal
chcp 65001 >nul 2>nul
cd /d "%~dp0"

echo ============================================
echo   更新“项目结构.txt”
echo ============================================
echo.

if exist "cmcol\Scripts\python.exe" (
    "cmcol\Scripts\python.exe" update_structure.py
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo [错误] 未找到 Python，请先运行 env_setup.bat
        pause
        exit /b 1
    )
    python update_structure.py
)

if errorlevel 1 (
    echo.
    echo [错误] 生成失败
    pause
    exit /b 1
)

echo.
echo 完成。按任意键退出...
pause > nul