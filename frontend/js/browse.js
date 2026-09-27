// ==================== 搜索、歌单解析、播放列表 ====================

let searchAbortController = null;
let searchRequestId = 0;

// ---------- 多选控制器（搜索结果） ----------
let resultSelection = null;

// ---------- 搜索进度 ----------
function showSearchProgress(show, text) {
  const el = $('search-progress');
  if (!el) return;
  if (!show) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'block';
  if (text) el.innerHTML = `<div class="sp-line"><span class="sp-dot"></span><span>${escapeHtml(text)}</span></div>`;
}
function clearSearchProgress() {
  const el = $('search-progress');
  if (!el) return;
  el.innerHTML = '';
  el.style.display = 'block';
}
function renderSearchProgress() {
  const el = $('search-progress');
  if (!el) return;
  const lines = Object.values(state.searchProgressMap);
  if (!lines.length) return;
  el.style.display = 'block';
  el.innerHTML = lines.map(l => `<div class="sp-line"><span class="sp-dot"></span><span>${escapeHtml(l)}</span></div>`).join('');
}
function handleSearchProgressWS(data) {
  if (!searchAbortController) return;
  const src = displaySource(data.source) || data.source || '源';
  if (data.processing != null) {
    state.searchProgressMap[src] = `${src}：正在处理第 ${data.processing} 个结果（第 ${data.page} 页）`;
  }
  renderSearchProgress();
}
function handleParseProgressWS(data) {
  if (!parseAbortController) return;
  showSearchProgress(true, `正在解析歌单，共 ${data.total} 首/第 ${data.done} 首`);
}

function setSearchBtn(stopping) {
  searchBtn.innerHTML = stopping ? `${IC('x')} 停止搜索` : `${IC('search')} 搜索`;
}

searchBtn.addEventListener('click', () => {
  if (searchAbortController) stopSearch();
  else performSearch();
});
searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') performSearch(); });

function performSearch() {
  if (searchAbortController) return;
  const keyword = searchInput.value.trim();
  if (!keyword) { resultList.innerHTML = '<div class="empty-tip">请输入关键词</div>'; return; }
  state.results = [];
  state.selectedRows.clear();
  state.searchProgressMap = {};
  resultList.innerHTML = '<div class="empty-tip">搜索中...</div>';
  setStats('搜索中...');
  clearSearchProgress();
  updateSearchSelectionBar();
  const rid = ++searchRequestId;
  const ctrl = new AbortController();
  searchAbortController = ctrl;
  setSearchBtn(true);
  fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword, request_id: String(rid) }),
    signal: ctrl.signal
  })
    .then(async (r) => {
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    })
    .then(data => {
      if (searchAbortController !== ctrl) return;
      state.results = data || [];
      renderResults();
      setStats(`搜索完成，共 ${state.results.length} 条结果`);
    })
    .catch(err => {
      if (searchAbortController !== ctrl) return;
      console.error('搜索失败:', err);
      resultList.innerHTML = `<div class="empty-tip">搜索失败: ${err.message}</div>`;
      setStats('搜索失败');
    })
    .finally(() => {
      if (searchAbortController === ctrl) {
        searchAbortController = null;
        setSearchBtn(false);
        showSearchProgress(false);
      }
    });
}

function stopSearch() {
  const ctrl = searchAbortController;
  if (!ctrl) return;
  searchAbortController = null;
  setSearchBtn(false);
  showSearchProgress(false);
  ctrl.abort();
  fetch(`${API_BASE}/search/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: String(searchRequestId) })
  }).catch(() => {});
  state.results = [];
  state.selectedRows.clear();
  resultList.innerHTML = '<div class="empty-tip">搜索已停止</div>';
  setStats('搜索已停止');
  updateSearchSelectionBar();
}

function renderResults() {
  if (!state.results.length) {
    resultList.innerHTML = '<div class="empty-tip">未找到相关歌曲</div>';
    updateSearchSelectionBar();
    return;
  }
  resultList.innerHTML = '';
  state.results.forEach((song, idx) => {
    const div = document.createElement('div');
    div.className = 'song-item';
    div.dataset.idx = String(idx);
    // 优化：延迟上限 0.6s，避免长列表末尾元素等待过久
    div.style.animationDelay = Math.min(idx * 0.04, 0.6) + 's';

    const name = song.song_name || '未知歌曲';
    const singer = song.singers || '未知歌手';
    const parts = [];
    if (song.album) parts.push(song.album);
    if (song.duration) parts.push(song.duration);
    if (song.file_size) parts.push(song.file_size);
    const srcName = displaySource(song.source);
    const cover = coverUrl(song);
    const isSmart = cover && cover.startsWith('data:');
    const coverHtml = cover
      ? `<img src="${cover}" draggable="false" ${isSmart ? '' : 'onerror="window.__resultCoverError(this)"'} loading="lazy">`
      : IC('music');

    div.innerHTML = `
      <input type="checkbox" class="song-check no-select" data-idx="${idx}" tabindex="-1" />
      <div class="cover">${coverHtml}</div>
      <div class="info">
        <div class="name"><span class="song-title">${escapeHtml(name)}</span>${srcName ? `<span class="source-badge">${escapeHtml(srcName)}</span>` : ''}</div>
        <div class="sub">${escapeHtml(singer)}${parts.length ? ' · ' + parts.map(escapeHtml).join(' · ') : ''}</div>
      </div>
      <button class="btn-play-item no-select" data-idx="${idx}" title="播放">${IC('play')}</button>
    `;

    // 只保留「播放按钮」的显式点击；其余交互交给多选控制器
    div.querySelector('.btn-play-item').addEventListener('click', (e) => {
      e.stopPropagation();
      addToPlaylist(state.results[idx], true);
    });
    resultList.appendChild(div);

    // 歌曲名 + 副标题：超出列表宽度时循环滚动
    if (typeof applyMarquee === 'function') {
      const titleEl = div.querySelector('.song-title');
      if (titleEl) applyMarquee(titleEl);
      const subEl = div.querySelector('.sub');
      if (subEl) applyMarquee(subEl);
    }
  });

  // 列表重建后刷新多选控制器缓存
  if (resultSelection) resultSelection.refresh();
  updateSearchSelectionBar();
}

// 结果列表容器宽度变化时重测跑马灯
if (window.ResizeObserver && typeof refreshMarqueesIn === 'function' && resultList) {
  new ResizeObserver(() => refreshMarqueesIn(resultList)).observe(resultList);
}

// ---------- 搜索结果选择栏 ----------
function updateSearchSelectionBar() {
  const n = state.selectedRows.size;
  if (searchSelectedCount) searchSelectedCount.textContent = n;
  // 读取最近一次鼠标点击位置，用于「被遮挡时自动下移」
  const keepMouseY = resultSelection ? resultSelection.getLastMouseY() : null;
  setSelectionBarVisible(resultList, searchSelectionBar, n > 0, searchSelectionBar, keepMouseY);
}

// ---------- 初始化搜索结果多选控制器（一次性） ----------
(function initResultSelection() {
  if (!resultList) return;
  resultSelection = createListSelection({
    container: resultList,
    itemSelector: '.song-item',
    getKey: (el) => {
      const v = el.dataset.idx;
      if (v == null || v === '') return null;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    },
    selectedSet: state.selectedRows,
    onPlay: (key) => {
      const idx = parseInt(key, 10);
      if (Number.isFinite(idx) && state.results[idx]) {
        addToPlaylist(state.results[idx], true);
      }
    },
    onSelectionChanged: updateSearchSelectionBar,
  });

  if (searchSelectAllBtn) {
    searchSelectAllBtn.addEventListener('click', () => resultSelection.selectAll());
  }
  if (searchInvertBtn) {
    searchInvertBtn.addEventListener('click', () => resultSelection.invert());
  }
  if (searchClearSelBtn) {
    searchClearSelBtn.addEventListener('click', () => resultSelection.clear());
  }
})();

// ---------- 歌单解析 ----------
let parseAbortController = null;
let parseRequestId = 0;

function setParseBtn(stopping) {
  parsePlaylistBtn.innerHTML = stopping ? `${IC('x')} 停止解析` : `${IC('folder')} 解析`;
}
parsePlaylistBtn.addEventListener('click', () => {
  if (parseAbortController) stopParsePlaylist();
  else parsePlaylist();
});

function stopParsePlaylist() {
  const ctrl = parseAbortController;
  if (!ctrl) return;
  parseAbortController = null;
  setParseBtn(false);
  ctrl.abort();
  fetch(`${API_BASE}/parse_playlist/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: String(parseRequestId) })
  }).catch(() => {});
  setStats('歌单解析已停止');
  showSearchProgress(false);
  resultList.innerHTML = '<div class="empty-tip">解析已停止</div>';
  updateSearchSelectionBar();
}

async function parsePlaylist() {
  if (parseAbortController) return;
  const url = playlistUrlInput.value.trim();
  if (!url) { setStats('请先输入歌单链接'); return; }
  const source = playlistSourceSelect.value;
  resultList.innerHTML = '<div class="empty-tip">解析歌单中（较慢）...</div>';
  setStats('正在解析歌单...');
  state.selectedRows.clear();
  updateSearchSelectionBar();
  const rid = ++parseRequestId;
  const ctrl = new AbortController();
  parseAbortController = ctrl;
  setParseBtn(true);
  showSearchProgress(true, '正在解析歌单...');
  try {
    const resp = await fetch(`${API_BASE}/parse_playlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, source_display: source, request_id: String(rid) }),
      signal: ctrl.signal
    });
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    if (parseAbortController !== ctrl) return;
    if (data.cancelled) {
      resultList.innerHTML = '<div class="empty-tip">解析已停止</div>';
      setStats('歌单解析已停止');
    } else if (data.songs && data.songs.length) {
      state.results = data.songs;
      state.selectedRows.clear();
      renderResults();
      setStats(`歌单解析成功，共 ${data.songs.length} 首歌曲`);
    } else {
      resultList.innerHTML = '<div class="empty-tip">解析成功，但未获取到歌曲</div>';
      setStats('解析成功，但未获取到歌曲');
    }
  } catch (err) {
    if (parseAbortController !== ctrl) return;
    resultList.innerHTML = `<div class="empty-tip">解析失败: ${err.message}</div>`;
    setStats('歌单解析失败');
  } finally {
    if (parseAbortController === ctrl) {
      parseAbortController = null;
      setParseBtn(false);
      showSearchProgress(false);
    }
  }
}

// ---------- 结果操作 ----------
clearResultsBtn.addEventListener('click', () => {
  state.results = [];
  state.selectedRows.clear();
  resultList.innerHTML = '';
  setStats('已清空');
  updateSearchSelectionBar();
});

function getSelectedResults() {
  const arr = [];
  [...state.selectedRows]
    .map(k => typeof k === 'number' ? k : parseInt(k, 10))
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b)
    .forEach(idx => {
      if (state.results[idx]) arr.push(state.results[idx]);
    });
  return arr;
}

addToPlaylistBtn.addEventListener('click', () => {
  const songs = getSelectedResults();
  if (!songs.length) { setStats('请先在搜索结果中勾选歌曲'); return; }
  songs.forEach(s => addToPlaylist(s, false));
  setStats(`已添加 ${songs.length} 首歌曲到在线歌单`);
});

// ============================================================
// 播放列表：在线 / 本地切换
// ============================================================
function switchPlaylistType(type) {
  if (state.playlistType === type) return;
  state.playlistType = type;
  playlistTabs.forEach(t => t.classList.toggle('active', t.dataset.type === type));
  updatePlaylistToolButtons();
  renderPlaylist();
}

function updatePlaylistToolButtons() {
  const isOnline = state.playlistType === 'online';
  if (btnSavePlaylist) btnSavePlaylist.title = isOnline ? '保存歌单（加密 JSON）' : '导出为 M3U';
  if (btnLoadPlaylist) btnLoadPlaylist.title = isOnline ? '加载歌单（加密 JSON）' : '从 M3U 加载';
}

(function initPlaylistTabs() {
  playlistTabs.forEach(tab => {
    tab.addEventListener('click', () => switchPlaylistType(tab.dataset.type));
  });
  updatePlaylistToolButtons();
})();

// ---------- 播放列表：添加 ----------
function addToPlaylist(song, play) {
  if (!song) return;
  const s = Object.assign({}, song);
  if (!s.identifier && s.song_id) s.identifier = s.song_id;

  const isLocal = s.source === 'LocalLibrary';
  const targetType = isLocal ? 'local' : 'online';
  const targetList = isLocal ? state.localPlaylist : state.onlinePlaylist;

  targetList.push(s);

  // 自动切到目标歌单（让用户立即看到刚添加的曲目）
  if (state.playlistType !== targetType) {
    state.playlistType = targetType;
    playlistTabs.forEach(t => t.classList.toggle('active', t.dataset.type === targetType));
    updatePlaylistToolButtons();
  }

  if (play) {
    state.currentIndex = targetList.length - 1;
    renderPlaylist();
    playCurrent();
  } else {
    renderPlaylist();
  }
}

function renderPlaylist() {
  const list = state.playlist;
  const isOnline = state.playlistType === 'online';
  const curIdx = state.currentIndex;

  playlistCount.textContent = list.length;

  if (!list.length) {
    playlistContent.innerHTML = `<div class="empty-tip">${isOnline ? '在线歌单为空' : '本地歌单为空'}</div>`;
  } else {
    playlistContent.innerHTML = '';
    list.forEach((song, i) => {
      const div = document.createElement('div');
      div.className = 'playlist-item' + (i === curIdx ? ' playing' : '');
      div.dataset.idx = i;

      // 在线歌单：下载按钮 + 删除按钮
      // 本地歌单：只有删除按钮（文件已在磁盘，无需下载）
      const actionsHtml = isOnline
        ? `<button class="dl-btn" title="下载">${IC('download')}</button><button class="del-btn" title="移除">✕</button>`
        : `<button class="del-btn" title="移除">✕</button>`;

      div.innerHTML = `
        <span class="idx">${i + 1}.</span>
        <span class="info">${escapeHtml(song.singers || '未知歌手')} - ${escapeHtml(song.song_name || '未知歌曲')}</span>
        ${actionsHtml}
      `;

      div.addEventListener('click', (e) => {
        if (e.target.closest('.del-btn') || e.target.closest('.dl-btn')) return;
        state.currentIndex = i;
        playCurrent();
      });

      const dlBtn = div.querySelector('.dl-btn');
      if (dlBtn) {
        dlBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          startDownload([song]);
        });
      }

      div.querySelector('.del-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        list.splice(i, 1);
        if (state.currentIndex === i) { state.currentIndex = -1; stopPlayback(); }
        else if (state.currentIndex > i) state.currentIndex -= 1;
        renderPlaylist();
      });

      div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showPlaylistMenu(e.clientX, e.clientY, i);
      });

      playlistContent.appendChild(div);
    });
  }

  if (state.vizOpen && vizPlaylistPanel && vizPlaylistPanel.classList.contains('show')) {
    renderVizPlaylist();
  }
}

function showPlaylistMenu(x, y, idx) {
  const isOnline = state.playlistType === 'online';
  const song = state.playlist[idx];
  const items = [
    { label: '播放', fn: () => { state.currentIndex = idx; playCurrent(); } },
  ];
  if (isOnline && song) {
    items.push({ label: '下载', fn: () => startDownload([song]) });
  }
  items.push(
    { label: '上移', fn: () => movePlaylistItem(idx, -1) },
    { label: '下移', fn: () => movePlaylistItem(idx, +1) },
    { separator: true },
    { label: '移除', fn: () => {
        state.playlist.splice(idx, 1);
        if (state.currentIndex === idx) { state.currentIndex = -1; stopPlayback(); }
        else if (state.currentIndex > idx) state.currentIndex -= 1;
        renderPlaylist();
      } },
    { label: '清空', danger: true, fn: () => {
        state.playlist = [];
        state.currentIndex = -1;
        stopPlayback();
        renderPlaylist();
      } },
  );
  showContextMenu(items, x, y);
}

function movePlaylistItem(idx, delta) {
  const target = idx + delta;
  if (target < 0 || target >= state.playlist.length) return;
  const t = state.playlist[idx];
  state.playlist[idx] = state.playlist[target];
  state.playlist[target] = t;
  if (state.currentIndex === idx) state.currentIndex = target;
  else if (state.currentIndex === target) state.currentIndex = idx;
  renderPlaylist();
}

btnClearPlaylist.addEventListener('click', () => {
  state.playlist = [];
  state.currentIndex = -1;
  stopPlayback();
  renderPlaylist();
  setStats(state.playlistType === 'online' ? '已清空在线歌单' : '已清空本地歌单');
});

// ============================================================
// 保存 / 加载：在线（加密 JSON）/ 本地（M3U）
// ============================================================
btnSavePlaylist.addEventListener('click', handleSavePlaylist);
btnLoadPlaylist.addEventListener('click', handleLoadPlaylist);

async function handleSavePlaylist(e) {
  if (state.playlistType === 'local') {
    await saveLocalPlaylistAsM3U();
  } else {
    await saveOnlinePlaylistEncrypted(e);
  }
}

async function handleLoadPlaylist() {
  if (state.playlistType === 'local') {
    await loadLocalPlaylistFromM3U();
  } else {
    await loadOnlinePlaylistEncrypted();
  }
}

// ---------- 在线歌单：加密 JSON ----------
async function saveOnlinePlaylistEncrypted(e) {
  if (!state.onlinePlaylist.length) { setStats('在线歌单为空，无需保存'); return; }
  if (!win || !fs) { setStats('保存歌单需要 Electron 环境'); return; }
  const plain = !!(e && e.shiftKey);
  try {
    const result = await dialog.showSaveDialog({
      title: plain ? '导出歌单（未加密）' : '保存歌单（加密）',
      defaultPath: 'playlist.json',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return;
    if (plain) {
      fs.writeFileSync(result.filePath, JSON.stringify(state.onlinePlaylist, null, 2), 'utf-8');
      setStats(`歌单已导出（未加密）至 ${result.filePath}`);
    } else {
      const data = await postJSON('/playlist/encrypt', { songs: state.onlinePlaylist });
      fs.writeFileSync(result.filePath, data.content, 'utf-8');
      setStats(`歌单已加密保存至 ${result.filePath}`);
    }
  } catch (err) {
    setStats(`保存失败: ${err.message}`);
  }
}

async function loadOnlinePlaylistEncrypted() {
  if (!win || !fs) { setStats('加载歌单需要 Electron 环境'); return; }
  try {
    const result = await dialog.showOpenDialog({
      title: '加载歌单',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return;
    const content = fs.readFileSync(result.filePaths[0], 'utf-8');
    const data = await postJSON('/playlist/decrypt', { content });
    if (!Array.isArray(data.songs)) throw new Error('无效的歌单格式');
    state.onlinePlaylist = data.songs;
    state._onlineIndex = -1;
    renderPlaylist();
    setStats(`已加载在线歌单，共 ${state.onlinePlaylist.length} 首歌曲`);
  } catch (e) {
    setStats(`加载失败: ${e.message}`);
  }
}

// ---------- 本地歌单：M3U ----------
async function saveLocalPlaylistAsM3U() {
  if (!state.localPlaylist.length) { setStats('本地歌单为空，无需导出'); return; }
  if (!win || !fs) { setStats('导出歌单需要 Electron 环境'); return; }
  try {
    const result = await dialog.showSaveDialog({
      title: '导出本地歌单（M3U）',
      defaultPath: 'local-playlist.m3u',
      filters: [{ name: 'M3U 播放列表', extensions: ['m3u', 'm3u8'] }]
    });
    if (result.canceled || !result.filePath) return;

    const lines = ['#EXTM3U'];
    for (const song of state.localPlaylist) {
      const dur = Math.round(song.duration_s || 0);
      const title = (song.singers ? song.singers + ' - ' : '') + (song.song_name || '');
      // identifier 保存的是本地文件的完整路径
      const filePath = song.identifier || song.path || '';
      lines.push(`#EXTINF:${dur},${title}`);
      lines.push(filePath);
    }
    // 带 BOM，兼容 Windows 播放器识别 UTF-8
    const content = '\ufeff' + lines.join('\r\n') + '\r\n';
    fs.writeFileSync(result.filePath, content, 'utf-8');
    setStats(`本地歌单已导出为 M3U：${result.filePath}（共 ${state.localPlaylist.length} 首）`);
  } catch (e) {
    setStats(`导出失败: ${e.message}`);
  }
}

async function loadLocalPlaylistFromM3U() {
  if (!win || !fs) { setStats('加载歌单需要 Electron 环境'); return; }
  try {
    const result = await dialog.showOpenDialog({
      title: '从 M3U 加载本地歌单',
      filters: [{ name: 'M3U 播放列表', extensions: ['m3u', 'm3u8'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return;

    const content = fs.readFileSync(result.filePaths[0], 'utf-8').replace(/^\ufeff/, '');
    const entries = parseM3U(content);
    if (!entries.length) { setStats('M3U 文件中没有条目'); return; }

    // 修复 B3：本地库若尚未扫描，先自动扫一次；否则 byPath/byName 全空，
    // 所有条目都会落进"未找到"，但用户完全无法理解原因。
    if (typeof libraryState !== 'undefined' && !libraryState.scanned && !libraryState.scanning) {
      setStats('正在扫描本地库以匹配 M3U 条目...');
      try {
        await scanLibrary(false);
      } catch (e) {
        // 扫描失败继续走下去，下面依然会尝试匹配（只是命中率低）
        console.warn('扫描本地库失败:', e);
      }
    }

    // 用本地库做路径匹配：先精确匹配完整路径，再回退到文件名
    const byPath = new Map();
    const byName = new Map();
    for (const s of libraryState.songs) {
      if (!s.path) continue;
      byPath.set(s.path.replace(/\\/g, '/').toLowerCase(), s);
      const bn = (s.filename || '').toLowerCase();
      if (bn && !byName.has(bn)) byName.set(bn, s);
    }

    let added = 0, missed = 0;
    for (const entry of entries) {
      const norm = entry.path.replace(/\\/g, '/').toLowerCase();
      let song = byPath.get(norm);
      if (!song) {
        const bn = norm.split('/').pop();
        if (bn) song = byName.get(bn);
      }
      if (song) {
        addLocalSongSync(song);
        added++;
      } else {
        missed++;
      }
    }
    renderPlaylist();
    const tip = missed > 0
      ? `已从 M3U 加载 ${added} 首（${missed} 首未在本地库中找到）`
      : `已从 M3U 加载 ${added} 首`;
    setStats(tip);
  } catch (e) {
    setStats(`加载失败: ${e.message}`);
  }
}

// M3U 解析：返回 [{ path, duration, info }]
function parseM3U(text) {
  const lines = String(text).split(/\r?\n/);
  const entries = [];
  let pending = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = line.match(/^#EXTINF:\s*(-?[\d.]+)\s*,\s*(.*)$/i);
      if (m) pending = { duration: parseFloat(m[1]) || 0, info: m[2] || '' };
      continue;
    }
    entries.push({
      path: line,
      duration: pending ? pending.duration : 0,
      info: pending ? pending.info : '',
    });
    pending = null;
  }
  return entries;
}

// 批量导入用：把本地曲目同步加入本地歌单（不做异步歌词加载）
function addLocalSongSync(song) {
  if (!song || !song.path) return;
  const s = {
    song_name: song.song_name,
    singers: song.singers || '',
    album: song.album || '',
    duration: song.duration || '',
    duration_s: song.duration_s || 0,
    ext: song.ext || 'mp3',
    identifier: song.path,
    source: 'LocalLibrary',
    download_url: `${API_BASE}/library/file?path=${encodeURIComponent(song.path)}`,
    lyric: '',
    cover_url: song.has_cover
      ? `${API_BASE}/library/cover?path=${encodeURIComponent(song.path)}`
      : '',
  };
  state.localPlaylist.push(s);
}