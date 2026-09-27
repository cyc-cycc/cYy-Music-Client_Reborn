# -*- coding: utf-8 -*-
"""本地音乐库：扫描 / 标签读取（含编码修正）/ 歌词读取 / 元数据写入"""
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Tuple

from utils import logger
from backend import state

AUDIO_EXTS = {
    '.mp3', '.m4a', '.m4b', '.flac', '.ogg', '.opus',
    '.wav', '.aac', '.webm', '.ape', '.wma',
}

_library_cache = {'root': None, 'encoding': 'UTF-8', 'scanned_at': 0.0, 'songs': []}
_library_lock = threading.Lock()
# 串行化真正的磁盘扫描：两个并发请求同时 miss 缓存时，只扫一次
_scan_lock = threading.Lock()
_SCAN_CACHE_TTL = 30
MAX_SONGS = 20000
_SCAN_THREADS = 8    # 并发读取标签的线程数


# ---------- 编码修正 ----------
def _fix_encoding(text: str, encoding: str) -> str:
    """用指定编码重新解码被误判的字符串。
    仅在 encoding != UTF-8 且 text 能 encode('latin1') 时尝试。"""
    if not text or not encoding or encoding.upper() == 'UTF-8':
        return text
    try:
        raw = text.encode('latin1')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text
    try:
        return raw.decode(encoding)
    except (UnicodeDecodeError, LookupError):
        return text


# ---------- 标签读取辅助 ----------
def _id3_get(tags, key: str) -> str:
    try:
        items = tags.getall(key)
        if items:
            it = items[0]
            if hasattr(it, 'text') and it.text:
                return str(it.text[0])
            return str(it)
    except Exception:
        pass
    return ''


def _try_keys(tags, keys) -> str:
    for k in keys:
        try:
            v = tags.get(k)
            if v:
                if isinstance(v, (list, tuple)):
                    val = v[0]
                    if isinstance(val, tuple):
                        val = val[0]
                    return str(val)
                if isinstance(val, tuple):
                    return str(val[0])
                return str(v)
        except Exception:
            continue
    return ''


def _extract_lyrics(audio, ext: str) -> str:
    if audio is None or audio.tags is None:
        return ''
    tags = audio.tags
    try:
        if hasattr(tags, 'getall'):
            for key in ('USLT::eng', 'USLT::chi', 'USLT'):
                try:
                    items = tags.getall(key)
                    if items:
                        for it in items:
                            txt = getattr(it, 'text', None)
                            if txt:
                                return str(txt)
                except Exception:
                    continue
    except Exception:
        pass
    for key in ('©lyr', 'LYRICS', 'UNSYNCEDLYRICS', 'lyrics',
                'WM/Lyrics', 'WM/Lyrics_Synchronised'):
        try:
            v = tags.get(key)
            if v:
                val = v[0] if isinstance(v, (list, tuple)) else v
                if isinstance(val, bytes):
                    try:
                        return val.decode('utf-8', errors='replace')
                    except Exception:
                        continue
                return str(val)
        except Exception:
            continue
    return ''


def _read_tags(path: str, encoding: str = 'UTF-8') -> Dict:
    result = {
        'song_name': os.path.splitext(os.path.basename(path))[0],
        'singers': '', 'album': '', 'year': '', 'genre': '',
        'track': '', 'disc': '',
        'duration_s': 0, 'has_cover': False, 'has_embedded_lyrics': False,
    }
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(path)
    except Exception:
        return result
    if audio is None:
        return result

    tags = getattr(audio, 'tags', None)
    title = artist = album = year = genre = track = disc = ''

    if tags is not None:
        if hasattr(tags, 'getall'):
            title = _id3_get(tags, 'TIT2')
            artist = _id3_get(tags, 'TPE1')
            album = _id3_get(tags, 'TALB')
            year = _id3_get(tags, 'TDRC') or _id3_get(tags, 'TYER')
            genre = _id3_get(tags, 'TCON')
            track = _id3_get(tags, 'TRCK')
            disc = _id3_get(tags, 'TPOS')
        else:
            title = _try_keys(tags, ['title', 'TITLE', '\xa9nam'])
            artist = _try_keys(tags, ['artist', 'ARTIST', '\xa9ART'])
            album = _try_keys(tags, ['album', 'ALBUM', '\xa9alb'])
            year = _try_keys(tags, ['date', 'DATE', 'year', '\xa9day'])
            genre = _try_keys(tags, ['genre', 'GENRE', '\xa9gen'])
            track = _try_keys(tags, ['tracknumber', 'TRACKNUMBER', 'trkn'])
            disc = _try_keys(tags, ['discnumber', 'DISCNUMBER', 'disk'])

    result['song_name'] = _fix_encoding(title, encoding) or result['song_name']
    result['singers'] = _fix_encoding(artist, encoding)
    result['album'] = _fix_encoding(album, encoding)
    result['year'] = _fix_encoding(year, encoding)
    result['genre'] = _fix_encoding(genre, encoding)
    result['track'] = _fix_encoding(track, encoding)
    result['disc'] = _fix_encoding(disc, encoding)

    try:
        info = getattr(audio, 'info', None)
        if info is not None and hasattr(info, 'length'):
            result['duration_s'] = int(info.length)
    except Exception:
        pass

    if tags is not None:
        try:
            if hasattr(tags, 'getall') and tags.getall('APIC'):
                result['has_cover'] = True
        except Exception:
            pass
        if not result['has_cover']:
            try:
                covr = tags.get('covr') if hasattr(tags, 'get') else None
                if covr:
                    result['has_cover'] = True
            except Exception:
                pass
    if not result['has_cover']:
        try:
            if getattr(audio, 'pictures', None):
                result['has_cover'] = True
        except Exception:
            pass

    try:
        if _extract_lyrics(audio, os.path.splitext(path)[1].lower()):
            result['has_embedded_lyrics'] = True
    except Exception:
        pass

    return result


def _human_size(n: int) -> str:
    if n < 1024:
        return f"{n}B"
    for unit in ('KB', 'MB', 'GB', 'TB'):
        n /= 1024.0
        if n < 1024 or unit == 'TB':
            return f"{n:.1f}{unit}"
    return f"{n:.1f}TB"


def _format_duration(sec: int) -> str:
    if sec <= 0:
        return ''
    m, s = divmod(int(sec), 60)
    return f"{m:02d}:{s:02d}"


def scan_directory(root: str, encoding: str = 'UTF-8') -> List[Dict]:
    if not root or not os.path.isdir(root):
        return []
    root_abs = os.path.abspath(root)

    # 1) 快速收集所有候选文件（无 I/O 密集操作）
    file_list = []
    for dirpath, dirnames, filenames in os.walk(root_abs):
        dirnames[:] = [d for d in dirnames if not d.startswith('.')]
        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in AUDIO_EXTS:
                continue
            full = os.path.join(dirpath, fn)
            try:
                st = os.stat(full)
            except Exception:
                continue
            file_list.append((full, fn, ext, st))

    if len(file_list) > MAX_SONGS:
        logger.warning(f"扫描达到上限 {MAX_SONGS} 首")
        file_list = file_list[:MAX_SONGS]

    # 2) 多线程并发读取标签（mutagen 属于 I/O 密集）
    def _read_one(item):
        full, fn, ext, st = item
        info = _read_tags(full, encoding)
        try:
            rel = os.path.relpath(full, root_abs)
        except Exception:
            rel = fn
        has_external = os.path.exists(os.path.splitext(full)[0] + '.lrc')
        return {
            'path': full, 'filename': fn, 'rel_path': rel,
            'song_name': info['song_name'], 'singers': info['singers'],
            'album': info['album'], 'year': info['year'],
            'genre': info['genre'], 'track': info['track'], 'disc': info['disc'],
            'duration': _format_duration(info['duration_s']),
            'duration_s': info['duration_s'],
            'ext': ext.lstrip('.'),
            'file_size': _human_size(st.st_size),
            'file_size_bytes': st.st_size,
            'mtime': st.st_mtime,
            'has_cover': info['has_cover'],
            'has_embedded_lyrics': info['has_embedded_lyrics'],
            'has_external_lyrics': has_external,
        }

    songs: List[Dict] = []
    if file_list:
        with ThreadPoolExecutor(max_workers=_SCAN_THREADS) as ex:
            futures = [ex.submit(_read_one, item) for item in file_list]
            for f in as_completed(futures):
                try:
                    songs.append(f.result())
                except Exception as e:
                    logger.warning(f"扫描文件失败: {e}")

    songs.sort(key=lambda x: x['rel_path'].lower())
    return songs


def resolve_root() -> str:
    if state.settings.get('library_use_custom'):
        d = (state.settings.get('library_dir') or '').strip()
        if d:
            return d
    return (state.settings.get('save_dir') or '').strip()


def _cache_hit(root: str, encoding: str) -> bool:
    with _library_lock:
        now = time.time()
        return (
            _library_cache['root'] == root
            and _library_cache['encoding'] == encoding
            and bool(_library_cache['songs'])
            and now - _library_cache['scanned_at'] < _SCAN_CACHE_TTL
        )


def _cached_result(root: str, encoding: str) -> Dict:
    with _library_lock:
        return {
            'root': root,
            'count': len(_library_cache['songs']),
            'songs': list(_library_cache['songs']),
            'scanned_at': _library_cache['scanned_at'],
            'cached': True,
            'encoding': encoding,
        }


def scan(root: Optional[str] = None, force: bool = False, encoding: str = 'UTF-8') -> Dict:
    if not root:
        root = resolve_root()
    root = os.path.abspath(root) if root else ''
    encoding = encoding or 'UTF-8'

    # 快速路径：命中缓存直接返回
    if not force and _cache_hit(root, encoding):
        return _cached_result(root, encoding)

    # 慢路径：串行扫描。_scan_lock 保证同一时刻只有一个真正在扫盘。
    with _scan_lock:
        # 二次检查：可能在排队期间已被其它线程扫过
        if not force and _cache_hit(root, encoding):
            return _cached_result(root, encoding)

        songs = scan_directory(root, encoding)
        with _library_lock:
            _library_cache.update({
                'root': root, 'encoding': encoding,
                'songs': songs, 'scanned_at': time.time(),
            })
            scanned_at = _library_cache['scanned_at']
        return {
            'root': root, 'count': len(songs), 'songs': songs,
            'scanned_at': scanned_at, 'cached': False, 'encoding': encoding,
        }


def invalidate_cache():
    with _library_lock:
        _library_cache['scanned_at'] = 0.0
        _library_cache['songs'] = []


def is_path_allowed(path: str) -> bool:
    if not path:
        return False
    try:
        real = os.path.realpath(path)
        roots = set()
        sd = (state.settings.get('save_dir') or '').strip()
        if sd:
            roots.add(os.path.realpath(sd))
        ld = (state.settings.get('library_dir') or '').strip()
        if ld:
            roots.add(os.path.realpath(ld))
        for r in roots:
            try:
                if os.path.commonpath([real, r]) == r:
                    return True
            except ValueError:
                continue
        return False
    except Exception:
        return False


def read_lyrics(path: str, encoding: str = 'UTF-8') -> Tuple[str, str]:
    """返回 (lyrics, source)；source ∈ {'embedded', 'external', 'none'}"""
    if not os.path.isfile(path):
        return '', 'none'
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(path)
        if audio is not None:
            lyrics = _extract_lyrics(audio, os.path.splitext(path)[1].lower())
            if lyrics:
                return _fix_encoding(lyrics, encoding), 'embedded'
    except Exception:
        pass
    lrc_path = os.path.splitext(path)[0] + '.lrc'
    if os.path.exists(lrc_path):
        encodings = ([encoding] if encoding and encoding.upper() != 'UTF-8' else []) + \
                    ['utf-8-sig', 'utf-8', 'gbk', 'gb18030', 'big5', 'shift-jis', 'euc-kr']
        for enc in encodings:
            try:
                with open(lrc_path, 'r', encoding=enc) as f:
                    return f.read(), 'external'
            except (UnicodeDecodeError, LookupError, UnicodeError):
                continue
            except Exception:
                break
    return '', 'none'


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', name)
    return name.strip().rstrip('.')


# 向后兼容别名（建议新代码直接使用 sanitize_filename）
_sanitize_filename = sanitize_filename


def write_tags(path: str, patch: Dict) -> None:
    """用 mutagen 写入标签；patch 键：title/artist/album/year/genre/track/disc
    空字符串视为删除该字段。"""
    from mutagen import File as MutagenFile
    audio_easy = MutagenFile(path, easy=True)
    if audio_easy is None:
        raise RuntimeError("无法解析文件")

    KEY_MAP = {
        'title': 'title', 'artist': 'artist', 'album': 'album',
        'year': 'date', 'genre': 'genre',
        'track': 'tracknumber', 'disc': 'discnumber',
    }

    if audio_easy.tags is None:
        try:
            audio_easy.add_tags()
        except Exception as e:
            raise RuntimeError(f"该文件不支持写入标签（无法创建标签容器）: {e}")
        if audio_easy.tags is None:
            raise RuntimeError("该文件不支持写入标签（标签容器创建失败）")

    for fk, ek in KEY_MAP.items():
        if fk not in patch:
            continue
        val = patch[fk]
        if val is None:
            continue
        val = str(val).strip()
        try:
            if not val:
                if ek in audio_easy.tags:
                    del audio_easy.tags[ek]
            else:
                audio_easy.tags[ek] = [val]
        except Exception as e:
            logger.warning(f"写入标签 {fk} 失败 ({path}): {e}")

    audio_easy.save()