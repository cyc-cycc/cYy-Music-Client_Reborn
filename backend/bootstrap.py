# -*- coding: utf-8 -*-
"""最早执行的初始化副作用（必须在任何触发 musicdl/rich 导入的代码之前）：
1. 重定向 musicdl 日志路径（patch platformdirs.user_log_dir）
2. setup_runtime_paths()：定位 ffmpeg 并注入 PATH/环境变量
3. 保存原始 stdout/stderr（供 console_capture 转发到真实控制台）
"""
import os
import sys

from constants import LOG_DIR

# 1) musicdl 日志路径重定向
try:
    import platformdirs as _platformdirs

    def _redirected_user_log_dir(*args, **kwargs):
        return os.path.join(LOG_DIR, 'musicdl')

    _platformdirs.user_log_dir = _redirected_user_log_dir
except Exception:
    pass

# 2) 运行时路径（FFmpeg 等）
from utils import setup_runtime_paths  # noqa: E402
setup_runtime_paths()

# 3) 保存原始 stdout/stderr（此后 console_capture 会替换 sys.stdout）
original_stdout = sys.stdout
original_stderr = sys.stderr