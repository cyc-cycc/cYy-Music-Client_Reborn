// ==================== 主题、调色板、设置表单渲染 ====================

// ---------- 从主色生成 5 色调色板（从暗到亮） ----------
function generatePalette(hexColor) {
  let r = parseInt(hexColor.slice(1, 3), 16) / 255;
  let g = parseInt(hexColor.slice(3, 5), 16) / 255;
  let b = parseInt(hexColor.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  const brightnessSteps = [0.15, 0.35, 0.55, 0.75, 0.95];
  const sat = Math.max(0.6, s * 0.9);
  return brightnessSteps.map(lightness => {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    let q = lightness < 0.5 ? lightness * (1 + sat) : lightness + sat - lightness * sat;
    let p = 2 * lightness - q;
    let rr = hue2rgb(p, q, h + 1 / 3);
    let gg = hue2rgb(p, q, h);
    let bb = hue2rgb(p, q, h - 1 / 3);
    const toHex = (c) => Math.round(c * 255).toString(16).padStart(2, '0');
    return '#' + toHex(rr) + toHex(gg) + toHex(bb);
  });
}

// ---------- 按振幅在调色板中插值取色 ----------
function getVizColor(v) {
  if (!vizPalette.length) return '#38BDF8';
  const idx = v * (vizPalette.length - 1);
  const i = Math.floor(idx);
  const f = idx - i;
  if (i >= vizPalette.length - 1) return vizPalette[vizPalette.length - 1];
  const c1 = vizPalette[i], c2 = vizPalette[i + 1];
  const r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * f);
  const g = Math.round(g1 + (g2 - g1) * f);
  const b = Math.round(b1 + (b2 - b1) * f);
  return `rgb(${r},${g},${b})`;
}

function effectiveAccent(accentKey, customColor) {
  if (THEME_ACCENTS[accentKey]) return THEME_ACCENTS[accentKey];
  if (accentKey === 'custom' && /^#[0-9a-f]{6}$/i.test(customColor || '')) return customColor;
  return '#38BDF8';
}

function applyTheme(theme, opacity, accentKey, customColor) {
  document.documentElement.dataset.theme = (theme === 'light') ? 'light' : 'dark';
  const alpha = Math.max(0.5, Math.min(1.0, opacity != null ? opacity : 1.0));
  document.documentElement.style.setProperty('--bg-alpha', alpha.toFixed(2));

  // 阶段 2：动态主题激活时（播放中封面驱动），--primary 由 dynamic-theme.js 接管，
  // 这里不覆盖，避免用户在播放中保存设置导致主色闪回。
  const dynamicActive = (typeof isDynamicActive === 'function') && isDynamicActive();
  if (!dynamicActive) {
    const primary = effectiveAccent(accentKey, customColor);
    document.documentElement.style.setProperty('--primary', primary);
    vizPalette = generatePalette(primary);
  }

  // 同步主题给迷你窗口（如果已打开）
  if (typeof notifyThemeChanged === 'function') {
    try { notifyThemeChanged(); } catch (e) {}
  }
}

// ---------- 下拉框填充 ----------
function fillSelect(sel, items) {
  sel.innerHTML = '';
  items.forEach(it => {
    const opt = document.createElement('option');
    opt.value = it;
    opt.textContent = it;
    sel.appendChild(opt);
  });
}

// ---------- 搜索源复选框渲染 ----------
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

// ---------- 音频比特率下拉（随格式变化） ----------
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
    sel.value = '';
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
  const saved = (state.settings && state.settings.convert_bitrate) || '';
  sel.value = options.includes(saved) ? saved : options[options.length - 1];
}

// ---------- 将 settings 应用到 UI ----------
function applySettingsToUI(settings) {
  const s = settings || {};
  volumeSlider.value = s.volume != null ? s.volume : 60;
  playmodeSelect.value = String(s.play_mode != null ? s.play_mode : 2);
  if (vizPlaymodeSelect) vizPlaymodeSelect.value = playmodeSelect.value;
  const rate = s.playback_rate != null ? String(s.playback_rate) : '1';
  speedSelect.value = speedSelect.querySelector(`option[value="${rate}"]`) ? rate : '1';
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
  if (settingSmartCover) settingSmartCover.checked = s.smart_cover !== false;
  if (settingDynamicTheme) settingDynamicTheme.checked = s.dynamic_theme !== false;
  document.querySelectorAll('#source-checkboxes input[type="checkbox"]').forEach(cb => {
    cb.checked = (s.sources || []).includes(cb.value);
  });
  customFormatGroup.style.display = (settingFilenameFormat.value === '自定义') ? 'block' : 'none';
  updateBitrateOptions();
  const opacityValue = s.background_opacity != null ? s.background_opacity : (parseInt(settingOpacity.value, 10) / 100);
  applyTheme(s.theme, opacityValue, accent, s.theme_custom);
  // 阶段 2：保存设置后立即按新开关切换动态主题
  if (typeof refreshDynamicTheme === 'function') {
    try { refreshDynamicTheme(); } catch (e) {}
  }
}