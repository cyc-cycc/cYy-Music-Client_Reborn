# -*- coding: utf-8 -*-
"""本地音乐库 API：扫描 / 歌词 / 播放 / 封面 / 重命名 / 标签编辑"""
import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from constants import DEFAULT_SAVE_DIR
from backend import state
from backend import library as lib

router = APIRouter()


class ScanRequest(BaseModel):
    dir: Optional[str] = None
    force: bool = False
    encoding: Optional[str] = 'UTF-8'


class RenameItem(BaseModel):
    path: str
    new_name: str


class RenameRequest(BaseModel):
    items: List[RenameItem]


class TagsRequest(BaseModel):
    paths: List[str]
    patch: dict
    encoding: Optional[str] = 'UTF-8'


# 与 backend.library.write_tags 的 KEY_MAP 一致
_ALLOWED_TAG_KEYS = {'title', 'artist', 'album', 'year', 'genre', 'track', 'disc'}

_MIME_MAP = {
    'mp3': 'audio/mpeg', 'm4a': 'audio/mp4', 'm4b': 'audio/mp4', 'aac': 'audio/aac',
    'flac': 'audio/flac', 'ogg': 'audio/ogg', 'opus': 'audio/ogg',
    'wav': 'audio/wav', 'webm': 'audio/webm', 'ape': 'audio/x-ape', 'wma': 'audio/x-ms-wma',
}


# ---------- 扫描 / 信息 ----------
@router.post("/library/scan")
def scan_library(req: ScanRequest):
    try:
        result = lib.scan(root=req.dir or None, force=bool(req.force),
                          encoding=req.encoding or 'UTF-8')
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/library/info")
def library_info():
    use_custom = bool(state.settings.get('library_use_custom'))
    custom_dir = (state.settings.get('library_dir') or '').strip()
    save_dir = (state.settings.get('save_dir') or '').strip() or DEFAULT_SAVE_DIR
    effective = custom_dir if (use_custom and custom_dir) else save_dir
    return {
        'use_custom': use_custom,
        'custom_dir': custom_dir,
        'save_dir': save_dir,
        'effective_dir': effective,
        'encoding': state.settings.get('library_encoding', 'UTF-8'),
    }


# ---------- 播放 / 封面 / 歌词 ----------
@router.get("/library/file")
def library_file(path: str):
    if not lib.is_path_allowed(path):
        raise HTTPException(status_code=403, detail="路径不允许")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="文件不存在")
    ext = os.path.splitext(path)[1].lower().lstrip('.')
    mime = _MIME_MAP.get(ext, 'application/octet-stream')
    return FileResponse(path, media_type=mime)


@router.get("/library/cover")
def library_cover(path: str):
    if not lib.is_path_allowed(path):
        raise HTTPException(status_code=403, detail="路径不允许")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="文件不存在")
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(path)
        if audio is None:
            raise HTTPException(status_code=404, detail="无法解析文件")
        tags = getattr(audio, 'tags', None)
        if tags is not None and hasattr(tags, 'getall'):
            apics = tags.getall('APIC')
            if apics:
                mime = getattr(apics[0], 'mime', '') or 'image/jpeg'
                return Response(content=apics[0].data, media_type=mime)
        if tags is not None and 'covr' in tags:
            covr = tags['covr']
            if covr:
                data = bytes(covr[0])
                fmt = getattr(covr[0], 'imageformat', None)
                mime = 'image/png' if fmt == 14 else 'image/jpeg'
                return Response(content=data, media_type=mime)
        pics = getattr(audio, 'pictures', None)
        if pics:
            return Response(content=pics[0].data, media_type=pics[0].mime or 'image/jpeg')
        raise HTTPException(status_code=404, detail="无内嵌封面")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/library/lyrics")
def library_lyrics(path: str, encoding: str = 'UTF-8'):
    if not lib.is_path_allowed(path):
        raise HTTPException(status_code=403, detail="路径不允许")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="文件不存在")
    try:
        lyrics, source = lib.read_lyrics(path, encoding)
        return {'lyrics': lyrics, 'source': source}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------- 批量重命名 ----------
@router.post("/library/rename")
def library_rename(req: RenameRequest):
    items = req.items or []
    if not items:
        return {'ok': 0, 'failed': []}
    if len(items) > 500:
        raise HTTPException(status_code=400, detail="单次最多重命名 500 个文件")

    ok = 0
    failed = []
    planned = []
    targets = set()

    for item in items:
        path = item.path
        new_name = item.new_name
        if not path or not new_name:
            failed.append({'path': path or '', 'error': '参数缺失'})
            continue
        if not lib.is_path_allowed(path):
            failed.append({'path': path, 'error': '路径不允许'})
            continue
        if not os.path.isfile(path):
            failed.append({'path': path, 'error': '文件不存在'})
            continue

        src_ext = os.path.splitext(path)[1]
        safe_name = lib.sanitize_filename(new_name)
        if not safe_name.lower().endswith(src_ext.lower()):
            safe_name = safe_name + src_ext
        new_path = os.path.join(os.path.dirname(path), safe_name)
        if os.path.realpath(new_path) == os.path.realpath(path):
            failed.append({'path': path, 'error': '文件名未变'})
            continue
        if os.path.exists(new_path):
            failed.append({'path': path, 'error': f'目标已存在: {safe_name}'})
            continue
        real_new = os.path.realpath(new_path)
        if real_new in targets:
            failed.append({'path': path, 'error': f'多文件同名: {safe_name}'})
            continue
        targets.add(real_new)
        planned.append((path, new_path))

    for src, dst in planned:
        try:
            os.rename(src, dst)
            ok += 1
        except Exception as e:
            failed.append({'path': src, 'error': str(e)})

    lib.invalidate_cache()
    return {'ok': ok, 'failed': failed}


# ---------- 批量编辑标签 ----------
@router.post("/library/tags")
def library_tags(req: TagsRequest):
    paths = req.paths or []
    raw_patch = req.patch or {}
    # 白名单过滤：只允许已知字段写入，防止将来 KEY_MAP 之外的字段被悄悄丢弃
    patch = {k: v for k, v in raw_patch.items() if k in _ALLOWED_TAG_KEYS}

    if not paths:
        return {'ok': 0, 'failed': []}
    if len(paths) > 500:
        raise HTTPException(status_code=400, detail="单次最多编辑 500 个文件")
    if not patch:
        return {'ok': 0, 'failed': []}

    ok = 0
    failed = []
    for path in paths:
        if not lib.is_path_allowed(path):
            failed.append({'path': path, 'error': '路径不允许'})
            continue
        if not os.path.isfile(path):
            failed.append({'path': path, 'error': '文件不存在'})
            continue
        try:
            lib.write_tags(path, patch)
            ok += 1
        except Exception as e:
            failed.append({'path': path, 'error': str(e)})

    lib.invalidate_cache()
    return {'ok': ok, 'failed': failed}
