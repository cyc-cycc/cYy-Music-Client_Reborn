// ==================== LRC 歌词解析（共享模块） ====================
// 被 player.js / lyrics-renderer.js / desktop-lyric-renderer.js 复用

function parseLrc(text) {
  const lyrics = [];
  // 支持 [mm:ss]、[mm:ss.x]、[mm:ss.xx]、[mm:ss.xxx]、[mm:ss:xx]
  const re = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\](.*)/;
  String(text).split('\n').forEach(line => {
    line = line.trim();
    const m = re.exec(line);
    if (m) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const msRaw = m[3];
      let ms = 0;
      if (msRaw) {
        if (msRaw.length === 1) ms = parseInt(msRaw, 10) * 100;
        else if (msRaw.length === 2) ms = parseInt(msRaw, 10) * 10;
        else ms = parseInt(msRaw, 10);
      }
      const time = min * 60 + sec + ms / 1000;
      const content = (m[4] || '').trim();
      if (content) lyrics.push({ time, text: content });
    }
  });
  lyrics.sort((a, b) => a.time - b.time);
  return lyrics;
}