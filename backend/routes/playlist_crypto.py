# -*- coding: utf-8 -*-
"""歌单加密保存 / 解密加载（Fernet）"""
import base64
import hashlib
import json

from fastapi import APIRouter, HTTPException

from constants import ENCRYPTION_PASSWORD
from backend.models import PlaylistEncryptRequest, PlaylistDecryptRequest
from utils import logger

router = APIRouter()


def _playlist_fernet():
    from cryptography.fernet import Fernet  # 延迟导入，缩短启动时间
    key = base64.urlsafe_b64encode(hashlib.sha256(ENCRYPTION_PASSWORD.encode()).digest())
    return Fernet(key)


@router.post("/playlist/encrypt")
def playlist_encrypt(req: PlaylistEncryptRequest):
    try:
        data = json.dumps(req.songs, ensure_ascii=False, indent=2).encode('utf-8')
        encrypted = _playlist_fernet().encrypt(data)
        return {"content": "ENCRYPTED:" + base64.b64encode(encrypted).decode('ascii')}
    except Exception as e:
        logger.error(f"歌单加密失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/playlist/decrypt")
def playlist_decrypt(req: PlaylistDecryptRequest):
    try:
        content = req.content
        if content.startswith("ENCRYPTED:"):
            encrypted_b64 = content[len("ENCRYPTED:"):]
            data = _playlist_fernet().decrypt(base64.b64decode(encrypted_b64))
        else:
            data = content.encode('utf-8')
        songs = json.loads(data.decode('utf-8'))
        if not isinstance(songs, list):
            raise ValueError("无效的歌单格式，应为数组")
        return {"songs": songs}
    except Exception as e:
        logger.error(f"歌单解密失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))