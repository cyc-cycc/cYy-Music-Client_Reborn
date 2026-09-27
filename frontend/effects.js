// ==================== 视觉增强层 · 交互逻辑（阶段 1） ====================
// 只负责少量需要 JS 参与的微交互；纯视觉部分见 enhanced.css。
// 删除本文件 + index.html 对应 <script> 即可完全回滚。

(function () {
  'use strict';

  // ------------------------------------------------------------
  // 1. 通用涟漪：在主要按钮上点击时扩散水波
  // ------------------------------------------------------------
  const RIPPLE_SELECTOR = [
    '.btn-primary', '.btn-orange', '.btn-accent',
    '.btn-secondary', '.btn-ghost', '.btn-danger',
    '.player-ctrl', '.mini-btn', '.icon-btn',
    '.modal-actions button', '.win-btn',
    '.settings-tab', '.playlist-tab',
    '.sleep-item',
    '.eq-chip'
  ].join(',');

  function spawnRipple(btn, clientX, clientY) {
    // 计算涟漪直径：取按钮对角线长度，保证全覆盖
    const rect = btn.getBoundingClientRect();
    const size = Math.hypot(rect.width, rect.height) * 1.05;
    const x = clientX - rect.left - size / 2;
    const y = clientY - rect.top - size / 2;

    // 确保按钮是定位上下文，且裁切溢出
    const cs = getComputedStyle(btn);
    if (cs.position === 'static') {
      btn.dataset.__ripplePos = '1';
      btn.style.position = 'relative';
    }
    // 记录原 overflow，避免破坏其他样式（如悬停光晕）
    if (cs.overflow === 'visible') {
      btn.dataset.__rippleOverflow = btn.style.overflow || '';
      btn.style.overflow = 'hidden';
    }

    const ripple = document.createElement('span');
    ripple.className = '__ripple';
    ripple.style.cssText =
      `left:${x}px;top:${y}px;width:${size}px;height:${size}px;`;

    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);
  }

  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const btn = e.target.closest(RIPPLE_SELECTOR);
    if (!btn) return;
    // 避免在 disabled 的按钮上冒涟漪
    if (btn.disabled) return;
    // 避免多次点击堆积
    if (btn.querySelector(':scope > .__ripple')) {
      btn.querySelectorAll(':scope > .__ripple').forEach(n => n.remove());
    }
    spawnRipple(btn, e.clientX, e.clientY);
  }, { passive: true });

  // ------------------------------------------------------------
  // 3. 列表项动画错峰：给同一容器内的连续条目加 delay
  // ------------------------------------------------------------
  function staggerListItems(container, selector, step = 28, max = 480) {
    if (!container) return;
    const items = container.querySelectorAll(selector);
    items.forEach((el, i) => {
      const delay = Math.min(i * step, max);
      el.style.animationDelay = delay + 'ms';
    });
  }

  // 观察列表内容变化，为新条目自动分配入场延迟
  function observeList(containerId, selector) {
    const container = document.getElementById(containerId);
    if (!container) return;
    let raf = null;
    const run = () => {
      raf = null;
      staggerListItems(container, selector);
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(run);
    };
    new MutationObserver(schedule).observe(container, {
      childList: true,
      subtree: false,
    });
    // 初始跑一次
    schedule();
  }

  // ------------------------------------------------------------
  // 4. 播放条播放状态 → 呼吸光（配合 enhanced.css 的 #player-bar.playing）
  // ------------------------------------------------------------
  function bindPlayerBarState() {
    const bar = document.getElementById('player-bar');
    const audio = document.getElementById('audio-player');
    if (!bar || !audio) return;

    const sync = () => {
      const playing = !audio.paused && !audio.ended && audio.readyState > 2;
      bar.classList.toggle('playing', playing);
    };
    ['play', 'pause', 'ended', 'loadeddata', 'emptied'].forEach(evt => {
      audio.addEventListener(evt, sync);
    });
    sync();
  }

  // ------------------------------------------------------------
  // 5. 弹窗打开时给 body 挂 class（用于将来扩展）
  // ------------------------------------------------------------
  function bindModalObserver() {
    const modals = document.querySelectorAll('.modal-mask');
    const update = () => {
      const anyOpen = [...modals].some(m => m.classList.contains('show'));
      document.body.classList.toggle('modal-open', anyOpen);
    };
    const mo = new MutationObserver(update);
    modals.forEach(m => mo.observe(m, { attributes: true, attributeFilter: ['class'] }));
    update();
  }

  // ------------------------------------------------------------
  // 6. 封面 3D 视差（阶段 3）
  // ------------------------------------------------------------
  // 鼠标在封面上移动时：轻微 3D 倾斜 + 边缘光晕跟随鼠标。
  // 只动 transform / opacity，不触发重排；离开时平滑回正。
  function bindCoverParallax(el, opts) {
    if (!el || el.dataset.parallaxBound === '1') return;
    el.dataset.parallaxBound = '1';
    el.classList.add('parallax-cover');

    const o = opts || {};
    const maxTilt    = (o.maxTilt    != null) ? o.maxTilt    : 14;
    const maxShift   = (o.maxShift   != null) ? o.maxShift   : 3;
    const hoverScale = (o.hoverScale != null) ? o.hoverScale : 1.06;
    const perspective= (o.perspective!= null) ? o.perspective: 700;

    let targetRx = 0, targetRy = 0, targetTx = 0, targetTy = 0, targetScale = 1;
    let curRx = 0, curRy = 0, curTx = 0, curTy = 0, curScale = 1;
    let rafId = null;

    function applyTransform() {
      el.style.transform =
        'perspective(' + perspective + 'px) ' +
        'rotateX(' + curRx.toFixed(2) + 'deg) ' +
        'rotateY(' + curRy.toFixed(2) + 'deg) ' +
        'translate3d(' + curTx.toFixed(2) + 'px, ' + curTy.toFixed(2) + 'px, 0) ' +
        'scale(' + curScale.toFixed(3) + ')';
    }

    function schedule() {
      if (rafId != null) return;
      rafId = requestAnimationFrame(tick);
    }

    function tick() {
      rafId = null;
      const K = 0.18;   // 缓动系数：越大越跟手，越小越"重"
      curRx += (targetRx - curRx) * K;
      curRy += (targetRy - curRy) * K;
      curTx += (targetTx - curTx) * K;
      curTy += (targetTy - curTy) * K;
      curScale += (targetScale - curScale) * K;
      applyTransform();

      const busy =
        Math.abs(targetRx - curRx) > 0.03 ||
        Math.abs(targetRy - curRy) > 0.03 ||
        Math.abs(targetTx - curTx) > 0.05 ||
        Math.abs(targetTy - curTy) > 0.05 ||
        Math.abs(targetScale - curScale) > 0.001;
      if (busy) schedule();
    }

    el.addEventListener('pointerenter', () => {
      targetScale = hoverScale;
      el.classList.add('parallax-active');
      schedule();
    });

    el.addEventListener('pointermove', (e) => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let nx = (e.clientX - cx) / (rect.width / 2);   // -1 ~ 1
      let ny = (e.clientY - cy) / (rect.height / 2);
      nx = Math.max(-1, Math.min(1, nx));
      ny = Math.max(-1, Math.min(1, ny));
      targetRy = nx * maxTilt;
      targetRx = -ny * maxTilt;
      targetTx = nx * maxShift;
      targetTy = ny * maxShift;
      el.style.setProperty('--px', nx.toFixed(3));
      el.style.setProperty('--py', ny.toFixed(3));
      schedule();
    });

    function reset() {
      targetRx = targetRy = targetTx = targetTy = 0;
      targetScale = 1;
      el.classList.remove('parallax-active');
      schedule();
    }
    el.addEventListener('pointerleave', reset);
    el.addEventListener('pointercancel', reset);
  }

  // ------------------------------------------------------------
  // 7. 播放条标题跑马灯
  // ------------------------------------------------------------
  // 溢出时滚动，但只在"暂停/停止"状态滚；
  // 播放中用 animation-play-state 冻结在原位置，恢复播放时从原地继续。
  function bindNowPlayingMarquee() {
    const el = document.getElementById('now-playing-text');
    if (!el || el.dataset.marqueeBound === '1') return;
    el.dataset.marqueeBound = '1';

    const audio = document.getElementById('audio-player');
    let overflow = false;   // 测量结果：是否超出容器

    function ensureInner() {
      let inner = el.querySelector(':scope > .npt-inner');
      if (inner) return inner;
      const span = document.createElement('span');
      span.className = 'npt-inner';
      span.textContent = el.textContent || '';
      el.textContent = '';
      el.appendChild(span);
      return span;
    }

    function measure() {
      const inner = ensureInner();
      // 先摘掉滚动 class，避免旧动画影响测量
      el.classList.remove('npt-scroll', 'npt-paused');
      requestAnimationFrame(() => {
        const w = inner.scrollWidth;
        const c = el.clientWidth;
        overflow = w > c + 1;
        if (overflow) {
          el.style.setProperty('--npt-shift', `-${w - c}px`);
          el.style.setProperty('--npt-dur', Math.max(6, (w - c) / 50 + 4).toFixed(2) + 's');
          el.title = inner.textContent || '';
        } else {
          el.style.removeProperty('--npt-shift');
          el.style.removeProperty('--npt-dur');
          el.removeAttribute('title');
        }
        applyScrollState();
      });
    }

    function isPlaying() {
      return !!audio && !audio.paused && !audio.ended && audio.readyState > 2;
    }

    function applyScrollState() {
      if (!overflow) {
        el.classList.remove('npt-scroll', 'npt-paused');
        return;
      }
      el.classList.add('npt-scroll');
      // 播放中 → 暂停动画；暂停/停止 → 运行
      el.classList.toggle('npt-paused', isPlaying());
    }

    ensureInner();
    measure();

    const mo = new MutationObserver(() => {
      mo.disconnect();
      ensureInner();
      measure();
      mo.observe(el, { childList: true });
    });
    mo.observe(el, { childList: true });

    if (audio) {
      ['play', 'pause', 'ended', 'loadeddata', 'emptied'].forEach(evt => {
        audio.addEventListener(evt, applyScrollState);
      });
    }
    window.addEventListener('resize', measure);
  }

  // ------------------------------------------------------------
  // 启动
  // ------------------------------------------------------------
  function init() {
    observeList('result-list', '.song-item');
    observeList('playlist-content', '.playlist-item');
    observeList('download-tasks-list', '.task-item');
    bindPlayerBarState();
    bindModalObserver();
    bindCoverParallax(document.getElementById('player-cover'), {
      maxTilt: 16, maxShift: 3, hoverScale: 1.06, perspective: 420,
    });
    bindCoverParallax(document.getElementById('lyrics-overlay-cover'), {
      maxTilt: 10, maxShift: 8, hoverScale: 1.0, perspective: 900,
    });
    bindNowPlayingMarquee();   // ← 新增
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();