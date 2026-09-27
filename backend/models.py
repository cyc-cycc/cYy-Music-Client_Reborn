# -*- coding: utf-8 -*-
"""Pydantic 请求模型"""
from typing import List, Optional

from pydantic import BaseModel


class SearchRequest(BaseModel):
    keyword: str
    sources: Optional[List[str]] = None
    request_id: Optional[str] = None


class CancelRequest(BaseModel):
    request_id: str


class ParsePlaylistRequest(BaseModel):
    url: str
    source_display: str
    request_id: Optional[str] = None


class DownloadRequest(BaseModel):
    songs: List[dict]
    save_dir: Optional[str] = None


class CancelTaskRequest(BaseModel):
    task_id: int


class RefreshRequest(BaseModel):
    songs: List[dict]


class PlaylistEncryptRequest(BaseModel):
    songs: List[dict]


class PlaylistDecryptRequest(BaseModel):
    content: str