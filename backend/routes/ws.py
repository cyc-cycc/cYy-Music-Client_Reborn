# -*- coding: utf-8 -*-
"""WebSocket：接收取消指令；广播由 backend.broadcast 主动推送"""
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend import auth, state
from backend.middleware import extract_token, is_local_request
from utils import logger

router = APIRouter()

# 非标准关闭码，方便前端区分“未启用”与“token 无效”
WS_CLOSE_NOT_ENABLED = 4403
WS_CLOSE_UNAUTHORIZED = 4401

_MAX_WS_MSG_BYTES = 16 * 1024


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # 局域网鉴权（BaseHTTPMiddleware 不覆盖 WS，所以在这里手动做）
    if not is_local_request(websocket):
        if not state.settings.get('remote_enabled', False):
            await websocket.close(code=WS_CLOSE_NOT_ENABLED)
            return
        if not auth.validate_token(extract_token(websocket)):
            await websocket.close(code=WS_CLOSE_UNAUTHORIZED)
            return

    await websocket.accept()
    with state.ws_lock:
        state.active_websockets.append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if len(data) > _MAX_WS_MSG_BYTES:
                logger.warning(f'主 WS 收到超大消息（{len(data)}B），丢弃')
                continue
            try:
                msg = json.loads(data)
                if msg.get('action') == 'cancel':
                    task_id = msg.get('task_id')
                    exists = False
                    with state.download_lock:
                        task = state.download_tasks.get(task_id)
                        if task is not None:
                            task['stop'].set()
                            exists = True
                    if exists:
                        await websocket.send_text(
                            json.dumps({"type": "cancelled", "task_id": task_id})
                        )
                    else:
                        await websocket.send_text(
                            json.dumps({"type": "error", "message": f"任务 {task_id} 不存在"})
                        )
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket 异常: {e}")
    finally:
        with state.ws_lock:
            if websocket in state.active_websockets:
                state.active_websockets.remove(websocket)