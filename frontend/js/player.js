// ==================== 歌词解析与播放控制 ====================

// ==================== 迷你播放器：状态上报 & 动作接收 ====================
let _lastReportTs = 0;
let _lastBackendReportTs = 0;
const _REPORT_INTERVAL = 400;
const _BACKEND_REPORT_INTERVAL = 800;   // HTTP 上报更慢一些，减少网络请求

// ---------- 播放列表摘要缓存（供遥控端使用，避免每次上报都重建） ----------
let _playlistBriefCache = null;
let _playlistBriefList = null;
let _playlistBriefLen = -1;

function _getPlaylistBrief() {
  const list = state.playlist;
  if (_playlistBriefCache && _playlistBriefList === list && _playlistBriefLen === list.length) {
    return _playlistBriefCache;
  }
  _playlistBriefList = list;
  _playlistBriefLen = list.length;
  _playlistBriefCache = list.slice(0, 500).map(s => ({
    name: (s && s.song_name) || '',
    singer: (s && s.singers) || '',
  }));
  return _playlistBriefCache;
}

function _buildStatePayload() {
  let primary = '#38BDF8';
  try {
    primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || primary;
  } catch (e) {}
  const cur = state.playlist[state.currentIndex] || {};
  return {
    song_name: nowPlayingText.textContent || '',
    singers: cur.singers || '',
    cover: state.currentCoverUrl || '',
    playing: !!state.playing,
    paused: !!state.paused,
    position: (state.seekBase || 0) + (audioPlayer.currentTime || 0),
    duration: state.currentDuration || 0,
    hasTrack: !!audioPlayer.src,
    volume: parseInt(volumeSlider.value, 10) || 0,
    primary: primary,
    theme: document.documentElement.dataset.theme || 'light',
    // 完整歌词：始终附带。
    // 之前为省 IPC 流量做了"仅在引用变化时附带"的优化，但会导致：
    // 主窗口第一次播放后，后续 payload 省略 lyrics 并覆盖主进程缓存；
    // 桌面歌词窗口打开时从缓存拉取 → 无 lyrics → 永远显示"暂无歌词"。
    // IPC payload ~45KB，每秒 ~2.5 次 → 约 110KB/s 进程内拷贝，
    // 现代硬件上开销可忽略，换稳定可靠。
    lyrics: state.currentLyrics || [],
    currentLine: state.currentLyricIndex,
    playlist: _getPlaylistBrief(),
    currentIndex: state.currentIndex,
    playMode: parseInt(playmodeSelect.value, 10) || 0,
  };
}

// ---------- 遥控端专用精简 payload：只发当前行 + 下一行歌词 ----------
function _buildRemotePayload(full) {
  const lyr = state.currentLyrics || [];
  const idx = state.currentLyricIndex;
  let curText = '', nextText = '';
  if (idx >= 0 && idx < lyr.length) {
    curText = lyr[idx].text || '';
    if (idx + 1 < lyr.length) nextText = lyr[idx + 1].text || '';
  }
  return {
    song_name: full.song_name,
    singers: full.singers,
    cover: full.cover,
    playing: full.playing,
    paused: full.paused,
    position: full.position,
    duration: full.duration,
    hasTrack: full.hasTrack,
    volume: full.volume,
    primary: full.primary,
    theme: full.theme,
    currentLine: idx,
    lyricCurrent: curText,
    lyricNext: nextText,
    playlist: full.playlist,
    currentIndex: full.currentIndex,
    playMode: full.playMode,
  };
}

function reportPlayerState(force = false) {
  const now = Date.now();
  const payload = _buildStatePayload();

  // 1) IPC 到 Electron 主进程（迷你窗口、桌面歌词）
  if (ipcRenderer && (force || now - _lastReportTs >= _REPORT_INTERVAL)) {
    _lastReportTs = now;
    ipcRenderer.send('player-state-update', payload);
  }

  // 2) HTTP 到后端（手机遥控端）—— 精简 payload，避免每 800ms 上传完整歌词
  if (force || now - _lastBackendReportTs >= _BACKEND_REPORT_INTERVAL) {
    _lastBackendReportTs = now;
    try {
      const brief = _buildRemotePayload(payload);
      fetch(`${API_BASE}/player_state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(brief),
      }).catch(() => {});
    } catch (e) {}
  }
}
// 动作分派（IPC 和 WS remote_action 共用）
function handlePlayerAction(action) {
  if (!action || !action.type) return;
  switch (action.type) {
    case 'toggle':
      togglePlay();
      break;
    case 'prev':
      playPrev();
      break;
    case 'next':
      playNext();
      break;
    case 'stop':
      stopPlayback();
      break;
    case 'seek':
      applySeek(parseFloat(action.value) || 0);
      break;
    case 'set-volume': {
      const v = Math.max(0, Math.min(100, parseInt(action.value, 10) || 0));
      volumeSlider.value = v;
      audioPlayer.volume = v / 100;
      if (typeof vizVolumeSlider !== 'undefined' && vizVolumeSlider) vizVolumeSlider.value = v;
      persistSetting({ volume: v });
      break;
    }
    case 'seek-relative': {
      if (!audioPlayer.src) break;
      const delta = parseFloat(action.value) || 0;
      const cur = (state.seekBase || 0) + (audioPlayer.currentTime || 0);
      applySeek(Math.max(0, cur + delta));
      break;
    }
    case 'set-mode': {
      const v = Math.max(0, Math.min(3, parseInt(action.value, 10) || 0));
      playmodeSelect.value = String(v);
      if (typeof settingPlaymode !== 'undefined' && settingPlaymode) {
        settingPlaymode.value = String(v);
      }
      if (typeof vizPlaymodeSelect !== 'undefined' && vizPlaymodeSelect) {
        vizPlaymodeSelect.value = String(v);
      }
      persistSetting({ play_mode: v });
      break;
    }
    case 'play-index': {
      const idx = parseInt(action.value, 10);
      if (Number.isFinite(idx) && idx >= 0 && idx < state.playlist.length) {
        state.currentIndex = idx;
        playCurrent();
      }
      break;
    }
  }
}

// 接收迷你窗口发来的动作
if (ipcRenderer) {
  ipcRenderer.on('player-action', (_evt, action) => handlePlayerAction(action));

  // 迷你窗口刚打开时主进程会通知，立即上报一次（含主题）
  ipcRenderer.on('mini-opened', () => reportPlayerState(true));
  ipcRenderer.on('mini-state-changed', (_evt, data) => {
    const btn = document.getElementById('btn-mini');
    if (btn) btn.classList.toggle('active', !!(data && data.open));
  });
}

// 主题变化时同步给迷你窗口（applyTheme 之后调用）
function notifyThemeChanged() {
  reportPlayerState(true);
}

// ---------- 歌词渲染（主界面 + 可视化） ----------
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
  // 全屏歌词覆盖层同步
  if (state.lyricsOpen && typeof updateFullLyricsLine === 'function') {
    updateFullLyricsLine();
  }
}

// ---------- 播放控制 ----------
async function playCurrent() {
  if (state.currentIndex < 0 || state.currentIndex >= state.playlist.length) { stopPlayback(); return; }
  const song = state.playlist[state.currentIndex];

  // 本地文件：URL 由本地库直接提供，无需（也无法）通过搜索源刷新
  if (song.source === 'LocalLibrary') {
    if (!song.download_url) {
      setStats('本地文件路径丢失');
      showWarn('播放失败', '本地文件路径无效，请重新扫描本地库。');
      stopPlayback();
      return;
    }
    doPlay(song);
    return;
  }

  // 在线歌曲：先刷新链接
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

// ==================== 实际播放格式标签 ====================
// 后端 /stream/codec 返回实际会使用的编码（直传 ext 或转码 mp3）。
// 由于 <audio> 无法读取响应头，只能通过这个轻量查询接口获取。
function setCodecLabel(codec) {
  const text = (codec || '--').toString().toUpperCase();
  if (labelCodec) labelCodec.textContent = text;
  if (labelCodecViz) labelCodecViz.textContent = text;
}

async function refreshCodecLabel(song, ext, start, token) {
  // token 用于防止切歌时旧查询结果覆盖新歌标签
  const hasToken = (token !== undefined && token !== null);
  const isStale = () => hasToken && token !== state.codecToken;

  // 本地文件：后端不参与，直接显示扩展名
  if (song && song.source === 'LocalLibrary') {
    if (isStale()) return;
    setCodecLabel(ext);
    return;
  }
  try {
    const params = new URLSearchParams({
      ext: ext || 'mp3',
      quality: 'auto',
      start: String(start || 0),
    });
    const r = await fetch(`${API_BASE}/stream/codec?${params}`);
    if (isStale()) return;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (isStale()) return;
    setCodecLabel(data.codec || ext);
  } catch (e) {
    if (isStale()) return;
    // 查询失败：回退到扩展名，不让 UI 挂掉
    setCodecLabel(ext);
  }
}

function doPlay(song) {
  ensureAudioGraph();
  const url = song.download_url;
  if (!url) return;
  const ext = (song.ext || 'mp3').toLowerCase();
  // 递增 codec token，使任何进行中的旧查询失效
  state.codecToken = (state.codecToken || 0) + 1;
  const myCodecToken = state.codecToken;
  // 先用扩展名占位，随即异步查询后端实际格式并覆盖
  setCodecLabel(ext);
  refreshCodecLabel(song, ext, 0, myCodecToken);
  // 本地文件直接使用后端 /library/file（FileResponse 原生支持 Range seek）；
  // 在线歌曲走 /stream 智能代理或 ffmpeg 转码
  if (song.source === 'LocalLibrary') {
    audioPlayer.src = url;
  } else {
    audioPlayer.src = `${API_BASE}/stream?url=${encodeURIComponent(url)}&source=${encodeURIComponent(song.source || '')}&ext=${encodeURIComponent(ext)}`;
  }
  audioPlayer.volume = volumeSlider.value / 100;
  audioPlayer.playbackRate = parseFloat(speedSelect.value) || 1;
  audioPlayer.preservesPitch = true;   // 变速不变调
  audioPlayer.play().catch(err => console.error('播放失败:', err));
  state.seekBase = 0;
  state.currentDuration = parseDurationSec(song);
  positionSlider.max = state.currentDuration || 0;
  positionSlider.value = 0;
  labelTime.textContent = state.currentDuration ? `00:00 / ${formatTime(state.currentDuration)}` : '00:00 / --:--';
  nowPlayingText.textContent = `${song.singers || ''} - ${song.song_name || ''}`;
  setBtnIcon(btnPlay, 'pause');
  btnPlay.classList.add('playing');
  state.playing = true;
  state.paused = false;
  const lyricText = song.lyric || song.lyrics || '';
  state.currentLyrics = lyricText ? parseLrc(lyricText) : [];
  state.currentLyricIndex = -1;
  renderLyrics();
  const cu = coverUrl(song);
  state.currentCoverUrl = cu;

  // 阶段 2：封面驱动动态主题（异步取色，token 防乱序）
  if (typeof setActiveCover === 'function') {
    if (cu) setActiveCover(cu);
    else if (typeof revertToBaseTheme === 'function') revertToBaseTheme();
  }
  playerCover.innerHTML = cu
    ? `<img src="${cu}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;" onerror="this.style.display='none'">`
    : IC('music');

  if (cu && !cu.startsWith('data:')) {
    // 用 token 标识"本次封面预检"，任何新的 doPlay 都会使旧 token 失效
    state.coverToken = (state.coverToken || 0) + 1;
    const myToken = state.coverToken;
    const _probe = new Image();
    _probe.onerror = () => {
      if (myToken !== state.coverToken) return;   // 已被新的播放事件取代
      const smart = smartCoverUrl(song);
      if (!smart || smart === cu) return;
      state.currentCoverUrl = smart;
      const img = playerCover.querySelector('img');
      if (img) img.src = smart;
      if (state.lyricsOpen && typeof forceRenderFullLyricsCover === 'function') {
        forceRenderFullLyricsCover();
      }
      if (state.vizOpen && typeof updateVizCover === 'function') {
        updateVizCover();
      }
      reportPlayerState(true);
    };
    _probe.src = cu;
  }
  if (state.vizOpen) {
    updateVizCover();
    syncVizUI();
  }
  renderPlaylist();
  setStats(`正在播放: ${song.song_name || ''}`);
  reportPlayerState(true);
  if (typeof onTrackChanged === 'function') {
    try { onTrackChanged(); } catch (e) {}
  }
}

function togglePlay() {
  if (audioPlayer.paused && audioPlayer.src) {
    ensureAudioGraph();
    audioPlayer.play();
    setBtnIcon(btnPlay, 'pause');
    btnPlay.classList.add('playing');
    state.playing = true; state.paused = false;
  } else if (!audioPlayer.paused) {
    audioPlayer.pause();
    setBtnIcon(btnPlay, 'play');
    btnPlay.classList.remove('playing');
    state.playing = false; state.paused = true;
  } else {
    playCurrent();
  }
  if (state.vizOpen) syncVizUI();
  if (state.lyricsOpen && typeof syncFullLyricsPlayBtn === 'function') {
    syncFullLyricsPlayBtn();
  }
  reportPlayerState(true);
}

function stopPlayback() {
  audioPlayer.pause();
  audioPlayer.removeAttribute('src');
  audioPlayer.load();
  state.playing = false;
  state.paused = false;
  setBtnIcon(btnPlay, 'play');
  btnPlay.classList.remove('playing');
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
  if (state.vizOpen) {
    updateVizCover();
    syncVizUI();
  }
  renderPlaylist();
  reportPlayerState(true);

  // 阶段 2：停止播放，回落到用户设置主题
  if (typeof revertToBaseTheme === 'function') revertToBaseTheme();
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
  if (mode === 0) {
    playCurrent();
  } else if (mode === 1) {
    // 修复 B1：stopPlayback 内部会把 nowPlayingText 设为"未播放"，
    // 必须在 stopPlayback 之后再设置"播放结束"，否则会被覆盖。
    stopPlayback();
    nowPlayingText.textContent = '播放结束';
  } else if (mode === 2) {
    state.currentIndex = (state.currentIndex + 1) % state.playlist.length;
    playCurrent();
  } else {
    if (state.currentIndex >= state.playlist.length - 1) {
      stopPlayback();
      nowPlayingText.textContent = '列表播放结束';
    } else {
      state.currentIndex += 1;
      playCurrent();
    }
  }
}

// ---------- 拖动进度条 ----------
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
  const seekTo = Math.max(0, Math.floor(sec));
  const u = new URL(src);
  u.searchParams.set('start', String(seekTo));
  state.seekBase = seekTo;
  audioPlayer.src = u.toString();
  audioPlayer.play().catch(() => {});
  setBtnIcon(btnPlay, 'pause');
  btnPlay.classList.add('playing');
  state.playing = true; state.paused = false;
  if (state.currentDuration > 0) {
    positionSlider.max = state.currentDuration;
    positionSlider.value = Math.min(sec, state.currentDuration);
    labelTime.textContent = `${formatTime(Math.min(sec, state.currentDuration))} / ${formatTime(state.currentDuration)}`;
  }
  // seek 后必然走转码路径，同步刷新格式标签（这是原来显示会"说谎"的地方）
  const song = state.playlist[state.currentIndex];
  if (song) {
    state.codecToken = (state.codecToken || 0) + 1;
    refreshCodecLabel(song, (song.ext || 'mp3').toLowerCase(), seekTo, state.codecToken);
  }
  renderPlaylist();
}

// ---------- 播放相关事件绑定 ----------
btnPlay.addEventListener('click', togglePlay);
btnPrev.addEventListener('click', playPrev);
btnNext.addEventListener('click', playNext);
btnStop.addEventListener('click', stopPlayback);

playmodeSelect.addEventListener('change', async (e) => {
  const v = parseInt(e.target.value, 10);
  settingPlaymode.value = String(v);
  if (vizPlaymodeSelect) vizPlaymodeSelect.value = String(v);
  await persistSetting({ play_mode: v });
});

speedSelect.addEventListener('change', () => {
  const v = parseFloat(speedSelect.value) || 1;
  audioPlayer.playbackRate = v;
  persistSetting({ playback_rate: v });
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
  reportPlayerState();   // 节流上报
  if (state.lyricsOpen && typeof updateFullLyricsTime === 'function') {
    updateFullLyricsTime();
  }
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
  const v = parseInt(e.target.value, 10);
  audioPlayer.volume = v / 100;
  vizVolumeSlider.value = v;
});
volumeSlider.addEventListener('change', () => {
  persistSetting({ volume: parseInt(volumeSlider.value, 10) });
  reportPlayerState(true);
});

vizVolumeSlider.addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10);
  audioPlayer.volume = v / 100;
  volumeSlider.value = v;
});
vizVolumeSlider.addEventListener('change', () => persistSetting({ volume: parseInt(volumeSlider.value, 10) }));