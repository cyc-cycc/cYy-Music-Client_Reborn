# -*- coding: utf-8 -*-
"""局域网配对鉴权 token 管理。

设计要点：
- token 用 secrets.token_urlsafe(24) 生成，约 32 字符，暴力破解不可行
- 默认 8 小时 TTL，可调
- 只在 remote_enabled=True 时才有 token 可用（关闭遥控即 revoke_all）
- 线程安全：FastAPI 的 sync route、WS 握手线程会并发访问
- 每台客户端可使用同一 token（简单、够用）；如需每设备独立 token，改造成 map 即可

持久化说明：
- remote_token 会写入 config.json，但内存 _tokens 在进程重启后清空。
- 因此启动时必须调用 ensure_token()，把磁盘上的 token 重新注册进内存，
  否则会出现「设置页显示链接，但访问报 token 无效」的脱节。
"""
import secrets
import threading
import time
from typing import Optional

_TOKEN_TTL = 8 * 3600
_lock = threading.Lock()
_tokens: dict = {}  # token -> expiry_ts


def generate_token(ttl: int = _TOKEN_TTL) -> str:
    token = secrets.token_urlsafe(24)
    with _lock:
        _prune_locked()
        _tokens[token] = time.time() + ttl
    return token


def ensure_token(token: Optional[str], ttl: int = _TOKEN_TTL) -> bool:
    """确保 token 在内存中有效（用于进程重启后从 settings 恢复）。

    返回 True 表示 token 之前已存在，False 表示本次新注册。
    token 为空时返回 False。
    """
    if not token:
        return False
    with _lock:
        _prune_locked()
        if token in _tokens:
            return True
        _tokens[token] = time.time() + ttl
        return False


def revoke_all() -> None:
    with _lock:
        _tokens.clear()


def validate_token(token: Optional[str]) -> bool:
    if not token:
        return False
    with _lock:
        _prune_locked()
        exp = _tokens.get(token)
        if exp is None:
            return False
        if time.time() > exp:
            _tokens.pop(token, None)
            return False
        return True


def has_active_tokens() -> bool:
    with _lock:
        _prune_locked()
        return bool(_tokens)


def _prune_locked() -> None:
    now = time.time()
    for t in [k for k, e in _tokens.items() if now > e]:
        _tokens.pop(t, None)