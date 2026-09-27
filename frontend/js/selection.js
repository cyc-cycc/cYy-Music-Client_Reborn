// ==================== 通用列表多选控制器 ====================
// 交互：
//   - 单击行            选中该项（清空其他）
//   - 单击已选中项      延迟 250ms 取消选中；期间双击则视为播放
//   - Ctrl/Cmd + 单击   切换该项选中
//   - Shift + 单击      从锚点扩展到当前行
//   - 按住拖动          从起点到当前行范围多选（实时）+ 边缘自动滚动
//   - 双击              播放
//   - 控制栏            全选 / 反选 / 取消选择
//
// 性能：
//   - applyVisual 用 rAF 节流（每帧最多一次）
//   - 每个元素用 dataset.selState 缓存上次选中状态，未变化则跳过 DOM 操作
//   - keys 数组 + key→index 哈希表缓存，拖动时 O(1) 索引
// ============================================================

function createListSelection(cfg) {
  const {
    container,
    scrollEl,
    itemSelector,
    getKey,
    selectedSet,
    onPlay,
    onSelectionChanged,
    clickDeselectDelay = 250,
    dragThreshold = 3,
    autoScrollEdge = 40,
    autoScrollSpeed = 14,
  } = cfg;

  if (!container || !itemSelector || typeof getKey !== 'function' || !selectedSet) {
    console.warn('[createListSelection] 参数缺失，返回空控制器');
    return {
      selectedSet: selectedSet || new Set(),
      refresh() {}, refreshAndNotify() {}, clear() {}, selectAll() {},
      invert() {}, count() { return 0; }, getLastMouseY() { return null; },
      destroy() {},
    };
  }

  const scrollTarget = scrollEl || container;

  // ---- 内部状态 ----
  let anchorKey = null;
  let dragging = false;
  let dragStartKey = null;
  let dragStartX = 0, dragStartY = 0;
  let didMove = false;
  let lastMouseX = 0, lastMouseY = 0;
  // 记录最近一次「用户主动点击」的视口 Y，用于选择栏出现时的可见性修正；
  // 非鼠标触发的操作（全选/反选/取消）会将其重置为 null，避免误用。
  let lastInteractiveY = null;

  let pendingDeselectKey = null;
  let pendingDeselectTimer = null;

  let autoScrollDir = 0;
  let autoScrollTimer = null;

  let visualRafPending = false;

  let _keysArray = null;
  let _keysIndex = null;

  // ---- 工具函数 ----
  function _buildKeysIndex() {
    const list = container.querySelectorAll(itemSelector);
    const arr = new Array(list.length);
    const map = new Map();
    for (let i = 0; i < list.length; i++) {
      const k = getKey(list[i]);
      arr[i] = k;
      if (k != null) map.set(k, i);
    }
    _keysArray = arr;
    _keysIndex = map;
  }

  function keys() {
    if (!_keysArray) _buildKeysIndex();
    return _keysArray;
  }

  function keyIndex(k) {
    if (!_keysIndex) _buildKeysIndex();
    return _keysIndex.get(k);
  }

  function invalidateKeysCache() {
    _keysArray = null;
    _keysIndex = null;
  }

  function keyFromEvent(e) {
    const el = e.target && e.target.closest ? e.target.closest(itemSelector) : null;
    if (!el || !container.contains(el)) return null;
    return { key: getKey(el), el };
  }

  function isInteractiveTarget(t) {
    if (!t || !t.closest) return false;
    return !!t.closest('button, a, input, select, textarea, .no-select');
  }

  function itemAtY(y) {
    const rect = scrollTarget.getBoundingClientRect();
    const x = rect.left + Math.min(rect.width / 2, 200);
    const el = document.elementFromPoint(x, y);
    if (el) {
      const item = el.closest(itemSelector);
      if (item && container.contains(item)) return item;
    }
    const list = container.querySelectorAll(itemSelector);
    if (!list.length) return null;
    let closest = null;
    let minDist = Infinity;
    for (let i = 0; i < list.length; i++) {
      const r = list[i].getBoundingClientRect();
      const c = r.top + r.height / 2;
      const d = Math.abs(c - y);
      if (d < minDist) { minDist = d; closest = list[i]; }
    }
    return closest;
  }

  // ---- 视觉更新（rAF 节流 + dataset 缓存） ----
  function _applyVisualNow() {
    const list = container.querySelectorAll(itemSelector);
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      const k = getKey(el);
      const should = selectedSet.has(k) ? '1' : '0';
      if (el.dataset.selState === should) continue;
      el.dataset.selState = should;
      if (should === '1') {
        el.classList.add('selected');
        const cb = el.querySelector('.song-check');
        if (cb) cb.checked = true;
      } else {
        el.classList.remove('selected');
        const cb = el.querySelector('.song-check');
        if (cb) cb.checked = false;
      }
    }
  }

  function applyVisual() {
    if (visualRafPending) return;
    visualRafPending = true;
    requestAnimationFrame(() => {
      visualRafPending = false;
      _applyVisualNow();
    });
  }

  function forceApplyVisual() {
    visualRafPending = false;
    _applyVisualNow();
  }

  function notify() {
    applyVisual();
    if (typeof onSelectionChanged === 'function') {
      try { onSelectionChanged(); } catch (e) { console.error(e); }
    }
  }

  // ---- 单击已选中项延迟取消 ----
  function cancelPendingDeselect() {
    if (pendingDeselectTimer) {
      clearTimeout(pendingDeselectTimer);
      pendingDeselectTimer = null;
    }
    pendingDeselectKey = null;
  }

  // ---- 自动滚动 ----
  function setAutoScrollDir(dir) {
    if (dir === autoScrollDir) return;
    autoScrollDir = dir;
    if (dir === 0) {
      if (autoScrollTimer) {
        clearInterval(autoScrollTimer);
        autoScrollTimer = null;
      }
      return;
    }
    if (autoScrollTimer) return;
    autoScrollTimer = setInterval(() => {
      if (!dragging || autoScrollDir === 0) return;
      const max = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight);
      const next = Math.max(0, Math.min(max, scrollTarget.scrollTop + autoScrollDir * autoScrollSpeed));
      if (next === scrollTarget.scrollTop) return;
      scrollTarget.scrollTop = next;
      updateDragSelectionByY(lastMouseY, false);
    }, 16);
  }

  function updateAutoScrollDir(y) {
    const rect = scrollTarget.getBoundingClientRect();
    let dir = 0;
    if (y < rect.top + autoScrollEdge) dir = -1;
    else if (y > rect.bottom - autoScrollEdge) dir = 1;
    setAutoScrollDir(dir);
  }

  function stopAutoScroll() {
    setAutoScrollDir(0);
  }

  // ---- 拖动范围选择：拖动中只更新视觉，不触发 onSelectionChanged ----
  function updateDragSelectionByY(y, notifyChanged) {
    if (!dragging || dragStartKey == null) return;
    const arr = keys();
    const startIdx = keyIndex(dragStartKey);
    if (startIdx == null) return;

    let curIdx = startIdx;
    const itemEl = itemAtY(y);
    if (itemEl) {
      const curKey = getKey(itemEl);
      const idx = keyIndex(curKey);
      if (idx != null) curIdx = idx;
    } else {
      const rect = scrollTarget.getBoundingClientRect();
      if (y < rect.top) curIdx = 0;
      else if (y > rect.bottom) curIdx = arr.length - 1;
    }

    const lo = Math.min(startIdx, curIdx);
    const hi = Math.max(startIdx, curIdx);
    selectedSet.clear();
    for (let i = lo; i <= hi; i++) {
      if (arr[i] != null) selectedSet.add(arr[i]);
    }
    applyVisual();
    if (notifyChanged && typeof onSelectionChanged === 'function') {
      try { onSelectionChanged(); } catch (e) { console.error(e); }
    }
  }

  // ---- 事件处理 ----
  function onMouseDown(e) {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;
    const hit = keyFromEvent(e);
    if (!hit) return;
    const key = hit.key;
    if (key == null) return;

    // 记录鼠标位置（用于选择栏显隐时的可见性修正）
    lastInteractiveY = e.clientY;

    // 双击的第二下 mousedown：不处理单击逻辑，让 dblclick 处理
    if (e.detail >= 2) {
      cancelPendingDeselect();
      return;
    }

    cancelPendingDeselect();

    // Shift 范围扩展
    if (e.shiftKey && anchorKey != null) {
      const all = keys();
      const i1 = keyIndex(anchorKey);
      const i2 = keyIndex(key);
      if (i1 != null && i2 != null) {
        const lo = Math.min(i1, i2);
        const hi = Math.max(i1, i2);
        selectedSet.clear();
        for (let i = lo; i <= hi; i++) {
          if (all[i] != null) selectedSet.add(all[i]);
        }
        notify();
        e.preventDefault();
      }
      return;
    }

    // Ctrl / Cmd 切换
    if (e.ctrlKey || e.metaKey) {
      if (selectedSet.has(key)) selectedSet.delete(key);
      else selectedSet.add(key);
      anchorKey = key;
      notify();
      e.preventDefault();
      return;
    }

    // 普通单击：准备拖动
    dragging = true;
    dragStartKey = key;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    didMove = false;
    anchorKey = key;

    if (selectedSet.has(key)) {
      pendingDeselectKey = key;
      pendingDeselectTimer = setTimeout(() => {
        pendingDeselectTimer = null;
        const k = pendingDeselectKey;
        pendingDeselectKey = null;
        if (k != null) {
          selectedSet.delete(k);
          notify();
        }
      }, clickDeselectDelay);
    } else {
      selectedSet.clear();
      selectedSet.add(key);
      notify();
    }
    e.preventDefault();
  }

  function onMouseMove(e) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (!dragging) return;

    if (!didMove) {
      if (Math.abs(e.clientX - dragStartX) < dragThreshold &&
          Math.abs(e.clientY - dragStartY) < dragThreshold) {
        return;
      }
      didMove = true;
      cancelPendingDeselect();
    }

    // 拖动中不通知（避免每帧强制布局）；鼠标抬起时统一通知
    updateDragSelectionByY(e.clientY, false);
    updateAutoScrollDir(e.clientY);
  }

  function onMouseUp() {
    if (!dragging) return;
    dragging = false;
    dragStartKey = null;
    const wasMoving = didMove;
    didMove = false;
    stopAutoScroll();
    if (wasMoving && typeof onSelectionChanged === 'function') {
      try { onSelectionChanged(); } catch (e) { console.error(e); }
    }
  }

  function onDblClick(e) {
    if (isInteractiveTarget(e.target)) return;
    const hit = keyFromEvent(e);
    if (!hit) return;
    cancelPendingDeselect();
    if (typeof onPlay === 'function') onPlay(hit.key, hit.el);
  }

  function onDragStart(e) {
    if (e.target && e.target.closest && e.target.closest(itemSelector)) {
      e.preventDefault();
    }
  }

  container.addEventListener('mousedown', onMouseDown);
  container.addEventListener('dblclick', onDblClick);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('dragstart', onDragStart);

  return {
    selectedSet,
    refresh() {
      invalidateKeysCache();
      forceApplyVisual();
    },
    refreshAndNotify() {
      invalidateKeysCache();
      forceApplyVisual();
      if (typeof onSelectionChanged === 'function') {
        try { onSelectionChanged(); } catch (e) { console.error(e); }
      }
    },
    clear() {
      lastInteractiveY = null;
      selectedSet.clear();
      notify();
    },
    selectAll() {
      lastInteractiveY = null;
      const all = keys();
      selectedSet.clear();
      for (const k of all) if (k != null) selectedSet.add(k);
      notify();
    },
    invert() {
      lastInteractiveY = null;
      const all = keys();
      const next = new Set();
      for (const k of all) if (k != null && !selectedSet.has(k)) next.add(k);
      selectedSet.clear();
      for (const k of next) selectedSet.add(k);
      notify();
    },
    count() { return selectedSet.size; },
    // 暴露给调用方：选择栏显隐时可读取以判断是否需做可见性修正
    getLastMouseY() { return lastInteractiveY; },
    destroy() {
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('dblclick', onDblClick);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('dragstart', onDragStart);
      stopAutoScroll();
      cancelPendingDeselect();
    },
  };
}

// ==================== 选择栏显隐 + 滚动补偿 ====================
// 目标：选择栏出现时尽量保持鼠标下的项目留在原位置，同时保证它不被选择栏遮挡。
//
// 算法：
//   1) 记录切换前容器在视口中的 top 与当前 scrollTop
//   2) 切换 bar 显隐
//   3) 计算容器位移 delta，得到「保持位置」的理想 scrollTop = S0 + delta
//   4) 若鼠标位置 keepMouseY 会被选择栏遮挡（keepMouseY < bar.bottom + 4），
//      则从理想 scrollTop 中扣掉「遮挡 deficit」，让该项刚好落到选择栏下方
//   5) 最终 scrollTop 夹到 [0, maxScroll]
//
// 隐藏时反向操作，行为与出现对称（不做可见性修正，因为 bar 已消失）。
function setSelectionBarVisible(container, bar, visible, stateObj, keepMouseY) {
  if (!bar) return;
  const st = stateObj || bar;
  const wasVisible = st._barVisible === true;
  if (wasVisible === !!visible) return;

  let beforeTop = 0;
  let beforeScrollTop = 0;
  if (container) {
    beforeTop = container.getBoundingClientRect().top;
    beforeScrollTop = container.scrollTop;
  }

  bar.style.display = visible ? 'flex' : 'none';

  // 强制同步布局：读取 offsetHeight 会触发重排
  if (container) void container.offsetHeight;

  if (container) {
    const afterTop = container.getBoundingClientRect().top;
    const delta = afterTop - beforeTop;                 // 正值=容器下移，负值=容器上移
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    let targetScrollTop = beforeScrollTop + delta;

    // 可见性修正：只在「显示」且拿到了有效鼠标 Y 时生效
    if (visible && typeof keepMouseY === 'number' && keepMouseY > 0) {
      const barRect = bar.getBoundingClientRect();
      const safeTop = barRect.bottom + 4;
      if (keepMouseY < safeTop) {
        const deficit = safeTop - keepMouseY;           // 需要让内容下移的像素数
        targetScrollTop -= deficit;                     // 减小 scrollTop = 内容下移
      }
    }

    const clamped = Math.max(0, Math.min(maxScroll, targetScrollTop));
    if (clamped !== container.scrollTop) {
      container.scrollTop = clamped;
    }
  }

  st._barVisible = !!visible;
}