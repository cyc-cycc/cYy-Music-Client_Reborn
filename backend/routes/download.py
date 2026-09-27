# -*- coding: utf-8 -*-
"""下载任务：启动、取消、状态查询"""
import atexit
import os
import threading
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException

from constants import DEFAULT_SAVE_DIR
from backend import state
from backend.downloader import download_song_task
from backend.models import DownloadRequest, CancelTaskRequest

router = APIRouter()

# 全局下载线程池：与 downloader.download_song_task 内部的 BoundedSemaphore(3) 对齐，
# 线程数 = 信号量上限，避免多余线程阻塞在 acquire() 上
_download_executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix='dl')

# 进程退出时不再接受新任务；允许运行中的任务自然结束
def _shutdown_download_executor():
    try:
        _download_executor.shutdown(wait=False, cancel_futures=True)
    except TypeError:
        # Python < 3.9 无 cancel_futures 参数
        try:
            _download_executor.shutdown(wait=False)
        except Exception:
            pass
    except Exception:
        pass

atexit.register(_shutdown_download_executor)


# 全局未完成任务上限：防止多次并发提交造成队列爆炸
_MAX_PENDING_TASKS = 500


@router.post("/download")
def start_downloads(req: DownloadRequest):
    if len(req.songs) > 200:
        raise HTTPException(status_code=400, detail="单次下载最多 200 首，请分批提交")

    # 检查未完成任务总数（背压）
    with state.download_lock:
        pending = len(state.download_tasks)
    if pending + len(req.songs) > _MAX_PENDING_TASKS:
        raise HTTPException(
            status_code=429,
            detail=f"下载队列已满（{pending}/{_MAX_PENDING_TASKS}），请等待现有任务完成后再提交"
        )

    save_dir = req.save_dir or state.settings.get('save_dir', DEFAULT_SAVE_DIR)
    try:
        os.makedirs(save_dir, exist_ok=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"无法创建目录: {e}")

    # 快照 settings：运行中改设置不影响本批次任务
    settings_snapshot = dict(state.settings)
    task_ids = []
    for song in req.songs:
        task_id = state.next_task_id()
        stop_event = threading.Event()
        with state.download_lock:
            state.download_tasks[task_id] = {'stop': stop_event}
        state.record_task_status(task_id, str(song.get('song_name', '')), 0, 'pending')
        _download_executor.submit(download_song_task, song, save_dir, task_id, settings_snapshot)
        task_ids.append(task_id)
    return {"task_ids": task_ids}


@router.post("/download/cancel")
def cancel_download_http(req: CancelTaskRequest):
    """HTTP 取消下载（WS 不可用时的回退），与 WS cancel 等价"""
    with state.download_lock:
        task = state.download_tasks.get(req.task_id)
        if not task:
            raise HTTPException(status_code=404, detail=f"任务 {req.task_id} 不存在")
        task['stop'].set()
    return {"ok": True, "task_id": req.task_id}


@router.get("/tasks")
def get_task_status():
    """最近任务状态历史（前端 WS 断开/重连时轮询对账用）"""
    with state.task_history_lock:
        return {"tasks": {str(k): v for k, v in state.task_status_history.items()}}
