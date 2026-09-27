// ==================== 核心：常量 / DOM 引用 / 状态 / 工具 ====================
// 本文件所有顶层声明均为共享符号，后续 <script> 可直接访问。
// 规则：本文件不做任何 DOM 事件绑定或立即执行的动作，只做声明。

// ---------- 后端地址（端口由主进程通过 additionalArguments 注入） ----------
const _API_PORT = (() => {
  const argv = (typeof process !== 'undefined' && process.argv) || [];
  const arg = argv.find(a => typeof a === 'string' && a.startsWith('--cmc-api-port='));
  if (arg) {
    const v = arg.split('=')[1];
    if (v) return v;
  }
  const envPort = (typeof process !== 'undefined' && process.env && process.env.CMC_API_PORT) || '';
  return envPort || '8000';
})();
// 用 let：支持后端崩溃重启换端口后动态更新（见下方 IPC 监听）
let API_BASE = `http://127.0.0.1:${_API_PORT}`;
let WS_URL = `ws://127.0.0.1:${_API_PORT}/ws`;

// ---------- Electron 上下文 ----------
let win = null, dialog = null, fs = null;
try {
  const remote = require('@electron/remote');
  win = remote.getCurrentWindow();
  dialog = remote.dialog;
} catch (e) {}
try { fs = require('fs'); } catch (e) {}
let ipcRenderer = null;
try { ipcRenderer = require('electron').ipcRenderer; } catch (e) {}

// ---------- IPC：后端动态换端口通知 ----------
// 场景：后端崩溃重启时探测到原端口被占用，会切到新端口。
// main.js 通过 'api-port-changed' 通知渲染进程，这里更新全局地址并触发 WS 重连。
if (ipcRenderer) {
  ipcRenderer.on('api-port-changed', (_evt, data) => {
    if (!data || !data.port) return;
    const newPort = String(data.port);
    API_BASE = `http://127.0.0.1:${newPort}`;
    WS_URL = `ws://127.0.0.1:${newPort}/ws`;
    if (typeof setStats === 'function') setStats(`后端已切换到端口 ${newPort}`);
    try {
      if (state.ws) { state.ws.close(); state.ws = null; }
    } catch (e) {}
    if (typeof connectWebSocket === 'function') {
      try { connectWebSocket(); } catch (e) {}
    }
  });
}

// ---------- DOM 工具 ----------
const $ = (id) => document.getElementById(id);

// ---------- DOM 引用 ----------
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
const speedSelect = $('speed-select');
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
const vizBtnPrev = $('viz-btn-prev');
const vizBtnNext = $('viz-btn-next');
const vizPlaymodeSelect = $('viz-playmode-select');
const vizBtnPlaylist = $('viz-btn-playlist');
const vizPlaylistPanel = $('viz-playlist-panel');
const vizPlaylistList = $('viz-playlist-list');
const vizPlaylistClose = $('viz-playlist-close');
const vizPlaylistCount = $('viz-playlist-count');
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
  vocal: $('eq-chip-vocal'),
  vocal_cancel: $('eq-chip-vocal-cancel'),
};
const aboutModal = $('about-modal');
const aboutCloseBtn = $('about-close-btn');
const navItems = document.querySelectorAll('.nav-item[data-view]');
const settingsTabBtns = document.querySelectorAll('.settings-tab');
const backendErrorBanner = $('backend-error-banner');
const backendErrorMsg = $('backend-error-msg');
const backendRetryBtn = $('backend-retry-btn');
const backendErrorClose = $('backend-error-close');
const libraryCount = $('library-count');
const libraryContent = $('library-content');
const libraryDirLabel = $('library-dir-label');
const libraryToggleBtn = $('library-toggle-btn');
const libraryCustomBtn = $('library-custom-btn');
const libraryRescanBtn = $('library-rescan-btn');

// 聆听本地 - 扩展控件
const libraryEncodingSelect = $('library-encoding-select');
const librarySortSelect = $('library-sort-select');
const librarySortDirBtn = $('library-sort-dir-btn');
const libraryFilterExt = $('library-filter-ext');
const libraryCoverOnly = $('library-cover-only');
const librarySelectionBar = $('library-selection-bar');
const librarySelectedCount = $('library-selected-count');
const libraryRenameBtn = $('library-rename-btn');
const libraryTagsBtn = $('library-tags-btn');
const libraryTrashBtn = $('library-trash-btn');
const libraryClearSelBtn = $('library-clear-sel-btn');
const librarySelectAllBtn = $('library-select-all-btn');
const libraryInvertBtn = $('library-invert-btn');
// 聆听本地 - 筛选 / 批量转换
const libraryFilterSinger = $('library-filter-singer');
const libraryFilterAlbum = $('library-filter-album');
const libraryConvertBtn = $('library-convert-btn');
const batchConvertModal = $('batch-convert-modal');
const batchConvertFormat = $('batch-convert-format');
const batchConvertBitrate = $('batch-convert-bitrate');
const batchConvertSummary = $('batch-convert-summary');
const batchConvertApplyBtn = $('batch-convert-apply-btn');
const batchConvertCancelBtn = $('batch-convert-cancel-btn');
const batchConvertCloseBtn = $('batch-convert-close-btn');

// 搜索视图多选栏
const searchSelectionBar = $('search-selection-bar');
const searchSelectedCount = $('search-selected-count');
const searchSelectAllBtn = $('search-select-all-btn');
const searchInvertBtn = $('search-invert-btn');
const searchClearSelBtn = $('search-clear-sel-btn');

// 歌单：在线 / 本地切换
const playlistTabs = document.querySelectorAll('.playlist-tab');

// 智能封面设置
const settingSmartCover = $('setting-smart-cover');

const settingDynamicTheme = $('setting-dynamic-theme');

// 睡眠定时器剩余时长
const sleepTimerRemaining = $('sleep-timer-remaining');
// 重命名 / 标签弹窗
const renameModal = $('rename-modal');
const renamePattern = $('rename-pattern');
const renamePreviewBody = $('rename-preview-body');
const renameCloseBtn = $('rename-close-btn');
const renameCancelBtn = $('rename-cancel-btn');
const renameApplyBtn = $('rename-apply-btn');
const tagsModal = $('tags-modal');
const tagsCountHint = $('tags-count-hint');
const tagsCloseBtn = $('tags-close-btn');
const tagsCancelBtn = $('tags-cancel-btn');
const tagsApplyBtn = $('tags-apply-btn');
const tagsClearRow = $('tags-clear-row');
const tagsInputs = {
  title: $('tags-title'), artist: $('tags-artist'), album: $('tags-album'),
  year: $('tags-year'), genre: $('tags-genre'), track: $('tags-track'), disc: $('tags-disc'),
};

// ---------- 全局状态 ----------
const state = {
  settings: null,
  options: null,
  results: [],
  selectedRows: new Set(),
  // 在线/本地歌单分离
  playlistType: 'online',   // 'online' | 'local'
  onlinePlaylist: [],
  localPlaylist: [],
  _onlineIndex: -1,
  _localIndex: -1,
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
  vocalCancel: null,
  vizRaf: null,
  coverToken: 0,
  codecToken: 0,
  searchProgressMap: {},
};

// state.playlist 动态指向当前激活的歌单数组；state.currentIndex 同理。
// 这样所有现有代码（player.js / eq-viz.js / mini 等）无需改动即可工作。
Object.defineProperty(state, 'playlist', {
  get() { return this.playlistType === 'local' ? this.localPlaylist : this.onlinePlaylist; },
  set(v) { if (this.playlistType === 'local') this.localPlaylist = v; else this.onlinePlaylist = v; },
  enumerable: true,
  configurable: true,
});
Object.defineProperty(state, 'currentIndex', {
  get() { return this.playlistType === 'local' ? this._localIndex : this._onlineIndex; },
  set(v) { if (this.playlistType === 'local') this._localIndex = v; else this._onlineIndex = v; },
  enumerable: true,
  configurable: true,
});

// ---------- 可视化调色板（由 applyTheme 更新） ----------
let vizPalette = [];

// ---------- 主题色候选 ----------
const THEME_ACCENTS = {
  sky: '#3a79f8',
  pink: '#E83E8C',
  yellow: '#F5A623',
  black: '#0F1419',
  white: '#F5F7FA',
};

// ---------- 通用工具 ----------
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

// ---------- 智能封面 URL（受设置开关控制） ----------
function smartCoverUrl(song) {
  if (!song) return '';
  if (!state.settings || !state.settings.smart_cover) return '';
  if (typeof generateSmartCover !== 'function') return '';
  try { return generateSmartCover(song); } catch (e) { return ''; }
}

function coverUrl(song) {
  const u = song && (song.cover_url || song.cover || '');
  if (u) {
    return `${API_BASE}/cover?url=${encodeURIComponent(u)}&source=${encodeURIComponent(song.source || '')}`;
  }
  return smartCoverUrl(song);
}

// ---------- 列表封面加载失败回退 ----------
function handleResultCoverError(imgEl) {
  if (!imgEl) return;
  if (imgEl.src && imgEl.src.startsWith('data:')) {
    imgEl.style.display = 'none';
    return;
  }
  if (imgEl.dataset.smartTried === '1') {
    imgEl.style.display = 'none';
    return;
  }
  imgEl.dataset.smartTried = '1';
  const itemEl = imgEl.closest('.song-item');
  const idx = itemEl ? parseInt(itemEl.dataset.idx, 10) : -1;
  const song = (idx >= 0 && state.results[idx]) ? state.results[idx] : null;
  const smart = song ? smartCoverUrl(song) : '';
  if (smart) {
    imgEl.src = smart;
  } else {
    imgEl.style.display = 'none';
  }
}
window.__resultCoverError = handleResultCoverError;

function displaySource(internal) {
  const map = (state.options && state.options.source_internal) || {};
  for (const [k, v] of Object.entries(map)) if (v === internal) return k;
  return internal || '';
}

// ---------- API 封装 ----------
async function postJSON(path, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

async function persistSetting(patch) {
  state.settings = Object.assign({}, state.settings, patch);
  try { await postJSON('/settings', patch); }
  catch (e) { console.error('保存设置失败:', e); }
}

// ---------- 简易警告弹窗（无依赖，样式内置） ----------
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

// ============================================================
// 通用跑马灯：给元素内文本加"超出则循环滚动"的效果
// ------------------------------------------------------------
// - applyMarquee(el)             ：包裹内部为 .marquee-inner，测量后按需滚动
// - refreshMarqueesIn(container) ：容器尺寸变化时对所有 .marquee 重测
// CSS 见 style.css 的 .marquee / .marquee-inner / @keyframes marqueeSlide
// ============================================================
const _marqueePending = new Set();
let _marqueeRaf = 0;
let _marqueeDelaySeed = 0;

function _ensureMarqueeInner(el) {
  let inner = el.querySelector(':scope > .marquee-inner');
  if (inner) return inner;
  inner = document.createElement('span');
  inner.className = 'marquee-inner';
  // 把已有子节点移入 inner（不丢失文本/元素）
  while (el.firstChild) inner.appendChild(el.firstChild);
  el.appendChild(inner);
  return inner;
}

function _measureMarquee(el) {
  const inner = el.querySelector(':scope > .marquee-inner');
  if (!inner) return;
  const overflow = inner.scrollWidth - el.clientWidth;
  if (overflow > 2) {
    el.style.setProperty('--marquee-shift', `-${overflow}px`);
    // 时长：基础 6s + 每像素 0.06s，上限 24s
    const dur = Math.min(24, 6 + overflow / 16);
    el.style.setProperty('--marquee-dur', dur.toFixed(2) + 's');
    // 错开各元素的动画起点，避免一屏同步滚动
    _marqueeDelaySeed = (_marqueeDelaySeed + 1.37) % 4;
    el.style.setProperty('--marquee-delay', _marqueeDelaySeed.toFixed(2) + 's');
    el.classList.add('scrolling');
  } else {
    el.classList.remove('scrolling');
    el.style.removeProperty('--marquee-shift');
    el.style.removeProperty('--marquee-dur');
    el.style.removeProperty('--marquee-delay');
  }
}

function _flushMarqueeMeasure() {
  _marqueeRaf = 0;
  const items = [..._marqueePending];
  _marqueePending.clear();
  // 一次读、一次写，避免逐项强制布局抖动
  items.forEach(_measureMarquee);
}

function _scheduleMarqueeMeasure() {
  if (_marqueeRaf) return;
  _marqueeRaf = requestAnimationFrame(_flushMarqueeMeasure);
}

function applyMarquee(el) {
  if (!el) return;
  el.classList.add('marquee');
  _ensureMarqueeInner(el);
  _marqueePending.add(el);
  _scheduleMarqueeMeasure();
}

function refreshMarqueesIn(container) {
  if (!container) return;
  container.querySelectorAll('.marquee').forEach(el => {
    _marqueePending.add(el);
  });
  if (_marqueePending.size) _scheduleMarqueeMeasure();
}