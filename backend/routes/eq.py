# -*- coding: utf-8 -*-
"""均衡器预设：列出 / 导入 / 导出 / 删除。

- 内置预设仍在前端 EQ_PRESETS 常量中（含 flat/pop/rock/...）
- 本路由只管理"用户自定义"预设，存到 {DATA_DIR}/.CMC/eq_presets/*.json
- 文件名由预设名 sanitize 得到；重名覆盖
"""
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from constants import DATA_DIR
from utils import atomic_write, logger

router = APIRouter()

_PRESET_DIR = Path(DATA_DIR) / '.CMC' / 'eq_presets'

_NAME_RE = re.compile(r'^[\w\u4e00-\u9fa5 .\-+()\[\]]{1,60}$')
_BANDS_LEN = 10
_GAIN_MIN, _GAIN_MAX = -12.0, 12.0


class PresetImportRequest(BaseModel):
    content: str  # 原始 JSON 文本


def _validate(data: Any) -> Dict:
    if not isinstance(data, dict):
        raise ValueError('预设必须是 JSON 对象')
    name = str(data.get('name', '')).strip()
    if not _NAME_RE.match(name):
        raise ValueError('预设名不合法（1-60 字符：字母/数字/中文/空格/常见符号）')
    bands = data.get('bands')
    if not isinstance(bands, list) or len(bands) != _BANDS_LEN:
        raise ValueError(f'bands 必须是长度 {_BANDS_LEN} 的数组')
    norm_bands = []
    for g in bands:
        try:
            v = float(g)
        except (TypeError, ValueError):
            raise ValueError('bands 中含非数字项')
        norm_bands.append(round(max(_GAIN_MIN, min(_GAIN_MAX, v)), 2))
    return {
        'name': name,
        'version': int(data.get('version', 1) or 1),
        'bands': norm_bands,
        'bass': bool(data.get('bass', False)),
        'treble': bool(data.get('treble', False)),
        'vocal': bool(data.get('vocal', False)),
        'vocal_cancel': bool(data.get('vocal_cancel', False)),
        'vocal_cancel_amount': max(0, min(100, int(data.get('vocal_cancel_amount', 100) or 0))),
        'preamp': float(data.get('preamp', 0) or 0),
    }


def _read(path: Path) -> Dict:
    with open(path, 'r', encoding='utf-8') as f:
        return _validate(json.load(f))


def _safe_filename(name: str) -> str:
    safe = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', name).strip().rstrip('.')
    return (safe or 'preset') + '.json'


@router.get("/eq/presets")
def list_presets():
    _PRESET_DIR.mkdir(parents=True, exist_ok=True)
    out: List[Dict] = []
    for fn in sorted(os.listdir(_PRESET_DIR)):
        if not fn.lower().endswith('.json'):
            continue
        try:
            out.append(_read(_PRESET_DIR / fn))
        except Exception as e:
            logger.warning(f"跳过无效预设 {fn}: {e}")
    return {'user': out}


@router.post("/eq/presets/import")
def import_preset(req: PresetImportRequest):
    try:
        data = json.loads(req.content)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f'JSON 解析失败: {e}')
    try:
        preset = _validate(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    _PRESET_DIR.mkdir(parents=True, exist_ok=True)
    target = _PRESET_DIR / _safe_filename(preset['name'])
    try:
        atomic_write(json.dumps(preset, ensure_ascii=False, indent=2).encode('utf-8'), str(target))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'保存失败: {e}')
    return {'ok': True, 'name': preset['name'], 'path': str(target)}


@router.get("/eq/presets/export")
def export_preset(name: str):
    if not _PRESET_DIR.is_dir():
        raise HTTPException(status_code=404, detail='无用户预设')
    for fn in os.listdir(_PRESET_DIR):
        if not fn.lower().endswith('.json'):
            continue
        try:
            preset = _read(_PRESET_DIR / fn)
        except Exception:
            continue
        if preset['name'] == name:
            return {'ok': True, 'content': json.dumps(preset, ensure_ascii=False, indent=2)}
    raise HTTPException(status_code=404, detail=f'未找到预设: {name}')


@router.delete("/eq/presets/{name}")
def delete_preset(name: str):
    if not _PRESET_DIR.is_dir():
        raise HTTPException(status_code=404, detail='无用户预设')
    for fn in os.listdir(_PRESET_DIR):
        if not fn.lower().endswith('.json'):
            continue
        p = _PRESET_DIR / fn
        try:
            preset = _read(p)
        except Exception:
            continue
        if preset['name'] == name:
            try:
                p.unlink()
            except Exception as e:
                raise HTTPException(status_code=500, detail=f'删除失败: {e}')
            return {'ok': True}
    raise HTTPException(status_code=404, detail=f'未找到用户预设: {name}')