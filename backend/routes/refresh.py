# -*- coding: utf-8 -*-
"""链接刷新"""
from typing import List

from fastapi import APIRouter

from backend.clients import refresh_song_url
from backend.models import RefreshRequest
from utils import logger

router = APIRouter()


@router.post("/refresh", response_model=List[dict])
def refresh_links(req: RefreshRequest):
    refreshed = []
    for song in req.songs:
        try:
            r = refresh_song_url(dict(song))
            if r:
                refreshed.append(r)
        except Exception as e:
            logger.error(f"刷新失败: {e}")
    return refreshed