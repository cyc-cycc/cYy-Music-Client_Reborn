# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包后端（FastAPI + musicdl）。

用法：pyinstaller --noconfirm server.spec
产物：dist/cyy_backend/cyy_backend.exe（onedir，可独立运行，无需目标机安装 Python）

关键点：
- musicdl 使用 importlib 动态导入（curl_cffi 等），PyInstaller 静态分析看不见，需显式 hiddenimports；
- musicdl 包内含非 .py 资源（youtube js、widevine .wvd），必须 collect_all 收集；
- uvicorn/websockets 的 auto 发现子模块需 hiddenimports；
- 排除体积巨大的 nodejs_wheel（仅 YouTube potoken 用，本项目源用不到）、av/PIL/faster_whisper（仅 Tidal/歌词转写用）。
"""
from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = collect_all('musicdl')

hiddenimports += [
    'curl_cffi',                 # musicdl 动态导入（Kuwo 等源需要）
    'uvicorn.logging',
    'uvicorn.loops.auto',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan.on',
    'websockets',
]

a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['nodejs_wheel', 'av', 'PIL', 'faster_whisper', 'tkinter', 'matplotlib', 'PyQt5', 'librosa', 'sounddevice', 'numpy', 'scipy', 'sklearn', 'numba', 'llvmlite'],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='cyy_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,          # 窗口程序：不显示命令行窗口（日志走文件）
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    name='cyy_backend',
)
