// ==================== 阶段 2：封面驱动动态主题 ====================
// 播放时从封面提取主色，覆盖 --primary；停止时回落到用户设置。
// 只改主色，不碰 data-theme / --bg-alpha（那些由 applyTheme 负责）。
// 删除本文件 + index.html 对应 <script> 即可完全回滚。

(function () {
  'use strict';

  // ---------- 内部状态 ----------
  let _activeToken = 0;        // 异步 token，防止乱序覆盖
  let _dynamicActive = false;  // 当前是否处于动态主题态

  // ---------- 色值转换 ----------
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s;
    const l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
        default: h = 0;
      }
    }
    return [h, s, l];
  }

  function hslToHex(h, s, l) {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    const toHex = (c) => Math.round(c * 255).toString(16).padStart(2, '0');
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  // ---------- 封面取色 ----------
  // 思路：把封面画到 64×64 小 canvas，按 hue 分 24 桶，用
  //      "饱和度 × 亮度接近中间" 加权，选出视觉上最"抢眼"的颜色。
  //      过滤太暗/太亮/太灰的像素；最后把 HSL 钳到舒适区间。
  const SAMPLE_SIZE = 64;
  const HUE_BUCKETS = 24;

  function extractPalette(imageUrl) {
    return new Promise((resolve) => {
      if (!imageUrl) { resolve(null); return; }
      const img = new Image();
      // 主进程已 webSecurity:false，无需 crossOrigin 也不会 taint
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = SAMPLE_SIZE;
          canvas.height = SAMPLE_SIZE;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) { resolve(null); return; }
          ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
          const data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;

          const buckets = new Array(HUE_BUCKETS);
          for (let i = 0; i < HUE_BUCKETS; i++) {
            buckets[i] = { w: 0, s: 0, l: 0 };
          }
          let totalW = 0;

          for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3];
            if (a < 128) continue;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const [h, s, l] = rgbToHsl(r, g, b);
            if (l < 0.12 || l > 0.92) continue;   // 太暗 / 太亮
            if (s < 0.12) continue;               // 太灰
            // 权重：饱和度越高、亮度越接近 0.5，权重越大
            const w = s * (1 - Math.abs(l - 0.5) * 1.3);
            if (w <= 0.01) continue;
            const bi = Math.min(HUE_BUCKETS - 1, Math.floor(h * HUE_BUCKETS));
            buckets[bi].w += w;
            buckets[bi].s += s * w;
            buckets[bi].l += l * w;
            totalW += w;
          }

          if (totalW < 0.5) { resolve(null); return; }

          let best = 0, bestW = 0;
          for (let i = 0; i < HUE_BUCKETS; i++) {
            if (buckets[i].w > bestW) { bestW = buckets[i].w; best = i; }
          }
          if (bestW <= 0) { resolve(null); return; }

          const bk = buckets[best];
          const avgH = (best + 0.5) / HUE_BUCKETS;
          // 钳制：太灰/太暗/太亮的主色视觉体验差
          let avgS = bk.s / bk.w;
          let avgL = bk.l / bk.w;
          avgS = Math.max(0.42, Math.min(0.86, avgS));
          avgL = Math.max(0.40, Math.min(0.62, avgL));

          resolve({ primary: hslToHex(avgH, avgS, avgL) });
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = imageUrl;
    });
  }

  // ---------- 应用动态主色 ----------
  function applyDynamicPalette(hex) {
    if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return;
    _dynamicActive = true;
    document.documentElement.style.setProperty('--primary', hex);
    // 同步可视化调色板（vizPalette 在 core.js 声明）
    if (typeof generatePalette === 'function') {
      try { vizPalette = generatePalette(hex); } catch (e) {}
    }
  }

  // ---------- 回落到用户设置主题 ----------
  function revertToBaseTheme() {
    if (!_dynamicActive) return;
    _dynamicActive = false;
    _activeToken++;  // 使挂起的取色请求失效
    const s = (typeof state !== 'undefined' && state && state.settings) || null;
    if (!s) return;
    const accentKey = s.theme_color || 'sky';
    const custom = s.theme_custom || '';
    const opacity = (s.background_opacity != null) ? s.background_opacity : 1.0;
    if (typeof applyTheme === 'function') {
      try { applyTheme(s.theme, opacity, accentKey, custom); } catch (e) {}
    }
  }

  // ---------- 开关判断 ----------
  // 未显式设为 false 时视为开启（兼容旧配置）
  function isEnabled() {
    if (typeof state === 'undefined' || !state || !state.settings) return true;
    return state.settings.dynamic_theme !== false;
  }

  // 供外部（保存设置后）主动刷新：按新开关与当前封面重新决策
  function refreshDynamicTheme() {
    if (!isEnabled()) { revertToBaseTheme(); return; }
    const cu = (typeof state !== 'undefined' && state && state.currentCoverUrl) || '';
    if (cu) setActiveCover(cu);
    else revertToBaseTheme();
  }

  // ---------- 综合入口：设置当前活跃封面 ----------
  function setActiveCover(coverUrl) {
    if (!isEnabled()) { revertToBaseTheme(); return; }   // ← 新增
    if (!coverUrl) { revertToBaseTheme(); return; }
    const myToken = ++_activeToken;
    extractPalette(coverUrl).then((result) => {
      if (myToken !== _activeToken) return;
      if (!isEnabled()) return;                          // ← 新增：异步回来时开关已关
      if (!result || !result.primary) return;
      applyDynamicPalette(result.primary);
    }).catch(() => {});
  }

  // ---------- 对外暴露 ----------
  window.extractPalette = extractPalette;
  window.applyDynamicPalette = applyDynamicPalette;
  window.revertToBaseTheme = revertToBaseTheme;
  window.setActiveCover = setActiveCover;
  window.isDynamicActive = function () { return _dynamicActive; };
  window.refreshDynamicTheme = refreshDynamicTheme;
  window.isDynamicThemeEnabled = isEnabled;
})();