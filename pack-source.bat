@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

cd /d "%~dp0"

echo ============================================
echo   cYy Music Client - 源代码打包脚本
echo ============================================

set "detail="
echo.
echo 是否添加备份详情？[Y/N] (5秒无输入默认 N)
choice /C YN /N /T 5 /D N /M "请选择 (Y/N): "
if errorlevel 2 goto :nofeature
if errorlevel 1 (
    set /p "user_detail=请输入备份详情: "
    if defined user_detail (
        set "user_detail=!user_detail:"=!"
        set "user_detail=!user_detail:\=!"
        set "user_detail=!user_detail:/=!"
        set "user_detail=!user_detail::=!"
        set "user_detail=!user_detail:\*=!"
        set "user_detail=!user_detail:?=!"
        set "user_detail=!user_detail:<=!"
        set "user_detail=!user_detail:>=!"
        set "user_detail=!user_detail:|=!"
        set "detail=-!user_detail!"
    )
)
:nofeature

:: ---- 查找 7-Zip ----
set "SEVENZIP="
if exist "C:\Program Files\7-Zip\7z.exe" (
    set "SEVENZIP=C:\Program Files\7-Zip\7z.exe"
) else if exist "C:\Program Files (x86)\7-Zip\7z.exe" (
    set "SEVENZIP=C:\Program Files (x86)\7-Zip\7z.exe"
) else (
    where 7z >nul 2>nul
    if not errorlevel 1 set "SEVENZIP=7z"
)

if not defined SEVENZIP (
    echo [错误] 未找到 7-Zip，请安装或将其添加到 PATH。
    pause
    exit /b 1
)

:: ---- 创建备份目录 ----
if not exist "backup" mkdir "backup"

:: ---- 生成时间戳 ----
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set "timestamp=%datetime:~0,4%-%datetime:~4,2%-%datetime:~6,2%_%datetime:~8,2%-%datetime:~10,2%-%datetime:~12,2%"

set "OUTPUT_NAME=cYy-Music-Client_source_%timestamp%%detail%.7z"
set "OUTPUT_PATH=backup\%OUTPUT_NAME%"

echo.
echo 正在打包源代码为 %OUTPUT_PATH% ...
echo.

:: ---- 创建排除列表文件（每行一个模式） ----
set "EXCLUDE_FILE=%TEMP%\7z_exclude_%RANDOM%.txt"
(
echo node_modules
echo electron_cache
echo .CMC
echo download
echo cover_cache
echo cmcol
echo build
echo dist
echo dist-app
echo __pycache__
echo musicdl_outputs
echo logs
echo *.pyc
echo *.pyo
echo .git
echo .env
echo *.log
echo *.7z
echo backup
) > "%EXCLUDE_FILE%"

:: ---- 执行 7-Zip 打包，使用排除文件 ----
"%SEVENZIP%" a -t7z -mx=9 "%OUTPUT_PATH%" -xr@"%EXCLUDE_FILE%" .

if errorlevel 1 (
    echo [错误] 打包失败。
    del "%EXCLUDE_FILE%" 2>nul
    pause
    exit /b 1
)

del "%EXCLUDE_FILE%" 2>nul

echo.
echo 打包完成：%OUTPUT_PATH%
echo 文件位置：%~dp0%OUTPUT_PATH%
pause > nul