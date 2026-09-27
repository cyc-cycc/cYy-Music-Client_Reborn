# -*- coding: utf-8 -*-
"""cYy Music 后端入口

启动顺序很重要：
1. backend.bootstrap：重定向 musicdl 日志路径、定位 ffmpeg、保存原始 stdout
2. backend.state    ：加载设置
3. console_capture.apply：把 stdout/stderr 重定向到管道（必须在任何 rich/musicdl 导入前）
4. backend.app      ：装配 FastAPI 路由
"""
# 1) bootstrap 副作用（必须在任何 musicdl 导入前）
from backend import bootstrap  # noqa: F401

# 2) 加载设置
from backend import state  # noqa: F401

# 3) 启动控制台捕获（替换 sys.stdout / sys.stderr）
from backend.console_capture import apply as _apply_console_capture
_apply_console_capture()

# 4) 装配 FastAPI
from backend.app import app, run_server  # noqa: E402


if __name__ == "__main__":
    run_server()