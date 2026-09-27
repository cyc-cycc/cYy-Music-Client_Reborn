# -*- coding: utf-8 -*-
"""通用工具模块：路径、日志、文件操作、音频转换、封面下载、歌词/封面嵌入。"""
import os
import sys
import re
import logging
import traceback
import subprocess
from logging.handlers import RotatingFileHandler
from typing import Dict, Optional, Tuple
import tempfile

import requests
import filetype

from constants import DATA_DIR, LOG_DIR, LOG_FILE, DEFAULT_SAVE_DIR


# ==================== 运行时路径设置 ====================
def setup_runtime_paths():
    """在源码或打包环境下，自动定位 FFmpeg 并设置环境变量"""
    if getattr(sys, 'frozen', False):
        base = sys._MEIPASS
    else:
        base = os.path.dirname(os.path.abspath(sys.argv[0]))

    # Windows 上是 ffmpeg.exe，macOS / Linux 上是无扩展名的 ffmpeg
    ffmpeg_name = 'ffmpeg.exe' if sys.platform == 'win32' else 'ffmpeg'

    ffmpeg_bin = None
    for cand in (os.path.join(base, 'ffmpeg', 'bin'), os.path.join(base, 'ffmpeg')):
        if os.path.isdir(cand) and os.path.exists(os.path.join(cand, ffmpeg_name)):
            ffmpeg_bin = cand
            break

    if ffmpeg_bin is None:
        for cand in {base, os.path.dirname(sys.executable)}:
            if os.path.isfile(os.path.join(cand, ffmpeg_name)):
                ffmpeg_bin = cand
                break

    if ffmpeg_bin:
        os.environ['PATH'] = ffmpeg_bin + os.pathsep + os.environ.get('PATH', '')
        ffmpeg_exe = os.path.join(ffmpeg_bin, ffmpeg_name)
        if os.path.exists(ffmpeg_exe):
            os.environ['AUDIOREAD_FFMPEG'] = ffmpeg_exe


# ==================== 日志设置 ====================
def setup_logging():
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        os.makedirs(LOG_DIR, exist_ok=True)
        os.makedirs(DEFAULT_SAVE_DIR, exist_ok=True)
    except Exception as e:
        print(f"警告：无法创建数据目录：{e}")

    _logger = logging.getLogger('MusicdlGUI')
    _logger.setLevel(logging.DEBUG)
    _logger.propagate = False

    file_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    # 默认 INFO（保留 WARNING/INFO 便于诊断），设置 MUSICDL_GUI_DEBUG 后提升到 DEBUG
    level = logging.INFO if os.getenv('MUSICDL_GUI_DEBUG') is None else logging.DEBUG

    try:
        file_handler = RotatingFileHandler(LOG_FILE, maxBytes=1024 * 1024, backupCount=1, encoding='utf-8')
        file_handler.setLevel(level)
        file_handler.setFormatter(file_formatter)
        _logger.addHandler(file_handler)
    except Exception as e:
        print(f"警告：无法创建日志文件 {LOG_FILE}：{e}")

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_handler.setFormatter(file_formatter)
    _logger.addHandler(console_handler)

    return _logger


logger = setup_logging()


# ==================== 全局异常钩子 ====================
def global_exception_hook(exctype, value, tb):
    """未捕获异常写入日志"""
    logger.error(''.join(traceback.format_exception(exctype, value, tb)))
    sys.__excepthook__(exctype, value, tb)


sys.excepthook = global_exception_hook


# ==================== 分组子目录 ====================
def get_group_subdir(song_info: Dict, group_by: str) -> str:
    if group_by == '无分组':
        return ''
    singer = song_info.get('singers', '').strip() or '未知歌手'
    album = song_info.get('album', '').strip() or '未知专辑'
    if group_by == '按歌手':
        return sanitize_filepath(singer)
    if group_by == '按专辑':
        return sanitize_filepath(album)
    if group_by == '按歌手-专辑':
        return os.path.join(sanitize_filepath(singer), sanitize_filepath(album))
    return ''


# ==================== 封面下载工具 ====================
# 只允许透传给 requests.get 的键，避免 request_kwargs 中携带意外字段
_ALLOWED_IMAGE_GET_KWARGS = ('headers', 'cookies', 'proxies', 'verify', 'timeout')


def _download_image_data(
    url: str,
    request_kwargs: Dict,
    max_size: int = 5 * 1024 * 1024,
    session: Optional[requests.Session] = None
) -> Tuple[Optional[bytes], Optional[str]]:
    if not url:
        return None, None
    sess_local = False
    try:
        sess = session or requests.Session()
        if session is None:
            sess_local = True

        # 显式白名单：只透传 requests.get 支持的参数
        kw: Dict = {}
        if request_kwargs:
            for k in _ALLOWED_IMAGE_GET_KWARGS:
                v = request_kwargs.get(k)
                if v is not None:
                    kw[k] = v
        kw.setdefault('timeout', 10)
        kw['stream'] = True
        kw.setdefault('allow_redirects', True)

        with sess.get(url, **kw) as resp:
            if resp.status_code != 200:
                return None, None
            content_length = resp.headers.get('content-length')
            if content_length and int(content_length) > max_size:
                logger.warning(f"封面图片过大 ({content_length} bytes)，跳过下载")
                return None, None
            data_arr = bytearray()
            for chunk in resp.iter_content(chunk_size=8192):
                if not chunk:
                    continue
                data_arr.extend(chunk)
                if len(data_arr) > max_size:
                    logger.warning("封面数据超过限制，截断")
                    return None, None
            if not data_arr:
                return None, None

            data_bytes = bytes(data_arr)
            kind = filetype.guess(data_bytes)
            if kind and kind.extension in ('jpg', 'jpeg', 'png', 'bmp', 'gif'):
                ext = 'jpg' if kind.extension == 'jpeg' else kind.extension
                return data_bytes, ext
            content_type = resp.headers.get('content-type', '').lower()
            if 'png' in content_type:
                return data_bytes, 'png'
            if 'jpeg' in content_type or 'jpg' in content_type:
                return data_bytes, 'jpg'
            logger.warning(f"未知图片格式: {content_type}")
            return None, None
    except Exception as e:
        logger.error(f"图片下载异常: {e}", exc_info=True)
        return None, None
    finally:
        if sess_local:
            try:
                sess.close()
            except Exception:
                pass


def get_cover_url(song_info: Dict) -> Optional[str]:
    for key in ('cover_url', 'cover', 'song_cover', 'album_cover', 'pic_url', 'img_url'):
        val = song_info.get(key)
        if val:
            return val
    return None


def download_cover_image(url: str, request_kwargs: Dict,
                         max_size: int = 5 * 1024 * 1024) -> Tuple[Optional[bytes], Optional[str]]:
    return _download_image_data(url, request_kwargs, max_size, session=None)


# ==================== 文件名处理 ====================
try:
    from pathvalidate import sanitize_filepath
except ImportError:
    def sanitize_filepath(filename):
        return re.sub(r'[\\/:*?"<>|]', '_', filename)


def build_filename(song_info: Dict, fmt: str) -> str:
    song_name = song_info.get('song_name', '')
    singers = song_info.get('singers', '')
    if fmt == "歌曲名":
        return song_name
    if fmt == "歌手-歌曲名":
        return f"{singers}-{song_name}"
    if fmt == "歌曲名-歌手":
        return f"{song_name}-{singers}"
    template = fmt
    template = template.replace("{歌手}", singers)
    template = template.replace("{歌曲名}", song_name)
    template = template.replace("{专辑}", song_info.get('album', ''))
    template = template.replace("{时长}", song_info.get('duration', ''))
    return template


# ==================== 原子写入 ====================
def atomic_write(data: bytes, target_path: str):
    """原子写入文件：先写临时文件，再重命名"""
    dirname = os.path.dirname(target_path)
    if dirname:
        os.makedirs(dirname, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=dirname, delete=False) as tmp:
        tmp.write(data)
        tmp.flush()
        os.fsync(tmp.fileno())
    os.replace(tmp.name, target_path)


# ==================== 歌词嵌入 ====================
def embed_lyrics(audio_path: str, lyric_text: str) -> bool:
    try:
        ext = os.path.splitext(audio_path)[1].lower()
        if ext == '.mp3':
            from mutagen.id3 import ID3, USLT
            try:
                audio = ID3(audio_path)
            except Exception:
                audio = ID3()
            audio.delall('USLT')
            audio.add(USLT(encoding=3, lang='eng', desc='', text=lyric_text))
            audio.save(audio_path)
        elif ext in ('.m4a', '.m4b'):
            from mutagen.mp4 import MP4
            audio = MP4(audio_path)
            audio['©lyr'] = lyric_text
            audio.save()
        elif ext == '.flac':
            from mutagen.flac import FLAC
            audio = FLAC(audio_path)
            audio['LYRICS'] = lyric_text
            audio.save()
        elif ext == '.ogg':
            from mutagen.oggvorbis import OggVorbis
            audio = OggVorbis(audio_path)
            audio['LYRICS'] = lyric_text
            audio.save()
        else:
            logger.warning(f"不支持嵌入歌词到 {ext} 格式")
            return False
        logger.info(f"歌词已嵌入: {audio_path}")
        return True
    except Exception as e:
        logger.error(f"嵌入歌词失败: {e}", exc_info=True)
        return False


# ==================== 格式转换 ====================
def convert_audio(input_path: str, output_format: str, bitrate: str = None) -> str:
    if not output_format:
        return input_path
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
    except (subprocess.SubprocessError, FileNotFoundError):
        logger.warning("FFmpeg 未找到，跳过格式转换")
        return None

    base, _ = os.path.splitext(input_path)
    output_path = f"{base}.{output_format}"
    if os.path.exists(output_path):
        counter = 1
        while os.path.exists(f"{base}_{counter}.{output_format}"):
            counter += 1
        output_path = f"{base}_{counter}.{output_format}"

    cmd = ['ffmpeg', '-y', '-i', input_path]
    if output_format != 'flac' and bitrate:
        cmd.extend(['-b:a', bitrate])
    if output_format == 'mp3':
        cmd.extend(['-acodec', 'libmp3lame'])
    elif output_format == 'aac':
        cmd.extend(['-acodec', 'aac'])
    elif output_format == 'ogg':
        cmd.extend(['-acodec', 'libvorbis'])
    elif output_format == 'flac':
        cmd.extend(['-acodec', 'flac'])
    cmd.append(output_path)

    # STARTUPINFO 仅存在于 Windows；非 Windows 平台传 None 即可
    startupinfo = None
    if sys.platform == 'win32':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE

    try:
        subprocess.run(cmd, capture_output=True, check=True, startupinfo=startupinfo)
        logger.info(f"转换成功: {output_path}")
        return output_path
    except subprocess.CalledProcessError as e:
        logger.error(f"转换失败: {e.stderr.decode() if e.stderr else '未知错误'}")
        return None
