// ==================== 弹窗、窗口控制、导航 ====================

// ---------- 弹窗开关 ----------
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

// ---------- 窗口控制 ----------
let winMaximized = false;
let winNormalBounds = null;

function isActuallyMaximized() {
  if (!win) return false;
  try {
    const { screen } = require('@electron/remote');
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const wa = display.workArea;
    return bounds.x === wa.x && bounds.y === wa.y
        && bounds.width === wa.width && bounds.height === wa.height;
  } catch (e) { return false; }
}
function toggleWindowMaximize() {
  if (!win) return;
  if (winMaximized || isActuallyMaximized()) {
    if (winNormalBounds) win.setBounds(winNormalBounds);
    winMaximized = false;
  } else {
    const bounds = win.getBounds();
    winNormalBounds = bounds;
    const { screen } = require('@electron/remote');
    const display = screen.getDisplayMatching(bounds);
    win.setBounds(display.workArea);
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
  $('btn-close').addEventListener('click', () => {
    document.body.classList.add('closing');
    setTimeout(() => { win.close(); }, 400);
  });
} else {
  document.querySelectorAll('.win-btn').forEach(b => b.style.display = 'none');
}

// ---------- 导航 ----------
function navigateTo(viewName) {
  const target = document.getElementById(`view-${viewName}`);
  if (!target) return;
  // 已是当前视图：直接返回，避免"移除 active 再添加"触发 .view 入场动画重播，
  // 那会让 header 短暂带着 translateY 偏移，进而干扰面板位置计算。
  if (target.classList.contains('active')) return;

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  target.classList.add('active');
  navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });
  // 切换视图后 view-header 高度变了，重新计算歌词面板的 top
  if (typeof syncLyricPanelTop === 'function') {
    requestAnimationFrame(syncLyricPanelTop);
  }
}
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.view);
  });
});

// ---------- 设置 / 关于弹窗入口 ----------
$('nav-settings').addEventListener('click', () => openModal('settings-modal'));
$('nav-about').addEventListener('click', () => openModal('about-modal'));
settingsCloseBtn.addEventListener('click', () => closeModal('settings-modal'));
settingsCancelBtn.addEventListener('click', () => closeModal('settings-modal'));
settingsModal.addEventListener('click', (e) => { if (e.target.id === 'settings-modal') closeModal('settings-modal'); });
aboutCloseBtn.addEventListener('click', () => closeModal('about-modal'));
aboutModal.addEventListener('click', (e) => { if (e.target.id === 'about-modal') closeModal('about-modal'); });

// ---------- 设置弹窗 Tab 切换 ----------
settingsTabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    settingsTabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(btn.dataset.tab);
    if (target) target.classList.add('active');
  });
});

// ============================================================
// 全局歌词面板：折叠 / 展开 + 定位
// ------------------------------------------------------------
// - 面板绝对定位在 #main-content 右侧，top 跟随 active view 的
//   滚动容器（view-body / playlist-full / library-full / download-full）顶部
// - view-header 不受面板影响，占满整宽
// - 折叠态通过 #main-content.lyric-collapsed 切换：
//   * 面板宽度归 0
//   * 滚动容器的 padding-right 归 0
//   * 按钮图标旋转 180°
// - 状态存 localStorage，跨启动保留
// ============================================================
(function initLyricPanel() {
  const panel = document.getElementById('lyric-panel');
  const mainContent = document.getElementById('main-content');
  const btn = document.getElementById('lyric-toggle-btn');
  if (!panel || !mainContent || !btn) return;

  const STORAGE_KEY = 'cmc_lyric_collapsed';
  const NEAR_DIST = 28;          // 鼠标进入按钮外 28px 内即视为"靠近"，显示按钮

  // ---------- 宽度持久化 / 拖动 ----------
  const WIDTH_KEY = 'cmc_lyric_width';
  const MIN_W = 220;
  const MAX_W = 600;
  const DEFAULT_W = 300;

  function _setPanelWidth(px) {
    const w = Math.max(MIN_W, Math.min(MAX_W, Math.round(px)));
    document.documentElement.style.setProperty('--lyric-panel-width', w + 'px');
    return w;
  }

  // 初始化：从 localStorage 恢复宽度
  let _restoredWidth = DEFAULT_W;
  try {
    const v = parseInt(localStorage.getItem(WIDTH_KEY), 10);
    if (Number.isFinite(v)) _restoredWidth = v;
  } catch (e) { /* 隐私模式等，忽略 */ }
  _setPanelWidth(_restoredWidth);

  // 绑定拖拽（用 Pointer Events，跨鼠标/触控板/触摸统一）
  const handle = document.getElementById('lyric-resize-handle');
  if (handle) {
    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // 折叠态不可拖动
      if (panel.classList.contains('collapsed')) return;

      dragging = true;
      startX = e.clientX;
      // 直接读实际像素宽度，避免 CSS 变量与计算值不一致
      startWidth = panel.getBoundingClientRect().width;

      document.body.classList.add('lyric-resizing');
      handle.classList.add('dragging');
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      // 手柄在面板左侧：鼠标向左移动 → 面板变宽
      const delta = startX - e.clientX;
      _setPanelWidth(startWidth + delta);
    });

    function _endDrag(e) {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('lyric-resizing');
      handle.classList.remove('dragging');
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
      // 最终宽度落盘
      const finalW = Math.round(panel.getBoundingClientRect().width);
      try { localStorage.setItem(WIDTH_KEY, String(finalW)); } catch (err) {}
    }

    handle.addEventListener('pointerup', _endDrag);
    handle.addEventListener('pointercancel', _endDrag);

    // 双击恢复默认宽度
    handle.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const w = _setPanelWidth(DEFAULT_W);
      try { localStorage.setItem(WIDTH_KEY, String(w)); } catch (err) {}
    });
  }

  // 面板与按钮的垂直位置：固定在 active view 的 view-header 下方。
  // 不跟随 view-body：多选栏 / 进度条显隐只会让 view-body 下移，
  // 面板保持不动，自己一列从 header 下沿铺到 main-content 底部。
  // 面板 top 相对 #main-content 的 padding box 顶部，目标是对齐 view-header 底边下方。
  // 计算方式：padding-top + header.offsetHeight + GAP
  //   - padding-top 从 getComputedStyle 读（不硬编码，CSS 改了自动跟随）
  //   - offsetHeight 是布局值，不受 .view 入场动画的 transform 影响
  //   - GAP 是面板顶边与 header 底边之间的留白，与 view-header 的 margin-bottom 对齐
  //   - 不使用 header.offsetTop：不同浏览器对 offsetParent 有 padding 时
  //     参照 padding edge 还是 content edge 存在差异，会少算约 20px
  //   - 不使用 getBoundingClientRect：会读到入场动画 translateY 的中间态
  const _mainPaddingTop = parseFloat(getComputedStyle(mainContent).paddingTop) || 0;
  const PANEL_TOP_GAP = 20;   // 与 .view-header 的 margin-bottom 保持一致

  window.syncLyricPanelTop = function () {
    const activeView = document.querySelector('.view.active');
    if (!activeView) return;
    const header = activeView.querySelector('.view-header');
    if (!header) return;
    const offset = Math.max(0, _mainPaddingTop + header.offsetHeight + PANEL_TOP_GAP);
    panel.style.top = offset + 'px';
    btn.style.top = (offset + 8) + 'px';
  };

  function applyState(collapsed) {
    panel.classList.toggle('collapsed', collapsed);
    mainContent.classList.toggle('lyric-collapsed', collapsed);
    const title = collapsed ? '展开歌词' : '收起歌词';
    btn.title = title;
    btn.setAttribute('aria-label', title);
  }

  // 初始化：从 localStorage 恢复
  let initialCollapsed = false;
  try {
    initialCollapsed = localStorage.getItem(STORAGE_KEY) === '1';
  } catch (e) { /* 隐私模式等，忽略 */ }
  applyState(initialCollapsed);

  // 点击切换
  btn.addEventListener('click', () => {
    const next = !panel.classList.contains('collapsed');
    applyState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch (e) { /* 忽略 */ }
  });

  // ---------- 鼠标距离 → 显示 / 悬停分离 ----------
  // 用 rAF 节流：每帧最多算一次，避免 mousemove 高频触发强制布局
  let _rafPending = false;
  let _lastX = 0, _lastY = 0;
  let _nearApplied = null;
  let _onApplied = null;

  function _updateButtonState() {
    const rect = btn.getBoundingClientRect();
    const x = _lastX, y = _lastY;

    // 判断鼠标是否落在按钮矩形内
    const inBtn = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

    // 到按钮矩形的最近距离
    const cx = Math.max(rect.left, Math.min(x, rect.right));
    const cy = Math.max(rect.top, Math.min(y, rect.bottom));
    const dx = x - cx, dy = y - cy;
    const near = inBtn || (dx * dx + dy * dy) <= NEAR_DIST * NEAR_DIST;

    if (near !== _nearApplied) {
      mainContent.classList.toggle('lyric-near', near);
      _nearApplied = near;
    }
    if (inBtn !== _onApplied) {
      btn.classList.toggle('lyric-on', inBtn);
      _onApplied = inBtn;
    }
  }

  function _scheduleUpdate() {
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(() => {
      _rafPending = false;
      _updateButtonState();
    });
  }

  document.addEventListener('mousemove', (e) => {
    _lastX = e.clientX;
    _lastY = e.clientY;
    _scheduleUpdate();
  }, { passive: true });

  // 鼠标离开窗口：立即恢复隐藏
  document.addEventListener('mouseleave', () => {
    if (_nearApplied !== false) {
      mainContent.classList.remove('lyric-near');
      _nearApplied = false;
    }
    if (_onApplied !== false) {
      btn.classList.remove('lyric-on');
      _onApplied = false;
    }
  });

  // ---------- 自动跟踪 view-header 高度变化 ----------
  // 面板 top 只跟 view-header 底部有关，所以只需观察 header。
  // 触发场景：
  //   - "聆听本地"工具栏选项异步填充 → 换行 → header 变高
  //   - 搜索视图解析区换行
  //   - 窗口缩放 / 字体加载 等
  if (window.ResizeObserver) {
    const _ro = new ResizeObserver(() => {
      requestAnimationFrame(syncLyricPanelTop);
    });
    document.querySelectorAll('.view-header').forEach(h => _ro.observe(h));
  }

  // 窗口尺寸变化时重算
  window.addEventListener('resize', () => {
    requestAnimationFrame(syncLyricPanelTop);
  });

  // 首次计算
  requestAnimationFrame(syncLyricPanelTop);
})();

// ============================================================
// 后端故障横幅 + 生命周期 IPC
// ============================================================
function showBackendError(msg) {
  if (!backendErrorBanner) return;
  if (backendErrorMsg) backendErrorMsg.textContent = msg || '后端连接异常';
  backendErrorBanner.style.display = 'flex';
}
function hideBackendError() {
  if (!backendErrorBanner) return;
  backendErrorBanner.style.display = 'none';
}

if (backendRetryBtn) {
  backendRetryBtn.addEventListener('click', async () => {
    if (!ipcRenderer) return;
    backendRetryBtn.disabled = true;
    backendRetryBtn.textContent = '重试中...';
    try {
      const result = await ipcRenderer.invoke('retry-backend');
      if (result && result.ok) {
        setStats('已请求重启后端...');
      } else {
        setStats(`重试失败: ${result && result.error ? result.error : '未知'}`);
      }
    } catch (e) {
      setStats(`重试失败: ${e.message}`);
    } finally {
      backendRetryBtn.disabled = false;
      backendRetryBtn.textContent = '重试';
    }
  });
}
if (backendErrorClose) {
  backendErrorClose.addEventListener('click', hideBackendError);
}

if (ipcRenderer) {
  ipcRenderer.on('backend-failed', (_evt, data) => {
    const msg = (data && data.message) ? data.message : '后端启动失败';
    document.body.classList.add('loaded');
    showBackendError(msg);
    setStats('后端异常，请点击横幅"重试"');
  });
  ipcRenderer.on('backend-restored', () => {
    hideBackendError();
    setStats('后端已恢复');
  });

  (async () => {
    try {
      const status = await ipcRenderer.invoke('get-backend-status');
      if (status && !status.running && status.lastError) {
        showBackendError(status.lastError);
      }
    } catch (e) {}
  })();
}

// ============================================================
// 通用右键菜单（供本地库使用）
// items: [{label, fn, danger?, disabled?, separator?}]
// ============================================================
let _activeContextMenu = null;
let _activeContextMenuClose = null;

function _removeActiveContextMenu() {
  if (_activeContextMenu) {
    try { _activeContextMenu.remove(); } catch (e) {}
    _activeContextMenu = null;
  }
  if (_activeContextMenuClose) {
    document.removeEventListener('click', _activeContextMenuClose);
    _activeContextMenuClose = null;
  }
}

function showContextMenu(items, x, y) {
  _removeActiveContextMenu();

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  items.forEach(it => {
    if (it && it.separator) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      menu.appendChild(sep);
      return;
    }
    const b = document.createElement('button');
    b.className = 'ctx-item' + (it.danger ? ' danger' : '');
    b.textContent = it.label;
    if (it.disabled) b.disabled = true;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const fn = it.fn;
      _removeActiveContextMenu();
      if (!it.disabled && fn) fn();
    });
    menu.appendChild(b);
  });
  document.body.appendChild(menu);
  _activeContextMenu = menu;

  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = Math.max(4, left) + 'px';
  menu.style.top = Math.max(4, top) + 'px';

  const close = () => { _removeActiveContextMenu(); };
  _activeContextMenuClose = close;
  setTimeout(() => document.addEventListener('click', close), 0);
}

// ---------- 迷你播放器按钮 ----------
const btnMini = document.getElementById('btn-mini');
if (btnMini && ipcRenderer) {
  btnMini.addEventListener('click', () => {
    ipcRenderer.send('open-mini-player');
  });
}

// ---------- 歌词窗口 / 桌面歌词按钮（可选） ----------
const btnLyrics = document.getElementById('btn-lyrics');
if (btnLyrics && ipcRenderer) {
  btnLyrics.addEventListener('click', () => ipcRenderer.send('open-lyrics-window'));
}