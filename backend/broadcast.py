# -*- coding: utf-8 -*-
"""WebSocket 广播：工作线程 → 事件循环的线程安全发送（fire-and-forget）"""
import asyncio
import json

from backend import state


def _consume_ws_fut(fut):
    """消费 run_coroutine_threadsafe 的 Future：避免未观察异常告警"""
    try:
        if not fut.cancelled():
            fut.exception()
    except Exception:
        pass


def ws_send(ws, payload: dict):
    if state.loop is None:
        return
    try:
        fut = asyncio.run_coroutine_threadsafe(
            ws.send_text(json.dumps(payload, ensure_ascii=False)), state.loop)
        fut.add_done_callback(_consume_ws_fut)
    except Exception:
        pass


def broadcast(payload: dict):
    with state.ws_lock:
        ws_list = list(state.active_websockets)
    for ws in ws_list:
        ws_send(ws, payload)


def broadcast_remote(payload: dict):
    """向所有遥控端 WS 连接推送（与主窗口 active_websockets 分开）"""
    with state.remote_ws_lock:
        ws_list = list(state.remote_websockets)
    for ws in ws_list:
        ws_send(ws, payload)