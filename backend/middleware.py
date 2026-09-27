# -*- coding: utf-8 -*-
"""局域网访问鉴权中间件。

策略：
- 本地请求（127.0.0.1 / ::1 / ::ffff:127.0.0.1）始终放行 —— Electron 主进程、本地浏览器调试不受影响
- 非本地请求：仅当 settings.remote_enabled=True 且携带有效 token 时放行
- token 通过 Header `X-CMC-Token` 或 Query 参数 `t` 传递（后者便于浏览器直接打开 /remote）
- /、/docs、/redoc、/openapi.json 是纯元信息，不含用户数据，允许匿名访问（便于调试）
"""
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from backend import auth, state

_LOCAL_HOSTS = {'127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1'}
_ANON_PATHS = {'/', '/docs', '/redoc', '/openapi.json'}


def is_local_request(request_or_ws) -> bool:
    """判断请求是否来自本机。request 与 websocket 都适用（都有 .client.host）。"""
    try:
        client = getattr(request_or_ws, 'client', None)
        if client and client.host in _LOCAL_HOSTS:
            return True
    except Exception:
        pass
    return False


def extract_token(request_or_ws) -> str:
    try:
        t = request_or_ws.headers.get('x-cmc-token')
        if t:
            return t
        qp = getattr(request_or_ws, 'query_params', None)
        if qp is not None:
            return qp.get('t', '') or ''
    except Exception:
        pass
    return ''


class LocalNetworkAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path in _ANON_PATHS:
            return await call_next(request)
        if is_local_request(request):
            return await call_next(request)

        if not state.settings.get('remote_enabled', False):
            return JSONResponse(status_code=403,
                                content={'detail': '遥控/投送未启用'})
        if not auth.validate_token(extract_token(request)):
            return JSONResponse(status_code=401,
                                content={'detail': 'token 无效或已过期'})
        return await call_next(request)