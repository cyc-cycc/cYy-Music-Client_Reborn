// ==================== 聆听本地：扫描、排序、筛选、多选、批量操作 ====================

const LIBRARY_ENCODINGS = [
  'UTF-8', 'GBK', 'GB2312', 'GB18030', 'Big5', 'Shift-JIS',
  'EUC-KR', 'Latin1', 'Windows-1252', 'UTF-16', 'UTF-16LE', 'UTF-16BE',
];

const libraryState = {
  songs: [],
  root: '',
  scanning: false,
  scanned: false,
  useCustom: false,
  customDir: '',
  saveDir: '',
  encoding: 'UTF-8',
  sortBy: 'filename',
  sortDir: 'asc',
  filterExt: '',
  filterCoverOnly: false,
  filterSinger: '',
  filterAlbum: '',
  selected: new Set(),
  _pathIndex: new Map(),   // path -> song，封面回退等高频查找用
};

function _rebuildPathIndex() {
  libraryState._pathIndex.clear();
  for (const s of libraryState.songs) {
    if (s.path) libraryState._pathIndex.set(s.path, s);
  }
}

let librarySelection = null;

// ---------- 初始化 UI ----------
(function initLibraryControls() {
  if (libraryEncodingSelect) {
    libraryEncodingSelect.innerHTML = '';
    LIBRARY_ENCODINGS.forEach(enc => {
      const opt = document.createElement('option');
      opt.value = enc;
      opt.textContent = enc;
      libraryEncodingSelect.appendChild(opt);
    });
    libraryEncodingSelect.value = libraryState.encoding;
  }
  if (librarySortSelect) librarySortSelect.value = libraryState.sortBy;
  if (librarySortDirBtn) librarySortDirBtn.textContent = libraryState.sortDir === 'asc' ? '↑' : '↓';
})();

async function loadLibraryInfo() {
  try {
    const info = await fetch(`${API_BASE}/library/info`).then(r => r.json());
    libraryState.useCustom = !!info.use_custom;
    libraryState.customDir = info.custom_dir || '';
    libraryState.saveDir = info.save_dir || '';
    if (info.encoding) {
      libraryState.encoding = info.encoding;
      if (libraryEncodingSelect) libraryEncodingSelect.value = info.encoding;
    }
    updateLibraryDirLabel();
  } catch (e) {}
}

function _basename(p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function updateLibraryDirLabel() {
  if (!libraryDirLabel) return;
  if (libraryState.useCustom && libraryState.customDir) {
    libraryDirLabel.textContent = `自定义：${_basename(libraryState.customDir)}`;
  } else {
    libraryDirLabel.textContent = '下载目录';
  }
}

// ---------- 扫描 ----------
async function scanLibrary(force = false) {
  if (libraryState.scanning) return;
  libraryState.scanning = true;
  libraryState.selected.clear();
  if (libraryContent) libraryContent.innerHTML = '<div class="empty-tip">扫描中...</div>';
  setStats('正在扫描本地音乐库...');
  try {
    const data = await postJSON('/library/scan', {
      force: !!force,
      encoding: libraryState.encoding,
    });
    libraryState.songs = data.songs || [];
    libraryState.root = data.root || '';
    libraryState.scanned = true;
    _rebuildPathIndex();
    refreshLibraryExtOptions();
    refreshLibraryFilterOptions();
    renderLibrary();
    updateSelectionBar();
    setStats(`本地库共 ${libraryState.songs.length} 首`);
  } catch (e) {
    if (libraryContent) libraryContent.innerHTML = `<div class="empty-tip">扫描失败: ${escapeHtml(e.message)}</div>`;
    setStats('本地库扫描失败');
  } finally {
    libraryState.scanning = false;
  }
}

function refreshLibraryExtOptions() {
  if (!libraryFilterExt) return;
  const exts = new Set(libraryState.songs.map(s => s.ext).filter(Boolean));
  const cur = libraryFilterExt.value;
  libraryFilterExt.innerHTML = '<option value="">全部格式</option>';
  [...exts].sort().forEach(ext => {
    const opt = document.createElement('option');
    opt.value = ext;
    opt.textContent = ext.toUpperCase();
    libraryFilterExt.appendChild(opt);
  });
  if (exts.has(cur)) libraryFilterExt.value = cur;
  else libraryFilterExt.value = '';
  libraryState.filterExt = libraryFilterExt.value;
}

function refreshLibraryFilterOptions() {
  if (libraryFilterSinger) {
    const singers = new Set();
    libraryState.songs.forEach(s => { if (s.singers) singers.add(s.singers); });
    const cur = libraryFilterSinger.value;
    libraryFilterSinger.innerHTML = '<option value="">全部</option>';
    [...singers].sort((a, b) => a.localeCompare(b, 'zh')).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      libraryFilterSinger.appendChild(opt);
    });
    if (singers.has(cur)) libraryFilterSinger.value = cur;
    else { libraryFilterSinger.value = ''; libraryState.filterSinger = ''; }
  }

  if (libraryFilterAlbum) {
    const albums = new Set();
    libraryState.songs.forEach(s => {
      if (libraryState.filterSinger && (s.singers || '') !== libraryState.filterSinger) return;
      if (s.album) albums.add(s.album);
    });
    const cur = libraryFilterAlbum.value;
    libraryFilterAlbum.innerHTML = '<option value="">全部</option>';
    [...albums].sort((a, b) => a.localeCompare(b, 'zh')).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      libraryFilterAlbum.appendChild(opt);
    });
    if (albums.has(cur)) libraryFilterAlbum.value = cur;
    else { libraryFilterAlbum.value = ''; libraryState.filterAlbum = ''; }
  }
}

// ---------- 排序 / 筛选 ----------
function getFilteredSortedSongs() {
  let list = libraryState.songs.slice();
  if (libraryState.filterExt) {
    list = list.filter(s => s.ext === libraryState.filterExt);
  }
  if (libraryState.filterCoverOnly) {
    list = list.filter(s => s.has_cover);
  }
  if (libraryState.filterSinger) {
    list = list.filter(s => (s.singers || '') === libraryState.filterSinger);
  }
  if (libraryState.filterAlbum) {
    list = list.filter(s => (s.album || '') === libraryState.filterAlbum);
  }
  const dir = libraryState.sortDir === 'asc' ? 1 : -1;
  const key = libraryState.sortBy;
  const pick = (s) => {
    switch (key) {
      case 'filename': return s.filename || '';
      case 'song_name': return s.song_name || '';
      case 'singers': return s.singers || '';
      case 'album': return s.album || '';
      case 'duration': return s.duration_s || 0;
      case 'size': return s.file_size_bytes || 0;
      case 'mtime': return s.mtime || 0;
      default: return s.filename || '';
    }
  };
  list.sort((a, b) => {
    const va = pick(a), vb = pick(b);
    if (typeof va === 'string') {
      return va.toLowerCase() < (vb || '').toLowerCase() ? -dir
           : va.toLowerCase() > (vb || '').toLowerCase() ? dir : 0;
    }
    return (va - vb) * dir;
  });
  return list;
}

// ---------- 渲染 ----------
function renderLibrary() {
  const visible = getFilteredSortedSongs();
  if (libraryCount) libraryCount.textContent = libraryState.songs.length;
  if (!libraryContent) return;
  if (!visible.length) {
    libraryContent.innerHTML = `<div class="empty-tip">${libraryState.songs.length ? '当前筛选无结果' : '目录为空或未找到音频文件'}</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  visible.forEach((song) => {
    const div = document.createElement('div');
    div.className = 'song-item library-item';
    if (libraryState.selected.has(song.path)) div.classList.add('selected');
    div.dataset.path = song.path;

    const coverSrc = song.has_cover
      ? `${API_BASE}/library/cover?path=${encodeURIComponent(song.path)}`
      : smartCoverUrl(song);
    const subParts = [];
    if (song.singers) subParts.push(song.singers);
    if (song.album) subParts.push(song.album);
    if (song.duration) subParts.push(song.duration);
    if (song.file_size) subParts.push(song.file_size);
    subParts.push((song.ext || '').toUpperCase());
    const lyricBadge = song.has_embedded_lyrics
      ? '<span class="badge-tag lyric-badge">内嵌词</span>'
      : (song.has_external_lyrics ? '<span class="badge-tag lyric-badge">外挂词</span>' : '');

    div.innerHTML = `
      <input type="checkbox" class="song-check no-select" ${libraryState.selected.has(song.path) ? 'checked' : ''} tabindex="-1" />
      <div class="cover">${coverSrc ? `<img src="${coverSrc}" draggable="false" ${coverSrc.startsWith('data:') ? '' : 'data-smart-tried="0"'} loading="lazy" onerror="window.__libraryCoverError(this, '${encodeURIComponent(song.path)}')">` : IC('music')}</div>
      <div class="info">
        <div class="name"><span class="song-title">${escapeHtml(song.song_name)}</span><span class="source-badge">本地</span>${lyricBadge}</div>
        <div class="sub">${subParts.map(escapeHtml).join(' · ')}</div>
      </div>
      <button class="btn-play-item no-select" title="播放">${IC('play')}</button>
    `;

    // 播放按钮
    div.querySelector('.btn-play-item').addEventListener('click', (e) => {
      e.stopPropagation();
      addLocalToPlaylist(song, true);
    });
    // 右键菜单
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showLibraryContextMenu(song, e.clientX, e.clientY);
    });
    frag.appendChild(div);
  });
  libraryContent.innerHTML = '';
  libraryContent.appendChild(frag);

  // 歌曲名 + 副标题：超出列表宽度时循环滚动
  if (typeof applyMarquee === 'function') {
    libraryContent.querySelectorAll('.library-item .song-title, .library-item .sub')
      .forEach(applyMarquee);
  }

  // 列表重建后刷新多选控制器缓存
  if (librarySelection) librarySelection.refresh();
  updateSelectionBar();
}

function updateSelectionBar() {
  const n = libraryState.selected.size;
  if (librarySelectedCount) librarySelectedCount.textContent = n;
  const keepMouseY = librarySelection ? librarySelection.getLastMouseY() : null;
  setSelectionBarVisible(libraryContent, librarySelectionBar, n > 0, librarySelectionBar, keepMouseY);
}

function clearLibrarySelection() {
  if (librarySelection) {
    librarySelection.clear();
  } else {
    libraryState.selected.clear();
    updateSelectionBar();
  }
}

// 本地库列表容器宽度变化时重测跑马灯
if (window.ResizeObserver && typeof refreshMarqueesIn === 'function' && libraryContent) {
  new ResizeObserver(() => refreshMarqueesIn(libraryContent)).observe(libraryContent);
}

// ---------- 右键菜单 ----------
function showLibraryContextMenu(song, x, y) {
  const inSel = libraryState.selected.has(song.path);
  const targets = inSel && libraryState.selected.size > 1
    ? libraryState.songs.filter(s => libraryState.selected.has(s.path))
    : [song];

  const items = [
    { label: '▶ 播放', fn: () => addLocalToPlaylist(song, true) },
    { label: '＋ 添加到播放列表', fn: () => addLocalToPlaylist(song, false) },
    { separator: true },
    { label: '在文件夹中显示', fn: () => {
        if (window.__cyy_shell && window.__cyy_shell.showItemInFolder) {
          window.__cyy_shell.showItemInFolder(song.path);
        } else if (win && win.webContents) {
          try { require('electron').shell.showItemInFolder(song.path); } catch (e) {}
        }
      } },
    { label: '用默认播放器打开', fn: () => {
        try { require('electron').shell.openPath(song.path); } catch (e) {}
      } },
    { label: '复制文件路径', fn: () => {
        try { require('electron').clipboard.writeText(song.path); setStats('已复制路径'); } catch (e) {}
      } },
  ];

  if (targets.length >= 1) {
    items.push({ separator: true });
    items.push({ label: `重命名（${targets.length} 项）`, fn: () => openRenameModal(targets) });
    items.push({ label: `编辑标签（${targets.length} 项）`, fn: () => openTagsModal(targets) });
    items.push({ label: `转换格式（${targets.length} 项）`, fn: () => openBatchConvertModal(targets) });
    items.push({ separator: true });
    items.push({ label: `移到回收站（${targets.length} 项）`, danger: true,
                 fn: () => trashLibraryFiles(targets) });
  }

  showContextMenu(items, x, y);
}

// ---------- 本地歌曲 → 播放列表（含歌词异步加载） ----------
async function addLocalToPlaylist(song, play) {
  if (!song) return;
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
  try {
    const params = new URLSearchParams({ path: song.path, encoding: libraryState.encoding });
    const resp = await fetch(`${API_BASE}/library/lyrics?${params}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.lyrics) s.lyric = data.lyrics;
    }
  } catch (e) { /* 忽略 */ }

  addToPlaylist(s, play);
}

// ---------- 目录选择 ----------
async function pickLibraryDir() {
  if (!dialog) return null;
  const result = await dialog.showOpenDialog({
    title: '选择音乐目录',
    properties: ['openDirectory'],
    defaultPath: libraryState.customDir || libraryState.saveDir || undefined,
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
}

// ---------- 批量重命名 ----------
let _renameTargets = [];

function openRenameModal(targets) {
  _renameTargets = targets;
  if (!renameModal) return;
  renamePattern.value = '{歌手}-{歌曲名}';
  renderRenamePreview();
  openModal('rename-modal');
}

function buildNewName(song, pattern) {
  const base = (pattern || '')
    .replace(/\{歌手\}/g, song.singers || '未知歌手')
    .replace(/\{歌曲名\}/g, song.song_name || '未知歌曲')
    .replace(/\{专辑\}/g, song.album || '')
    .replace(/\{年份\}/g, song.year || '')
    .replace(/\{音轨\}/g, song.track || '')
    .replace(/\{原名\}/g, (song.filename || '').replace(/\.[^.]+$/, ''))
    .trim();
  return base || (song.filename || '');
}

function renderRenamePreview() {
  if (!renamePreviewBody) return;
  renamePreviewBody.innerHTML = '';
  const pattern = renamePattern.value || '';
  const nameCount = new Map();
  _renameTargets.forEach(song => {
    const newBase = buildNewName(song, pattern);
    const ext = '.' + (song.ext || 'mp3');
    const newFull = newBase.toLowerCase().endsWith(ext) ? newBase : newBase + ext;
    const key = newFull.toLowerCase();
    nameCount.set(key, (nameCount.get(key) || 0) + 1);
  });

  _renameTargets.forEach(song => {
    const newBase = buildNewName(song, pattern);
    const ext = '.' + (song.ext || 'mp3');
    const newFull = newBase.toLowerCase().endsWith(ext) ? newBase : newBase + ext;
    const original = song.filename || '';
    const isSame = newFull === original;
    const hasConflict = nameCount.get(newFull.toLowerCase()) > 1;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td title="${escapeHtml(original)}">${escapeHtml(original)}</td>
      <td class="${hasConflict ? 'conflict' : (isSame ? 'same' : 'ok')}">${escapeHtml(newFull)}</td>
    `;
    renamePreviewBody.appendChild(tr);
  });
}

async function applyRename() {
  if (!_renameTargets.length) return;
  const items = _renameTargets.map(song => ({
    path: song.path,
    new_name: buildNewName(song, renamePattern.value),
  }));
  renameApplyBtn.disabled = true;
  try {
    const res = await postJSON('/library/rename', { items });
    const ok = res.ok || 0;
    const failed = res.failed || [];
    if (failed.length) {
      setStats(`重命名完成: 成功 ${ok}，失败 ${failed.length}（详见控制台）`);
      console.warn('重命名失败明细:', failed);
      showWarn('部分重命名失败', failed.map(f => `${f.path ? _basename(f.path) : '?'}: ${f.error}`).join('\n'));
    } else {
      setStats(`重命名完成: ${ok} 项`);
    }
    closeModal('rename-modal');
    await scanLibrary(true);
  } catch (e) {
    setStats(`重命名失败: ${e.message}`);
  } finally {
    renameApplyBtn.disabled = false;
  }
}

// ---------- 批量编辑标签 ----------
let _tagsTargets = [];

function openTagsModal(targets) {
  _tagsTargets = targets;
  if (!tagsModal) return;
  if (tagsCountHint) tagsCountHint.textContent = `（${targets.length} 项）`;
  Object.values(tagsInputs).forEach(inp => { if (inp) inp.value = ''; });

  if (tagsClearRow) {
    tagsClearRow.innerHTML = '';
    const fields = [
      ['title', '标题'], ['artist', '艺术家'], ['album', '专辑'],
      ['year', '年份'], ['genre', '流派'], ['track', '音轨号'], ['disc', '碟片号'],
    ];
    fields.forEach(([key, label]) => {
      const cb = document.createElement('label');
      cb.className = 'inline-checkbox';
      cb.innerHTML = `<input type="checkbox" data-clear-key="${key}" /> 清空${label}`;
      tagsClearRow.appendChild(cb);
    });
  }
  openModal('tags-modal');
}

async function applyTags() {
  if (!_tagsTargets.length) return;
  const patch = {};
  Object.entries(tagsInputs).forEach(([key, inp]) => {
    if (inp && inp.value.trim() !== '') {
      patch[key] = inp.value.trim();
    }
  });
  if (tagsClearRow) {
    tagsClearRow.querySelectorAll('input[data-clear-key]').forEach(cb => {
      if (cb.checked) patch[cb.dataset.clearKey] = '';
    });
  }
  if (!Object.keys(patch).length) {
    setStats('未填写任何字段');
    return;
  }
  tagsApplyBtn.disabled = true;
  try {
    const paths = _tagsTargets.map(s => s.path);
    const res = await postJSON('/library/tags', {
      paths,
      patch,
      encoding: libraryState.encoding,
    });
    const ok = res.ok || 0;
    const failed = res.failed || [];
    if (failed.length) {
      setStats(`标签写入: 成功 ${ok}，失败 ${failed.length}`);
      console.warn('标签写入失败明细:', failed);
      showWarn('部分写入失败', failed.map(f => `${f.path ? _basename(f.path) : '?'}: ${f.error}`).join('\n'));
    } else {
      setStats(`标签写入完成: ${ok} 项`);
    }
    closeModal('tags-modal');
    await scanLibrary(true);
  } catch (e) {
    setStats(`标签写入失败: ${e.message}`);
  } finally {
    tagsApplyBtn.disabled = false;
  }
}

// ==================== 回收站删除 ====================
async function trashLibraryFiles(targets) {
  if (!targets.length) return;

  const ok = await new Promise(resolve => {
    showConfirm(
      '移到回收站',
      `确定将 ${targets.length} 个文件移到回收站吗？可从回收站恢复。`,
      () => resolve(true),
      () => resolve(false),
    );
  });
  if (!ok) return;

  const results = { ok: 0, failed: [] };
  const shell = (() => { try { return require('electron').shell; } catch (e) { return null; } })();
  const fsLocal = (() => { try { return require('fs'); } catch (e) { return null; } })();

  // 首次尝试优先走回收站；若 trashItem 不可用则直接永久删除
  let usePermanentDelete = !(shell && typeof shell.trashItem === 'function');
  let askedFallback = false;

  for (const song of targets) {
    try {
      if (usePermanentDelete) {
        if (!fsLocal) throw new Error('文件系统模块不可用');
        fsLocal.unlinkSync(song.path);
      } else {
        await shell.trashItem(song.path);
      }
      results.ok += 1;
    } catch (e) {
      const msg = String(e);
      // 回收站首次失败 → 询问用户是否切换为永久删除
      if (!usePermanentDelete && !askedFallback) {
        askedFallback = true;
        const fallbackOk = await new Promise(resolve => {
          showConfirm(
            '回收站不可用',
            '系统回收站当前不可用，后续文件将被永久删除（不可恢复）。\n\n确定继续吗？',
            () => resolve(true),
            () => resolve(false),
          );
        });
        if (fallbackOk) {
          usePermanentDelete = true;
          try {
            if (!fsLocal) throw new Error('文件系统模块不可用');
            fsLocal.unlinkSync(song.path);
            results.ok += 1;
            continue;
          } catch (e2) {
            results.failed.push({ path: song.path, error: String(e2) });
            continue;
          }
        }
      }
      results.failed.push({ path: song.path, error: msg });
    }
  }

  if (results.failed.length) {
    showWarn('部分删除失败', results.failed.map(f => f.path + ': ' + f.error).join('\n'));
  }
  setStats(usePermanentDelete
    ? `已永久删除: ${results.ok} 项`
    : `已移到回收站: ${results.ok} 项`);
  clearLibrarySelection();
  await scanLibrary(true);
}

function showConfirm(title, text, onOk, onCancel) {
  const mask = document.createElement('div');
  mask.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:20000;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--color-bg);border:1px solid var(--color-border);border-radius:12px;padding:20px 24px;max-width:380px;';
  box.innerHTML = `
    <div style="font-weight:bold;margin-bottom:8px;">${escapeHtml(title)}</div>
    <div style="white-space:pre-line;font-size:13px;color:var(--color-text-secondary);margin-bottom:14px;">${escapeHtml(text)}</div>
    <div style="text-align:right;">
      <button class="btn-ghost" style="margin-right:6px;">取消</button>
      <button class="btn-danger">确定</button>
    </div>`;
  mask.appendChild(box);
  document.body.appendChild(mask);
  const [cancelBtn, okBtn] = box.querySelectorAll('button');
  const cleanup = () => mask.remove();
  cancelBtn.addEventListener('click', () => { cleanup(); onCancel && onCancel(); });
  okBtn.addEventListener('click', () => { cleanup(); onOk && onOk(); });
  mask.addEventListener('click', (e) => { if (e.target === mask) { cleanup(); onCancel && onCancel(); } });
}

// ---------- 事件绑定 ----------
if (libraryRescanBtn) libraryRescanBtn.addEventListener('click', () => scanLibrary(true));

if (libraryEncodingSelect) {
  libraryEncodingSelect.addEventListener('change', async () => {
    libraryState.encoding = libraryEncodingSelect.value;
    await persistSetting({ library_encoding: libraryState.encoding });
    scanLibrary(true);
  });
}

if (librarySortSelect) {
  librarySortSelect.addEventListener('change', () => {
    libraryState.sortBy = librarySortSelect.value;
    renderLibrary();
  });
}
if (librarySortDirBtn) {
  librarySortDirBtn.addEventListener('click', () => {
    libraryState.sortDir = libraryState.sortDir === 'asc' ? 'desc' : 'asc';
    librarySortDirBtn.textContent = libraryState.sortDir === 'asc' ? '↑' : '↓';
    renderLibrary();
  });
}
if (libraryFilterExt) {
  libraryFilterExt.addEventListener('change', () => {
    libraryState.filterExt = libraryFilterExt.value;
    renderLibrary();
  });
}
if (libraryCoverOnly) {
  libraryCoverOnly.addEventListener('change', () => {
    libraryState.filterCoverOnly = libraryCoverOnly.checked;
    renderLibrary();
  });
}

if (libraryToggleBtn) {
  libraryToggleBtn.addEventListener('click', async () => {
    if (!libraryState.useCustom) {
      if (!libraryState.customDir) {
        const picked = await pickLibraryDir();
        if (!picked) return;
        await persistSetting({ library_dir: picked, library_use_custom: true });
        libraryState.customDir = picked;
      } else {
        await persistSetting({ library_use_custom: true });
      }
      libraryState.useCustom = true;
    } else {
      await persistSetting({ library_use_custom: false });
      libraryState.useCustom = false;
    }
    updateLibraryDirLabel();
    scanLibrary(true);
  });
}

if (libraryCustomBtn) {
  libraryCustomBtn.addEventListener('click', async () => {
    const picked = await pickLibraryDir();
    if (!picked) return;
    await persistSetting({ library_dir: picked, library_use_custom: true });
    libraryState.customDir = picked;
    libraryState.useCustom = true;
    updateLibraryDirLabel();
    scanLibrary(true);
  });
}

// ---------- 初始化本地库多选控制器（一次性） ----------
(function initLibrarySelection() {
  if (!libraryContent) return;
  librarySelection = createListSelection({
    container: libraryContent,
    itemSelector: '.library-item',
    getKey: (el) => el.dataset.path || null,
    selectedSet: libraryState.selected,
    onPlay: (key) => {
      const song = libraryState.songs.find(s => s.path === key);
      if (song) addLocalToPlaylist(song, true);
    },
    onSelectionChanged: updateSelectionBar,
  });
})();

// 多选工具栏
if (librarySelectAllBtn) {
  librarySelectAllBtn.addEventListener('click', () => {
    if (librarySelection) librarySelection.selectAll();
  });
}
if (libraryInvertBtn) {
  libraryInvertBtn.addEventListener('click', () => {
    if (librarySelection) librarySelection.invert();
  });
}
if (libraryRenameBtn) libraryRenameBtn.addEventListener('click', () => {
  const targets = libraryState.songs.filter(s => libraryState.selected.has(s.path));
  if (!targets.length) return;
  openRenameModal(targets);
});
if (libraryTagsBtn) libraryTagsBtn.addEventListener('click', () => {
  const targets = libraryState.songs.filter(s => libraryState.selected.has(s.path));
  if (!targets.length) return;
  openTagsModal(targets);
});
if (libraryConvertBtn) libraryConvertBtn.addEventListener('click', () => {
  const targets = libraryState.songs.filter(s => libraryState.selected.has(s.path));
  if (!targets.length) return;
  openBatchConvertModal(targets);
});
if (libraryTrashBtn) libraryTrashBtn.addEventListener('click', () => {
  const targets = libraryState.songs.filter(s => libraryState.selected.has(s.path));
  if (!targets.length) return;
  trashLibraryFiles(targets);
});
if (libraryClearSelBtn) libraryClearSelBtn.addEventListener('click', clearLibrarySelection);

// 重命名弹窗事件
if (renamePattern) renamePattern.addEventListener('input', renderRenamePreview);
if (renameApplyBtn) renameApplyBtn.addEventListener('click', applyRename);
if (renameCloseBtn) renameCloseBtn.addEventListener('click', () => closeModal('rename-modal'));
if (renameCancelBtn) renameCancelBtn.addEventListener('click', () => closeModal('rename-modal'));
if (renameModal) renameModal.addEventListener('click', (e) => { if (e.target === renameModal) closeModal('rename-modal'); });

// 标签弹窗事件
if (tagsApplyBtn) tagsApplyBtn.addEventListener('click', applyTags);
if (tagsCloseBtn) tagsCloseBtn.addEventListener('click', () => closeModal('tags-modal'));
if (tagsCancelBtn) tagsCancelBtn.addEventListener('click', () => closeModal('tags-modal'));
if (tagsModal) tagsModal.addEventListener('click', (e) => { if (e.target === tagsModal) closeModal('tags-modal'); });

// 首次进入"聆听本地"时扫描
(function bindLibraryLazyScan() {
  const nav = document.querySelector('.nav-item[data-view="library"]');
  if (!nav) return;
  nav.addEventListener('click', () => {
    if (libraryState.scanned || libraryState.scanning) return;
    loadLibraryInfo().then(() => scanLibrary(false));
  });
})();

// ---------- 本地库封面加载失败回退 ----------
function handleLibraryCoverError(imgEl, encodedPath) {
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
  const path = decodeURIComponent(encodedPath || '');
  const song = libraryState._pathIndex.get(path);
  const smart = song ? smartCoverUrl(song) : '';
  if (smart) {
    imgEl.src = smart;
  } else {
    imgEl.style.display = 'none';
  }
}
window.__libraryCoverError = handleLibraryCoverError;

// ==================== 批量格式转换 ====================
let _batchConvertTargets = [];

function openBatchConvertModal(targets) {
  _batchConvertTargets = targets;
  if (!batchConvertModal) return;
  if (batchConvertSummary) batchConvertSummary.textContent = `（${targets.length} 项）`;
  const keepRadio = document.querySelector('input[name="batch-convert-mode"][value="keep"]');
  if (keepRadio) keepRadio.checked = true;
  updateBatchConvertBitrateOptions();
  openModal('batch-convert-modal');
}

function updateBatchConvertBitrateOptions() {
  if (!batchConvertBitrate || !batchConvertFormat) return;
  const fmt = batchConvertFormat.value;
  batchConvertBitrate.innerHTML = '';
  if (fmt === 'flac') {
    batchConvertBitrate.disabled = true;
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = '无损（无需比特率）';
    batchConvertBitrate.appendChild(opt);
    return;
  }
  batchConvertBitrate.disabled = false;
  const options = fmt === 'aac' ? ['128k', '192k', '256k'] : ['128k', '192k', '256k', '320k'];
  options.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    batchConvertBitrate.appendChild(opt);
  });
  batchConvertBitrate.value = options[options.length - 1];
}

async function applyBatchConvert() {
  if (!_batchConvertTargets.length) return;
  const targetFormat = batchConvertFormat.value;
  const bitrate = targetFormat === 'flac' ? '' : batchConvertBitrate.value;
  const modeEl = document.querySelector('input[name="batch-convert-mode"]:checked');
  const mode = modeEl ? modeEl.value : 'keep';
  const keepOriginal = mode === 'keep';

  batchConvertApplyBtn.disabled = true;
  const originalText = batchConvertApplyBtn.textContent;
  batchConvertApplyBtn.textContent = '转换中…';
  setStats(`正在转换 ${_batchConvertTargets.length} 首，请稍候…`);

  try {
    const paths = _batchConvertTargets.map(s => s.path);
    const res = await postJSON('/library/convert', {
      paths,
      target_format: targetFormat,
      bitrate,
      keep_original: keepOriginal,
      replace_on_success: !keepOriginal,
    });
    const ok = res.ok || 0;
    const failed = res.failed || [];
    if (failed.length) {
      setStats(`转换完成: 成功 ${ok}，失败 ${failed.length}`);
      console.warn('转换失败明细:', failed);
      showWarn('部分转换失败',
        failed.map(f => `${f.path ? _basename(f.path) : '?'}: ${f.error}`).join('\n'));
    } else {
      setStats(`转换完成: ${ok} 项`);
    }
    closeModal('batch-convert-modal');
    await scanLibrary(true);
  } catch (e) {
    setStats(`转换失败: ${e.message}`);
  } finally {
    batchConvertApplyBtn.disabled = false;
    batchConvertApplyBtn.textContent = originalText;
  }
}

if (batchConvertFormat) batchConvertFormat.addEventListener('change', updateBatchConvertBitrateOptions);
if (batchConvertApplyBtn) batchConvertApplyBtn.addEventListener('click', applyBatchConvert);
if (batchConvertCloseBtn) batchConvertCloseBtn.addEventListener('click', () => closeModal('batch-convert-modal'));
if (batchConvertCancelBtn) batchConvertCancelBtn.addEventListener('click', () => closeModal('batch-convert-modal'));
if (batchConvertModal) batchConvertModal.addEventListener('click', (e) => {
  if (e.target === batchConvertModal) closeModal('batch-convert-modal');
});

// ==================== 筛选事件 ====================
if (libraryFilterSinger) {
  libraryFilterSinger.addEventListener('change', () => {
    libraryState.filterSinger = libraryFilterSinger.value;
    refreshLibraryFilterOptions();
    renderLibrary();
  });
}
if (libraryFilterAlbum) {
  libraryFilterAlbum.addEventListener('change', () => {
    libraryState.filterAlbum = libraryFilterAlbum.value;
    renderLibrary();
  });
}