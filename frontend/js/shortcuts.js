// ==================== 全局键盘快捷键 ====================
// 默认键位；输入框/可编辑元素聚焦时不响应。
(function () {
  const SHORTCUTS = {
    'Space': 'toggle',
    'ArrowLeft': 'seekBack',
    'ArrowRight': 'seekForward',
    'Ctrl+ArrowLeft': 'prev',
    'Ctrl+ArrowRight': 'next',
    'ArrowUp': 'volUp',
    'ArrowDown': 'volDown',
    'KeyF': 'fullLyrics',
    'KeyL': 'desktopLyric',
    'KeyV': 'viz',
    'KeyM': 'mute',
    'Escape': 'escape',
  };

  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function comboOf(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    parts.push(e.code || e.key);
    return parts.join('+');
  }

  // 统一设置音量：主音量条、播放器、可视化音量条、迷你窗口全部同步
  function setGlobalVolume(v) {
    v = Math.max(0, Math.min(100, v | 0));
    volumeSlider.value = v;
    audioPlayer.volume = v / 100;
    if (typeof vizVolumeSlider !== 'undefined' && vizVolumeSlider) {
      vizVolumeSlider.value = v;
    }
    // 迷你窗口通过 reportPlayerState 广播（若未定义则忽略）
    if (typeof reportPlayerState === 'function') {
      try { reportPlayerState(true); } catch (e) {}
    }
    persistSetting({ volume: v });
  }

  const actions = {
    toggle() {
      if (audioPlayer.src) togglePlay();
      else if (state.playlist.length) playCurrent();
    },
    seekBack() {
      if (!audioPlayer.src) return;
      applySeek((state.seekBase || 0) + audioPlayer.currentTime - 5);
    },
    seekForward() {
      if (!audioPlayer.src) return;
      applySeek((state.seekBase || 0) + audioPlayer.currentTime + 5);
    },
    prev() { playPrev(); },
    next() { playNext(); },
    volUp() {
      const v = Math.min(100, (parseInt(volumeSlider.value, 10) || 0) + 5);
      setGlobalVolume(v);
    },
    volDown() {
      const v = Math.max(0, (parseInt(volumeSlider.value, 10) || 0) - 5);
      setGlobalVolume(v);
    },
    mute() {
      audioPlayer.muted = !audioPlayer.muted;
      setStats(audioPlayer.muted ? '已静音（按 M 取消）' : '取消静音');
    },
    fullLyrics() { toggleFullLyrics(); },
    desktopLyric() { if (ipcRenderer) ipcRenderer.send('toggle-desktop-lyric'); },
    viz() { if (state.vizOpen) closeViz(); else openViz(); },
    escape() {
      const modals = document.querySelectorAll('.modal-mask.show');
      if (modals.length) {
        modals[modals.length - 1].classList.remove('show');
        return;
      }
      if (state.lyricsOpen) { closeFullLyrics(); return; }
      if (state.vizOpen) closeViz();
    },
  };

  document.addEventListener('keydown', (e) => {
    if (isEditable(e.target)) return;
    const action = SHORTCUTS[comboOf(e)];
    if (!action) return;
    const fn = actions[action];
    if (typeof fn !== 'function') return;
    if (e.code === 'Space' || (e.code && e.code.startsWith('Arrow'))) {
      e.preventDefault();
    }
    try { fn(); } catch (err) { console.error('快捷键执行失败:', err); }
  });
})();