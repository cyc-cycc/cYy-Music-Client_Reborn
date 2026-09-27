# -*- coding: utf-8 -*-
"""诊断信息：系统 / 依赖 / 路径 / 运行状态 / 打码配置 / 日志大小"""
import os
import platform
import shutil
import sys
import time

from fastapi import APIRouter

from constants import DATA_DIR, LOG_DIR
from backend import state

router = APIRouter()

_START_TIME = time.time()
_SENSITIVE_KEYS = {'cookie', 'cookies', 'password', 'token', 'secret'}
_MASK = '***'


def _mask(key, value):
    k = str(key).lower()
    if any(s in k for s in _SENSITIVE_KEYS):
        return _MASK
    if isinstance(value, dict):
        return {kk: _mask(kk, vv) for kk, vv in value.items()}
    if isinstance(value, list):
        return [_mask(key, v) for v in value]
    return value


def _size(p):
    try:
        return os.path.getsize(p)
    except Exception:
        return None


@router.get("/diagnostics")
def diagnostics():
    try:
        import musicdl
        musicdl_version = getattr(musicdl, '__version__', 'unknown')
    except Exception as e:
        musicdl_version = f'import failed: {e}'

    ffmpeg_path = shutil.which('ffmpeg')

    log_files = {}
    for name in ('CMC.log', 'CMC.log.1', 'backend_stdout.log', 'backend_stdout.log.1'):
        p = os.path.join(LOG_DIR, name)
        if os.path.exists(p):
            log_files[name] = _size(p)
    musicdl_log_dir = os.path.join(LOG_DIR, 'musicdl')
    if os.path.isdir(musicdl_log_dir):
        try:
            for fn in os.listdir(musicdl_log_dir):
                p = os.path.join(musicdl_log_dir, fn)
                if os.path.isfile(p):
                    log_files[f'musicdl/{fn}'] = _size(p)
        except Exception:
            pass

    return {
        'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
        'python': {
            'version': sys.version,
            'executable': sys.executable,
            'frozen': bool(getattr(sys, 'frozen', False)),
        },
        'platform': {
            'system': platform.system(),
            'release': platform.release(),
            'machine': platform.machine(),
            'processor': platform.processor(),
        },
        'paths': {
            'data_dir': DATA_DIR,
            'log_dir': LOG_DIR,
            'cover_cache_dir': state.cover_cache_dir,
        },
        'dependencies': {
            'musicdl': musicdl_version,
            'ffmpeg': ffmpeg_path or '(not found)',
        },
        'runtime': {
            'uptime_seconds': int(time.time() - _START_TIME),
            'active_websockets': len(state.active_websockets),
            'download_tasks': len(state.download_tasks),
            'task_history': len(state.task_status_history),
        },
        'settings': _mask('settings', dict(state.settings)),
        'logs': log_files,
    }