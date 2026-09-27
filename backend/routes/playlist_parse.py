# -*- coding: utf-8 -*-
"""歌单解析"""
from fastapi import APIRouter, HTTPException

from constants import PLAYLIST_SOURCE_MAP, SOURCE_INTERNAL
from backend import state
from backend.clients import get_music_client, normalize_song_item, reset_all_clients
from backend.models import ParsePlaylistRequest, CancelRequest
from utils import logger

router = APIRouter()


@router.post("/parse_playlist")
def parse_playlist(req: ParsePlaylistRequest):
    try:
        client = get_music_client()
        source_internal = PLAYLIST_SOURCE_MAP.get(req.source_display)
        if not source_internal:
            raise HTTPException(status_code=400, detail="不支持的平台")
        src_client = client.music_clients.get(source_internal)
        if not src_client:
            # 未启用的源自动加入设置并重建客户端（与原版一致）
            display = next((k for k, v in SOURCE_INTERNAL.items() if v == source_internal), req.source_display)
            need_save = False
            with state.client_lock:
                if display not in state.settings.get('sources', []):
                    state.settings['sources'].append(display)
                    reset_all_clients()
                    need_save = True
            # 磁盘 I/O 移出锁外
            if need_save:
                from config import save_settings
                save_settings(state.settings)
            client = get_music_client()
            src_client = client.music_clients.get(source_internal)
            if not src_client:
                raise HTTPException(status_code=400, detail=f"当前未启用 {req.source_display}")
        song_infos = src_client.parseplaylist(req.url)
        if state.is_parse_cancelled(req.request_id):
            logger.info(f"歌单解析 {req.request_id} 已停止，结果丢弃")
            return {"message": "解析已停止", "songs": [], "cancelled": True}
        if not song_infos:
            return {"message": "解析成功，但未获取到歌曲", "songs": []}
        formatted = []
        for info in song_infos:
            info = normalize_song_item(info)
            info['source'] = source_internal
            if 'identifier' not in info and 'song_id' in info:
                info['identifier'] = info['song_id']
            formatted.append(info)
        return {"message": f"解析成功，共 {len(formatted)} 首", "songs": formatted}
    except Exception as e:
        logger.exception("歌单解析失败")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        state.clear_parse_cancelled(req.request_id)


@router.post("/parse_playlist/cancel")
def cancel_parse(req: CancelRequest):
    state.mark_parse_cancelled(req.request_id)
    logger.info(f"歌单解析任务 {req.request_id} 已标记取消")
    return {"ok": True}
