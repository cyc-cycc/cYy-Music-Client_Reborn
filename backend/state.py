# -*- coding: utf-8 -*-
"""全局状态：设置、锁、缓存、任务历史、取消标记。本模块无副作用、不导入 musicdl。"""
import os
import tempfile
import threading
import time
from collections import OrderedDict

from cachetools import TTLCache

from config import load_settings
from constants import DATA_DIR, URL_CACHE_TTL, URL_HEAD_CACHE_TTL

# ---------- 设置（可被 update_settings 原地更新） ----------
settings = load_settings()

# ---------- MusicClient 锁 ----------
client_lock = threading.Lock()

# ---------- WebSocket 活跃连接 ----------
active_websockets = []
ws_lock = threading.Lock()

# ---------- 遥控端 WebSocket ----------
remote_websockets = []
remote_ws_lock = threading.Lock()

# ---------- 最新播放状态（遥控端重连时拉取） ----------
latest_player_state = {}
player_state_lock = threading.Lock()

# ---------- 事件循环引用（由 lifespan 设置） ----------
loop = None

# ---------- 下载任务 ----------
download_tasks = {}
download_lock = threading.Lock()
download_slots = threading.BoundedSemaphore(3)
_task_counter_lock = threading.Lock()
task_counter = 0


def next_task_id() -> int:
    global task_counter
    with _task_counter_lock:
        task_counter += 1
        return task_counter


# ---------- 链接刷新缓存（两层） ----------
# url_cache：刷新后的 URL（来源是重新搜索），TTL 较长
# url_head_cache：无签名 URL 的 HEAD 校验结果，TTL 较短，避免过期链接被长期信任
url_cache = TTLCache(maxsize=500, ttl=URL_CACHE_TTL)
url_head_cache = TTLCache(maxsize=500, ttl=URL_HEAD_CACHE_TTL)
url_cache_lock = threading.Lock()


# ---------- 封面缓存目录（放 DATA_DIR 下，失败降级到系统临时目录） ----------
def _init_cover_cache_dir():
    primary = os.path.join(DATA_DIR, 'cover_cache')
    try:
        os.makedirs(primary, exist_ok=True)
        return primary
    except Exception:
        fallback = os.path.join(tempfile.gettempdir(), 'cmc_cover')
        try:
            os.makedirs(fallback, exist_ok=True)
            return fallback
        except Exception:
            return tempfile.gettempdir()


cover_cache_dir = _init_cover_cache_dir()


def cleanup_cover_cache(max_age_seconds: int = 30 * 86400,
                        max_total_bytes: int = 200 * 1024 * 1024) -> None:
    """清理封面磁盘缓存：过期条目（默认 30 天）+ 总量超限时按 mtime 从旧到新删除。
    由 app.py 的 lifespan 在后台触发，失败静默。"""
    try:
        if not os.path.isdir(cover_cache_dir):
            return
        entries = []
        now = time.time()
        for fn in os.listdir(cover_cache_dir):
            p = os.path.join(cover_cache_dir, fn)
            try:
                if not os.path.isfile(p):
                    continue
                st = os.stat(p)
                entries.append([p, st.st_mtime, st.st_size])
            except Exception:
                continue

        # 1) 删除过期
        survivors = []
        for item in entries:
            p, mtime, size = item
            if now - mtime > max_age_seconds:
                try:
                    os.remove(p)
                    continue
                except Exception:
                    pass
            survivors.append(item)

        # 2) 总量超限，按 mtime 从旧到新删除
        total = sum(s for _, _, s in survivors)
        if total > max_total_bytes:
            survivors.sort(key=lambda x: x[1])
            for p, mtime, size in survivors:
                if total <= max_total_bytes:
                    break
                try:
                    os.remove(p)
                    total -= size
                except Exception:
                    pass
    except Exception:
        pass


# ---------- 任务状态历史 ----------
task_status_history = OrderedDict()
task_history_lock = threading.Lock()
MAX_TASK_HISTORY = 500


def record_task_status(task_id: int, song_name: str, percent: int, status: str):
    with task_history_lock:
        task_status_history[task_id] = {
            'song': song_name,
            'percent': int(percent),
            'status': status,
            'updated_at': time.time(),
        }
        try:
            task_status_history.move_to_end(task_id, last=True)
        except Exception:
            pass
        while len(task_status_history) > MAX_TASK_HISTORY:
            try:
                task_status_history.popitem(last=False)
            except Exception:
                break


# ---------- 取消标记（带 TTL，避免长期累积） ----------
CANCEL_TTL = 120
_cancelled_search_ids = {}
_search_cancel_lock = threading.Lock()
_cancelled_parse_ids = {}
_parse_cancel_lock = threading.Lock()


def _mark_cancelled(store, lock, request_id):
    if not request_id:
        return
    now = time.time()
    with lock:
        expired = [k for k, t in store.items() if now - t > CANCEL_TTL]
        for k in expired:
            store.pop(k, None)
        store[request_id] = now


def _is_cancelled(store, lock, request_id):
    if not request_id:
        return False
    with lock:
        return request_id in store


def _clear_cancelled(store, lock, request_id):
    if not request_id:
        return
    with lock:
        store.pop(request_id, None)


def mark_search_cancelled(request_id):
    _mark_cancelled(_cancelled_search_ids, _search_cancel_lock, request_id)


def is_search_cancelled(request_id) -> bool:
    return _is_cancelled(_cancelled_search_ids, _search_cancel_lock, request_id)


def clear_search_cancelled(request_id):
    _clear_cancelled(_cancelled_search_ids, _search_cancel_lock, request_id)


def mark_parse_cancelled(request_id):
    _mark_cancelled(_cancelled_parse_ids, _parse_cancel_lock, request_id)


def is_parse_cancelled(request_id) -> bool:
    return _is_cancelled(_cancelled_parse_ids, _parse_cancel_lock, request_id)


def clear_parse_cancelled(request_id):
    _clear_cancelled(_cancelled_parse_ids, _parse_cancel_lock, request_id)
