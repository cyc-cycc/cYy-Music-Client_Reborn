# -*- coding: utf-8 -*-
"""本地库批量格式转换"""
import atexit
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from utils import logger, convert_audio
from backend import library as lib

router = APIRouter()

# 限制并发：ffmpeg 本身 CPU 密集，根据核心数动态调整（2~4 之间）
_CPU = os.cpu_count() or 2
_WORKERS = min(4, max(2, _CPU - 1))
_executor = ThreadPoolExecutor(max_workers=_WORKERS)


def _shutdown_convert_executor():
    try:
        _executor.shutdown(wait=False, cancel_futures=True)
    except TypeError:
        try:
            _executor.shutdown(wait=False)
        except Exception:
            pass
    except Exception:
        pass


atexit.register(_shutdown_convert_executor)

_VALID_FORMATS = ('mp3', 'aac', 'ogg', 'flac')


class ConvertRequest(BaseModel):
    paths: List[str]
    target_format: str
    bitrate: Optional[str] = ''
    keep_original: bool = True
    replace_on_success: bool = False


def _convert_one(path, target_format, bitrate, keep_original, replace_on_success):
    result = {'path': path, 'ok': False, 'out_path': '', 'error': ''}
    if not lib.is_path_allowed(path):
        result['error'] = '路径不允许'
        return result
    if not os.path.isfile(path):
        result['error'] = '文件不存在'
        return result

    src_ext = os.path.splitext(path)[1].lower().lstrip('.')
    if src_ext == target_format:
        result['error'] = f'源格式已是 {target_format.upper()}'
        return result

    try:
        out_path = convert_audio(path, target_format, bitrate or None)
    except Exception as e:
        result['error'] = str(e)
        return result

    if not out_path or not os.path.exists(out_path):
        result['error'] = '转换失败（ffmpeg 未找到或执行错误）'
        return result

    result['out_path'] = out_path
    result['ok'] = True

    if replace_on_success and not keep_original:
        try:
            os.remove(path)
        except Exception as e:
            logger.warning(f"删除原文件失败: {e}")

    return result


@router.post("/library/convert")
def library_convert(req: ConvertRequest):
    paths = req.paths or []
    if not paths:
        return {'ok': 0, 'failed': []}
    if len(paths) > 200:
        raise HTTPException(status_code=400, detail='单次最多转换 200 个文件')

    target_format = (req.target_format or '').lower().lstrip('.')
    if target_format not in _VALID_FORMATS:
        raise HTTPException(status_code=400, detail=f'不支持的目标格式：{target_format}')

    futures = [
        _executor.submit(
            _convert_one, p, target_format, req.bitrate or '',
            bool(req.keep_original), bool(req.replace_on_success),
        )
        for p in paths
    ]

    ok = 0
    failed = []
    for f in as_completed(futures):
        try:
            r = f.result()
        except Exception as e:
            failed.append({'path': '', 'error': str(e)})
            continue
        if r['ok']:
            ok += 1
        else:
            failed.append({'path': r['path'], 'error': r['error']})

    lib.invalidate_cache()
    return {'ok': ok, 'failed': failed}
