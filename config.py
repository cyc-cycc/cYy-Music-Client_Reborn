# -*- coding: utf-8 -*-
import os
import json
import threading
import time
from pathlib import Path
from constants import DATA_DIR, DEFAULT_SAVE_DIR


def get_config_dir() -> Path:
    """统一使用 DATA_DIR/.CMC（所有平台一致），
    便于便携版聚合；DATA_DIR 已由 constants.py 处理平台差异 / CMC_DATA_DIR 覆盖。"""
    return Path(DATA_DIR) / '.CMC'


CONFIG_DIR = get_config_dir()
CONFIG_FILE = CONFIG_DIR / 'config.json'

# 串行化磁盘写入：避免多线程并发保存时互相覆盖临时文件
_save_lock = threading.Lock()

DEFAULT_SETTINGS = {
    'sources': ['酷我音乐(普通无损,推荐)'],
    'limit': 10,
    'dedup': False,
    'save_dir': DEFAULT_SAVE_DIR,
    'filename_format': '歌手-歌曲名',
    'custom_format': '',
    'download_lyric': True,
    'download_cover': True,
    'volume': 60,
    'play_mode': 2,
    'playback_rate': 1.0,
    'convert_enabled': False,
    'convert_format': 'mp3',
    'convert_bitrate': '320k',
    'theme': 'light',
    'theme_color': 'sky',
    'theme_custom': '#38BDF8',
    'background_opacity': 0.8,
    'show_progress_detail': True,
    'smart_cover': True,
    'dynamic_theme': True,
    'embed_lyrics': False,
    'delete_lyrics': False,
    'embed_cover': False,
    'delete_cover': False,
    'group_by': '无分组',
    'library_use_custom': False,
    'library_dir': '',
    'library_encoding': 'UTF-8',
    'remote_enabled': False,
    'remote_token': '',
    'eq': {
        'bands': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        'bass': False,
        'treble': False,
        'vocal': False,
        'vocal_cancel': False,
        'vocal_cancel_amount': 100,
        'preset': 'flat',
    },
}


def _deep_copy_defaults() -> dict:
    return json.loads(json.dumps(DEFAULT_SETTINGS))


def _backup_corrupted_config(reason: str) -> None:
    """把损坏的 config.json 重命名为 .bak.<时间戳>，避免下次启动重复报错。"""
    try:
        if not CONFIG_FILE.exists():
            return
        ts = time.strftime('%Y%m%d_%H%M%S')
        bak = CONFIG_FILE.with_suffix(f'.json.bak.{ts}')
        os.replace(str(CONFIG_FILE), str(bak))
        try:
            from utils import logger
            logger.warning(f"配置损坏（{reason}），已备份至 {bak.name}")
        except Exception:
            pass
    except Exception:
        # 备份失败也不能影响主流程
        pass


def load_settings() -> dict:
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if not isinstance(data, dict):
                raise ValueError(f"配置根节点不是对象：{type(data).__name__}")
            for k, v in DEFAULT_SETTINGS.items():
                data.setdefault(k, v)
            # 合并嵌套 eq 默认值
            if isinstance(data.get('eq'), dict):
                for k, v in DEFAULT_SETTINGS['eq'].items():
                    data['eq'].setdefault(k, v)
            else:
                data['eq'] = dict(DEFAULT_SETTINGS['eq'])
            return data
        except Exception as e:
            # 记录 + 把损坏文件挪到 .bak，避免下次启动重复失败
            try:
                from utils import logger
                logger.error(f"加载配置失败: {e}")
            except Exception:
                pass
            _backup_corrupted_config(str(e))
    return _deep_copy_defaults()


def save_settings(settings: dict):
    """原子写入：先写唯一临时文件，再 os.replace。
    使用互斥锁串行化，避免并发保存互相覆盖。"""
    with _save_lock:
        tmp_path = None
        try:
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            tmp_path = str(CONFIG_FILE) + f'.{os.getpid()}.{threading.get_ident()}.tmp'
            with open(tmp_path, 'w', encoding='utf-8') as f:
                json.dump(settings, f, indent=2, ensure_ascii=False)
                f.flush()
                try:
                    os.fsync(f.fileno())
                except Exception:
                    pass
            os.replace(tmp_path, CONFIG_FILE)
            tmp_path = None
        except Exception as e:
            try:
                from utils import logger
                logger.error(f"保存配置失败: {e}")
            except Exception:
                pass
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass