@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul

title cYy Music - Set Version
cd /d "%~dp0"

echo ============================================
echo   cYy Music - 一键编辑版本号
echo ============================================
echo.
echo 目标文件:
echo   1. frontend\package.json
echo   2. frontend\package-lock.json
echo   3. frontend\index.html
echo.

if not exist "set-version.ps1" (
    echo [ERROR] set-version.ps1 not found in "%~dp0".
    echo         Please place both files in the same directory.
    pause
    exit /b 1
)

:: ---- Read current version ----
set "CUR_VER="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-Content 'frontend\package.json' -Raw | ConvertFrom-Json).version" 2^>nul`) do set "CUR_VER=%%i"
if defined CUR_VER (echo 当前版本：%CUR_VER%) else (echo [WARN] Cannot read current version)
echo.

:: ---- Prompt for new version ----
set "NEW_VER="
set /p "NEW_VER=请输入新版本号，直接回车取消："
if not defined NEW_VER (
    echo 已取消
    pause
    exit /b 0
)

:: ---- Validate format ----
set "VER_CHECK="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "if ($env:NEW_VER -match '^[0-9A-Za-z][0-9A-Za-z._+-]{0,30}$') { 'ok' } else { 'bad' }" 2^>nul`) do set "VER_CHECK=%%i"
if not "!VER_CHECK!"=="ok" (
    echo.
    echo [ERROR] Invalid version format.
    echo         Allowed: letters, digits, dot, underscore, hyphen, plus.
    echo         Length: 1-31, must start with letter or digit.
    pause
    exit /b 1
)

echo.
echo 将把版本号更新为: !NEW_VER!
echo.

:: ---- Confirm (10s default Y) ----
choice /C YN /N /T 3 /D Y /M "确认修改这三个文件？(Y/N，3 秒默认 Y): "
if errorlevel 2 (
    echo 已取消
    pause
    exit /b 0
)
echo.

:: ---- Execute ----
echo 正在更新...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0set-version.ps1" -Version "!NEW_VER!"
set "PS_RC=!errorlevel!"

echo.
if "!PS_RC!"=="0" (
    echo ============================================
    echo   版本号已更新为 !NEW_VER!
    echo ============================================
) else (
    echo [ERROR] Update failed, exit code !PS_RC!
)
echo.
pause
exit /b !PS_RC!