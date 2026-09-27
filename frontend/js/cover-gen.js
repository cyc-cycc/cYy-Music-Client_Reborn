// ==================== 智能封面生成 ====================
// 无内嵌封面的歌曲，按 歌手|歌名 的确定性哈希生成渐变封面。
// 结果缓存在内存 Map 中，LRU 上限 300 条，超出时淘汰最早的条目。

const _smartCoverCache = new Map();
const _MAX_SMART_COVER_CACHE = 300;

function _smartCoverCacheGet(key) {
  if (!_smartCoverCache.has(key)) return undefined;
  // LRU：命中后移到末尾
  const url = _smartCoverCache.get(key);
  _smartCoverCache.delete(key);
  _smartCoverCache.set(key, url);
  return url;
}

function _smartCoverCacheSet(key, url) {
  if (_smartCoverCache.size >= _MAX_SMART_COVER_CACHE) {
    // 淘汰最旧（Map 迭代顺序为插入顺序，第一个即最旧）
    const oldestKey = _smartCoverCache.keys().next().value;
    if (oldestKey !== undefined) _smartCoverCache.delete(oldestKey);
  }
  _smartCoverCache.set(key, url);
}

function _fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function generateSmartCover(song) {
  const key = `${song.singers || ''}|${song.song_name || ''}`;
  const cached = _smartCoverCacheGet(key);
  if (cached) return cached;

  const hash = _fnv1a(key) || 0x9e3779b9;
  const hue1 = hash % 360;
  const hue2 = (hue1 + 30 + ((hash >>> 8) % 80)) % 360;

  const size = 240;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // 主渐变
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, `hsl(${hue1}, 68%, 58%)`);
  grad.addColorStop(1, `hsl(${hue2}, 72%, 42%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // 装饰圆
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 6; i++) {
    const seed = (hash >>> (i * 4)) & 0xffff;
    const r = 24 + (seed % 70);
    const x = (seed * 3) % size;
    const y = (seed * 7) % size;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 首字母
  const text = String(song.song_name || '?').trim().charAt(0).toUpperCase() || '♪';
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = `bold ${Math.round(size * 0.48)}px -apple-system, "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 12;
  ctx.fillText(text, size / 2, size / 2 + 4);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  const url = canvas.toDataURL('image/png');
  _smartCoverCacheSet(key, url);
  return url;
}