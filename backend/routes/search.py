# -*- coding: utf-8 -*-
"""多源并行搜索"""
import asyncio
from typing import List

from fastapi import APIRouter, HTTPException

from backend import state
from backend.clients import get_music_client, normalize_song_item
from backend.models import SearchRequest, CancelRequest
from utils import logger

router = APIRouter()


def _search_source(client, src: str, keyword: str) -> List[dict]:
    src_client = client.music_clients[src]
    items = src_client.search(keyword=keyword, num_threadings=2)
    out = []
    for item in items:
        item = normalize_song_item(item)
        item['source'] = src
        out.append(item)
    return out


@router.post("/search", response_model=List[dict])
async def search_songs(req: SearchRequest):
    try:
        client = get_music_client()
        sources = list(client.music_clients.keys())
        results = []
        if not sources:
            return results

        tasks = [asyncio.create_task(asyncio.to_thread(_search_source, client, src, req.keyword))
                 for src in sources]
        pending = set(tasks)
        try:
            while pending:
                if state.is_search_cancelled(req.request_id):
                    break
                done, pending = await asyncio.wait(pending, timeout=1, return_when=asyncio.FIRST_COMPLETED)
                for t in done:
                    try:
                        results.extend(t.result())
                    except Exception as e:
                        logger.exception(f"搜索源任务失败: {e}")
        finally:
            for t in pending:
                t.cancel()

        if state.settings.get('dedup'):
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
        state.clear_search_cancelled(req.request_id)


@router.post("/search/cancel")
def cancel_search(req: CancelRequest):
    state.mark_search_cancelled(req.request_id)
    logger.info(f"搜索任务 {req.request_id} 已标记取消")
    return {"ok": True}
