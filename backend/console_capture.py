# -*- coding: utf-8 -*-
"""控制台捕获：把 stdout/stderr 重定向到管道，后台线程消费：
- 写入 logs/backend_stdout.log（1MB 轮转）
- 按 state.settings.show_progress_detail 广播解析后的结构化进度
"""
import os
import re
import sys
import threading

from backend import broadcast as _broadcast
from backend import state
from backend.bootstrap import original_stdout
from constants import LOG_DIR

_LOG_MAX_BYTES = 1024 * 1024

_capture_thread = None
_capture_active = False
_writer = None


class _ImmediateFlushWriter:
    """立即 flush 的流包装：写入捕获管道（供 reader 实时解析），
    同时按需转发到真实控制台。绝不在运行中替换/关闭，因为 rich 会缓存引用。

    对管道写入失败（BrokenPipeError / OSError）做静默处理，避免 reader 线程
    意外退出后所有 stdout 调用崩溃。"""

    def __init__(self, fd, forward_to):
        self._f = os.fdopen(fd, 'w', encoding='utf-8', buffering=1)
        self._forward = forward_to
        self.encoding = 'utf-8'

    def write(self, s):
        try:
            self._f.write(s)
            self._f.flush()
        except (BrokenPipeError, OSError, ValueError):
            pass
        if self._forward is not None:
            try:
                self._forward.write(s)
                self._forward.flush()
            except Exception:
                pass
        return len(s) if s else 0

    def flush(self):
        try:
            self._f.flush()
        except (BrokenPipeError, OSError, ValueError):
            pass
        if self._forward is not None:
            try:
                self._forward.flush()
            except Exception:
                pass

    def isatty(self):
        return False

    def fileno(self):
        return self._f.fileno()


def _get_forward_target():
    try:
        if getattr(sys, 'frozen', False) or original_stdout is None or not original_stdout.isatty():
            return None
        return original_stdout
    except Exception:
        return None


def _rotate_log_file(log_path):
    try:
        if os.path.exists(log_path) and os.path.getsize(log_path) > _LOG_MAX_BYTES:
            backup = log_path + '.1'
            if os.path.exists(backup):
                os.remove(backup)
            os.rename(log_path, backup)
            return True
    except Exception:
        pass
    return False


_ANSI_RE = re.compile(r'\x1b\[[0-9;?]*[a-zA-Z]')


def _handle_console_line(line):
    try:
        # 直接读 settings，避免后台 reader 线程与主线程之间的可见性问题
        if not state.settings.get('show_progress_detail', True):
            return
        line = _ANSI_RE.sub('', line)
        m = re.search(r'(\d+) Songs Found in Playlist \S+ >>> Completed \((\d+)/(\d+)\)', line)
        if m:
            _broadcast.broadcast({'type': 'parse_progress',
                                  'done': int(m.group(2)), 'total': int(m.group(3))})
            return
        m = re.search(r'(\w+MusicClient)\._search >>> Start to process the (\d+)(?:st|nd|rd|th)? search result on page (\d+)', line)
        if m:
            _broadcast.broadcast({'type': 'search_progress', 'source': m.group(1),
                                  'processing': int(m.group(2)), 'page': int(m.group(3))})
    except Exception:
        pass


def _reader_loop(read_fd):
    log_path = os.path.join(LOG_DIR, 'backend_stdout.log')
    line_count = 0
    try:
        with os.fdopen(read_fd, 'r', encoding='utf-8', errors='replace') as f:
            lf = open(log_path, 'a', encoding='utf-8')
            try:
                for line in f:
                    line = line.rstrip('\n').rstrip('\r')
                    lf.write(line + '\n')
                    lf.flush()
                    line_count += 1
                    if line_count % 200 == 0:
                        try:
                            if os.path.getsize(log_path) > _LOG_MAX_BYTES:
                                lf.close()
                                _rotate_log_file(log_path)
                                lf = open(log_path, 'a', encoding='utf-8')
                        except Exception:
                            pass
                    if line:
                        _handle_console_line(line)
            finally:
                try:
                    lf.close()
                except Exception:
                    pass
    except Exception:
        pass


def start():
    """启动捕获基础设施（幂等）。把 stdout/stderr 重定向到管道，后台线程消费。"""
    global _capture_thread, _capture_active, _writer
    if _capture_active:
        return
    try:
        os.environ['TTY_COMPATIBLE'] = '1'
        os.makedirs(LOG_DIR, exist_ok=True)
        read_fd, write_fd = os.pipe()
        os.set_inheritable(write_fd, False)
        _writer = _ImmediateFlushWriter(write_fd, _get_forward_target())
        sys.stdout = _writer
        sys.stderr = sys.stdout
        t = threading.Thread(target=_reader_loop, args=(read_fd,), daemon=True, name='console-capture')
        t.start()
        _capture_thread = t
        _capture_active = True
    except Exception:
        pass


def apply():
    """确保捕获基础设施已启动（幂等）。广播开关在 _handle_console_line 中动态读取。"""
    start()
