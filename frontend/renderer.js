// ==================== cYy Music Client 渲染进程 ====================
const API_BASE = 'http://127.0.0.1:8000';

// ---------- Electron ----------
let win = null, dialog = null, fs = null;
try {
  const remote = require('@electron/remote');
  win = remote.getCurrentWindow();
  dialog = remote.dialog;
} catch (e) {}
try { fs = require('fs'); } catch (e) {}

// ---------- DOM 引用 ----------
const $ = (id) => document.getElementById(id);
const searchInput = $('search-input');
const searchBtn = $('search-btn');
const resultList = $('result-list');
const playlistUrlInput = $('playlist-url-input');
const playlistSourceSelect = $('playlist-source-select');
const parsePlaylistBtn = $('parse-playlist-btn');
const downloadSelectedBtn = $('download-selected-btn');
const addToPlaylistBtn = $('add-to-playlist-btn');
const clearResultsBtn = $('clear-results-btn');
const cancelAllBtn = $('cancel-all-btn');
const lyricContent = $('lyric-content');
const playlistContent = $('playlist-content');
const playlistCount = $('playlist-count');
const playerCover = $('player-cover');
const nowPlayingText = $('now-playing-text');
const miniSpectrum = $('mini-spectrum');
const positionSlider = $('position-slider');
const labelTime = $('label-time');
const audioPlayer = $('audio-player');
const btnPlay = $('btn-play');
const btnPrev = $('btn-prev');
const btnNext = $('btn-next');
const btnStop = $('btn-stop');
const btnEq = $('btn-eq');
const volumeSlider = $('volume-slider');
const playmodeSelect = $('playmode-select');
const labelStats = $('sidebar-stats');
const barOverall = $('bar-overall');
const downloadTasksList = $('download-tasks-list');
const btnSavePlaylist = $('btn-save-playlist');
const btnLoadPlaylist = $('btn-load-playlist');
const btnClearPlaylist = $('btn-clear-playlist');
const btnViz = $('btn-viz');
const vizOverlay = $('viz-overlay');
const vizTitle = $('viz-title');
const vizCover = $('viz-cover');
const vizLyrics = $('viz-lyrics');
const vizBarsCanvas = $('viz-bars-canvas');
const vizRingCanvas = $('viz-ring-canvas');
const vizWaterfallCanvas = $('viz-waterfall-canvas');
const vizBtnPlay = $('viz-btn-play');
const vizBtnStop = $('viz-btn-stop');
const vizPositionSlider = $('viz-position-slider');
const vizVolumeSlider = $('viz-volume-slider');
const labelTimeViz = $('label-time-viz');
const labelCodec = $('label-codec');
const labelCodecViz = $('label-codec-viz');
const vizCloseBtn = $('viz-close');
const vizMinBtn = $('viz-min');
const vizMaxBtn = $('viz-max');
const settingsModal = $('settings-modal');
const settingsForm = $('settings-form');
const settingsCloseBtn = $('settings-close-btn');
const settingsCancelBtn = $('settings-cancel-btn');
const sourceCheckboxes = $('source-checkboxes');
const settingLimit = $('setting-limit');
const settingDedup = $('setting-dedup');
const settingSaveDir = $('setting-save-dir');
const settingFilenameFormat = $('setting-filename-format');
const settingCustomFormat = $('setting-custom-format');
const customFormatGroup = $('custom-format-group');
const settingGroupBy = $('setting-group-by');
const settingDownloadLyric = $('setting-download-lyric');
const settingDownloadCover = $('setting-download-cover');
const settingConvertEnabled = $('setting-convert-enabled');
const settingConvertFormat = $('setting-convert-format');
const settingConvertBitrate = $('setting-convert-bitrate');
const settingEmbedLyrics = $('setting-embed-lyrics');
const settingDeleteLyrics = $('setting-delete-lyrics');
const settingEmbedCover = $('setting-embed-cover');
const settingDeleteCover = $('setting-delete-cover');
const settingTheme = $('setting-theme');
const settingAccent = $('setting-accent');
const settingAccentColor = $('setting-accent-color');
const settingOpacity = $('setting-opacity');
const settingOpacityLabel = $('setting-opacity-label');
const settingShowProgress = $('setting-show-progress');
const settingPlaymode = $('setting-playmode');
const browseSaveDir = $('browse-save-dir');
const eqModal = $('eq-modal');
const eqCloseBtn = $('eq-close-btn');
const eqDoneBtn = $('eq-done-btn');
const eqPreset = $('eq-preset');
const eqReset = $('eq-reset');
const eqBands = $('eq-bands');
const eqChips = {
  bass: $('eq-chip-bass'),
  treble: $('eq-chip-treble'),
  vocal: $('eq-chip-vocal')
};
const aboutModal = $('about-modal');
const aboutCloseBtn = $('about-close-btn');
const navItems = document.querySelectorAll('.nav-item[data-view]');
const settingsTabBtns = document.querySelectorAll('.settings-tab');

// ---------- 状态 ----------
const state = {
  settings: null,
  options: null,
  results: [],
  selectedRows: new Set(),
  playlist: [],
  currentIndex: -1,
  playing: false,
  paused: false,
  currentLyrics: [],
  currentLyricIndex: -1,
  downloads: new Map(),
  downloadTotal: 0,
  downloadDone: 0,
  downloadStartTime: null,
  taskReconcileTimer: null,
  dragging: false,
  seekBase: 0,
  currentDuration: 0,
  currentCoverUrl: '',
  vizOpen: false,
  audioCtx: null,
  srcNode: null,
  analyser: null,
  eqFilters: null,
  eqExtra: null,
  eq: null,
  ws: null,
};

// ---------- 工具 ----------
function setStats(text) { labelStats.textContent = text; }
const IC = (n) => `<svg class="ic"><use href="#i-${n}"/></svg>`;
function setBtnIcon(btn, name) { if (btn) btn.innerHTML = IC(name); }
function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function parseDurationSec(song) {
  const raw = song && (song.duration_s != null ? song.duration_s : song.duration);
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') return Math.max(0, Math.round(raw));
  const s = String(raw).trim();
  const parts = s.split(':').map(Number);
  if (parts.length === 2 && parts.every(n => !isNaN(n))) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts.every(n => !isNaN(n))) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.max(0, Math.round(n));
}
function coverUrl(song) {
  const u = song && (song.cover_url || song.cover || '');
  if (!u) return '';
  return `${API_BASE}/cover?url=${encodeURIComponent(u)}&source=${encodeURIComponent(song.source || '')}`;
}
function displaySource(internal) {
  const map = (state.options && state.options.source_internal) || {};
  for (const [k, v] of Object.entries(map)) if (v === internal) return k;
  return internal || '';
}
async function postJSON(path, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}
function showWarn(title, text) {
  const mask = document.createElement('div');
  mask.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:20000;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--color-bg);border:1px solid var(--color-border);border-radius:12px;padding:20px 24px;max-width:400px;box-shadow:0 8px 30px rgba(0,0,0,0.2);';
  box.innerHTML = `<div style="font-weight:bold;margin-bottom:8px;">${escapeHtml(title)}</div><div style="white-space:pre-line;font-size:13px;color:var(--color-text-secondary);margin-bottom:14px;">${escapeHtml(text)}</div><div style="text-align:right;"><button class="btn-primary" style="padding:6px 18px;border-radius:8px;">确定</button></div>`;
  mask.appendChild(box);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  box.querySelector('button').addEventListener('click', close);
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
}

// ---------- 窗口控制 ----------
let winMaximized = false;
let winNormalBounds = null;
function isActuallyMaximized() {
  if (!win) return false;
  try {
    const { screen } = require('@electron/remote');
    const wa = screen.getPrimaryDisplay().workArea;
    const b = win.getBounds();
    return b.x === wa.x && b.y === wa.y && b.width === wa.width && b.height === wa.height;
  } catch (e) { return false; }
}
function toggleWindowMaximize() {
  if (!win) return;
  if (winMaximized || isActuallyMaximized()) {
    if (winNormalBounds) win.setBounds(winNormalBounds);
    winMaximized = false;
  } else {
    winNormalBounds = win.getBounds();
    const { screen } = require('@electron/remote');
    win.setBounds(screen.getPrimaryDisplay().workArea);
    winMaximized = true;
  }
  updateMaxButtons();
}
function updateMaxButtons() {
  const icon = (winMaximized || isActuallyMaximized()) ? 'restore' : 'max';
  const maxBtn = $('btn-max');
  const vizMax = $('viz-max');
  if (maxBtn) setBtnIcon(maxBtn, icon);
  if (vizMax) setBtnIcon(vizMax, icon);
}
if (win) {
  $('btn-min').addEventListener('click', () => win.minimize());
  $('btn-max').addEventListener('click', toggleWindowMaximize);
  $('btn-close').addEventListener('click', () => win.close());
} else {
  document.querySelectorAll('.win-btn').forEach(b => b.style.display = 'none');
}

// ---------- 导航 ----------
function navigateTo(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.add('active');
  navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });
}
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.view);
  });
});

// ---------- 弹窗 ----------
function openModal(id) {
  const mask = $(id);
  if (!mask) return;
  mask.classList.remove('closing');
  mask.classList.add('show');
}
function closeModal(id) {
  const mask = $(id);
  if (!mask || !mask.classList.contains('show')) return;
  mask.classList.add('closing');
  setTimeout(() => {
    mask.classList.remove('closing', 'show');
  }, 160);
}

// ---------- 初始化 ----------
const THEME_ACCENTS = {
  sky: '#38BDF8',    // 天蓝
  pink: '#E83E8C',
  yellow: '#F5A623',
  black: '#0F1419',
  white: '#F5F7FA',
};
function effectiveAccent(accentKey, customColor) {
  if (THEME_ACCENTS[accentKey]) return THEME_ACCENTS[accentKey];
  if (accentKey === 'custom' && /^#[0-9a-f]{6}$/i.test(customColor || '')) return customColor;
  return '#38BDF8';
}
function applyTheme(theme, opacity, accentKey, customColor) {
  document.documentElement.dataset.theme = (theme === 'light') ? 'light' : 'dark';
  const alpha = Math.max(0.5, Math.min(1.0, opacity != null ? opacity : 1.0));
  document.documentElement.style.setProperty('--bg-alpha', alpha.toFixed(2));
  document.documentElement.style.setProperty('--primary', effectiveAccent(accentKey, customColor));
}
function fillSelect(sel, items) {
  sel.innerHTML = '';
  items.forEach(it => {
    const opt = document.createElement('option');
    opt.value = it;
    opt.textContent = it;
    sel.appendChild(opt);
  });
}
function renderSourceCheckboxes(groups) {
  sourceCheckboxes.innerHTML = '';
  for (const [group, sources] of Object.entries(groups)) {
    const g = document.createElement('div');
    g.className = 'src-group';
    g.textContent = group;
    sourceCheckboxes.appendChild(g);
    sources.forEach(name => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = name;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(name));
      sourceCheckboxes.appendChild(label);
    });
  }
}
function updateBitrateOptions() {
  const fmt = settingConvertFormat.value;
  const checked = settingConvertEnabled.checked;
  const sel = settingConvertBitrate;
  sel.innerHTML = '';
  if (fmt === 'flac') {
    sel.disabled = true;
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '无损（无需比特率）';
    sel.appendChild(opt);
    return;
  }
  sel.disabled = !checked;
  const options = fmt === 'aac' ? ['128k', '192k', '256k'] : ['128k', '192k', '256k', '320k'];
  options.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
  sel.value = (state.settings && state.settings.convert_bitrate) || '320k';
}
function applySettingsToUI(settings) {
  const s = settings || {};
  volumeSlider.value = s.volume != null ? s.volume : 60;
  playmodeSelect.value = String(s.play_mode != null ? s.play_mode : 2);
  settingLimit.value = s.limit || 10;
  settingSaveDir.value = s.save_dir || '';
  settingDedup.checked = !!s.dedup;
  settingDownloadLyric.checked = s.download_lyric !== false;
  settingDownloadCover.checked = s.download_cover !== false;
  settingConvertEnabled.checked = !!s.convert_enabled;
  settingConvertFormat.value = s.convert_format || 'mp3';
  settingEmbedLyrics.checked = !!s.embed_lyrics;
  settingDeleteLyrics.checked = !!s.delete_lyrics;
  settingEmbedCover.checked = !!s.embed_cover;
  settingDeleteCover.checked = !!s.delete_cover;
  settingPlaymode.value = String(s.play_mode != null ? s.play_mode : 2);
  if (state.options && state.options.default_save_dir && !s.save_dir) {
    settingSaveDir.value = state.options.default_save_dir;
  }
  const themeSel = settingTheme;
  if (themeSel.querySelector(`option[value="${s.theme}"]`)) themeSel.value = s.theme;
  const accent = s.theme_color || 'sky';
  settingAccent.value = THEME_ACCENTS[accent] ? accent : 'custom';
  const customColor = (accent === 'custom' && /^#[0-9a-f]{6}$/i.test(s.theme_custom || '')) ? s.theme_custom : '#38BDF8';
  settingAccentColor.value = customColor;
  settingAccentColor.style.display = (settingAccent.value === 'custom') ? 'block' : 'none';
  const fmtSel = settingFilenameFormat;
  if (fmtSel.querySelector(`option[value="${s.filename_format}"]`)) fmtSel.value = s.filename_format;
  settingCustomFormat.value = s.custom_format || '';
  const gb = settingGroupBy;
  if (gb.querySelector(`option[value="${s.group_by}"]`)) gb.value = s.group_by;
  const op = Math.round((s.background_opacity != null ? s.background_opacity : 1.0) * 100);
  settingOpacity.value = op;
  settingOpacityLabel.textContent = op + '%';
  settingShowProgress.checked = s.show_progress_detail !== false;
  document.querySelectorAll('#source-checkboxes input[type="checkbox"]').forEach(cb => {
    cb.checked = (s.sources || []).includes(cb.value);
  });
  updateBitrateOptions();
  const opacityValue = s.background_opacity != null ? s.background_opacity : (parseInt(settingOpacity.value, 10) / 100);
  applyTheme(s.theme, opacityValue, accent, s.theme_custom);
}
async function initApp() {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const [options, settings] = await Promise.all([
        fetch(`${API_BASE}/settings/options`).then(r => r.json()),
        fetch(`${API_BASE}/settings`).then(r => r.json()),
      ]);
      state.options = options;
      state.settings = settings;
      state.eq = settings.eq || defaultEq();

      playlistSourceSelect.innerHTML = '';
      (options.playlist_sources || []).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        playlistSourceSelect.appendChild(opt);
      });

      fillSelect(settingFilenameFormat, options.filename_formats || ['歌曲名', '歌手-歌曲名', '歌曲名-歌手', '自定义']);
      fillSelect(settingGroupBy, options.group_by_options || ['无分组', '按歌手', '按专辑', '按歌手-专辑']);
      const themeSel = settingTheme;
      themeSel.innerHTML = '';
      Object.entries(options.themes || { light: '亮色', dark: '暗色' }).forEach(([key, name]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = name;
        themeSel.appendChild(opt);
      });

      renderSourceCheckboxes(options.source_groups || {});
      applySettingsToUI(settings);
      if (!searchAbortController && !parseAbortController) setStats('就绪');   // 不覆盖进行中的搜索/解析状态
      console.log('初始化完成');
      return;
    } catch (e) {
      if (attempt === 0) setStats('正在连接后端...');
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  console.error('初始化失败');
  setStats('无法连接后端，请确认 server.py 已启动');
  resultList.innerHTML = '<div class="empty-tip">无法连接后端服务</div>';
}

// 绑定设置 UI 事件
settingConvertFormat.addEventListener('change', updateBitrateOptions);
settingConvertEnabled.addEventListener('change', updateBitrateOptions);
settingFilenameFormat.addEventListener('change', function() {
  customFormatGroup.style.display = this.value === '自定义' ? 'block' : 'none';
});
settingOpacity.addEventListener('input', function() {
  const val = parseInt(this.value, 10);
  settingOpacityLabel.textContent = val + '%';
  const accent = settingAccent.value;
  const customColor = settingAccentColor.value;
  applyTheme(settingTheme.value, val / 100, accent, accent === 'custom' ? customColor : undefined);
});
settingAccent.addEventListener('change', function() {
  const showCustom = this.value === 'custom';
  settingAccentColor.style.display = showCustom ? 'block' : 'none';
  const accent = this.value;
  const customColor = settingAccentColor.value;
  applyTheme(settingTheme.value, parseInt(settingOpacity.value, 10) / 100, accent, accent === 'custom' ? customColor : undefined);
});
settingAccentColor.addEventListener('input', function() {
  applyTheme(settingTheme.value, parseInt(settingOpacity.value, 10) / 100, 'custom', this.value);
});

// ---------- 搜索 ----------
let searchAbortController = null;
let searchRequestId = 0;
state.searchProgressMap = {};   // source -> 最新格式化进度文本

// 进度显示（后端解析 rich 实时帧后的结构化消息）
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
  if (!searchAbortController) return;   // 已停止/已完成，忽略残留进度消息（容器已隐藏）
  const src = data.source || '源';
  if (data.processing != null) {
    state.searchProgressMap[src] = `${src}：正在处理第 ${data.processing} 个结果（第 ${data.page} 页）`;
  }
  renderSearchProgress();
}
function handleParseProgressWS(data) {
  if (!parseAbortController) return;   // 已停止/无解析任务，忽略后端残留进度
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
  if (searchAbortController) return;   // 已在搜索中（再次点击按钮会走 stopSearch）
  const keyword = searchInput.value.trim();
  if (!keyword) { resultList.innerHTML = '<div class="empty-tip">请输入关键词</div>'; return; }
  state.results = [];
  state.selectedRows.clear();
  state.searchProgressMap = {};
  resultList.innerHTML = '<div class="empty-tip">搜索中...</div>';
  setStats('搜索中...');
  clearSearchProgress();
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
      if (searchAbortController !== ctrl) return;   // 已被停止/新搜索覆盖，丢弃过期结果
      state.results = data || [];
      renderResults();
      setStats(`搜索完成，共 ${state.results.length} 条结果`);
    })
    .catch(err => {
      if (searchAbortController !== ctrl) return;   // 主动停止导致的 AbortError，忽略
      console.error('搜索失败:', err);
      resultList.innerHTML = `<div class="empty-tip">搜索失败: ${err.message}</div>`;
      setStats('搜索失败');
    })
    .finally(() => {
      if (searchAbortController === ctrl) {
        searchAbortController = null;
        setSearchBtn(false);
        showSearchProgress(false);   // 搜索完成：隐藏并清空进度详情
      }
    });
}

function stopSearch() {
  const ctrl = searchAbortController;
  if (!ctrl) return;
  searchAbortController = null;
  setSearchBtn(false);
  showSearchProgress(false);
  ctrl.abort();   // 立即断开与现有搜索请求的连接（fetch 拒绝，结果丢弃，不等待后端返回）
  // 通知后端取消该任务（不等待返回，失败忽略；后端主流程会提前返回）
  fetch(`${API_BASE}/search/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: String(searchRequestId) })
  }).catch(() => {});
  state.results = [];
  state.selectedRows.clear();
  resultList.innerHTML = '<div class="empty-tip">搜索已停止</div>';
  setStats('搜索已停止');
}
function renderResults() {
  if (!state.results.length) {
    resultList.innerHTML = '<div class="empty-tip">未找到相关歌曲</div>';
    return;
  }
  resultList.innerHTML = '';
  state.results.forEach((song, idx) => {
    const div = document.createElement('div');
    div.className = 'song-item';
    div.dataset.idx = idx;
    const name = song.song_name || '未知歌曲';
    const singer = song.singers || '未知歌手';
    const parts = [];
    if (song.album) parts.push(song.album);
    if (song.duration) parts.push(song.duration);
    if (song.file_size) parts.push(song.file_size);
    const srcName = displaySource(song.source);
    const cover = coverUrl(song);
    div.innerHTML = `
      <input type="checkbox" class="song-check" data-idx="${idx}" />
      <div class="cover">${cover ? `<img src="${cover}" loading="lazy" onerror="this.style.display='none'">` : IC('music')}</div>
      <div class="info">
        <div class="name">${escapeHtml(name)}${srcName ? `<span class="source-badge">${escapeHtml(srcName)}</span>` : ''}</div>
        <div class="sub">${escapeHtml(singer)}${parts.length ? ' · ' + parts.map(escapeHtml).join(' · ') : ''}</div>
      </div>
      <button class="btn-play-item" data-idx="${idx}" title="播放">${IC('play')}</button>
    `;
    div.querySelector('.song-check').addEventListener('change', (e) => {
      if (e.target.checked) state.selectedRows.add(idx); else state.selectedRows.delete(idx);
      div.classList.toggle('selected', e.target.checked);
    });
    div.querySelector('.btn-play-item').addEventListener('click', (e) => {
      e.stopPropagation();
      addToPlaylist(state.results[idx], true);
    });
    div.addEventListener('dblclick', () => addToPlaylist(state.results[idx], true));
    resultList.appendChild(div);
  });
}

// ---------- 歌单解析（可停止） ----------
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
  ctrl.abort();   // 立即断开连接，不等待后端返回
  fetch(`${API_BASE}/parse_playlist/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: String(parseRequestId) })
  }).catch(() => {});
  setStats('歌单解析已停止');
  showSearchProgress(false);
  resultList.innerHTML = '<div class="empty-tip">解析已停止</div>';
}
async function parsePlaylist() {
  if (parseAbortController) return;
  const url = playlistUrlInput.value.trim();
  if (!url) { setStats('请先输入歌单链接'); return; }
  const source = playlistSourceSelect.value;
  resultList.innerHTML = '<div class="empty-tip">解析歌单中（较慢）...</div>';
  setStats('正在解析歌单...');
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
    if (parseAbortController !== ctrl) return;   // 已停止/被新任务覆盖
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
    if (parseAbortController !== ctrl) return;   // 主动停止，忽略
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
});
function getSelectedResults() {
  const arr = [];
  [...state.selectedRows].sort((a, b) => a - b).forEach(idx => {
    if (state.results[idx]) arr.push(state.results[idx]);
  });
  return arr;
}
addToPlaylistBtn.addEventListener('click', () => {
  const songs = getSelectedResults();
  if (!songs.length) { setStats('请先在搜索结果中勾选歌曲'); return; }
  songs.forEach(s => addToPlaylist(s, false));
  setStats(`已添加 ${songs.length} 首歌曲到歌单`);
});

// ---------- 播放列表 ----------
function addToPlaylist(song, play) {
  if (!song) return;
  const s = Object.assign({}, song);
  if (!s.identifier && s.song_id) s.identifier = s.song_id;
  state.playlist.push(s);
  if (play) {
    state.currentIndex = state.playlist.length - 1;
    playCurrent();
  }
  renderPlaylist();
}
function renderPlaylist() {
  playlistCount.textContent = state.playlist.length;
  if (!state.playlist.length) {
    playlistContent.innerHTML = '<div class="empty-tip">列表为空</div>';
    return;
  }
  playlistContent.innerHTML = '';
  state.playlist.forEach((song, idx) => {
    const div = document.createElement('div');
    div.className = 'playlist-item' + (idx === state.currentIndex ? ' playing' : '');
    div.dataset.idx = idx;
    div.innerHTML = `
      <span class="idx">${idx + 1}.</span>
      <span class="info">${escapeHtml(song.singers || '未知歌手')} - ${escapeHtml(song.song_name || '未知歌曲')}</span>
      <button class="del-btn" title="移除">✕</button>
    `;
    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('del-btn')) return;
      state.currentIndex = idx;
      playCurrent();
    });
    div.querySelector('.del-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      state.playlist.splice(idx, 1);
      if (state.currentIndex === idx) { state.currentIndex = -1; stopPlayback(); }
      else if (state.currentIndex > idx) state.currentIndex -= 1;
      renderPlaylist();
    });
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showPlaylistMenu(e.clientX, e.clientY, idx);
    });
    playlistContent.appendChild(div);
  });
}
function showPlaylistMenu(x, y, idx) {
  const menu = document.createElement('div');
  menu.style.cssText = 'position:fixed;z-index:10000;background:var(--color-bg);border:1px solid var(--color-border);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.1);padding:5px;min-width:130px;';
  const items = [
    ['播放', () => { state.currentIndex = idx; playCurrent(); }],
    ['上移', () => movePlaylistItem(idx, -1)],
    ['下移', () => movePlaylistItem(idx, +1)],
    ['移除', () => { state.playlist.splice(idx, 1); if (state.currentIndex === idx) { state.currentIndex = -1; stopPlayback(); } else if (state.currentIndex > idx) state.currentIndex -= 1; renderPlaylist(); }],
    ['清空', () => { state.playlist = []; state.currentIndex = -1; stopPlayback(); renderPlaylist(); }],
  ];
  items.forEach(([label, fn]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'display:block;width:100%;text-align:left;padding:6px 10px;border:none;background:transparent;color:var(--color-text);cursor:pointer;border-radius:5px;font-size:13px;';
    b.addEventListener('mouseenter', () => b.style.background = 'var(--color-surface)');
    b.addEventListener('mouseleave', () => b.style.background = 'transparent');
    b.addEventListener('click', () => { fn(); menu.remove(); });
    menu.appendChild(b);
  });
  document.body.appendChild(menu);
  const close = () => menu.remove();
  setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
  menu.style.left = Math.min(x, window.innerWidth - 150) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 10) + 'px';
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
  setStats('已清空播放列表');
});
btnSavePlaylist.addEventListener('click', savePlaylist);
btnLoadPlaylist.addEventListener('click', loadPlaylist);
async function savePlaylist() {
  if (!state.playlist.length) { setStats('歌单为空，无需保存'); return; }
  if (!win || !fs) { setStats('保存歌单需要 Electron 环境'); return; }
  try {
    const result = await dialog.showSaveDialog({
      title: '保存歌单',
      defaultPath: 'playlist.json',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return;
    const data = await postJSON('/playlist/encrypt', { songs: state.playlist });
    fs.writeFileSync(result.filePath, data.content, 'utf-8');
    setStats(`歌单已加密保存至 ${result.filePath}`);
  } catch (e) {
    setStats(`保存失败: ${e.message}`);
  }
}
async function loadPlaylist() {
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
    state.playlist = data.songs;
    state.currentIndex = -1;
    renderPlaylist();
    setStats(`已加载歌单，共 ${state.playlist.length} 首歌曲`);
  } catch (e) {
    setStats(`加载失败: ${e.message}`);
  }
}

// ---------- 播放 ----------
async function playCurrent() {
  if (state.currentIndex < 0 || state.currentIndex >= state.playlist.length) { stopPlayback(); return; }
  const song = state.playlist[state.currentIndex];
  setStats('正在刷新播放链接...');
  btnPlay.disabled = true;
  try {
    const refreshed = await postJSON('/refresh', { songs: [song] });
    const info = (refreshed && refreshed.length) ? refreshed[0] : song;
    state.playlist[state.currentIndex] = info;
    if (!info.download_url) {
      setStats('无法获取有效的播放链接');
      showWarn('播放失败', '无法获取有效的播放链接，请检查网络或重新搜索。');
      stopPlayback();
      return;
    }
    doPlay(info);
  } catch (e) {
    setStats('链接刷新失败');
    showWarn('播放失败', e.message);
    stopPlayback();
  } finally {
    btnPlay.disabled = false;
  }
}
function doPlay(song) {
  ensureAudioGraph();
  const url = song.download_url;
  if (!url) return;
  const ext = (song.ext || 'mp3').toLowerCase();
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  let outputCodec = ext.toUpperCase();
  if (isSafari && ['flac', 'ogg', 'opus'].includes(ext)) outputCodec = 'MP3';
  else if (!['mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wav', 'webm'].includes(ext)) outputCodec = 'MP3';
  labelCodec.textContent = outputCodec;
  labelCodecViz.textContent = outputCodec;
  audioPlayer.src = `${API_BASE}/stream?url=${encodeURIComponent(url)}&source=${encodeURIComponent(song.source || '')}&ext=${encodeURIComponent(ext)}`;
  audioPlayer.volume = volumeSlider.value / 100;
  audioPlayer.play().catch(err => console.error('播放失败:', err));
  state.seekBase = 0;
  state.currentDuration = parseDurationSec(song);
  positionSlider.max = state.currentDuration || 0;
  positionSlider.value = 0;
  labelTime.textContent = state.currentDuration ? `00:00 / ${formatTime(state.currentDuration)}` : '00:00 / --:--';
  nowPlayingText.textContent = `${song.singers || ''} - ${song.song_name || ''}`;
  setBtnIcon(btnPlay, 'pause');
  state.playing = true;
  state.paused = false;
  const lyricText = song.lyric || song.lyrics || '';
  state.currentLyrics = lyricText ? parseLrc(lyricText) : [];
  state.currentLyricIndex = -1;
  renderLyrics();
  const cu = coverUrl(song);
  state.currentCoverUrl = cu;
  playerCover.innerHTML = cu ? `<img src="${cu}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;" onerror="this.style.display='none'">` : IC('music');
  if (state.vizOpen) updateVizCover();
  renderPlaylist();
  setStats(`正在播放: ${song.song_name || ''}`);
}
function togglePlay() {
  if (audioPlayer.paused && audioPlayer.src) {
    audioPlayer.play();
    setBtnIcon(btnPlay, 'pause');
    state.playing = true; state.paused = false;
  } else if (!audioPlayer.paused) {
    audioPlayer.pause();
    setBtnIcon(btnPlay, 'play');
    state.playing = false; state.paused = true;
  } else {
    playCurrent();
  }
}
function stopPlayback() {
  audioPlayer.pause();
  audioPlayer.removeAttribute('src');
  audioPlayer.load();
  state.playing = false;
  state.paused = false;
  setBtnIcon(btnPlay, 'play');
  nowPlayingText.textContent = '未播放';
  positionSlider.value = 0;
  positionSlider.max = 0;
  labelCodec.textContent = '--';
  labelCodecViz.textContent = '--';
  labelTime.textContent = '00:00 / 00:00';
  state.seekBase = 0;
  state.currentDuration = 0;
  state.currentCoverUrl = '';
  state.currentLyrics = [];
  state.currentLyricIndex = -1;
  renderLyrics();
  playerCover.innerHTML = IC('music');
  if (state.vizOpen) updateVizCover();
  renderPlaylist();
}
function playPrev() {
  if (!state.playlist.length) return;
  state.currentIndex = state.currentIndex <= 0 ? state.playlist.length - 1 : state.currentIndex - 1;
  playCurrent();
}
function playNext() {
  if (!state.playlist.length) return;
  state.currentIndex = state.currentIndex >= state.playlist.length - 1 ? 0 : state.currentIndex + 1;
  playCurrent();
}
function onPlaybackEnded() {
  const mode = parseInt(playmodeSelect.value, 10);
  if (mode === 0) { playCurrent(); }
  else if (mode === 1) { nowPlayingText.textContent = '播放结束'; stopPlayback(); }
  else if (mode === 2) { state.currentIndex = (state.currentIndex + 1) % state.playlist.length; playCurrent(); }
  else {
    if (state.currentIndex >= state.playlist.length - 1) { nowPlayingText.textContent = '列表播放结束'; stopPlayback(); }
    else { state.currentIndex += 1; playCurrent(); }
  }
}
btnPlay.addEventListener('click', togglePlay);
btnPrev.addEventListener('click', playPrev);
btnNext.addEventListener('click', playNext);
btnStop.addEventListener('click', stopPlayback);
playmodeSelect.addEventListener('change', async (e) => {
  const v = parseInt(e.target.value, 10);
  await persistSetting({ play_mode: v });
});
positionSlider.addEventListener('input', () => {
  state.dragging = true;
  const total = state.currentDuration;
  if (total > 0) labelTime.textContent = `${formatTime(positionSlider.value)} / ${formatTime(total)}`;
});
positionSlider.addEventListener('change', () => {
  state.dragging = false;
  applySeek(parseFloat(positionSlider.value));
});
function applySeek(sec) {
  if (!audioPlayer.src || sec < 0) return;
  const total = state.currentDuration;
  if (total > 0) sec = Math.min(sec, total);
  if (audioPlayer.seekable && audioPlayer.seekable.length > 0 && isFinite(audioPlayer.duration)) {
    audioPlayer.currentTime = sec;
  } else {
    seekStream(sec);
  }
}
function seekStream(sec) {
  const src = audioPlayer.src;
  if (!src) return;
  const u = new URL(src);
  u.searchParams.set('start', String(Math.max(0, Math.floor(sec))));
  state.seekBase = Math.max(0, Math.floor(sec));
  audioPlayer.src = u.toString();
  audioPlayer.play().catch(() => {});
  setBtnIcon(btnPlay, 'pause');
  state.playing = true; state.paused = false;
  if (state.currentDuration > 0) {
    positionSlider.max = state.currentDuration;
    positionSlider.value = Math.min(sec, state.currentDuration);
    labelTime.textContent = `${formatTime(Math.min(sec, state.currentDuration))} / ${formatTime(state.currentDuration)}`;
  }
  renderPlaylist();
}
audioPlayer.addEventListener('timeupdate', () => {
  if (state.dragging) return;
  const cur = state.seekBase + audioPlayer.currentTime;
  const total = state.currentDuration;
  if (total > 0) {
    positionSlider.max = total;
    positionSlider.value = Math.min(cur, total);
    labelTime.textContent = `${formatTime(Math.min(cur, total))} / ${formatTime(total)}`;
  } else {
    labelTime.textContent = `${formatTime(cur)} / --:--`;
  }
  updateLyrics(cur);
  if (state.vizOpen && !state.dragging) {
    vizPositionSlider.max = total || 0;
    vizPositionSlider.value = Math.min(cur, total || 0);
    labelTimeViz.textContent = total ? `${formatTime(Math.min(cur, total))} / ${formatTime(total)}` : `${formatTime(cur)} / --:--`;
  }
});
audioPlayer.addEventListener('loadedmetadata', () => {
  if (isFinite(audioPlayer.duration) && audioPlayer.duration > 0 && !state.currentDuration) {
    state.currentDuration = audioPlayer.duration;
    positionSlider.max = audioPlayer.duration;
  }
});
audioPlayer.addEventListener('ended', onPlaybackEnded);
audioPlayer.addEventListener('play', () => { document.getElementById('player-bar').classList.add('playing'); });
audioPlayer.addEventListener('pause', () => { document.getElementById('player-bar').classList.remove('playing'); });
audioPlayer.addEventListener('ended', () => { document.getElementById('player-bar').classList.remove('playing'); });
audioPlayer.addEventListener('error', () => {
  if (!audioPlayer.src) return;
  showWarn('播放失败', '无法播放该歌曲，可能链接已失效或需要特定请求头。\n建议使用「下载」功能保存到本地。');
  nowPlayingText.textContent = '播放失败';
  stopPlayback();
});
volumeSlider.addEventListener('input', (e) => {
  audioPlayer.volume = e.target.value / 100;
  vizVolumeSlider.value = e.target.value;
});
volumeSlider.addEventListener('change', () => persistSetting({ volume: parseInt(volumeSlider.value, 10) }));
vizVolumeSlider.addEventListener('input', (e) => {
  audioPlayer.volume = e.target.value / 100;
  volumeSlider.value = e.target.value;
});
async function persistSetting(patch) {
  state.settings = Object.assign({}, state.settings, patch);
  try { await postJSON('/settings', patch); } catch (e) { console.error('保存设置失败:', e); }
}

// ---------- 歌词 ----------
function parseLrc(text) {
  const lyrics = [];
  const re = /\[(\d{2}):(\d{2})[.:](\d{2,3})\](.*)/;
  String(text).split('\n').forEach(line => {
    line = line.trim();
    const m = re.exec(line);
    if (m) {
      const min = parseInt(m[1], 10), sec = parseInt(m[2], 10);
      const msStr = m[3];
      const ms = msStr.length === 2 ? parseInt(msStr, 10) * 10 : parseInt(msStr, 10);
      const time = min * 60 + sec + ms / 1000;
      const content = m[4].trim();
      if (content) lyrics.push({ time, text: content });
    }
  });
  lyrics.sort((a, b) => a.time - b.time);
  return lyrics;
}
function renderLyrics() {
  if (!state.currentLyrics.length) {
    lyricContent.innerHTML = '<div class="lyric-empty">暂无歌词</div>';
    vizLyrics.innerHTML = '<div class="lyric-empty">暂无歌词</div>';
    return;
  }
  let html = '';
  state.currentLyrics.forEach((l, i) => {
    html += `<div class="lyric-line" data-i="${i}">${escapeHtml(l.text)}</div>`;
  });
  lyricContent.innerHTML = html;
  vizLyrics.innerHTML = html;
  lyricContent.querySelectorAll('.lyric-line').forEach(el => {
    el.addEventListener('click', () => seekToLyric(parseInt(el.dataset.i, 10)));
  });
  vizLyrics.querySelectorAll('.lyric-line').forEach(el => {
    el.addEventListener('click', () => seekToLyric(parseInt(el.dataset.i, 10)));
  });
}
function seekToLyric(idx) {
  const l = state.currentLyrics[idx];
  if (!l || !audioPlayer.src) return;
  applySeek(l.time);
}
function updateLyrics(curTime) {
  if (!state.currentLyrics.length) return;
  let newIdx = -1;
  for (let i = 0; i < state.currentLyrics.length; i++) {
    if (state.currentLyrics[i].time <= curTime) newIdx = i;
    else break;
  }
  if (newIdx === state.currentLyricIndex) return;
  const old = state.currentLyricIndex;
  state.currentLyricIndex = newIdx;
  [lyricContent, vizLyrics].forEach(container => {
    if (!container) return;
    if (old >= 0) {
      const el = container.querySelector(`.lyric-line[data-i="${old}"]`);
      if (el) el.classList.remove('active');
    }
    if (newIdx >= 0) {
      const el = container.querySelector(`.lyric-line[data-i="${newIdx}"]`);
      if (el) {
        el.classList.add('active');
        if (container.isConnected && container.scrollHeight > container.clientHeight) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    }
  });
}

// ---------- 下载 ----------
downloadSelectedBtn.addEventListener('click', downloadSelected);
async function downloadSelected() {
  const songs = getSelectedResults();
  if (!songs.length) { setStats('请先勾选要下载的歌曲'); return; }
  setStats('正在刷新链接...');
  downloadSelectedBtn.disabled = true;
  try {
    const refreshed = await postJSON('/refresh', { songs });
    const toDownload = refreshed.length ? refreshed : songs;
    if (!toDownload.length) { setStats('所有歌曲链接均已失效，请重新搜索'); return; }
    const data = await postJSON('/download', { songs: toDownload });
    initDownloadTasks(data.task_ids, toDownload);
  } catch (e) {
    setStats(`启动下载失败: ${e.message}`);
  } finally {
    downloadSelectedBtn.disabled = false;
  }
}
function initDownloadTasks(taskIds, songs) {
  state.downloads.clear();
  state.downloadTotal = songs.length;
  state.downloadDone = 0;
  state.downloadStartTime = Date.now();
  taskIds.forEach((tid, i) => {
    state.downloads.set(tid, { song: songs[i], percent: 0, status: 'pending' });
  });
  renderDownloadTasks();
  cancelAllBtn.disabled = false;
  startTaskReconcile();
  setStats(`准备下载 ${songs.length} 首...`);
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
function startTaskReconcile() {
  stopTaskReconcile();
  state.taskReconcileTimer = setInterval(reconcileTasks, 4000);
}
function stopTaskReconcile() {
  if (state.taskReconcileTimer) { clearInterval(state.taskReconcileTimer); state.taskReconcileTimer = null; }
}
function renderDownloadTasks() {
  downloadTasksList.innerHTML = '';
  state.downloads.forEach((t, tid) => {
    const div = document.createElement('div');
    div.className = 'task-item';
    div.id = `task-${tid}`;
    const statusText = t.status === 'done' ? '完成' : t.status === 'error' ? '失败' : t.status === 'cancelled' ? '已取消' : '';
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
function handleWSMessage(data) {
  // 搜索进度（每源一行，实时更新）
  if (data.type === 'search_progress') { handleSearchProgressWS(data); return; }
  // 歌单解析进度
  if (data.type === 'parse_progress') { handleParseProgressWS(data); return; }
  const tid = data.task_id;
  if (tid == null) return;
  if (data.type === 'progress') {
    applyTaskResult(tid, 'progress', data.percent);
  } else if (data.type === 'done' || data.type === 'error' || data.type === 'cancelled') {
    applyTaskResult(tid, data.type, data.type === 'done' ? 100 : null);
  }
}
function updateDownloadProgress() {
  const total = state.downloadTotal;
  const done = state.downloadDone;
  if (!total) return;
  const pct = Math.round(done / total * 100);
  barOverall.style.width = pct + '%';
  const elapsed = (Date.now() - state.downloadStartTime) / 1000;
  let eta = '';
  if (done > 0 && elapsed > 1) {
    const progress = done / total;
    const etaSec = (elapsed / progress) - elapsed;
    eta = etaSec > 0 ? `剩余: ${formatTime(etaSec)}` : '即将完成';
  }
  setStats(`已完成 ${done}/${total}  ${eta}`);
  if (done >= total) {
    cancelAllBtn.disabled = true;
    const failed = [...state.downloads.values()].filter(t => t.status === 'error').length;
    setStats(`所有下载任务已完成 (${total} 首)${failed ? `，${failed} 首失败` : ''}`);
  }
}
function cancelDownload(taskId) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ action: 'cancel', task_id: taskId }));
  }
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
  state.ws = new WebSocket('ws://127.0.0.1:8000/ws');
  state.ws.onopen = () => console.log('WebSocket 已连接');
  state.ws.onmessage = (event) => {
    try { handleWSMessage(JSON.parse(event.data)); }
    catch (e) { console.error('解析 WS 消息失败:', e); }
  };
  state.ws.onclose = () => { setTimeout(connectWebSocket, 3000); };
  state.ws.onerror = (err) => console.error('WebSocket 错误:', err);
}

// ---------- 频谱 + 均衡器 ----------
const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_PRESETS = {
  flat:      [0,0,0,0,0,0,0,0,0,0],
  pop:       [-1,2,4,5,3,0,-1,-1,0,1],
  rock:      [5,4,2,1,0,-1,-1,1,2,3],
  jazz:      [3,2,1,0,0,0,-1,0,1,2],
  classical: [4,3,1,0,0,0,0,1,3,4],
  vocal:     [-3,-2,0,2,4,5,4,1,0,-2],
  bass:      [7,6,5,3,1,0,0,0,0,0],
};
function defaultEq() {
  return { bands: EQ_PRESETS.flat.slice(), bass: false, treble: false, vocal: false, preset: 'flat' };
}
function ensureAudioGraph() {
  if (state.audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  state.audioCtx = new AC();
  state.srcNode = state.audioCtx.createMediaElementSource(audioPlayer);
  state.analyser = state.audioCtx.createAnalyser();
  state.analyser.fftSize = 2048;
  state.analyser.smoothingTimeConstant = 0.7;
  const mk = (type, freq, Q = 1.1) => {
    const f = state.audioCtx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    f.gain.value = 0;
    return f;
  };
  state.eqExtra = {
    bass: mk('lowshelf', 120),
    treble: mk('highshelf', 8000),
    vocal: mk('peaking', 1500, 1.0),
  };
  state.eqFilters = EQ_BANDS.map(freq => mk('peaking', freq));
  let node = state.srcNode;
  node.connect(state.eqExtra.bass); node = state.eqExtra.bass;
  node.connect(state.eqExtra.treble); node = state.eqExtra.treble;
  node.connect(state.eqExtra.vocal); node = state.eqExtra.vocal;
  for (const f of state.eqFilters) { node.connect(f); node = f; }
  node.connect(state.analyser);
  state.analyser.connect(state.audioCtx.destination);
  applyEqToGraph();
}
function applyEqToGraph() {
  if (!state.eqFilters || !state.audioCtx) return;
  const eq = state.eq || defaultEq();
  (eq.bands || EQ_PRESETS.flat.slice()).forEach((g, i) => {
    if (state.eqFilters[i]) state.eqFilters[i].gain.value = Math.max(-12, Math.min(12, Number(g) || 0));
  });
  if (state.eqExtra.bass) state.eqExtra.bass.gain.value = eq.bass ? 6 : 0;
  if (state.eqExtra.treble) state.eqExtra.treble.gain.value = eq.treble ? 4 : 0;
  if (state.eqExtra.vocal) state.eqExtra.vocal.gain.value = eq.vocal ? 4 : 0;
}
function openEqModal() {
  if (!state.eq) state.eq = defaultEq();
  renderEqBands();
  syncEqUI();
  openModal('eq-modal');
}
eqCloseBtn.addEventListener('click', () => closeModal('eq-modal'));
eqDoneBtn.addEventListener('click', () => closeModal('eq-modal'));
eqModal.addEventListener('click', (e) => { if (e.target.id === 'eq-modal') closeModal('eq-modal'); });
eqReset.addEventListener('click', () => {
  state.eq = defaultEq();
  renderEqBands();
  syncEqUI();
  applyEqToGraph();
  persistSetting({ eq: state.eq });
});
function renderEqBands() {
  const wrap = eqBands;
  if (!wrap || wrap.dataset.rendered) return;
  wrap.dataset.rendered = '1';
  EQ_BANDS.forEach((freq, i) => {
    const div = document.createElement('div');
    div.className = 'eq-band';
    const label = freq >= 1000 ? (freq / 1000) + 'K' : String(freq);
    div.innerHTML = `
      <span class="gain" id="eq-gain-${i}">0</span>
      <input type="range" min="-12" max="12" step="0.5" value="0" data-i="${i}" />
      <span class="freq">${label}</span>
    `;
    wrap.appendChild(div);
  });
  wrap.querySelectorAll('input[type="range"]').forEach(input => {
    input.addEventListener('input', () => {
      const i = Number(input.dataset.i);
      state.eq.bands[i] = Number(input.value);
      document.getElementById('eq-gain-' + i).textContent = input.value > 0 ? '+' + input.value : input.value;
      state.eq.preset = 'custom';
      eqPreset.value = 'custom';
      applyEqToGraph();
      persistSetting({ eq: state.eq });
    });
  });
}
function syncEqUI() {
  const eq = state.eq || defaultEq();
  (eq.bands || EQ_PRESETS.flat.slice()).forEach((g, i) => {
    const input = document.querySelector(`#eq-bands input[data-i="${i}"]`);
    if (input) input.value = g;
    const label = document.getElementById('eq-gain-' + i);
    if (label) label.textContent = g > 0 ? '+' + g : g;
  });
  eqPreset.value = eq.preset || 'custom';
  [
    ['bass', eqChips.bass],
    ['treble', eqChips.treble],
    ['vocal', eqChips.vocal]
  ].forEach(([k, el]) => {
    if (el) el.classList.toggle('on', !!eq[k]);
  });
}
eqPreset.addEventListener('change', () => {
  const key = eqPreset.value;
  state.eq.preset = key;
  if (EQ_PRESETS[key]) state.eq.bands = EQ_PRESETS[key].slice();
  syncEqUI();
  applyEqToGraph();
  persistSetting({ eq: state.eq });
});
Object.entries(eqChips).forEach(([k, el]) => {
  if (el) {
    el.addEventListener('click', () => {
      state.eq[k] = !state.eq[k];
      syncEqUI();
      applyEqToGraph();
      persistSetting({ eq: state.eq });
    });
  }
});

// ---------- 频谱绘制 ----------
function spectrumBins(data, count, loHz = 60, hiHz = 7000, fftSize = 2048, sampleRate = 44100) {
  const bins = new Float32Array(count);
  const n = data.length;
  if (!n) return bins;
  const lo = Math.max(1, Math.floor(loHz * fftSize / sampleRate));
  const hi = Math.max(lo + 1, Math.min(n, Math.floor(hiHz * fftSize / sampleRate)));
  const edges = new Array(count + 1);
  for (let i = 0; i <= count; i++) edges[i] = Math.round(lo * Math.pow(hi / lo, i / count));
  for (let i = 0; i < count; i++) {
    const s = edges[i], e = Math.max(s + 1, edges[i + 1]);
    let mx = 0;
    for (let j = s; j < e && j < n; j++) if (data[j] > mx) mx = data[j];
    bins[i] = mx / 255;
  }
  return bins;
}
const VIRIDIS = [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]];
function viridisColor(t) {
  t = Math.max(0, Math.min(1, t)) * (VIRIDIS.length - 1);
  const i = Math.floor(t), f = t - i, a = VIRIDIS[i], b = VIRIDIS[Math.min(i + 1, VIRIDIS.length - 1)];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}
const miniSmooth = new Float32Array(28);
function drawMiniSpectrum() {
  const canvas = miniSpectrum;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  let bins = new Float32Array(28);
  if (state.analyser) {
    const data = new Uint8Array(state.analyser.frequencyBinCount);
    state.analyser.getByteFrequencyData(data);
    bins = spectrumBins(data, 28);
  }
  for (let i = 0; i < 28; i++) miniSmooth[i] = 0.45 * bins[i] + 0.55 * miniSmooth[i];
  const n = 28, gap = 1;
  const barW = (w - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const v = miniSmooth[i];
    const bh = Math.max(2, v * (h - 3));
    const x = i * (barW + gap), y = h - 1.5 - bh;
    const t = i / Math.max(1, n - 1);
    ctx.fillStyle = `rgba(${Math.round(74 + 56 * t)},144,${Math.round(217 - 60 * t)},0.9)`;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, bh, barW / 3);
    ctx.fill();
  }
  requestAnimationFrame(drawMiniSpectrum);
}
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    if (r > w/2) r = w/2;
    if (r > h/2) r = h/2;
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r);
    this.lineTo(x, y + r);
    this.quadraticCurveTo(x, y, x + r, y);
    this.closePath();
    return this;
  };
}

// ---------- 可视化 ----------
const vizState = {
  bars: new Float32Array(45),
  ring: new Float32Array(40),
  waterfall: [],
};
const VIZ_BINS = 45, VIZ_RING = 40, VIZ_ROWS = 60;
function openViz() {
  document.body.classList.add('viz-mode');
  vizOverlay.classList.add('show');
  state.vizOpen = true;
  vizState.waterfall = [];
  for (let i = 0; i < VIZ_ROWS; i++) vizState.waterfall.push(new Float32Array(VIZ_BINS));
  syncVizUI();
  updateVizCover();
  resizeVizCanvases();
  if (!state.vizRaf) drawViz();
  setStats('可视化播放中');
}
function closeViz() {
  vizOverlay.classList.remove('show');
  document.body.classList.remove('viz-mode');
  state.vizOpen = false;
  if (state.vizRaf) { cancelAnimationFrame(state.vizRaf); state.vizRaf = null; }
}
function updateVizCover() {
  if (!vizCover) return;
  if (state.currentCoverUrl) {
    vizCover.style.backgroundImage = `url('${state.currentCoverUrl}')`;
    vizCover.style.display = 'block';
  } else {
    vizCover.style.display = 'none';
  }
}
vizCloseBtn.addEventListener('click', closeViz);
vizMinBtn.addEventListener('click', () => { if (win) win.minimize(); });
vizMaxBtn.addEventListener('click', toggleWindowMaximize);
btnEq.addEventListener('click', openEqModal);
playerCover.addEventListener('click', openViz);
btnViz.addEventListener('click', openViz);
function syncVizUI() {
  vizTitle.textContent = nowPlayingText.textContent;
  vizVolumeSlider.value = volumeSlider.value;
  vizBtnPlay.innerHTML = IC(audioPlayer.paused && audioPlayer.src ? 'play' : 'pause');
}
function resizeVizCanvases() {
  ['viz-bars-canvas', 'viz-ring-canvas', 'viz-waterfall-canvas'].forEach(id => {
    const c = $(id);
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(10, Math.round(r.width * dpr));
    c.height = Math.max(10, Math.round(r.height * dpr));
  });
}
window.addEventListener('resize', () => { if (state.vizOpen) resizeVizCanvases(); });
vizBtnPlay.addEventListener('click', () => { togglePlay(); syncVizUI(); });
vizBtnStop.addEventListener('click', () => { stopPlayback(); syncVizUI(); });
vizPositionSlider.addEventListener('input', function() {
  state.dragging = true;
  const total = state.currentDuration;
  if (total > 0) labelTimeViz.textContent = `${formatTime(this.value)} / ${formatTime(total)}`;
});
vizPositionSlider.addEventListener('change', function() {
  state.dragging = false;
  applySeek(parseFloat(this.value));
});
let vizFrame = 0;
function drawViz() {
  if (!state.vizOpen) { state.vizRaf = null; return; }
  const data = new Uint8Array(state.analyser ? state.analyser.frequencyBinCount : 0);
  if (state.analyser) state.analyser.getByteFrequencyData(data);
  const bars = spectrumBins(data, VIZ_BINS, 20, 10000);
  for (let i = 0; i < VIZ_BINS; i++) vizState.bars[i] = 0.4 * bars[i] + 0.6 * vizState.bars[i];
  for (let i = 0; i < VIZ_RING; i++) {
    const src = Math.floor(i / VIZ_RING * VIZ_BINS);
    vizState.ring[i] = 0.4 * vizState.bars[src] + 0.6 * vizState.ring[i];
  }
  drawVizBars();
  drawVizRing();
  vizFrame++;
  if (vizFrame % 2 === 0) {
    vizState.waterfall.pop();
    vizState.waterfall.unshift(Float32Array.from(vizState.bars));
    drawVizWaterfall();
  }
  state.vizRaf = requestAnimationFrame(drawViz);
}
function drawVizBars() {
  const canvas = vizBarsCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const n = VIZ_BINS, gap = 2;
  const barW = (w - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const v = vizState.bars[i];
    const bh = Math.max(2, v * (h - 4));
    const x = i * (barW + gap), y = h - 2 - bh;
    ctx.fillStyle = viridisColor(v);
    ctx.fillRect(x, y, barW, bh);
  }
}
function drawVizRing() {
  const canvas = vizRingCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const maxR = Math.min(w, h) / 2 - 8;
  const n = VIZ_RING;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const v = vizState.ring[i];
    const r = maxR * (0.15 + 0.85 * v);
    ctx.strokeStyle = viridisColor(v);
    ctx.lineWidth = Math.max(2, maxR * 0.028);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * 2, cy + Math.sin(angle) * 2);
    ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    ctx.stroke();
    ctx.fillStyle = viridisColor(v);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 2 + v * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
function drawVizWaterfall() {
  const canvas = vizWaterfallCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (w <= 2 || h <= 2) return;
  const rows = vizState.waterfall;
  const n = VIZ_BINS;
  const GAP = 1;
  const unit = w / (n * (GAP + 1) - 1);
  const colW = unit;
  const rowH = h / VIZ_ROWS;
  const threshold = 0.3;
  ctx.fillStyle = 'rgb(65,105,225)';
  for (let r = 0; r < VIZ_ROWS; r++) {
    const row = rows[r];
    const y = r * rowH;
    for (let c = 0; c < n; c++) {
      const v = row[c];
      if (v * v > threshold) {
        ctx.fillRect(c * unit * (GAP + 1), y, colW + 0.5, rowH + 0.5);
      }
    }
  }
}

// ---------- 设置与关于 ----------
$('nav-settings').addEventListener('click', () => openModal('settings-modal'));
$('nav-about').addEventListener('click', () => openModal('about-modal'));
settingsCloseBtn.addEventListener('click', () => closeModal('settings-modal'));
settingsCancelBtn.addEventListener('click', () => closeModal('settings-modal'));
settingsModal.addEventListener('click', (e) => { if (e.target.id === 'settings-modal') closeModal('settings-modal'); });
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const sources = [];
  document.querySelectorAll('#source-checkboxes input[type="checkbox"]:checked').forEach(cb => sources.push(cb.value));
  const convertEnabled = settingConvertEnabled.checked;
  const settings = {
    sources,
    limit: parseInt(settingLimit.value, 10) || 10,
    dedup: settingDedup.checked,
    save_dir: settingSaveDir.value.trim(),
    filename_format: settingFilenameFormat.value,
    custom_format: settingCustomFormat.value.trim(),
    group_by: settingGroupBy.value,
    download_lyric: settingDownloadLyric.checked,
    download_cover: settingDownloadCover.checked,
    convert_enabled: convertEnabled,
    convert_format: convertEnabled ? settingConvertFormat.value : '',
    convert_bitrate: settingConvertFormat.value === 'flac' ? '' : settingConvertBitrate.value,
    embed_lyrics: settingEmbedLyrics.checked,
    delete_lyrics: settingDeleteLyrics.checked,
    embed_cover: settingEmbedCover.checked,
    delete_cover: settingDeleteCover.checked,
    theme: settingTheme.value,
    theme_color: settingAccent.value,
    theme_custom: settingAccentColor.value,
    background_opacity: parseInt(settingOpacity.value, 10) / 100,
    show_progress_detail: settingShowProgress.checked,
    play_mode: parseInt(settingPlaymode.value, 10),
    volume: parseInt(volumeSlider.value, 10),
  };
  try {
    await postJSON('/settings', settings);
    state.settings = Object.assign({}, state.settings, settings);
    applyTheme(settings.theme, settings.background_opacity, settings.theme_color, settings.theme_custom);
    playmodeSelect.value = String(settings.play_mode);
    closeModal('settings-modal');
    setStats('设置已更新并保存');
  } catch (err) {
    setStats(`保存设置失败: ${err.message}`);
  }
});
browseSaveDir.addEventListener('click', async () => {
  if (!dialog) return;
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    defaultPath: settingSaveDir.value || undefined
  });
  if (!result.canceled && result.filePaths.length) {
    settingSaveDir.value = result.filePaths[0];
  }
});
settingsTabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    settingsTabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(btn.dataset.tab);
    if (target) target.classList.add('active');
  });
});
aboutCloseBtn.addEventListener('click', () => closeModal('about-modal'));
aboutModal.addEventListener('click', (e) => { if (e.target.id === 'about-modal') closeModal('about-modal'); });

// ---------- 启动 ----------
audioPlayer.style.display = 'none';
connectWebSocket();
drawMiniSpectrum();
initApp();