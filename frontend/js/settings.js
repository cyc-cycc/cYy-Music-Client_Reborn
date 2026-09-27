// ==================== 设置表单事件 + 应用初始化 ====================

// ---------- 设置表单事件 ----------
settingConvertFormat.addEventListener('change', updateBitrateOptions);
settingConvertEnabled.addEventListener('change', updateBitrateOptions);
settingFilenameFormat.addEventListener('change', function () {
  customFormatGroup.style.display = this.value === '自定义' ? 'block' : 'none';
});
settingOpacity.addEventListener('input', function () {
  const val = parseInt(this.value, 10);
  settingOpacityLabel.textContent = val + '%';
  const accent = settingAccent.value;
  const customColor = settingAccentColor.value;
  applyTheme(settingTheme.value, val / 100, accent, accent === 'custom' ? customColor : undefined);
});
settingAccent.addEventListener('change', function () {
  const showCustom = this.value === 'custom';
  settingAccentColor.style.display = showCustom ? 'block' : 'none';
  const accent = this.value;
  const customColor = settingAccentColor.value;
  applyTheme(settingTheme.value, parseInt(settingOpacity.value, 10) / 100, accent, accent === 'custom' ? customColor : undefined);
});
settingAccentColor.addEventListener('input', function () {
  applyTheme(settingTheme.value, parseInt(settingOpacity.value, 10) / 100, 'custom', this.value);
});
settingPlaymode.addEventListener('change', function () {
  playmodeSelect.value = this.value;
  if (vizPlaymodeSelect) vizPlaymodeSelect.value = this.value;
});

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
    smart_cover: settingSmartCover ? settingSmartCover.checked : true,
    dynamic_theme: settingDynamicTheme ? settingDynamicTheme.checked : true,
    play_mode: parseInt(settingPlaymode.value, 10),
    volume: parseInt(volumeSlider.value, 10),
    playback_rate: parseFloat(speedSelect.value) || 1,
  };
  try {
    await postJSON('/settings', settings);
    state.settings = Object.assign({}, state.settings, settings);
    applyTheme(settings.theme, settings.background_opacity, settings.theme_color, settings.theme_custom);
    playmodeSelect.value = String(settings.play_mode);
    if (vizPlaymodeSelect) vizPlaymodeSelect.value = String(settings.play_mode);
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

// ---------- 应用初始化 ----------
async function initApp() {
  let visibilityTimer = setTimeout(() => {
    if (ipcRenderer) {
      try { ipcRenderer.send('window-ready-to-show'); } catch (e) {}
    }
    document.body.offsetHeight;
    setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.body.classList.add('loaded');
        });
      });
    }, 550);   // ← 这里
  }, 3000);

  const revealUI = () => {
    if (visibilityTimer) { clearTimeout(visibilityTimer); visibilityTimer = null; }
    if (ipcRenderer) {
      try { ipcRenderer.send('window-ready-to-show'); } catch (e) {}
    }
    // 强制同步 reflow，确保浏览器已记账初始状态
    document.body.offsetHeight;
    getComputedStyle(document.body).opacity;
    // 延迟需要覆盖：IPC 往返（~30ms）+ 窗口 show()（~200ms）
    // + 合成器首帧就绪（~150ms）+ 余量（~150ms）≈ 550ms
    // 之前 200ms 明显不够，导致 loaded 触发时窗口还没上屏。
    setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.body.classList.add('loaded');
        });
      });
    }, 550);
  };

  // 60 秒总超时：40 次 × 1.5 秒；后端首次启动解压依赖可能较慢
  const MAX_INIT_ATTEMPTS = 40;
  const INIT_RETRY_DELAY_MS = 1500;

  for (let attempt = 0; attempt < MAX_INIT_ATTEMPTS; attempt++) {
    try {
      const [options, settings] = await Promise.all([
        fetch(`${API_BASE}/settings/options`).then(r => r.json()),
        fetch(`${API_BASE}/settings`).then(r => r.json()),
      ]);
      state.options = options;
      state.settings = settings;
      state.eq = settings.eq || defaultEq();
      if (state.eq.vocal_cancel_amount == null) state.eq.vocal_cancel_amount = 100;

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
      if (!searchAbortController && !parseAbortController) setStats('就绪');
      console.log('初始化完成');

      revealUI();
      return;
    } catch (e) {
      if (attempt === 0) {
        setStats('正在连接后端...');
      } else if (attempt % 5 === 0) {
        const sec = Math.round((attempt * INIT_RETRY_DELAY_MS) / 1000);
        setStats(`正在连接后端...（已等待 ${sec}s）`);
      }
      await new Promise(r => setTimeout(r, INIT_RETRY_DELAY_MS));
    }
  }

  console.error('初始化失败');
  revealUI();
  setStats('无法连接后端，请确认 server.py 已启动');
  resultList.innerHTML = '<div class="empty-tip">无法连接后端服务</div>';
}

// ============================================================
// 诊断面板
// ============================================================
const diagRefreshBtn = $('diag-refresh-btn');
const diagExportBtn = $('diag-export-btn');
const diagOutput = $('diag-output');

if (diagRefreshBtn) {
  diagRefreshBtn.addEventListener('click', async () => {
    diagRefreshBtn.disabled = true;
    try {
      const resp = await fetch(`${API_BASE}/diagnostics`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (diagOutput) {
        diagOutput.style.display = 'block';
        diagOutput.textContent = JSON.stringify(data, null, 2);
      }
    } catch (e) {
      if (diagOutput) {
        diagOutput.style.display = 'block';
        diagOutput.textContent = `获取诊断信息失败: ${e.message}`;
      }
    } finally {
      diagRefreshBtn.disabled = false;
    }
  });
}

if (diagExportBtn) {
  diagExportBtn.addEventListener('click', async () => {
    if (!ipcRenderer) {
      setStats('导出诊断包需要 Electron 环境');
      return;
    }
    diagExportBtn.disabled = true;
    try {
      const result = await ipcRenderer.invoke('export-diagnostics');
      if (result && result.cancelled) return;
      if (result && result.ok) {
        setStats(`诊断包已导出: ${result.filePath}`);
      } else {
        setStats(`导出失败: ${(result && result.error) || '未知错误'}`);
      }
    } catch (e) {
      setStats(`导出失败: ${e.message}`);
    } finally {
      diagExportBtn.disabled = false;
    }
  });
}
// ============================================================
// 手机遥控
// ============================================================
(function initRemoteControl() {
  const chkEnabled = $('setting-remote-enabled');
  const urlGroup = $('remote-url-group');
  const actionsGroup = $('remote-actions-group');
  const urlInput = $('setting-remote-url');
  const connectedEl = $('remote-connected-count');
  const btnCopy = $('btn-copy-remote-url');
  const btnRotate = $('btn-rotate-remote-token');
  const btnDisable = $('btn-disable-remote');
  if (!chkEnabled) return;

  let _status = null;
  let _pollTimer = null;

  const qrImg = $('remote-qrcode');
  const qrEmpty = $('remote-qr-empty');
  let _lastQrKey = '';

  function refreshQrcode(force) {
    if (!qrImg || !qrEmpty) return;
    const s = _status || {};
    if (!s.enabled || !s.url) {
      qrImg.removeAttribute('src');
      qrImg.style.display = 'none';
      qrEmpty.style.display = '';
      qrEmpty.textContent = '遥控未启用';
      _lastQrKey = '';
      return;
    }
    // 用 token 指纹判断是否需要重新拉取：token 变了才换 src，避免每次轮询都刷
    const key = s.token || s.url;
    if (!force && key === _lastQrKey && qrImg.getAttribute('src')) return;
    _lastQrKey = key;
    qrImg.style.display = 'block';
    qrEmpty.style.display = 'none';
    qrImg.src = `${API_BASE}/remote/qrcode?ts=${Date.now()}`;
    qrImg.onerror = () => {
      qrImg.style.display = 'none';
      qrEmpty.style.display = '';
      qrEmpty.textContent = '二维码加载失败';
    };
  }

  function render() {
    const s = _status || {};
    chkEnabled.checked = !!s.enabled;
    if (s.enabled && s.url) {
      urlGroup.style.display = '';
      actionsGroup.style.display = '';
      urlInput.value = s.url;
    } else {
      urlGroup.style.display = 'none';
      actionsGroup.style.display = 'none';
      urlInput.value = '';
    }
    connectedEl.textContent = String(s.connected_remotes || 0);
    refreshQrcode(false);
  }

  async function refresh() {
    try {
      const r = await fetch(`${API_BASE}/remote/status`);
      _status = await r.json();
      render();
    } catch (e) { /* 后端未就绪，忽略 */ }
  }

  async function enable() {
    try {
      const r = await fetch(`${API_BASE}/remote/enable`, { method: 'POST' });
      _status = await r.json();
      render();
      refreshQrcode(true);
      setStats('遥控已启用');
      if (!_status.lan_ip) {
        showWarn('未检测到局域网 IP',
          '无法自动获取本机局域网 IP。请检查网络连接，或手动查看 ipconfig 后在手机浏览器输入地址。');
      }
    } catch (e) {
      setStats('启用失败：' + e.message);
      chkEnabled.checked = false;
    }
  }

  async function disable() {
    try {
      const r = await fetch(`${API_BASE}/remote/disable`, { method: 'POST' });
      _status = await r.json();
      render();
      setStats('遥控已关闭');
    } catch (e) {
      setStats('关闭失败：' + e.message);
    }
  }

  chkEnabled.addEventListener('change', () => {
    if (chkEnabled.checked) enable();
    else disable();
  });

  btnCopy.addEventListener('click', () => {
    const v = urlInput.value;
    if (!v) return;
    try {
      require('electron').clipboard.writeText(v);
      setStats('已复制到剪贴板');
    } catch (e) {
      urlInput.select();
      document.execCommand('copy');
      setStats('已复制');
    }
  });

  btnRotate.addEventListener('click', async () => {
    const ok = await promptConfirm('重置 Token', '这会立即断开所有已连接的手机，并生成新链接。确定继续？');
    if (!ok) return;
    try {
      const r = await fetch(`${API_BASE}/remote/rotate`, { method: 'POST' });
      _status = await r.json();
      render();
      refreshQrcode(true);
      setStats('Token 已重置');
    } catch (e) {
      setStats('重置失败：' + e.message);
    }
  });

  btnDisable.addEventListener('click', async () => {
    const ok = await promptConfirm('关闭遥控', '关闭后手机将无法访问，所有连接会被断开。确定继续？');
    if (!ok) return;
    await disable();
  });

  // 打开设置弹窗时刷新一次；弹窗打开期间每 3 秒刷新一次在线数
  const settingsModalEl = $('settings-modal');
  const observer = new MutationObserver(() => {
    const open = settingsModalEl.classList.contains('show');
    if (open) {
      refresh();
      if (!_pollTimer) {
        _pollTimer = setInterval(refresh, 3000);
      }
    } else if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  });
  observer.observe(settingsModalEl, { attributes: true, attributeFilter: ['class'] });
})();

// ============================================================
// 设置管理：导出 / 导入 / 重置
// ============================================================
(function initSettingsManagement() {
  const exportBtn = $('settings-export-btn');
  const importBtn = $('settings-import-btn');
  const resetBackendBtn = $('settings-reset-backend-btn');
  const resetFrontendBtn = $('settings-reset-frontend-btn');

  // ---------- 导出设置 ----------
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      if (!win || !dialog || !fs) { setStats('导出设置需要 Electron 环境'); return; }
      exportBtn.disabled = true;
      try {
        const result = await dialog.showSaveDialog({
          title: '导出设置',
          defaultPath: `cyy-settings-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: 'JSON 文件', extensions: ['json'] }],
        });
        if (result.canceled || !result.filePath) return;
        // 从后端拉最新设置，避免与前端缓存不一致
        const current = await fetch(`${API_BASE}/settings`).then(r => r.json());
        fs.writeFileSync(result.filePath, JSON.stringify(current, null, 2), 'utf-8');
        setStats(`设置已导出: ${result.filePath}`);
      } catch (e) {
        setStats(`导出失败: ${e.message}`);
      } finally {
        exportBtn.disabled = false;
      }
    });
  }

  // ---------- 导入设置 ----------
  if (importBtn) {
    importBtn.addEventListener('click', async () => {
      if (!win || !dialog || !fs) { setStats('导入设置需要 Electron 环境'); return; }
      importBtn.disabled = true;
      try {
        const result = await dialog.showOpenDialog({
          title: '导入设置',
          filters: [{ name: 'JSON 文件', extensions: ['json'] }],
          properties: ['openFile'],
        });
        if (result.canceled || !result.filePaths.length) return;

        const content = fs.readFileSync(result.filePaths[0], 'utf-8');
        let parsed;
        try {
          parsed = JSON.parse(content);
        } catch (e) {
          showWarn('导入失败', 'JSON 格式无效：' + e.message);
          return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          showWarn('导入失败', '设置文件必须是一个 JSON 对象。');
          return;
        }

        const ok = await promptConfirm(
          '导入设置',
          '导入将覆盖当前所有设置（搜索源、下载、主题、EQ 等），并立即生效。\n\n确定继续？'
        );
        if (!ok) return;

        const resp = await fetch(`${API_BASE}/settings/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: parsed }),
        });
        if (!resp.ok) {
          let msg = `HTTP ${resp.status}`;
          try { const j = await resp.json(); if (j && j.detail) msg = j.detail; } catch (e) {}
          throw new Error(msg);
        }
        const data = await resp.json();
        // 用后端返回的完整设置更新前端缓存与 UI
        state.settings = data.settings || parsed;
        state.eq = state.settings.eq || defaultEq();
        if (state.eq.vocal_cancel_amount == null) state.eq.vocal_cancel_amount = 100;
        applySettingsToUI(state.settings);
        if (typeof syncEqUI === 'function') syncEqUI();
        if (typeof applyEqToGraph === 'function') applyEqToGraph();
        if (typeof refreshDynamicTheme === 'function') {
          try { refreshDynamicTheme(); } catch (e) {}
        }
        setStats('设置已导入并生效');
      } catch (e) {
        setStats(`导入失败: ${e.message}`);
        showWarn('导入失败', String(e.message || e));
      } finally {
        importBtn.disabled = false;
      }
    });
  }

  // ---------- 重置后端设置 ----------
  if (resetBackendBtn) {
    resetBackendBtn.addEventListener('click', async () => {
      const ok = await promptConfirm(
        '重置后端设置',
        '将把 config.json 恢复为默认值（搜索源、下载、主题、EQ 等全部重置），并立即生效。\n\n确定继续？'
      );
      if (!ok) return;
      resetBackendBtn.disabled = true;
      try {
        const resp = await fetch(`${API_BASE}/settings/reset`, { method: 'POST' });
        if (!resp.ok) {
          let msg = `HTTP ${resp.status}`;
          try { const j = await resp.json(); if (j && j.detail) msg = j.detail; } catch (e) {}
          throw new Error(msg);
        }
        const data = await resp.json();
        state.settings = data.settings;
        state.eq = state.settings.eq || defaultEq();
        if (state.eq.vocal_cancel_amount == null) state.eq.vocal_cancel_amount = 100;
        applySettingsToUI(state.settings);
        if (typeof syncEqUI === 'function') syncEqUI();
        if (typeof applyEqToGraph === 'function') applyEqToGraph();
        if (typeof refreshDynamicTheme === 'function') {
          try { refreshDynamicTheme(); } catch (e) {}
        }
        setStats('后端设置已重置为默认值');
      } catch (e) {
        setStats(`重置失败: ${e.message}`);
      } finally {
        resetBackendBtn.disabled = false;
      }
    });
  }

  // ---------- 重置前端设置 ----------
  if (resetFrontendBtn) {
    resetFrontendBtn.addEventListener('click', async () => {
      const ok = await promptConfirm(
        '重置前端设置',
        '将清除本地界面状态（歌词面板折叠状态、窗口位置等），并重新加载界面。\n\n确定继续？'
      );
      if (!ok) return;
      resetFrontendBtn.disabled = true;
      try {
        // 1) 清 localStorage 里本项目使用的 key
        const FRONTEND_KEYS = [
          'cmc_lyric_collapsed',   // 歌词面板折叠状态
          'cmc_lyric_width',       // 歌词面板宽度
        ];
        FRONTEND_KEYS.forEach(k => {
          try { localStorage.removeItem(k); } catch (e) {}
        });

        // 2) 清主进程保存的窗口位置
        if (ipcRenderer) {
          try { await ipcRenderer.invoke('reset-window-state'); } catch (e) {}
        }

        setStats('前端设置已重置，即将重新加载...');
        setTimeout(() => {
          try { location.reload(); } catch (e) {}
        }, 400);
      } catch (e) {
        setStats(`重置失败: ${e.message}`);
        resetFrontendBtn.disabled = false;
      }
    });
  }
})();