# -*- coding: utf-8 -*-
"""封面代理（带磁盘缓存）"""
import hashlib
import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from backend import state
from backend.clients import get_request_kwargs_for_source
from utils import _download_image_data, logger

router = APIRouter()


@router.get("/cover")
def cover_proxy(url: str, source: str = ""):
    if not url:
        raise HTTPException(status_code=400, detail="缺少 url 参数")
    if not (url.startswith('http://') or url.startswith('https://')):
        raise HTTPException(status_code=400, detail="仅支持 http/https 图片")
    digest = hashlib.sha256(url.encode('utf-8')).hexdigest()
    try:
        cache_file = None
        for ext in ('.jpg', '.png'):
            cand = os.path.join(state.cover_cache_dir, digest + ext)
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
        cache_file = os.path.join(state.cover_cache_dir, digest + '.' + ext)
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