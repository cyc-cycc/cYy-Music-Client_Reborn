// ==================== 下载管理 + WebSocket ====================

// ---------- 下载核心（可被搜索结果 / 在线歌单复用） ----------
async function startDownload(songs) {
  if (!songs || !songs.length) return;
  if (songs.length > 200) { setStats('单次下载最多 200 首，请分批勾选'); return; }
  setStats('正在刷新链接...');
  try {
    const refreshed = await postJSON('/refresh', { songs });
    const map = new Map();
    for (const r of refreshed) {
      const key = r.identifier || r.song_id || `${r.song_name}|${r.singers}`;
      map.set(key, r);
    }
    const toDownload = songs.map(s => {
      const key = s.identifier || s.song_id || `${s.song_name}|${s.singers}`;
      return map.get(key) || s;
    });
    if (!toDownload.length) { setStats('无可下载歌曲'); return; }
    const data = await postJSON('/download', { songs: toDownload });
    initDownloadTasks(data.task_ids, toDownload);
  } catch (e) {
    setStats(`启动下载失败: ${e.message}`);
  }
}

// ---------- 下载入口：搜索结果勾选 ----------
downloadSelectedBtn.addEventListener('click', downloadSelected);

async function downloadSelected() {
  const songs = getSelectedResults();
  if (!songs.length) { setStats('请先勾选要下载的歌曲'); return; }
  downloadSelectedBtn.disabled = true;
  try {
    await startDownload(songs);
  } finally {
    downloadSelectedBtn.disabled = false;
  }
}

// ---------- 下载任务管理 ----------
function initDownloadTasks(taskIds, songs) {
  // 清理已完成/已失败/已取消的旧任务，保留仍在进行中的
  for (const [tid, t] of [...state.downloads]) {
    if (t.status === 'done' || t.status === 'error' || t.status === 'cancelled') {
      state.downloads.delete(tid);
    }
  }
  const stillPending = [...state.downloads.values()].some(
    t => t.status === 'pending' || t.status === 'progress'
  );
  if (!stillPending) {
    state.downloadDone = 0;
    state.downloadTotal = 0;
    state.downloadStartTime = Date.now();
  }
  state.downloadTotal += songs.length;
  taskIds.forEach((tid, i) => {
    state.downloads.set(tid, { song: songs[i], percent: 0, status: 'pending' });
  });
  renderDownloadTasks();
  cancelAllBtn.disabled = false;
  startTaskReconcile();
  setStats(`已提交 ${songs.length} 首下载任务（共 ${state.downloadTotal} 首）`);
}

function applyTaskResult(tid, status, percent) {
  const task = state.downloads.get(tid);
  if (!task) return;
  const terminal = ['done', 'error', 'cancelled'].includes(status);
  if (terminal && ['done', 'error', 'cancelled'].includes(task.status)) return;
  task.status = status;
  if (status === 'progress' && percent != null) task.percent = percent;
  else if (status === 'done') task.percent = 100;
  if (terminal) state.downloadDone += 1;
  renderDownloadTasks();
  updateDownloadProgress();
  if (state.downloadTotal > 0 && state.downloadDone >= state.downloadTotal) stopTaskReconcile();
}

async function reconcileTasks() {
  if (!state.downloads.size) return;
  try {
    const resp = await fetch(`${API_BASE}/tasks`);
    const data = await resp.json();
    const tasks = data.tasks || {};
    state.downloads.forEach((t, tid) => {
      const s = tasks[String(tid)];
      if (s) applyTaskResult(tid, s.status, s.percent);
    });
  } catch (e) {}
}

// 对账策略：WS 连通时不需要轮询；WS 断开时才启用 HTTP 轮询兜底
function startTaskReconcile() {
  stopTaskReconcile();
  if (!state.downloads.size) return;
  if (state.ws && state.ws.readyState === WebSocket.OPEN) return;  // WS 可用，无需轮询
  state.taskReconcileTimer = setInterval(reconcileTasks, 8000);
}
function stopTaskReconcile() {
  if (state.taskReconcileTimer) {
    clearInterval(state.taskReconcileTimer);
    state.taskReconcileTimer = null;
  }
}

function renderDownloadTasks() {
  downloadTasksList.innerHTML = '';
  state.downloads.forEach((t, tid) => {
    const div = document.createElement('div');
    div.className = 'task-item';
    div.id = `task-${tid}`;
    const statusText = t.status === 'done' ? '完成'
      : t.status === 'error' ? '失败'
      : t.status === 'cancelled' ? '已取消' : '';
    div.innerHTML = `
      <span class="task-name">${escapeHtml(t.song.song_name || '未知歌曲')}</span>
      <div class="task-track"><div class="task-bar" id="progress-${tid}" style="width:${t.percent}%"></div></div>
      <span class="task-pct" id="pct-${tid}">${t.status === 'done' ? '100%' : t.percent + '%'}</span>
      <span class="task-status">${statusText}</span>
      <button class="cancel-task" data-task="${tid}">取消</button>
    `;
    const cancelBtn = div.querySelector('.cancel-task');
    if (t.status === 'done' || t.status === 'error' || t.status === 'cancelled') {
      cancelBtn.style.display = 'none';
    }
    cancelBtn.addEventListener('click', () => cancelDownload(tid));
    downloadTasksList.appendChild(div);
  });
}

function updateDownloadProgress() {
  const total = state.downloadTotal;
  if (!total) return;

  // 从 state.downloads 实时推导，避免 downloadDone 因取消/清理而漂移
  let done = 0, failed = 0, cancelled = 0;
  for (const t of state.downloads.values()) {
    if (t.status === 'done') done++;
    else if (t.status === 'error') failed++;
    else if (t.status === 'cancelled') cancelled++;
  }
  const finished = done + failed + cancelled;
  const pct = Math.round(finished / total * 100);
  barOverall.style.width = pct + '%';

  const elapsed = (Date.now() - (state.downloadStartTime || Date.now())) / 1000;
  let eta = '';
  if (finished > 0 && elapsed > 1 && finished < total) {
    const progress = finished / total;
    const etaSec = (elapsed / progress) - elapsed;
    eta = etaSec > 0 ? `剩余: ${formatTime(etaSec)}` : '即将完成';
  }
  setStats(`已完成 ${finished}/${total}  ${eta}`);

  if (finished >= total) {
    cancelAllBtn.disabled = true;
    const parts = [];
    if (done) parts.push(`成功 ${done}`);
    if (failed) parts.push(`失败 ${failed}`);
    if (cancelled) parts.push(`已取消 ${cancelled}`);
    setStats(`所有下载任务已结束（共 ${total} 首）${parts.length ? '，' + parts.join('，') : ''}`);
  }
}

function cancelDownload(taskId) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    try {
      state.ws.send(JSON.stringify({ action: 'cancel', task_id: taskId }));
      return;
    } catch (e) {}
  }
  fetch(`${API_BASE}/download/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId })
  }).catch(() => {});
}

cancelAllBtn.addEventListener('click', cancelAllDownloads);
function cancelAllDownloads() {
  state.downloads.forEach((t, tid) => {
    if (t.status === 'pending' || t.status === 'progress') cancelDownload(tid);
  });
  cancelAllBtn.disabled = true;
  setStats('正在取消全部下载...');
}

// ---------- WebSocket ----------
function connectWebSocket() {
  state.ws = new WebSocket(WS_URL);
  state.ws.onopen = () => {
    console.log('WebSocket 已连接');
    // WS 恢复：停止 HTTP 轮询，做一次对账确保状态一致
    stopTaskReconcile();
    if (state.downloads.size) reconcileTasks();
  };
  state.ws.onmessage = (event) => {
    try { handleWSMessage(JSON.parse(event.data)); }
    catch (e) { console.error('解析 WS 消息失败:', e); }
  };
  state.ws.onclose = (ev) => {
    // 4401/4403 是鉴权失败或被禁用，不再重连
    if (ev && (ev.code === 4401 || ev.code === 4403)) {
      console.warn('WebSocket 被拒绝，停止重连:', ev.code);
      if (ev.code === 4403) setStats('后端已禁用局域网访问');
      else setStats('WebSocket 鉴权失败');
      return;
    }
    if (state.downloads.size) startTaskReconcile();
    setTimeout(connectWebSocket, 3000);
  };
  state.ws.onerror = (err) => console.error('WebSocket 错误:', err);
}

function handleWSMessage(data) {
  if (data.type === 'search_progress') { handleSearchProgressWS(data); return; }
  if (data.type === 'parse_progress') { handleParseProgressWS(data); return; }
  // 手机遥控端发来的动作 → 转发给 handlePlayerAction
  if (data.type === 'remote_action' && data.action) {
    if (typeof handlePlayerAction === 'function') {
      try { handlePlayerAction(data.action); } catch (e) { console.error(e); }
    }
    return;
  }
  const tid = data.task_id;
  if (tid == null) return;
  if (data.type === 'progress') {
    applyTaskResult(tid, 'progress', data.percent);
  } else if (data.type === 'done' || data.type === 'error' || data.type === 'cancelled') {
    applyTaskResult(tid, data.type, data.type === 'done' ? 100 : null);
  }
}