# -*- coding: utf-8 -*-
"""MusicClient / RefreshClient 懒加载、源请求头获取、链接刷新"""
import os
from typing import Dict, Optional

import requests

from constants import SOURCE_INTERNAL, DATA_DIR, REFRESH_SEARCH_SIZE
from utils import logger
from backend import state

# MusicClient 单例（通过 reset_music_client 重置）
_music_client = None
_refresh_client = None

_SONG_INFO_KEYS = [
    'song_name', 'singers', 'album', 'ext', 'duration', 'duration_s',
    'cover_url', 'lyric', 'lyrics', 'download_url', 'url', 'identifier',
    'song_id', 'file_size', 'file_size_bytes', 'cookies',
]


def normalize_song_item(item) -> dict:
    """把 musicdl 返回的 SongInfo 对象或 dict 统一为 dict（dict 原样返回）"""
    if isinstance(item, dict):
        return item
    return {k: getattr(item, k, '') for k in _SONG_INFO_KEYS}


def get_music_client():
    global _music_client
    if _music_client is not None:
        return _music_client
    with state.client_lock:
        if _music_client is not None:
            return _music_client
        selected_display = state.settings.get('sources', [])
        selected_sources = [SOURCE_INTERNAL.get(d) for d in selected_display if SOURCE_INTERNAL.get(d)]
        if not selected_sources:
            raise RuntimeError("请在设置中启用至少一个搜索源")
        init_cfg = {}
        for src in selected_sources:
            init_cfg[src] = {
                'search_size_per_source': state.settings.get('limit', 10),
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


def reset_music_client():
    """仅重置搜索/解析用客户端（影响 limit 变化）"""
    global _music_client
    _music_client = None


def reset_refresh_client():
    """仅重置链接刷新专用客户端（影响 sources 变化）"""
    global _refresh_client
    _refresh_client = None


def reset_all_clients():
    """同时重置两个客户端（sources 变化时用）"""
    reset_music_client()
    reset_refresh_client()


def get_refresh_client():
    """链接刷新专用 MusicClient：每源仅搜索 REFRESH_SEARCH_SIZE 条，速度更快"""
    global _refresh_client
    if _refresh_client is not None:
        return _refresh_client
    with state.client_lock:
        if _refresh_client is not None:
            return _refresh_client
        selected_display = state.settings.get('sources', [])
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


def get_request_kwargs_for_source(source: str) -> dict:
    kwargs = {'headers': {}, 'cookies': {}, 'proxies': {}, 'timeout': 30, 'verify': True}
    try:
        client = get_music_client()
    except Exception:
        return kwargs
    src_client = client.music_clients.get(source) if client else None
    if not src_client:
        return kwargs
    for attr in ('default_download_headers', 'default_headers',
                 'default_search_headers', 'default_parse_headers'):
        v = getattr(src_client, attr, None)
        if v:
            kwargs['headers'].update(v)
    for attr in ('default_download_cookies', 'default_cookies',
                 'default_search_cookies', 'default_parse_cookies'):
        v = getattr(src_client, attr, None)
        if v:
            kwargs['cookies'].update(v)
    return kwargs


def _refresh_search(source: str, keyword: str, identifier: str = None):
    """在指定源中搜索并返回匹配歌曲（统一为 dict）；优先 identifier 精确匹配，否则取第一条"""
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
    normalized = [normalize_song_item(it) for it in results]
    if identifier:
        for item in normalized[:REFRESH_SEARCH_SIZE]:
            if item.get('identifier') == identifier:
                return item
    return normalized[0] if normalized else None


def refresh_song_url(song_info: Dict) -> Optional[Dict]:
    identifier = song_info.get('identifier') or song_info.get('song_id')
    cache_key = identifier or f"{song_info.get('source')}|{song_info.get('singers', '')}|{song_info.get('song_name', '')}"

    # 1) 长期缓存：刷新后的链接（5 分钟）
    with state.url_cache_lock:
        cached_url = state.url_cache.get(cache_key)
    if cached_url is not None:
        if cached_url != song_info.get('download_url'):
            song_info['download_url'] = cached_url
            logger.debug(f"使用缓存的链接: {cache_key}")
        return song_info

    url = song_info.get('download_url', '')

    # 2) 短期缓存：无签名/过期参数的 URL，最近 HEAD 校验通过（60 秒）
    if url and 'expires' not in url and 'sign' not in url:
        with state.url_cache_lock:
            head_cached = state.url_head_cache.get(cache_key)
        if head_cached == url:
            return song_info

        try:
            hk = get_request_kwargs_for_source(song_info.get('source', ''))
            head_resp = requests.head(
                url,
                headers=hk.get('headers') or {},
                cookies=hk.get('cookies') or None,
                timeout=5,
                allow_redirects=True,
            )
            if head_resp.status_code < 400:
                with state.url_cache_lock:
                    state.url_head_cache[cache_key] = url
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

    with state.url_cache_lock:
        state.url_cache[cache_key] = new_url
    logger.info(f"链接刷新成功: {song_info.get('song_name', '')} -> {source}")
    return song_info
