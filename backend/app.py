# -*- coding: utf-8 -*-
"""FastAPI 应用装配 + 启动入口"""
import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from backend import state
from backend.middleware import LocalNetworkAuthMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 记录事件循环引用，供工作线程做线程安全的 WS 发送
    state.loop = asyncio.get_running_loop()
    # 进程重启后，把 config.json 里持久化的遥控 token 重新注册进内存，
    # 否则设置页会显示链接、但访问报「token 无效或已过期」
    try:
        if state.settings.get('remote_enabled') and state.settings.get('remote_token'):
            from backend import auth
            auth.ensure_token(state.settings['remote_token'])
    except Exception:
        pass
    # 后台清理封面缓存（过期条目 + 总量超限），不阻塞启动
    try:
        asyncio.create_task(asyncio.to_thread(state.cleanup_cover_cache))
    except Exception:
        pass
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="cYy Music API", version="5.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # 局域网鉴权：放在 CORS 之后注册（Starlette 的 middleware 是 LIFO，
    # 先 add 的 CORS 后执行，先执行鉴权再补 CORS 头，OPTIONS 预检不受影响）
    app.add_middleware(LocalNetworkAuthMiddleware)

    from backend.routes import (
        basic, search, playlist_parse, refresh,
        cover, playlist_crypto, stream, download, ws, library, diagnostics,
        library_convert, eq, remote,
    )
    app.include_router(basic.router)
    app.include_router(search.router)
    app.include_router(playlist_parse.router)
    app.include_router(refresh.router)
    app.include_router(cover.router)
    app.include_router(playlist_crypto.router)
    app.include_router(stream.router)
    app.include_router(download.router)
    app.include_router(ws.router)
    app.include_router(library.router)
    app.include_router(diagnostics.router)
    app.include_router(library_convert.router)
    app.include_router(eq.router)
    app.include_router(remote.router)
    return app


app = create_app()


def run_server(port=None):
    if port is None:
        try:
            port = int(os.environ.get('CMC_API_PORT', 8000))
        except Exception:
            port = 8000
    # 绑 0.0.0.0：本地仍走 127.0.0.1 访问不受影响；局域网访问由
    # LocalNetworkAuthMiddleware 控制（remote_enabled=False 时一律拒绝）
    host = os.environ.get('CMC_API_HOST', '0.0.0.0')
    uvicorn.run(app, host=host, port=port, log_level="info")