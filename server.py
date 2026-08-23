# -*- coding: utf-8 -*-
"""cYy Music 后端服务（FastAPI）

功能对齐纯 PyQt 原版：
- 搜索 / 歌单解析 / 链接刷新
- 下载：携带源请求头/Cookie、重试、并发上限、歌词/封面/嵌入、进度广播（WebSocket 线程安全）
- 封面代理（含磁盘缓存）
- 设置读写 + 前端选项接口（下拉列表数据由后端下发，前端不硬编码）
- 歌单加密保存 / 解密加载（与原版 Fernet 方案一致）
- 流式播放：ffmpeg 转 mp3，自动携带源 Referer/headers，不阻塞事件循环
"""
import os
import re
import sys
import json
import asyncio
import base64
import hashlib
import threading
import time
from typing import List, Optional, Dict
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
import uvicorn
import subprocess as sp
import requests
from cachetools import TTLCache

# 先导入 constants（不触发 musicdl），以便重定向 musicdl 日志路径
from constants import (
    SOURCE_INTERNAL, PLAYLIST_SOURCE_MAP, DEFAULT_SAVE_DIR,
    SOURCE_GROUPS, FILENAME_FORMATS, GROUP_BY_OPTIONS, THEMES,
    ENCRYPTION_PASSWORD, REFRESH_SEARCH_SIZE, LOG_DIR, DATA_DIR,
)

# ---------- musicdl 日志重定向（必须在任何触发 musicdl 导入之前生效） ----------
# musicdl 的 LoggerHandle 在类定义时就创建 FileHandler 写入
# %LOCALAPPDATA%\zcjin\musicdl\Logs\musicdl.log；受限环境/便携部署可能不可写。
# 统一重定向到应用 logs 目录。
try:
    import platformdirs as _platformdirs

    def _redirected_user_log_dir(*args, **kwargs):
        return os.path.join(LOG_DIR, 'musicdl')

    _platformdirs.user_log_dir = _redirected_user_log_dir
except Exception:
    pass

# ---------- 控制台捕获（必须在 musicdl/rich 导入之前） ----------
# 打包后被 GUI 进程（Electron）拉起时，进程没有真实控制台：stdout 句柄对 rich 的
# Windows 控制台渲染（legacy_windows_render → colorama → os.write）无效，
# musicdl 搜索结束时的 Progress.__exit__ 会抛 OSError [Errno 22]。
# 统一把 stdout/stderr 重定向到管道：后台线程读取，写入日志文件，
# 同时解析 musicdl 的进度输出（搜索/解析歌单）并通过 WebSocket 广播给前端 UI。
# rich 在非 TTY 下用 \r（不换行）刷新进度帧，行缓冲下没有 \n 不会 flush，
# 导致进度积压到搜索结束才一次性输出。用「每次 write 立即 flush」的包装流，
# 让 rich 每帧实时进入管道，reader 以 universal newlines 按 \r 拆行 → 前端实时显示。
# 控制台捕获状态（须在 _apply_console_capture 首次调用前声明）
_console_capture_thread = None
_console_capture_active = False
_console_writer = None
_console_broadcast_enabled = False   # show_progress_detail 开关：是否向前端广播进度

class _ImmediateFlushWriter:
    """立即 flush 的流包装：写入捕获管道（供 reader 实时解析广播），
    同时转发到真实控制台/日志文件（关闭详细进度时控制台输出照常可见）。
    注意：musicdl 会缓存 rich Console 对 stdout 的引用，因此捕获基础设施常驻，
    绝不在运行中替换 sys.stdout 或关闭本 writer，否则缓存引用会写已关闭的流。"""

    def __init__(self, fd, forward_to):
        self._f = os.fdopen(fd, 'w', encoding='utf-8', buffering=1)
        self._forward = forward_to
        self.encoding = 'utf-8'

    def write(self, s):
        self._f.write(s)
        self._f.flush()
        if self._forward is not None:
            try:
                self._forward.write(s)
                self._forward.flush()
            except Exception:
                pass
        return len(s)

    def flush(self):
        self._f.flush()
        if self._forward is not None:
            try:
                self._forward.flush()
            except Exception:
                pass

    def isatty(self):
        return False

    def fileno(self):
        return self._f.fileno()

def _get_console_forward_target():
    """rich 输出的转发目标：真实控制台（tty）或 None。
    无控制台环境不转发（reader 已把捕获内容写入 backend_stdout.log，
    再转发同一文件会造成内容重复与轮转冲突）。"""
    try:
        if getattr(sys, 'frozen', False) or _original_stdout is None or not _original_stdout.isatty():
            return None
        return _original_stdout
    except Exception:
        return None

_LOG_MAX_BYTES = 1024 * 1024   # 日志大小上限（1MB）

def _rotate_log_file(log_path):
    """日志超过上限时轮转：旧文件保留为 .1（覆盖），继续写新文件；返回是否轮转"""
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

def _start_console_capture():
    """把 stdout/stderr 重定向到管道（常驻，不随设置开关而停止），
    后台线程消费：写日志 + 按开关广播格式化进度"""
    global _console_capture_thread, _console_capture_active, _console_writer
    if _console_capture_active:
        return
    try:
        # rich 对非终端默认只在 Progress 退出时输出最终帧（不实时）。
        # 设置 TTY_COMPATIBLE=1 让 rich 走终端逐帧渲染路径，配合立即 flush
        # 包装流 + reader 按 \r 拆行，实现进度实时到达前端。
        os.environ['TTY_COMPATIBLE'] = '1'
        os.makedirs(LOG_DIR, exist_ok=True)
        read_fd, write_fd = os.pipe()
        os.set_inheritable(write_fd, False)
        _console_writer = _ImmediateFlushWriter(write_fd, _get_console_forward_target())
        sys.stdout = _console_writer
        sys.stderr = sys.stdout
        t = threading.Thread(target=_console_reader_loop, args=(read_fd,), daemon=True, name='console-capture')
        t.start()
        _console_capture_thread = t
        _console_capture_active = True
    except Exception:
        pass

def _apply_console_capture():
    """按设置控制是否向前端广播详细进度（基础设施常驻，仅切换广播开关）"""
    global _console_broadcast_enabled
    _start_console_capture()
    _console_broadcast_enabled = _settings.get('show_progress_detail', True)

def _console_reader_loop(read_fd):
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
                        # 超过上限：先关闭自身句柄（Windows 上改名需文件未被占用），轮转后重开
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

_ANSI_RE = re.compile(r'\x1b\[[0-9;?]*[a-zA-Z]')

def _clean_console_line(line):
    """清理 rich 输出的控制字符：ANSI 转义序列、\r、尾部空白"""
    line = _ANSI_RE.sub('', line)
    line = line.replace('\r', '')
    return line.rstrip()

def _handle_console_line(line):
    """解析 rich 实时帧（TTY 模式下逐帧到达），提取搜索/解析进度并广播格式化消息；
    不做原始行转发（前端按结构化消息格式化显示）。关闭详细进度时不广播。"""
    try:
        if not _console_broadcast_enabled:
            return
        if line.startswith(('INFO:', 'WARNING:', 'ERROR:')):
            return
        line = _ANSI_RE.sub('', line)   # 剥掉 ANSI 控制码（TTY 帧含 \x1b[2K 等）
        # 歌单解析：Completed (N/M) SongInfo → 共 X 首/第 Y 首
        m = re.search(r'(\d+) Songs Found in Playlist \S+ >>> Completed \((\d+)/(\d+)\)', line)
        if m:
            broadcast({'type': 'parse_progress', 'done': int(m.group(2)), 'total': int(m.group(3))})
            return
        # 搜索：正在处理第 N 个结果（实时进度；页完成信息冗余不广播）
        m = re.search(r'(\w+MusicClient)\._search >>> Start to process the (\d+)(?:st|nd|rd|th)? search result on page (\d+)', line)
        if m:
            broadcast({'type': 'search_progress', 'source': m.group(1),
                       'processing': int(m.group(2)), 'page': int(m.group(3))})
    except Exception:
        pass

# 导入现有核心模块
from config import load_settings, save_settings
from utils import (
    logger, setup_runtime_paths, build_filename, get_group_subdir,
    sanitize_filepath, convert_audio, atomic_write,
    _download_image_data, download_cover_image, get_cover_url,
    embed_lyrics,
)

setup_runtime_paths()

# ---------- 设置加载与控制台捕获开关（须在 musicdl 首次使用前） ----------
_settings = load_settings()
_original_stdout = sys.stdout
_original_stderr = sys.stderr
_apply_console_capture()

# ---------- 数据模型 ----------
class SearchRequest(BaseModel):
    keyword: str
    sources: Optional[List[str]] = None
    request_id: Optional[str] = None    # 搜索任务 ID（前端点击停止时用于取消）

class CancelRequest(BaseModel):
    request_id: str

class ParsePlaylistRequest(BaseModel):
    url: str
    source_display: str
    request_id: Optional[str] = None    # 解析任务 ID（点击停止时用于取消）

class DownloadRequest(BaseModel):
    songs: List[dict]
    save_dir: Optional[str] = None

class RefreshRequest(BaseModel):
    songs: List[dict]

class PlaylistEncryptRequest(BaseModel):
    songs: List[dict]

class PlaylistDecryptRequest(BaseModel):
    content: str

# ---------- FastAPI 初始化 ----------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """记录事件循环引用，供工作线程做线程安全的 WS 发送"""
    global _loop
    _loop = asyncio.get_running_loop()
    yield

app = FastAPI(title="cYy Music API", version="2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- 全局变量 ----------
_loop = None
_music_client = None
_refresh_client = None          # 独立刷新客户端（2 条/源，与原版 RefreshClient 一致）
_client_lock = threading.Lock() # 保护 MusicClient 的创建/重置（并行搜索 + 设置切换并发时避免竞态）
active_websockets = []          # 所有活跃 WS 连接（广播下载进度）
download_tasks = {}             # task_id -> {'stop': threading.Event}
download_lock = threading.Lock()
_download_slots = threading.BoundedSemaphore(3)   # 并发下载上限（与原版 3 一致）
task_counter = 0
_url_cache = TTLCache(maxsize=500, ttl=300)       # 链接刷新缓存
_cover_cache_dir = os.path.join(os.path.expanduser("~"), ".cache", "cmc_cover")
os.makedirs(_cover_cache_dir, exist_ok=True)
task_status_history = {}                          # task_id -> {'song', 'percent', 'status'}（供前端轮询对账）
task_history_lock = threading.Lock()
_MAX_TASK_HISTORY = 500
# 搜索取消标记：request_id -> 已取消（点击停止后主流程提前返回，不等待未完成源）
_cancelled_search_ids = set()
_search_cancel_lock = threading.Lock()
# 歌单解析取消标记（解析是单次阻塞调用，取消后结果丢弃）
_cancelled_parse_ids = set()
_parse_cancel_lock = threading.Lock()

# ---------- 懒加载 MusicClient ----------
def get_music_client():
    global _music_client
    if _music_client is not None:
        return _music_client
    with _client_lock:
        if _music_client is not None:
            return _music_client
        selected_display = _settings.get('sources', [])
        selected_sources = [SOURCE_INTERNAL.get(d) for d in selected_display if SOURCE_INTERNAL.get(d)]
        if not selected_sources:
            raise RuntimeError("请在设置中启用至少一个搜索源")
        init_cfg = {}
        for src in selected_sources:
            init_cfg[src] = {
                'search_size_per_source': _settings.get('limit', 10),
                'maintain_session': True,
                'disable_print': True,
                'work_dir': os.path.join(DATA_DIR, 'musicdl_outputs'),
            }
        try:
            from musicdl import musicdl
            client = musicdl.MusicClient(
                music_sources=selected_sources,
                init_music_clients_cfg=init_cfg,
                clients_threadings={src: 5 for src in selected_sources}
            )
            _music_client = client
            logger.info(f"API 服务已初始化 MusicClient，源: {selected_sources}")
            return client
        except Exception as e:
            logger.error(f"初始化 MusicClient 失败: {e}")
            raise RuntimeError(f"初始化失败: {e}")

# ---------- 独立刷新客户端（search_size_per_source=REFRESH_SEARCH_SIZE，线程数少） ----------
def get_refresh_client():
    """链接刷新专用 MusicClient：每源仅搜索 REFRESH_SEARCH_SIZE 条，速度更快"""
    global _refresh_client
    if _refresh_client is not None:
        return _refresh_client
    with _client_lock:
        if _refresh_client is not None:
            return _refresh_client
        selected_display = _settings.get('sources', [])
        selected_sources = [SOURCE_INTERNAL.get(d) for d in selected_display if SOURCE_INTERNAL.get(d)]
        if not selected_sources:
            return None
        init_cfg = {}
        for src in selected_sources:
            init_cfg[src] = {
                'search_size_per_source': REFRESH_SEARCH_SIZE,
                'maintain_session': True,
                'disable_print': True,
                'work_dir': os.path.join(DATA_DIR, 'musicdl_outputs'),
            }
        try:
            from musicdl import musicdl
            client = musicdl.MusicClient(
                music_sources=selected_sources,
                init_music_clients_cfg=init_cfg,
                clients_threadings={src: 2 for src in selected_sources}
            )
            _refresh_client = client
            logger.info(f"RefreshClient 初始化成功，源: {selected_sources}（每源 {REFRESH_SEARCH_SIZE} 条）")
            return client
        except Exception as e:
            logger.error(f"RefreshClient 初始化失败: {e}")
            return None

# ---------- 源请求头/Cookie（与原版 PlaybackMixin._get_request_kwargs_for_source 一致） ----------
def get_request_kwargs_for_source(source: str) -> dict:
    kwargs = {
        'headers': {},
        'cookies': {},
        'proxies': {},
        'timeout': 30,
        'verify': True,
    }
    try:
        client = get_music_client()
    except Exception:
        return kwargs
    src_client = client.music_clients.get(source) if client else None
    if not src_client:
        return kwargs
    for attr in ('default_download_headers', 'default_headers', 'default_search_headers', 'default_parse_headers'):
        v = getattr(src_client, attr, None)
        if v:
            kwargs['headers'].update(v)
    for attr in ('default_download_cookies', 'default_cookies', 'default_search_cookies', 'default_parse_cookies'):
        v = getattr(src_client, attr, None)
        if v:
            kwargs['cookies'].update(v)
    return kwargs

# ---------- 链接刷新（与原版 RefreshMixin.refresh_song_url 等价，增强：无 identifier 也按关键词搜索） ----------
def _refresh_search(source: str, keyword: str, identifier: str = None):
    """在指定源中搜索并返回匹配歌曲；优先 identifier 精确匹配，否则取第一条"""
    client = get_refresh_client() or get_music_client()
    src_client = client.music_clients.get(source) if client else None
    if not src_client:
        logger.warning(f"刷新客户端中无源 {source}，跳过刷新")
        return None
    try:
        results = src_client.search(keyword, num_threadings=1)
    except Exception as e:
        logger.error(f"刷新搜索失败: {e}")
        return None
    if not results:
        return None
    if identifier:
        for item in results[:REFRESH_SEARCH_SIZE]:
            if isinstance(item, dict) and item.get('identifier') == identifier:
                return item
    return results[0] if results else None

def refresh_song_url(song_info: Dict) -> Optional[Dict]:
    identifier = song_info.get('identifier') or song_info.get('song_id')

    cache_key = identifier or f"{song_info.get('source')}|{song_info.get('singers', '')}|{song_info.get('song_name', '')}"
    with download_lock:
        cached_url = _url_cache.get(cache_key)
        if cached_url is not None:
            if cached_url != song_info.get('download_url'):
                song_info['download_url'] = cached_url
                logger.debug(f"使用缓存的链接: {cache_key}")
            return song_info

    url = song_info.get('download_url', '')
    if url and 'expires' not in url and 'sign' not in url:
        try:
            head_resp = requests.head(url, timeout=5, allow_redirects=True)
            if head_resp.status_code < 400:
                _url_cache[cache_key] = url
                return song_info
        except Exception:
            pass

    source = song_info.get('source')
    if not source:
        logger.warning(f"缺少 source，无法刷新: {song_info.get('song_name', '')}")
        return None

    keyword = f"{song_info.get('singers', '')} {song_info.get('song_name', '')}".strip()
    if not keyword:
        logger.warning(f"无关键词，无法刷新: {song_info.get('song_name', '')}")
        return None

    matched = _refresh_search(source, keyword, identifier)
    if not matched:
        logger.warning(f"刷新搜索没有返回结果: {song_info.get('song_name', '')}")
        return None

    new_url = matched.get('download_url') or matched.get('url')
    if not new_url:
        return None

    song_info['download_url'] = new_url
    for key in ('cover_url', 'duration', 'duration_s', 'lyric', 'ext', 'identifier'):
        if matched.get(key):
            song_info[key] = matched[key]
    if 'identifier' not in song_info and matched.get('song_id'):
        song_info['identifier'] = matched['song_id']

    _url_cache[cache_key] = new_url
    logger.info(f"链接刷新成功: {song_info.get('song_name', '')} -> {source}")
    return song_info

# ---------- WebSocket 线程安全发送 ----------
def _consume_ws_fut(fut):
    """消费 run_coroutine_threadsafe 的 Future：避免未观察异常告警"""
    try:
        if not fut.cancelled():
            fut.exception()
    except Exception:
        pass

def ws_send(ws: WebSocket, payload: dict):
    """工作线程 → 事件循环的线程安全发送（非阻塞 fire-and-forget）。
    进度类消息允许丢弃（下载进度前端还有 /tasks 轮询兜底）；
    绝不在工作线程内阻塞等待，否则控制台捕获线程会卡死导致 musicdl 进度写入管道阻塞、搜索挂起。"""
    if _loop is None:
        return
    try:
        fut = asyncio.run_coroutine_threadsafe(
            ws.send_text(json.dumps(payload, ensure_ascii=False)), _loop)
        fut.add_done_callback(_consume_ws_fut)
    except Exception:
        pass

def broadcast(payload: dict):
    for ws in list(active_websockets):
        ws_send(ws, payload)

def record_task_status(task_id: int, song_name: str, percent: int, status: str):
    """记录任务状态历史（供前端 WS 断开后轮询对账）"""
    with task_history_lock:
        task_status_history[task_id] = {
            'song': song_name, 'percent': int(percent), 'status': status,
        }
        # 超过上限时清理最旧的
        while len(task_status_history) > _MAX_TASK_HISTORY:
            task_status_history.pop(min(task_status_history), None)

# ---------- 基础 API ----------
@app.get("/")
def root():
    return {"message": "cYy Music API is running", "status": "ok"}

@app.get("/settings")
def get_settings():
    return _settings

@app.post("/settings")
def update_settings(settings: dict):
    global _settings, _music_client, _refresh_client
    with _client_lock:
        _settings.update(settings)
        save_settings(_settings)
        _music_client = None      # 重置客户端（下次使用自动重建）
        _refresh_client = None
    _apply_console_capture()      # 依据 show_progress_detail 切换控制台捕获
    return {"message": "Settings updated"}

@app.get("/settings/options")
def get_settings_options():
    """前端选项数据（下拉列表等），避免前端硬编码"""
    return {
        'source_groups': SOURCE_GROUPS,
        'filename_formats': FILENAME_FORMATS,
        'group_by_options': GROUP_BY_OPTIONS,
        'playlist_sources': list(PLAYLIST_SOURCE_MAP.keys()),
        'playlist_source_map': PLAYLIST_SOURCE_MAP,
        'themes': {k: v['display_name'] for k, v in THEMES.items()},
        'default_save_dir': DEFAULT_SAVE_DIR,
    }

def _is_search_cancelled(request_id: Optional[str]) -> bool:
    if not request_id:
        return False
    with _search_cancel_lock:
        return request_id in _cancelled_search_ids

def _search_source(client, src: str, keyword: str) -> List[dict]:
    """在单个源中搜索并格式化结果（在工作线程中执行）"""
    src_client = client.music_clients[src]
    items = src_client.search(keyword=keyword, num_threadings=2)
    out = []
    for item in items:
        if not isinstance(item, dict):
            item = {k: getattr(item, k, '') for k in ['song_name', 'singers', 'album', 'ext',
                                                      'duration', 'duration_s', 'cover_url', 'lyric',
                                                      'download_url', 'identifier', 'file_size', 'file_size_bytes']}
        item['source'] = src
        out.append(item)
    return out

@app.post("/search", response_model=List[dict])
async def search_songs(req: SearchRequest):
    """多源并行搜索（无超时，时长由用户配置的每源条数决定）；
    request_id 用于点击「停止搜索」后立即提前返回（不等待未完成源）"""
    try:
        client = get_music_client()
        sources = list(client.music_clients.keys())
        results = []
        if not sources:
            return results

        # 每个源一个并行任务（asyncio.to_thread → 默认线程池）
        tasks = [asyncio.create_task(asyncio.to_thread(_search_source, client, src, req.keyword))
                 for src in sources]
        pending = set(tasks)
        try:
            while pending:
                # 被停止：立即放弃剩余源，返回已收集的结果
                if _is_search_cancelled(req.request_id):
                    break
                # 收集已完成源；每 5s 醒来一次检查取消（取消不等待任何源）
                done, pending = await asyncio.wait(pending, timeout=5, return_when=asyncio.FIRST_COMPLETED)
                for t in done:
                    try:
                        items = t.result()
                        results.extend(items)
                    except Exception as e:
                        logger.exception(f"搜索源任务失败: {e}")
        finally:
            # 停止/异常时取消未完成任务（底层线程继续跑完，结果丢弃，不阻塞返回）
            for t in pending:
                t.cancel()

        # 去重（按 歌曲名+歌手，保留第一个来源）
        if _settings.get('dedup'):
            seen = set()
            deduped = []
            for r in results:
                key = (str(r.get('song_name', '')), str(r.get('singers', '')))
                if key in seen:
                    continue
                seen.add(key)
                deduped.append(r)
            results = deduped
        return results[:50]
    except Exception as e:
        logger.exception("搜索失败")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if req.request_id:
            with _search_cancel_lock:
                _cancelled_search_ids.discard(req.request_id)

@app.post("/search/cancel")
def cancel_search(req: CancelRequest):
    """标记搜索任务已取消（主流程提前返回；正在执行的源线程自然结束后丢弃结果）"""
    with _search_cancel_lock:
        _cancelled_search_ids.add(req.request_id)
    logger.info(f"搜索任务 {req.request_id} 已标记取消")
    return {"ok": True}

def _is_parse_cancelled(request_id: Optional[str]) -> bool:
    if not request_id:
        return False
    with _parse_cancel_lock:
        return request_id in _cancelled_parse_ids

@app.post("/parse_playlist")
def parse_playlist(req: ParsePlaylistRequest):
    try:
        client = get_music_client()
        source_internal = PLAYLIST_SOURCE_MAP.get(req.source_display)
        if not source_internal:
            raise HTTPException(status_code=400, detail="不支持的平台")
        src_client = client.music_clients.get(source_internal)
        if not src_client:
            # 与原版 _add_source_temp 一致：未启用的源自动加入设置并重建客户端
            display = next((k for k, v in SOURCE_INTERNAL.items() if v == source_internal), req.source_display)
            with _client_lock:
                if display not in _settings.get('sources', []):
                    _settings['sources'].append(display)
                    save_settings(_settings)
                global _music_client
                _music_client = None
            client = get_music_client()
            src_client = client.music_clients.get(source_internal)
            if not src_client:
                raise HTTPException(status_code=400, detail=f"当前未启用 {req.source_display}")
        song_infos = src_client.parseplaylist(req.url)
        # 解析是单次阻塞调用，无法中途打断；停止后丢弃结果
        if _is_parse_cancelled(req.request_id):
            logger.info(f"歌单解析 {req.request_id} 已停止，结果丢弃")
            return {"message": "解析已停止", "songs": [], "cancelled": True}
        if not song_infos:
            return {"message": "解析成功，但未获取到歌曲", "songs": []}
        formatted = []
        for info in song_infos:
            if not isinstance(info, dict):
                info = {k: getattr(info, k, '') for k in ['song_name', 'singers', 'album', 'ext',
                                                          'duration', 'duration_s', 'cover_url', 'lyric',
                                                          'download_url', 'identifier', 'file_size', 'file_size_bytes']}
            info['source'] = source_internal
            if 'identifier' not in info and 'song_id' in info:
                info['identifier'] = info['song_id']
            formatted.append(info)
        return {"message": f"解析成功，共 {len(formatted)} 首", "songs": formatted}
    except Exception as e:
        logger.exception("歌单解析失败")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if req.request_id:
            with _parse_cancel_lock:
                _cancelled_parse_ids.discard(req.request_id)

@app.post("/parse_playlist/cancel")
def cancel_parse(req: CancelRequest):
    """标记歌单解析任务已取消（解析调用返回后丢弃结果）"""
    with _parse_cancel_lock:
        _cancelled_parse_ids.add(req.request_id)
    logger.info(f"歌单解析任务 {req.request_id} 已标记取消")
    return {"ok": True}

# ---------- 链接刷新 ----------
@app.post("/refresh", response_model=List[dict])
def refresh_links(req: RefreshRequest):
    """批量刷新歌曲下载链接（TTLCache + HEAD 校验 + 按 identifier 重新搜索）"""
    refreshed = []
    for song in req.songs:
        try:
            r = refresh_song_url(dict(song))
            if r:
                refreshed.append(r)
        except Exception as e:
            logger.error(f"刷新失败: {e}")
    return refreshed

# ---------- 封面代理 ----------
@app.get("/cover")
def cover_proxy(url: str, source: str = ""):
    """封面图片代理：外部封面 URL 防盗链/CORS 无法被前端直接加载时使用；带磁盘缓存"""
    if not url:
        raise HTTPException(status_code=400, detail="缺少 url 参数")
    digest = hashlib.sha256(url.encode('utf-8')).hexdigest()
    try:
        cache_file = None
        for ext in ('.jpg', '.png'):
            cand = os.path.join(_cover_cache_dir, digest + ext)
            if os.path.exists(cand):
                cache_file = cand
                break
        if cache_file:
            with open(cache_file, 'rb') as f:
                data = f.read()
            mime = 'image/png' if cache_file.endswith('.png') else 'image/jpeg'
            return Response(content=data, media_type=mime)

        kwargs = get_request_kwargs_for_source(source) if source else {}
        data, ext = _download_image_data(url, kwargs, session=None)
        if not data:
            raise HTTPException(status_code=404, detail="封面获取失败")
        ext = ext or 'jpg'
        cache_file = os.path.join(_cover_cache_dir, digest + '.' + ext)
        try:
            with open(cache_file, 'wb') as f:
                f.write(data)
        except Exception:
            pass
        mime = 'image/png' if ext == 'png' else 'image/jpeg'
        return Response(content=data, media_type=mime)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"封面代理失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ---------- 歌单加解密（与原版 PlaylistMixin 一致） ----------
def _playlist_fernet():
    from cryptography.fernet import Fernet  # 延迟导入，缩短启动时间
    key = base64.urlsafe_b64encode(hashlib.sha256(ENCRYPTION_PASSWORD.encode()).digest())
    return Fernet(key)

@app.post("/playlist/encrypt")
def playlist_encrypt(req: PlaylistEncryptRequest):
    try:
        data = json.dumps(req.songs, ensure_ascii=False, indent=2).encode('utf-8')
        encrypted = _playlist_fernet().encrypt(data)
        return {"content": "ENCRYPTED:" + base64.b64encode(encrypted).decode('ascii')}
    except Exception as e:
        logger.error(f"歌单加密失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/playlist/decrypt")
def playlist_decrypt(req: PlaylistDecryptRequest):
    try:
        content = req.content
        if content.startswith("ENCRYPTED:"):
            encrypted_b64 = content[len("ENCRYPTED:"):]
            data = _playlist_fernet().decrypt(base64.b64decode(encrypted_b64))
        else:
            data = content.encode('utf-8')
        songs = json.loads(data.decode('utf-8'))
        if not isinstance(songs, list):
            raise ValueError("无效的歌单格式，应为数组")
        return {"songs": songs}
    except Exception as e:
        logger.error(f"歌单解密失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ---------- 流式播放 ----------
@app.get("/stream")
async def stream_audio(
    request: Request,                # 关键：注入 Request 对象
    url: str,
    referer: str = "",
    source: str = "",
    start: float = 0,
    ext: str = "mp3",                # 源格式扩展名
    quality: str = "auto"            # auto / lossless / mp3（保留兼容，前端已不再传）
):
    """智能流式播放：
    - 浏览器兼容的无损格式（flac/ogg/opus/wav/webm）→ HTTP Range 代理直传源，
      浏览器原生 seek（拖动进度条/点歌词直接发 Range 请求，无需重启流，音质零损失）
    - 不兼容格式或 seek 兜底（start>0）→ ffmpeg 转码 mp3（-ss 精确 seek）
    """
    # 1. 源请求头/Cookie（供代理与 ffmpeg -headers 使用）
    source_headers = {}
    source_cookies = {}
    if source:
        kwargs = get_request_kwargs_for_source(source)
        source_headers = {k: v for k, v in kwargs['headers'].items() if v}
        source_cookies = kwargs['cookies'] or {}
    elif referer:
        source_headers['Referer'] = referer

    # 2. 浏览器兼容性（通过 User-Agent）
    user_agent = request.headers.get('user-agent', '')
    is_safari = 'Safari' in user_agent and 'Chrome' not in user_agent
    ext_lower = ext.lower() if ext else 'mp3'

    mime_map = {
        'mp3': 'audio/mpeg',
        'm4a': 'audio/mp4',
        'aac': 'audio/aac',
        'flac': 'audio/flac',
        'ogg': 'audio/ogg',
        'opus': 'audio/ogg',
        'wav': 'audio/wav',
        'webm': 'audio/webm',
    }
    # 浏览器原生支持的无损/高音质格式（原生 seek 的前提）
    native_support = {
        'flac': not is_safari,   # Safari 不支持 FLAC 流
        'ogg': not is_safari,    # Safari 不支持 OGG
        'opus': not is_safari,
        'wav': True,             # 几乎所有浏览器支持
        'webm': not is_safari,
    }

    # 3. 直传 or 转码
    if quality == 'mp3':
        use_copy = False
    elif quality == 'lossless':
        use_copy = True
    else:
        use_copy = ext_lower in native_support and native_support[ext_lower]

    if use_copy:
        return await _proxy_stream(request, url, source_headers, source_cookies,
                                   mime_map.get(ext_lower, 'audio/mpeg'), start)
    return await _transcode_stream(url, source_headers, start)


async def _proxy_stream(request: Request, url: str, headers: dict, cookies: dict,
                        fallback_mime: str, start: float):
    """无损直传代理：把浏览器的 Range 请求转发给音源，206 流式回传。
    浏览器对代理流可原生 seek（拖动进度条/点歌词跳转直接发 Range，无需重启流）。
    start>0 表示前端 seek 失败后的兜底重启（音源不支持 Range），改用 ffmpeg 转码精确 seek。"""
    if start > 0:
        return await _transcode_stream(url, headers, start)

    req_headers = dict(headers)
    range_header = request.headers.get('range')
    if range_header:
        req_headers['Range'] = range_header

    loop = asyncio.get_running_loop()
    try:
        upstream = await loop.run_in_executor(
            None,
            lambda: requests.get(url, headers=req_headers, cookies=cookies or None,
                                 stream=True, timeout=30, verify=True)
        )
    except Exception as e:
        logger.error(f"流式代理请求失败: {e}")
        raise HTTPException(status_code=502, detail=f"无法连接音源: {e}")

    resp_headers = {'Content-Type': upstream.headers.get('Content-Type') or fallback_mime}
    for k in ('Content-Range', 'Accept-Ranges', 'Content-Length'):
        v = upstream.headers.get(k)
        if v:
            resp_headers[k] = v
    resp_headers.setdefault('Accept-Ranges', 'bytes')
    status_code = upstream.status_code

    async def generate():
        try:
            while True:
                chunk = await loop.run_in_executor(None, upstream.raw.read, 64 * 1024)
                if not chunk:
                    break
                yield chunk
        except Exception as e:
            logger.error(f"流式代理传输中断: {e}")
        finally:
            try:
                await loop.run_in_executor(None, upstream.close)
            except Exception:
                pass

    return StreamingResponse(generate(), status_code=status_code, headers=resp_headers)


async def _transcode_stream(url: str, headers: dict, start: float):
    """ffmpeg 转码 mp3 流（无限流；-ss 在 -i 之前做输入 seek，转码模式下精确）"""
    cmd = ['ffmpeg']
    for k, v in headers.items():
        cmd += ['-headers', f'{k}: {v}\r\n']
    if start > 0:
        cmd += ['-ss', str(float(start))]
    cmd += ['-i', url]
    cmd += ['-acodec', 'libmp3lame', '-ab', '320k', '-f', 'mp3', '-']

    startupinfo = None
    if sys.platform == 'win32':
        startupinfo = sp.STARTUPINFO()
        startupinfo.dwFlags |= sp.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = sp.SW_HIDE
    process = sp.Popen(cmd, stdout=sp.PIPE, stderr=sp.DEVNULL, bufsize=1024*1024, startupinfo=startupinfo)

    loop = asyncio.get_running_loop()

    async def generate():
        try:
            while True:
                data = await loop.run_in_executor(None, process.stdout.read, 8192)
                if not data:
                    break
                yield data
        except Exception as e:
            logger.error(f"流式传输中断: {e}")
        finally:
            try:
                process.terminate()
            except Exception:
                pass

    return StreamingResponse(generate(), media_type='audio/mpeg')

# ---------- WebSocket 管理 ----------
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get('action') == 'cancel':
                    task_id = msg.get('task_id')
                    with download_lock:
                        if task_id in download_tasks:
                            download_tasks[task_id]['stop'].set()
                            await websocket.send_text(json.dumps({"type": "cancelled", "task_id": task_id}))
                        else:
                            await websocket.send_text(json.dumps({"type": "error", "message": f"任务 {task_id} 不存在"}))
            except json.JSONDecodeError:
                pass  # 忽略非 JSON 消息（如心跳）
    except WebSocketDisconnect:
        if websocket in active_websockets:
            active_websockets.remove(websocket)
    except Exception as e:
        logger.error(f"WebSocket 异常: {e}")
        if websocket in active_websockets:
            active_websockets.remove(websocket)

# ---------- 下载 ----------
def _download_file(url: str, target_path: str, request_kwargs: Dict,
                   stop_event: threading.Event, progress_cb, attempt: int = 1):
    """单次下载：临时文件 + 原子替换；失败抛异常由上层重试"""
    temp_dir = os.path.dirname(target_path) or '.'
    tmp_path = os.path.join(temp_dir, f".{os.path.basename(target_path)}.{attempt}.tmp")
    session = requests.Session()
    try:
        session.verify = request_kwargs.get('verify', True)
        headers = request_kwargs.get('headers') or {}
        session.headers.update(headers)
        cookies = request_kwargs.get('cookies') or {}
        if cookies:
            session.cookies.update(cookies)

        req_kwargs = {}
        for k in ('proxies', 'verify'):
            if k in request_kwargs:
                req_kwargs[k] = request_kwargs[k]
        req_kwargs['stream'] = True
        req_kwargs['timeout'] = request_kwargs.get('timeout', 30)

        with session.get(url, **req_kwargs) as resp:
            if resp.status_code != 200:
                raise requests.RequestException(f"HTTP {resp.status_code}")
            total = int(resp.headers.get('content-length', 0)) or None
            downloaded = 0
            last_emit = 0.0
            with open(tmp_path, 'wb') as f:
                for chunk in resp.iter_content(chunk_size=32*1024):
                    if stop_event.is_set():
                        raise IOError("下载已取消")
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        now = time.time()
                        if total:
                            percent = int(downloaded / total * 100)
                        else:
                            percent = min(99, int(downloaded / (1024 * 50)))
                        if now - last_emit > 0.25 or percent == 100:
                            progress_cb(percent)
                            last_emit = now
            if stop_event.is_set():
                raise IOError("下载已取消")
            progress_cb(100)
            os.replace(tmp_path, target_path)
    except Exception:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
        raise
    finally:
        session.close()

def download_song_task(song: Dict, save_dir: str, task_id: int, settings: Dict):
    """单曲下载全流程（在受限并发槽中执行）"""
    stop_event = download_tasks.get(task_id, {}).get('stop')
    if stop_event is None:
        return
    _download_slots.acquire()
    try:
        # 1) 下载前先刷新链接（有 identifier 时；与原版先 refresh 再下载一致）
        info = refresh_song_url(dict(song)) or song
        url = info.get('download_url')
        if not url:
            raise Exception("缺少下载链接")

        # 2) 构建文件名与目录
        ext = info.get('ext', 'mp3') or 'mp3'
        convert_enabled = settings.get('convert_enabled', False)
        convert_format = settings.get('convert_format', '').lower()
        final_ext = convert_format if (convert_enabled and convert_format) else ext

        base_name = sanitize_filepath(build_filename(info, settings.get('filename_format', '歌手-歌曲名')))
        sub_dir = get_group_subdir(info, settings.get('group_by', '无分组'))
        target_dir = os.path.join(save_dir, sub_dir) if sub_dir else save_dir
        os.makedirs(target_dir, exist_ok=True)
        final_path = os.path.join(target_dir, f"{base_name}.{final_ext}")

        broadcast({"type": "start", "task_id": task_id, "song": info.get('song_name'), "path": final_path})
        record_task_status(task_id, str(info.get('song_name', '')), 0, 'progress')

        # 3) 源请求头/Cookie
        request_kwargs = get_request_kwargs_for_source(info.get('source', ''))
        if info.get('cookies'):
            request_kwargs['cookies'].update(info['cookies'])

        def progress_cb(percent):
            broadcast({"type": "progress", "task_id": task_id, "percent": percent})
            record_task_status(task_id, str(info.get('song_name', '')), percent, 'progress')

        # 4) 下载（带重试，3 次；取消不重试）
        last_err = None
        downloaded = False
        for attempt in range(1, 4):
            if stop_event.is_set():
                raise IOError("下载已取消")
            try:
                _download_file(url, final_path, request_kwargs, stop_event, progress_cb, attempt)
                downloaded = True
                break
            except IOError:
                raise  # 取消：不重试
            except Exception as e:
                last_err = e
                logger.warning(f"下载尝试 {attempt}/3 失败: {e}")
                time.sleep(1)
        if not downloaded:
            raise Exception(f"下载失败: {last_err}")

        # 5) 格式转换
        if convert_enabled and convert_format and convert_format != ext:
            converted = convert_audio(final_path, convert_format, settings.get('convert_bitrate', ''))
            if converted and converted != final_path:
                try:
                    os.replace(converted, final_path)
                except Exception:
                    os.remove(converted) if os.path.exists(converted) else None

        # 6) 歌词
        if settings.get('download_lyric', True):
            lyric_text = info.get('lyric') or info.get('lyrics', '')
            if lyric_text:
                lyric_path = os.path.join(target_dir, f"{base_name}.lrc")
                try:
                    atomic_write(lyric_text.encode('utf-8-sig'), lyric_path)
                except Exception as e:
                    logger.error(f"歌词保存失败: {e}")
                else:
                    if settings.get('embed_lyrics'):
                        try:
                            if embed_lyrics(final_path, lyric_text) and settings.get('delete_lyrics'):
                                os.remove(lyric_path)
                        except Exception as e:
                            logger.error(f"嵌入歌词失败: {e}")

        # 7) 封面
        if settings.get('download_cover', True):
            cover_url = get_cover_url(info)
            if cover_url:
                img_data, cover_ext = download_cover_image(cover_url, request_kwargs)
                if img_data:
                    cover_ext = cover_ext or 'jpg'
                    cover_path = os.path.join(target_dir, f"{base_name}_cover.{cover_ext}")
                    try:
                        atomic_write(img_data, cover_path)
                    except Exception as e:
                        logger.error(f"保存封面失败: {e}")
                    else:
                        if settings.get('embed_cover'):
                            try:
                                _embed_cover(final_path, img_data, cover_ext)
                                if settings.get('delete_cover') and os.path.exists(cover_path):
                                    os.remove(cover_path)
                            except Exception as e:
                                logger.error(f"嵌入封面失败: {e}")

        broadcast({"type": "done", "task_id": task_id, "path": final_path})
        record_task_status(task_id, str(info.get('song_name', '')), 100, 'done')

    except Exception as e:
        if stop_event.is_set():
            logger.info(f"下载任务 {task_id} 已取消")
            broadcast({"type": "cancelled", "task_id": task_id})
            record_task_status(task_id, str(song.get('song_name', '')), 0, 'cancelled')
        else:
            logger.error(f"下载任务 {task_id} 失败: {e}")
            broadcast({"type": "error", "task_id": task_id, "message": str(e)})
            record_task_status(task_id, str(song.get('song_name', '')), 0, 'error')
    finally:
        _download_slots.release()
        with download_lock:
            download_tasks.pop(task_id, None)

def _embed_cover(audio_path: str, img_data: bytes, cover_ext: str):
    """将封面嵌入音频文件（mp3/m4a/flac，与原版 threads.DownloadThread._embed_cover 一致）"""
    ext_lower = os.path.splitext(audio_path)[1].lower()
    if ext_lower == '.mp3':
        from mutagen.id3 import ID3, APIC
        try:
            audio = ID3(audio_path)
        except Exception:
            audio = ID3()
        audio.add(APIC(encoding=3, mime=f'image/{cover_ext}', type=3, desc='Cover', data=img_data))
        audio.save(audio_path)
    elif ext_lower in ['.m4a', '.m4b']:
        from mutagen.mp4 import MP4, MP4Cover
        audio = MP4(audio_path)
        fmt = MP4Cover.FORMAT_PNG if cover_ext.lower() == 'png' else MP4Cover.FORMAT_JPEG
        audio['covr'] = [MP4Cover(img_data, imageformat=fmt)]
        audio.save()
    elif ext_lower == '.flac':
        from mutagen.flac import FLAC, Picture
        pic = Picture()
        pic.data = img_data
        pic.type = 3
        pic.mime = f'image/{cover_ext}'
        audio = FLAC(audio_path)
        audio.add_picture(pic)
        audio.save()

@app.post("/download")
def start_downloads(req: DownloadRequest):
    """启动下载任务（不要求 WS 活跃；进度通过 /ws 广播 + /tasks 轮询）"""
    global task_counter
    task_ids = []
    save_dir = req.save_dir or _settings.get('save_dir', DEFAULT_SAVE_DIR)
    try:
        os.makedirs(save_dir, exist_ok=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"无法创建目录: {e}")
    for song in req.songs:
        task_counter += 1
        task_id = task_counter
        stop_event = threading.Event()
        with download_lock:
            download_tasks[task_id] = {'stop': stop_event}
        record_task_status(task_id, str(song.get('song_name', '')), 0, 'pending')
        thread = threading.Thread(target=download_song_task,
                                  args=(song, save_dir, task_id, _settings))
        thread.daemon = True
        thread.start()
        task_ids.append(task_id)
    return {"task_ids": task_ids}

@app.get("/tasks")
def get_task_status():
    """最近任务状态历史（前端 WS 断开/重连时轮询对账用）"""
    with task_history_lock:
        return {"tasks": {str(k): v for k, v in task_status_history.items()}}

# ---------- 启动入口 ----------
def run_server(port=8000):
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")

if __name__ == "__main__":
    run_server()
