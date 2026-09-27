# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包配置（cYy Music 后端）"""
import os
import sys

_IS_WIN = sys.platform == 'win32'
_ICON = 'gui/icon_256.ico' if _IS_WIN else 'gui/icon.icns'

block_cipher = None

# 显式收集 backend 子包（PyInstaller 静态分析通常能自动收集，
# 但显式列出可避免打包后 ImportError）
hiddenimports = [
    # backend 子包及路由
    'backend',
    'backend.bootstrap',
    'backend.state',
    'backend.broadcast',
    'backend.console_capture',
    'backend.models',
    'backend.clients',
    'backend.downloader',
    'backend.app',
    'backend.routes',
    'backend.routes.basic',
    'backend.routes.search',
    'backend.routes.playlist_parse',
    'backend.routes.refresh',
    'backend.routes.cover',
    'backend.routes.playlist_crypto',
    'backend.routes.stream',
    'backend.routes.download',
    'backend.routes.ws',
    'backend.routes.library',
    'backend.routes.diagnostics',
    # 以下 3 个模块之前漏列（B2 修复）
    'backend.routes.library_convert',
    'backend.routes.eq',
    'backend.routes.remote',
    # 后端依赖
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'websockets',
    'websockets.legacy',
    'websockets.legacy.server',
    'curl_cffi',
    'cachetools',
    'cryptography',
    'cryptography.fernet',
    'mutagen',
    'mutagen.id3',
    'mutagen.mp4',
    'mutagen.flac',
    'mutagen.oggvorbis',
    'filetype',
    'pathvalidate',
    'platformdirs',
    'qrcode',
    'qrcode.image.svg',
]

a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('backend', 'backend'),  # 确保 backend 目录作为数据/包一起收集（含 __init__.py）
    ],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # 排除巨大的非必要依赖，显著缩小体积
        'nodejs_wheel',    # 仅 YouTube potoken 用（约 113MB）
        'av',              # 仅部分源视频解码用
        'PIL',             # 仅封面处理内部使用，后端不直接依赖
        'faster_whisper',  # 仅歌词转写用
        'PyQt5', 'PyQt6', 'PySide2', 'PySide6',  # GUI 框架
        'librosa', 'matplotlib', 'scipy',        # 音频分析/绘图
        'tkinter',
        'IPython',
        'pytest',
        'numpy.f2py',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='cyy_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=_IS_WIN,            # macOS：UPX 会破坏代码签名，禁用
    console=False,          # windowed：无控制台窗口（Electron 拉起时不弹出黑窗）
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=_ICON if os.path.exists(_ICON) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='cyy_backend',
)