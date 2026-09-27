// ==================== 全屏歌词覆盖层 ====================
// 与 viz-overlay 并列，复用 .show / scale 动画；打开时会关闭 viz，反之亦然。

const lyricsOverlay = $('lyrics-overlay');
const lyricsOverlayBg = $('lyrics-overlay-bg');
const lyricsOverlayTitle = $('lyrics-overlay-title');
const lyricsOverlayCover = $('lyrics-overlay-cover');
const lyricsOverlayLines = $('lyrics-overlay-lines');
const lyricsOverlayTime = $('lyrics-overlay-time');
const lyricsOverlayPlayBtn = $('lyrics-overlay-play');

const LYRIC_PLAY_SVG = '<svg class="ic"><use href="#i-play"/></svg>';
const LYRIC_PAUSE_SVG = '<svg class="ic"><use href="#i-pause"/></svg>';

state.lyricsOpen = false;
let _lyricsLastLineIdx = -1;
let _lyricsLastCoverUrl = '';

function openFullLyrics() {
  if (state.lyricsOpen) return;
  if (state.vizOpen) closeViz();
  document.body.classList.add('lyrics-mode');
  lyricsOverlay.classList.add('show');
  state.lyricsOpen = true;
  _lyricsLastLineIdx = -1;
  _lyricsLastCoverUrl = '';
  renderFullLyrics();
  renderFullLyricsCover();
  syncFullLyricsTitle();
  setStats('全屏歌词已打开');
}

function closeFullLyrics() {
  if (!state.lyricsOpen) return;
  lyricsOverlay.classList.remove('show');
  document.body.classList.remove('lyrics-mode');
  state.lyricsOpen = false;
}

function toggleFullLyrics() {
  if (state.lyricsOpen) closeFullLyrics();
  else openFullLyrics();
}

function syncFullLyricsTitle() {
  if (!lyricsOverlayTitle) return;
  lyricsOverlayTitle.textContent = nowPlayingText.textContent || 'cYy Music · 歌词';
}

function renderFullLyricsCover() {
  if (!lyricsOverlayCover) return;
  const url = state.currentCoverUrl || '';
  if (url === _lyricsLastCoverUrl) return;
  _lyricsLastCoverUrl = url;
  if (url) {
    lyricsOverlayCover.style.backgroundImage = `url('${url}')`;
    lyricsOverlayCover.classList.remove('no-cover');
    if (lyricsOverlayBg) lyricsOverlayBg.style.backgroundImage = `url('${url}')`;
  } else {
    lyricsOverlayCover.style.backgroundImage = '';
    lyricsOverlayCover.classList.add('no-cover');
    if (lyricsOverlayBg) lyricsOverlayBg.style.backgroundImage = '';
  }
}

function forceRenderFullLyricsCover() {
  _lyricsLastCoverUrl = '';
  renderFullLyricsCover();
}

function renderFullLyrics() {
  if (!lyricsOverlayLines) return;
  const lyrics = state.currentLyrics || [];
  lyricsOverlayLines.innerHTML = '';
  if (!lyrics.length) {
    lyricsOverlayLines.innerHTML = '<div class="lyric-empty">暂无歌词</div>';
    _lyricsLastLineIdx = -1;
    return;
  }
  const frag = document.createDocumentFragment();
  lyrics.forEach((l, i) => {
    const div = document.createElement('div');
    div.className = 'lyric-line';
    div.dataset.i = String(i);
    div.textContent = l.text;
    div.addEventListener('click', () => {
      state.dragging = false;
      applySeek(l.time);
    });
    frag.appendChild(div);
  });
  lyricsOverlayLines.appendChild(frag);
  _lyricsLastLineIdx = -1;
  updateFullLyricsLine();
}

function updateFullLyricsLine() {
  if (!state.lyricsOpen || !lyricsOverlayLines) return;
  const idx = state.currentLyricIndex;
  if (idx === _lyricsLastLineIdx) return;
  const prev = _lyricsLastLineIdx >= 0
    ? lyricsOverlayLines.querySelector(`.lyric-line[data-i="${_lyricsLastLineIdx}"]`)
    : null;
  if (prev) prev.classList.remove('active');
  if (idx >= 0) {
    const cur = lyricsOverlayLines.querySelector(`.lyric-line[data-i="${idx}"]`);
    if (cur) {
      cur.classList.add('active');
      const elTop = cur.offsetTop;
      const target = elTop - lyricsOverlayLines.clientHeight / 2 + cur.clientHeight / 2;
      lyricsOverlayLines.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  }
  _lyricsLastLineIdx = idx;
}

function syncFullLyricsPlayBtn() {
  if (!lyricsOverlayPlayBtn) return;
  lyricsOverlayPlayBtn.innerHTML = (state.playing && !state.paused)
    ? LYRIC_PAUSE_SVG
    : LYRIC_PLAY_SVG;
}

// 由 player.js 的 timeupdate 调用
function updateFullLyricsTime() {
  if (!state.lyricsOpen || !lyricsOverlayTime) return;
  const cur = (state.seekBase || 0) + (audioPlayer.currentTime || 0);
  const total = state.currentDuration || 0;
  lyricsOverlayTime.textContent = total > 0
    ? `${formatTime(Math.min(cur, total))} / ${formatTime(total)}`
    : `${formatTime(cur)} / --:--`;
}

// 由 player.js 的 doPlay / stopPlayback 调用
function onTrackChanged() {
  syncFullLyricsTitle();
  renderFullLyricsCover();
  renderFullLyrics();
  syncFullLyricsPlayBtn();
}

// ---------- 事件绑定 ----------
$('lyrics-overlay-close').addEventListener('click', closeFullLyrics);
$('lyrics-overlay-min').addEventListener('click', () => { if (win) win.minimize(); });
$('lyrics-overlay-max').addEventListener('click', toggleWindowMaximize);
$('lyrics-overlay-prev').addEventListener('click', () => { playPrev(); onTrackChanged(); });
$('lyrics-overlay-next').addEventListener('click', () => { playNext(); onTrackChanged(); });
$('lyrics-overlay-stop').addEventListener('click', () => { stopPlayback(); });
lyricsOverlayPlayBtn.addEventListener('click', () => {
  togglePlay();
  syncFullLyricsPlayBtn();
});

// 点击歌词区空白处不关闭，避免误触；按 Esc 由 shortcuts.js 处理