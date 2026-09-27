// ==================== 桌面歌词渲染进程 ====================
const { ipcRenderer } = require('electron');
const curEl = document.getElementById('dl-current');
const nextEl = document.getElementById('dl-next');

const state = { lyrics: [], currentLine: -1 };
let lastIdx = -1;

function update() {
  const lyrics = state.lyrics || [];
  const idx = state.currentLine;
  if (idx === lastIdx) return;
  lastIdx = idx;
  if (!lyrics.length) {
    curEl.textContent = '暂无歌词';
    curEl.classList.add('dl-empty');
    nextEl.textContent = '';
    return;
  }
  curEl.classList.remove('dl-empty');
  if (idx >= 0 && idx < lyrics.length) {
    curEl.textContent = lyrics[idx].text;
    nextEl.textContent = (idx + 1 < lyrics.length) ? lyrics[idx + 1].text : '';
  } else {
    curEl.textContent = '♪ 准备中...';
    nextEl.textContent = '';
  }
}

ipcRenderer.on('player-state', (_evt, payload) => {
  if (!payload) return;
  Object.assign(state, payload);
  update();
});

ipcRenderer.invoke('get-player-state').then((s) => {
  if (s) Object.assign(state, s);
  update();
}).catch(() => update());

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  ipcRenderer.send('desktop-lyric-context');
});

update();