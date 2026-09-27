#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
update_structure.py - 自动生成/更新“项目结构.txt”

用法:
    python update_structure.py
或通过 cmcol 虚拟环境：
    cmcol\\Scripts\\python.exe update_structure.py
"""

import os
import sys
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent

# ---------- 排除规则 ----------
EXCLUDE_DIRS = {
    'node_modules', '.git', '__pycache__', 'cmcol', 'build',
    'dist', 'dist-app', 'backup', '.CMC', 'logs', 'download',
    'musicdl_outputs', 'electron_cache', '.venv', 'venv',
    '.idea', '.vscode', 'cover_cache',
}

EXCLUDE_FILES = {
    '.env', '.DS_Store', 'Thumbs.db', '项目结构.txt',
}

EXCLUDE_EXTS = {
    '.pyc', '.pyo', '.log', '.7z', '.zip', '.rar',
}

# ---------- 已知路径的描述（相对路径用正斜杠） ----------
DESCRIPTIONS = {
    # ==================== 后端入口 ====================
    'server.py': '后端主程序（初始化编排：bootstrap → state → console_capture → app）',
    'constants.py': '常量：搜索源映射、主题、播放模式枚举、路径（支持 CMC_DATA_DIR）',
    'config.py': '设置读写（.CMC/config.json，原子写入）',
    'utils.py': '工具：路径 / 日志 / 文件名 / 封面下载 / 格式转换 / 歌词嵌入',
    'requirements.txt': '后端依赖清单',

    # ==================== 后端包 ====================
    'backend': '后端功能拆分独立',
    'backend/__init__.py': '后端包标识',
    'backend/app.py': 'FastAPI 应用装配 + 启动入口（lifespan 恢复 token / 后台清理封面缓存）',
    'backend/auth.py': '局域网遥控 token 管理：生成 / 校验 / 撤销（默认 8h TTL，线程安全）',
    'backend/bootstrap.py': '最早副作用：musicdl 日志重定向、FFmpeg 定位、保存原始 stdout',
    'backend/broadcast.py': 'WebSocket 线程安全广播（fire-and-forget，主 / 遥控双通道）',
    'backend/clients.py': 'MusicClient / RefreshClient 懒加载、源请求头、链接刷新（双层缓存）',
    'backend/console_capture.py': 'stdout/stderr 捕获 + rich 进度解析广播（后台线程，1MB 轮转）',
    'backend/downloader.py': '下载核心：重试、原子替换、格式转换、歌词 / 封面嵌入',
    'backend/library.py': '本地音乐库：扫描 / 标签读取（编码修正）/ 歌词读取 / 元数据写入',
    'backend/middleware.py': '局域网鉴权中间件（本地放行；非本地需 remote_enabled + 有效 token）',
    'backend/models.py': 'Pydantic 请求模型',
    'backend/state.py': '全局状态：settings / 锁 / URL 缓存 / 任务历史 / 取消标记（带 TTL）',

    # ==================== 后端路由 ====================
    'backend/routes': 'API 路由子包',
    'backend/routes/__init__.py': 'API 路由子包标识',
    'backend/routes/basic.py': '基础 API：健康检查 / 设置读写 / 前端选项',
    'backend/routes/cover.py': '封面代理（磁盘缓存，filetype 推断图片格式）',
    'backend/routes/diagnostics.py': '诊断信息：系统 / 依赖 / 路径 / 运行状态 / 打码配置 / 日志大小',
    'backend/routes/download.py': '下载任务：启动、取消、状态历史查询',
    'backend/routes/eq.py': '均衡器预设：列出 / 导入 / 导出 / 删除（用户自定义 JSON）',
    'backend/routes/library.py': '本地音乐库 API：扫描 / 歌词 / 播放 / 封面 / 重命名 / 标签编辑',
    'backend/routes/library_convert.py': '本地库批量格式转换（ffmpeg，2 线程）',
    'backend/routes/playlist_crypto.py': '歌单加密保存 / 解密加载（Fernet）',
    'backend/routes/playlist_parse.py': '歌单解析（平台链接 → 歌曲列表，支持取消）',
    'backend/routes/refresh.py': '下载 / 播放链接刷新',
    'backend/routes/remote.py': '手机遥控：内联页面 + 遥控 WS + 播放状态上报 + token 管理',
    'backend/routes/search.py': '多源并行搜索（支持取消、可选去重）',
    'backend/routes/stream.py': '流式播放：无损直传代理 / ffmpeg 转码 mp3',
    'backend/routes/ws.py': '主 WebSocket：接收取消指令 + 广播通道',

    # ==================== 打包 / 文档 / 脚本 ====================
    'server.spec': 'PyInstaller 配置（windowed、collect-all musicdl、排除 nodejs_wheel 等）',
    'BUILD.md': '完整打包指南',
    'README.md': '项目说明文档',
    'ffmpeg.exe': '流播放 / 转码依赖',
    'env_setup.bat': '环境搭建脚本（创建 cmcol venv + 安装前后端依赖）',
    'run.bat': '开发模式启动 Electron（自动拉起本地 Python 后端）',
    'build.bat': '编译打包脚本（NSIS / Portable / 仅后端 / 组合）',
    'pack-source.bat': '源代码打包脚本（含备份详情输入）',
    'update-structure.bat': '调用本脚本的包装器',
    'update_structure.py': '本脚本',

    'set-version.bat': '版本编辑交互',
    'set-version.ps1': '版本编辑脚本',

    # ==================== Electron 前端 ====================
    'frontend': 'Electron 前端',
    'frontend/main.js': 'Electron 主进程：拉起后端、动态端口、数据目录定位、崩溃重启、迷你 / 桌面歌词窗口',
    'frontend/index.html': '界面结构（SVG 图标精灵 / 设置 Tab / 均衡器弹窗 / 可视化 / 全屏歌词）',
    'frontend/style.css': '黑白·天蓝极简主题（CSS 变量 + color-mix 动态主色）',
    'frontend/renderer.js': '渲染进程入口（仅负责启动：WS / 频谱 / initApp）',  # [修正] 批次 0 拆分后仅剩启动逻辑
    'frontend/package.json': 'electron-builder 打包配置',
    'frontend/package-lock.json': 'npm 依赖锁定文件',
    'frontend/mini.html': '迷你播放器窗口（封面 / 进度 / 控制 / 桌面歌词按钮）',
    'frontend/mini-renderer.js': '迷你播放器渲染进程',
    'frontend/desktop-lyric.html': '桌面歌词窗口（透明背景 + 拖动）',
    'frontend/desktop-lyric-renderer.js': '桌面歌词渲染进程',

    # ==================== 前端渲染逻辑（js/） ====================
    'frontend/js': '渲染逻辑模块（批次 0 拆分）',
    'frontend/js/core.js': '核心：API/WS 地址（--cmc-api-port）、DOM 引用、state、工具、API 封装',
    'frontend/js/lrc.js': 'LRC 歌词解析（共享模块，被 player / 桌面歌词复用）',
    'frontend/js/cover-gen.js': '智能封面生成（FNV-1a 哈希渐变，LRU 缓存 300）',
    'frontend/js/theme.js': '主题、调色板、设置表单渲染',
    'frontend/js/ui.js': '弹窗、窗口控制、导航、通用右键菜单、迷你播放器按钮',
    'frontend/js/selection.js': '通用列表多选控制器（单击 / 拖拽 / Ctrl / Shift / 双击 + 选择栏滚动补偿）',
    'frontend/js/player.js': '歌词同步与播放控制、状态节流上报、遥控 / IPC 动作分派',
    'frontend/js/browse.js': '搜索、歌单解析、在线 / 本地播放列表、M3U 导入导出',
    'frontend/js/download.js': '下载管理 + WebSocket（对账、节流上报）',
    'frontend/js/full-lyrics.js': '全屏歌词覆盖层（封面模糊背景 + 居中滚动）',
    'frontend/js/eq-viz.js': '均衡器（10 段 + 人声消除）、频谱、三种可视化、自定义预设管理',
    'frontend/js/sleep-timer.js': '睡眠定时器（预设 + 自定义分钟数）',
    'frontend/js/shortcuts.js': '全局键盘快捷键（空格 / 方向键 / F / L / V / M / Esc）',
    'frontend/js/settings.js': '设置表单事件、应用初始化、诊断面板、手机遥控 UI',
    'frontend/js/library.js': '聆听本地：扫描 / 排序 / 筛选 / 多选 / 重命名 / 标签 / 回收站 / 批量转换',

    'frontend/effects.js': '视觉增强层交互逻辑（涟漪 / 入场错峰 / 视差 / 标题跑马灯）',
    'frontend/enhanced.css': '视觉增强层样式（玻璃拟态 / 微交互 / 动态主色 / 视差 / logo）',
    'frontend/js/dynamic-theme.js': '封面驱动动态主题（封面取主色，可开关，停止播放回落设置色）',

    # ==================== GUI 资源 ====================
    'gui': '原版 PyQt GUI 资源（已弃用并清理）',
    'gui/icon.ico': '应用图标',
    'gui/icon.icns': 'macOS 应用图标',
    'gui/icon_256.ico': '打包用 256px 图标',
}

# ---------- 工具函数 ----------

def should_exclude(path: Path) -> bool:
    name = path.name
    if path.is_dir() and name in EXCLUDE_DIRS:
        return True
    if path.is_file():
        if name in EXCLUDE_FILES:
            return True
        if path.suffix.lower() in EXCLUDE_EXTS:
            return True
    return False


def compute_sizes(root: Path) -> dict:
    """后序遍历，计算每个目录的总字节数（跳过排除项）"""
    sizes = {}
    for dirpath, dirnames, filenames in os.walk(root, topdown=False):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        total = 0
        for f in filenames:
            fp = Path(dirpath) / f
            if should_exclude(fp):
                continue
            try:
                total += fp.stat().st_size
            except OSError:
                pass
        for d in dirnames:
            dp = str(Path(dirpath) / d)
            if dp in sizes:
                total += sizes[dp]
        sizes[dirpath] = total
    return sizes


def format_size(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    if n < 1024 ** 3:
        return f"{n / 1024 / 1024:.1f} MB"
    return f"{n / 1024 ** 3:.2f} GB"


def collect_all_relpaths(root: Path) -> list:
    """收集所有（未被排除的）文件与目录的相对路径，正斜杠分隔，已排序"""
    paths = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        base = Path(dirpath)
        for d in dirnames:
            dp = base / d
            rel = dp.relative_to(root).as_posix()
            paths.append(rel)
        for f in filenames:
            fp = base / f
            if should_exclude(fp):
                continue
            rel = fp.relative_to(root).as_posix()
            paths.append(rel)
    paths.sort()
    return paths


# ---------- 主逻辑 ----------

def main():
    sizes = compute_sizes(ROOT)

    lines = []
    lines.append("cYy Music Client - 项目结构")
    lines.append("=" * 60)
    lines.append(f"自动生成: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"项目根目录: {ROOT}")
    lines.append("")

    def render(dir_path: Path, rel: str, prefix: str = ""):
        try:
            items = sorted(dir_path.iterdir(),
                           key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError:
            return
        items = [it for it in items if not should_exclude(it)]

        for i, item in enumerate(items):
            last = (i == len(items) - 1)
            connector = "└─ " if last else "├─ "
            new_prefix = prefix + ("   " if last else "│  ")

            item_rel = f"{rel}/{item.name}" if rel else item.name
            desc = DESCRIPTIONS.get(item_rel, "")
            desc_str = f"  ← {desc}" if desc else ""

            if item.is_dir():
                size = sizes.get(str(item), 0)
                size_str = f"  [{format_size(size)}]" if size else ""
                lines.append(f"{prefix}{connector}{item.name}\\{size_str}{desc_str}")
                render(item, item_rel, new_prefix)
            else:
                try:
                    size = item.stat().st_size
                except OSError:
                    size = 0
                size_str = f"  [{format_size(size)}]" if size else ""
                lines.append(f"{prefix}{connector}{item.name}{size_str}{desc_str}")

    render(ROOT, "")

    out = ROOT / "项目结构.txt"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"已更新: {out}")
    print(f"共 {len(lines)} 行")

    # ---------- 打印未指定描述的文件/文件夹 ----------
    all_paths = collect_all_relpaths(ROOT)
    missing = [p for p in all_paths if p not in DESCRIPTIONS]

    print()
    if not missing:
        print("所有文件/文件夹均已指定描述 ✔")
    else:
        print(f"=========== 以下 {len(missing)} 项未指定描述 ===========")
        print("# 可直接复制到 DESCRIPTIONS 字典中，补全右侧描述")
        print()
        for p in missing:
            # 若路径含空格或特殊字符，仍用单引号包裹，可直接粘贴
            print(f"    '{p}': '',")
        print()
        print("=====================================================")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)
