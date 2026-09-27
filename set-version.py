#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""跨平台版本号编辑：更新 frontend/package.json、package-lock.json、index.html。

用法:
    python set-version.py 8.4.1
"""
import json
import re
import sys
from pathlib import Path


def update_json_version(path: Path, version: str) -> int:
    if not path.exists():
        print(f"  skip: {path}")
        return 0
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    changed = 0
    if data.get('version') != version:
        data['version'] = version
        changed = 1
    if isinstance(data.get('packages'), dict) and '' in data['packages']:
        if data['packages'][''].get('version') != version:
            data['packages']['']['version'] = version
            changed = 1
    if changed:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"  updated: {path}")
    else:
        print(f"  no change: {path}")
    return changed


def update_html_version(path: Path, version: str) -> int:
    if not path.exists():
        print(f"  skip: {path}")
        return 0
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    new_content = re.sub(r'(\u7248\u672c\s+)[0-9A-Za-z._-]+', r'\g<1>' + version, content)
    if new_content != content:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"  updated: {path}")
        return 1
    print(f"  no change: {path}")
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: python set-version.py <版本号>", file=sys.stderr)
        return 1
    version = sys.argv[1]
    if not re.match(r'^[0-9A-Za-z][0-9A-Za-z._+-]{0,30}$', version):
        print(f"[ERROR] 版本号格式无效: {version}", file=sys.stderr)
        print("        允许字母/数字/./_/-/+，长度 1-31，首字符须为字母或数字", file=sys.stderr)
        return 1

    root = Path(__file__).resolve().parent
    count = 0
    count += update_json_version(root / 'frontend' / 'package.json', version)
    count += update_json_version(root / 'frontend' / 'package-lock.json', version)
    count += update_html_version(root / 'frontend' / 'index.html', version)
    print(f"\nDone. {count} replacement(s).")
    return 0


if __name__ == '__main__':
    sys.exit(main())
