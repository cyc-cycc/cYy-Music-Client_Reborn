# -*- coding: utf-8 -*-
"""基础 API：健康检查、设置读写、前端选项、设置导入/导出/重置"""
import json as _json
import copy as _copy

from fastapi import APIRouter, HTTPException

from constants import (
    SOURCE_GROUPS, SOURCE_INTERNAL, FILENAME_FORMATS, GROUP_BY_OPTIONS,
    THEMES, PLAYLIST_SOURCE_MAP, DEFAULT_SAVE_DIR,
)
from backend import state
from backend.clients import reset_music_client, reset_all_clients
from backend.console_capture import apply as apply_console_capture

router = APIRouter()


@router.get("/")
def root():
    return {"message": "cYy Music API is running", "status": "ok"}


@router.get("/settings")
def get_settings():
    return state.settings


# 影响 MusicClient 初始化配置的字段
_CLIENT_AFFECTING_SOURCES = 'sources'   # 源列表：影响两个客户端
_CLIENT_AFFECTING_LIMIT = 'limit'       # 每源条数：只影响搜索/解析客户端


@router.post("/settings")
def update_settings(patch: dict):
    keys = set(patch.keys())
    # 仅内存更新 + 客户端重置放在锁内
    with state.client_lock:
        state.settings.update(patch)
        if _CLIENT_AFFECTING_SOURCES in keys:
            reset_all_clients()
        elif _CLIENT_AFFECTING_LIMIT in keys:
            reset_music_client()
    # 磁盘 I/O 移出锁外，避免阻塞其他需要 client_lock 的请求
    from config import save_settings
    save_settings(state.settings)
    apply_console_capture()
    return {"message": "Settings updated"}


# ==================== 设置重置 / 导入 ====================
def _defaults() -> dict:
    """返回一份 DEFAULT_SETTINGS 的深拷贝。"""
    from config import DEFAULT_SETTINGS
    return _copy.deepcopy(DEFAULT_SETTINGS)


def _sanitize(incoming: dict) -> dict:
    """只接受 DEFAULT_SETTINGS 中已声明的字段，嵌套 eq 也做白名单。"""
    defaults = _defaults()
    merged = dict(defaults)
    if not isinstance(incoming, dict):
        return merged
    for k, v in incoming.items():
        if k in defaults:
            merged[k] = v
    # eq 嵌套合并：保证结构完整
    if isinstance(merged.get('eq'), dict):
        base_eq = defaults.get('eq') or {}
        for k, v in base_eq.items():
            merged['eq'].setdefault(k, v)
        # bands 长度校验（10 段），长度不对则丢弃
        bands = merged['eq'].get('bands')
        if not isinstance(bands, list) or len(bands) != 10:
            merged['eq']['bands'] = base_eq.get('bands', [0] * 10)
    return merged


def _apply_settings(new_settings: dict) -> None:
    """原地替换 state.settings，重置客户端，写盘，重启控制台捕获。"""
    from config import save_settings
    with state.client_lock:
        state.settings.clear()
        state.settings.update(new_settings)
        reset_all_clients()
    save_settings(state.settings)
    apply_console_capture()


@router.post("/settings/reset")
def reset_settings():
    """把 config.json 恢复为默认值（搜索源、下载、主题、EQ 等全部重置）。"""
    defaults = _defaults()
    try:
        _apply_settings(defaults)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"重置失败: {e}")
    return {"message": "Settings reset to defaults", "settings": state.settings}


@router.post("/settings/import")
def import_settings(payload: dict):
    """导入设置：只接受已知字段，缺失字段用默认值补齐。

    请求体可以是：
      - 直接的 settings 对象：{"sources": [...], "theme": "dark", ...}
      - 或包一层：{"settings": {...}}
    两者都兼容。未知字段会被静默忽略。
    """
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="请求体必须是 JSON 对象")

    incoming = payload.get('settings') if 'settings' in payload else payload
    if not isinstance(incoming, dict):
        raise HTTPException(status_code=400, detail="settings 必须是 JSON 对象")

    merged = _sanitize(incoming)
    try:
        _apply_settings(merged)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"导入失败: {e}")
    return {"message": "Settings imported", "settings": state.settings}


@router.get("/settings/options")
def get_settings_options():
    return {
        'source_groups': SOURCE_GROUPS,
        'source_internal': SOURCE_INTERNAL,
        'filename_formats': FILENAME_FORMATS,
        'group_by_options': GROUP_BY_OPTIONS,
        'playlist_sources': list(PLAYLIST_SOURCE_MAP.keys()),
        'playlist_source_map': PLAYLIST_SOURCE_MAP,
        'themes': {k: v['display_name'] for k, v in THEMES.items()},
        'default_save_dir': DEFAULT_SAVE_DIR,
    }