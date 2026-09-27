// ==================== 迷你播放器渲染进程 ====================
const { ipcRenderer } = require('electron');

// ---------- 打开动画触发 ----------
document.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.add('loaded');
    });
  });
});

// ---------- 关闭动画（先播动画，再真正关闭窗口） ----------
let _closing = false;
function closeWithAnimation() {
  if (_closing) return;
  _closing = true;
  document.body.classList.add('closing');
  // 动画时长 180ms，稍多留 40ms 冗余，避免动画被截断
  setTimeout(() => {
    ipcRenderer.send('close-mini-player');
  }, 220);
}

const $ = (id) => document.getElementById(id);
const cover = $('mini-cover');
const title = $('mini-title');
const slider = $('mini-slider');
const timeLabel = $('mini-time');
const btnPlay = $('mini-btn-play');
const btnPrev = $('mini-btn-prev');
const btnNext = $('mini-btn-next');
const btnClose = $('mini-btn-close');
const btnExpand = $('mini-btn-expand');

const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m7 4 13 8-13 8V4z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z"/></svg>';

const state = {
  song_name: '',
  cover: '',
  playing: false,
  paused: false,
  position: 0,
  duration: 0,
  hasTrack: false,
  primary: '#38BDF8',
  theme: 'light',
};

let seeking = false;
let lastCoverUrl = null;

function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function render() {
  // 标题
  title.textContent = state.song_name || '未播放';

  // 封面（只在 URL 变化时更新，避免闪烁）
  if (state.cover !== lastCoverUrl) {
    lastCoverUrl = state.cover;
    if (state.cover) {
      cover.style.backgroundImage = `url('${state.cover.replace(/'/g, "\\'")}')`;
      cover.classList.remove('no-cover');
    } else {
      cover.style.backgroundImage = '';
      cover.classList.add('no-cover');
    }
  }

  // 播放按钮
  btnPlay.innerHTML = (state.playing && !state.paused) ? PAUSE_SVG : PLAY_SVG;

  // 进度
  if (!seeking) {
    const dur = state.duration || 0;
    slider.max = dur;
    slider.value = Math.min(state.position || 0, dur || 0);
  }
  if (state.duration > 0) {
    timeLabel.textContent = `${formatTime(state.position)} / ${formatTime(state.duration)}`;
  } else {
    timeLabel.textContent = '--:-- / --:--';
  }

  // 主题
  if (state.primary) {
    document.documentElement.style.setProperty('--primary', state.primary);
  }
  document.documentElement.dataset.theme = state.theme === 'dark' ? 'dark' : 'light';
}

// ---------- 接收主窗口状态 ----------
ipcRenderer.on('player-state', (_evt, payload) => {
  if (!payload) return;
  Object.assign(state, payload);
  render();
});

// 打开时主动拉取当前状态
ipcRenderer.invoke('get-player-state').then((s) => {
  if (s) { Object.assign(state, s); }
  render();
}).catch(() => render());

// ---------- 按钮事件 ----------
function send(type, extra) {
  ipcRenderer.send('mini-action', Object.assign({ type }, extra || {}));
}

const btnDesktopLyric = $('mini-btn-desktop-lyric');

btnPlay.addEventListener('click', () => send('toggle'));
btnPrev.addEventListener('click', () => send('prev'));
btnNext.addEventListener('click', () => send('next'));
if (btnDesktopLyric) {
  btnDesktopLyric.addEventListener('click', () => send('toggle-desktop-lyric'));
}
btnClose.addEventListener('click', closeWithAnimation);
btnExpand.addEventListener('click', () => {
  ipcRenderer.send('show-main-window');
  closeWithAnimation();
});

// ---------- 进度条 ----------
slider.addEventListener('pointerdown', () => { seeking = true; });
slider.addEventListener('input', () => {
  const v = parseFloat(slider.value) || 0;
  if (state.duration > 0) {
    timeLabel.textContent = `${formatTime(v)} / ${formatTime(state.duration)}`;
  }
});
slider.addEventListener('change', () => {
  seeking = false;
  send('seek', { value: parseFloat(slider.value) || 0 });
});

// ---------- 键盘快捷键（在迷你窗口聚焦时生效） ----------
document.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault();
    send('toggle');
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    send('prev');
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    send('next');
  } else if (e.key === 'Escape') {
    closeWithAnimation();
  }
});

render();