# -*- coding: utf-8 -*-
"""流式播放：无损直传代理 / ffmpeg 转码 mp3"""
import asyncio
import shutil
import subprocess as sp
import sys
import threading

import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from backend.clients import get_request_kwargs_for_source
from utils import logger

router = APIRouter()

_MIME_MAP = {
    'mp3': 'audio/mpeg', 'm4a': 'audio/mp4', 'aac': 'audio/aac',
    'flac': 'audio/flac', 'ogg': 'audio/ogg', 'opus': 'audio/ogg',
    'wav': 'audio/wav', 'webm': 'audio/webm',
}
_NATIVE_EXTS = {'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wav', 'webm'}


def _ffmpeg_available() -> bool:
    try:
        return shutil.which('ffmpeg') is not None
    except Exception:
        return False


def _sanitize_header_part(v) -> str:
    """去掉 CR/LF，避免 header 注入到 ffmpeg -headers 参数"""
    return str(v).replace('\r', '').replace('\n', '')


def decide_codec(ext: str, quality: str, start: float):
    """纯计算：判断 /stream 实际会走直传还是转码。

    返回 (use_copy, codec, mime)。
    注意：这里的逻辑必须与 /stream 的实际分支保持一致，
    否则前端显示的格式会说谎。任何修改都要两处同步。
    """
    ext_lower = (ext or 'mp3').lower()
    if quality == 'mp3':
        use_copy = False
    elif quality == 'lossless':
        use_copy = True
    else:
        use_copy = ext_lower in _NATIVE_EXTS
    # 代理路径遇到 start > 0 会降级为转码（见 _proxy_stream 首行）
    if use_copy and start > 0:
        use_copy = False
    if use_copy:
        return True, ext_lower, _MIME_MAP.get(ext_lower, 'audio/mpeg')
    return False, 'mp3', 'audio/mpeg'


@router.get("/stream/codec")
def stream_codec(ext: str = "mp3", quality: str = "auto", start: float = 0):
    """供前端查询实际播放格式。纯计算，不访问源站、不消耗带宽。"""
    use_copy, codec, mime = decide_codec(ext, quality, start)
    return {"codec": codec, "transcoded": not use_copy, "mime": mime}


@router.get("/stream")
async def stream_audio(
    request: Request,
    url: str,
    referer: str = "",
    source: str = "",
    start: float = 0,
    ext: str = "mp3",
    quality: str = "auto"
):
    if not (url.startswith('http://') or url.startswith('https://')):
        raise HTTPException(status_code=400, detail="仅支持 http/https 音频源")

    source_headers = {}
    source_cookies = {}
    if source:
        kwargs = get_request_kwargs_for_source(source)
        source_headers = {k: v for k, v in kwargs['headers'].items() if v}
        source_cookies = kwargs['cookies'] or {}
    elif referer:
        source_headers['Referer'] = referer

    use_copy, codec, mime = decide_codec(ext, quality, start)

    if use_copy:
        resp = await _proxy_stream(request, url, source_headers, source_cookies, mime, start)
    else:
        resp = await _transcode_stream(url, source_headers, source_cookies, start)
    # 附带实际编码：虽然 <audio> 读不到响应头，但对调试/抓包很有用
    resp.headers['X-CMC-Codec'] = codec
    return resp


async def _proxy_stream(request: Request, url: str, headers: dict, cookies: dict,
                        fallback_mime: str, start: float):
    if start > 0:
        return await _transcode_stream(url, headers, cookies, start)

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

    # 关键：禁止 urllib3 自动解压。若自动解压，raw.read 返回的是已解压字节，
    # 但 Content-Encoding 头依然会透传给浏览器 → 浏览器二次解压失败。
    # 保持 raw 语义与响应头一致，是最安全的做法。
    try:
        upstream.raw.decode_content = False
    except Exception:
        pass

    resp_headers = {'Content-Type': upstream.headers.get('Content-Type') or fallback_mime}
    for k in ('Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Encoding'):
        v = upstream.headers.get(k)
        if v:
            resp_headers[k] = v
    resp_headers.setdefault('Accept-Ranges', 'bytes')

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

    return StreamingResponse(generate(), status_code=upstream.status_code, headers=resp_headers)


def _drain_ffmpeg_stderr(proc: sp.Popen, url_for_log: str) -> None:
    """把 ffmpeg 的 stderr 逐行写入日志（DEBUG 级），避免误吞错误信息。"""
    try:
        if proc.stderr is None:
            return
        for raw in iter(proc.stderr.readline, b''):
            if not raw:
                break
            try:
                line = raw.decode('utf-8', errors='replace').rstrip()
            except Exception:
                continue
            if line:
                logger.debug(f"[ffmpeg] {line}")
    except Exception:
        pass


async def _transcode_stream(url: str, headers: dict, cookies: dict, start: float):
    if not _ffmpeg_available():
        raise HTTPException(status_code=500, detail="ffmpeg 不可用，无法转码播放")

    merged_headers = dict(headers) if headers else {}
    if cookies:
        cookie_str = '; '.join(
            f'{_sanitize_header_part(k)}={_sanitize_header_part(v)}'
            for k, v in cookies.items() if v
        )
        if cookie_str:
            existing = merged_headers.get('Cookie', '')
            merged_headers['Cookie'] = (existing + '; ' + cookie_str) if existing else cookie_str

    cmd = ['ffmpeg']
    if merged_headers:
        header_str = ''.join(
            f'{_sanitize_header_part(k)}: {_sanitize_header_part(v)}\r\n'
            for k, v in merged_headers.items()
        )
        cmd += ['-headers', header_str]
    if start > 0:
        cmd += ['-ss', str(float(start))]
    cmd += ['-i', url]
    cmd += ['-acodec', 'libmp3lame', '-ab', '320k', '-f', 'mp3', '-']

    # STARTUPINFO 仅 Windows 存在
    startupinfo = None
    if sys.platform == 'win32':
        startupinfo = sp.STARTUPINFO()
        startupinfo.dwFlags |= sp.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = sp.SW_HIDE

    try:
        process = sp.Popen(
            cmd,
            stdout=sp.PIPE,
            stderr=sp.PIPE,        # ← 收集 stderr，交给后台线程写日志
            bufsize=1024 * 1024,
            startupinfo=startupinfo,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="找不到 ffmpeg 可执行文件")

    # 后台线程消费 stderr，避免管道写满阻塞 ffmpeg
    t = threading.Thread(
        target=_drain_ffmpeg_stderr,
        args=(process, url),
        daemon=True,
        name='ffmpeg-stderr',
    )
    t.start()

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