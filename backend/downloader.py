# -*- coding: utf-8 -*-
"""下载核心：单次下载、单曲全流程（含格式转换、歌词/封面嵌入）"""
import os
import threading
import time
from typing import Dict

import requests

from utils import (
    logger, build_filename, get_group_subdir, sanitize_filepath,
    convert_audio, atomic_write, download_cover_image, get_cover_url,
    embed_lyrics,
)
from backend import state
from backend.broadcast import broadcast
from backend.clients import get_request_kwargs_for_source, refresh_song_url


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

        # verify 仅通过 session.verify 生效，避免单次请求重复传参
        req_kwargs = {}
        for k in ('proxies',):
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
                for chunk in resp.iter_content(chunk_size=32 * 1024):
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


def _embed_cover(audio_path: str, img_data: bytes, cover_ext: str):
    """将封面嵌入音频文件（mp3/m4a/flac）"""
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


def download_song_task(song: Dict, save_dir: str, task_id: int, settings: Dict):
    """单曲下载全流程（在受限并发槽中执行）"""
    stop_event = state.download_tasks.get(task_id, {}).get('stop')
    if stop_event is None:
        return

    # 带超时的槽位获取：中途可响应取消，避免被慢任务永久阻塞
    acquired = False
    while not stop_event.is_set():
        if state.download_slots.acquire(timeout=0.5):
            acquired = True
            break
    if not acquired:
        logger.info(f"下载任务 {task_id} 在排队阶段被取消")
        broadcast({"type": "cancelled", "task_id": task_id})
        state.record_task_status(task_id, str(song.get('song_name', '')), 0, 'cancelled')
        with state.download_lock:
            state.download_tasks.pop(task_id, None)
        return

    try:
        if stop_event.is_set():
            raise IOError("下载已取消")

        # 1) 下载前先刷新链接
        info = refresh_song_url(dict(song)) or song
        url = info.get('download_url')
        if not url:
            raise Exception("缺少下载链接")

        # 2) 构建文件名与目录（先按源扩展名下载，转换成功后再改名为目标扩展名）
        ext = (info.get('ext', 'mp3') or 'mp3').lower().lstrip('.')
        convert_enabled = settings.get('convert_enabled', False)
        convert_format = (settings.get('convert_format', '') or '').lower()
        need_convert = bool(convert_enabled and convert_format and convert_format != ext)

        base_name = sanitize_filepath(build_filename(info, settings.get('filename_format', '歌手-歌曲名')))
        sub_dir = get_group_subdir(info, settings.get('group_by', '无分组'))
        target_dir = os.path.join(save_dir, sub_dir) if sub_dir else save_dir
        os.makedirs(target_dir, exist_ok=True)

        src_path = os.path.join(target_dir, f"{base_name}.{ext}")
        final_ext = convert_format if need_convert else ext
        final_target = os.path.join(target_dir, f"{base_name}.{final_ext}")

        broadcast({"type": "start", "task_id": task_id, "song": info.get('song_name'), "path": final_target})
        state.record_task_status(task_id, str(info.get('song_name', '')), 0, 'progress')

        # 3) 源请求头/Cookie
        request_kwargs = get_request_kwargs_for_source(info.get('source', ''))
        if info.get('cookies'):
            request_kwargs['cookies'].update(info['cookies'])

        def progress_cb(percent):
            broadcast({"type": "progress", "task_id": task_id, "percent": percent})
            state.record_task_status(task_id, str(info.get('song_name', '')), percent, 'progress')

        # 4) 下载（3 次重试；取消不重试）
        last_err = None
        downloaded = False
        for attempt in range(1, 4):
            if stop_event.is_set():
                raise IOError("下载已取消")
            try:
                _download_file(url, src_path, request_kwargs, stop_event, progress_cb, attempt)
                downloaded = True
                break
            except IOError:
                raise
            except Exception as e:
                last_err = e
                logger.warning(f"下载尝试 {attempt}/3 失败: {e}")
                time.sleep(1)
        if not downloaded:
            raise Exception(f"下载失败: {last_err}")

        # 5) 格式转换（如启用）；失败保留源文件，避免扩展名错位损坏文件
        if need_convert:
            converted = convert_audio(src_path, convert_format, settings.get('convert_bitrate', ''))
            if converted and converted != src_path and os.path.exists(converted):
                try:
                    os.replace(converted, final_target)
                    try:
                        os.remove(src_path)
                    except Exception:
                        pass
                    final_path = final_target
                except Exception as e:
                    logger.error(f"重命名转换文件失败: {e}")
                    final_path = converted
            else:
                logger.warning(f"格式转换失败，保留源格式: {src_path}")
                final_path = src_path
        else:
            final_path = src_path

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
        state.record_task_status(task_id, str(info.get('song_name', '')), 100, 'done')

    except Exception as e:
        if stop_event.is_set():
            logger.info(f"下载任务 {task_id} 已取消")
            broadcast({"type": "cancelled", "task_id": task_id})
            state.record_task_status(task_id, str(song.get('song_name', '')), 0, 'cancelled')
        else:
            logger.error(f"下载任务 {task_id} 失败: {e}")
            broadcast({"type": "error", "task_id": task_id, "message": str(e)})
            state.record_task_status(task_id, str(song.get('song_name', '')), 0, 'error')
    finally:
        state.download_slots.release()
        with state.download_lock:
            state.download_tasks.pop(task_id, None)