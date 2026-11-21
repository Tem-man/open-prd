#!/usr/bin/env python3
"""校验 i18n：所有 locale JSON 的 key 集合必须与英文基线（messages/*.ts）一致。

原理：从 messages/*.ts 提取 `export const xxxMessageDefaults = { ... } as const`
中的顶层 key，与 locales/zh-cn/<域>.json 的 key 比对。
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MSG_DIR = ROOT / "packages" / "vue" / "src" / "i18n" / "messages"
ZH_DIR = ROOT / "packages" / "vue" / "src" / "i18n" / "locales" / "zh-cn"

DOMAINS = ["shell", "home", "session", "version", "export", "module", "prd", "history", "prototype", "editor"]


def extract_default_keys(ts_path: Path) -> set[str]:
    text = ts_path.read_text(encoding="utf-8")
    m = re.search(r"MessageDefaults\s*=\s*\{(.*?)\n\}\s*as const", text, re.S)
    if not m:
        return set()
    body = m.group(1)
    return set(re.findall(r"^\s{2}([A-Za-z][A-Za-z0-9]*)\s*:", body, re.M))


def main() -> int:
    errors = 0
    for domain in DOMAINS:
        ts = MSG_DIR / f"{domain}.ts"
        zh = ZH_DIR / f"{domain}.json"
        en_keys = extract_default_keys(ts)
        zh_keys = set(json.loads(zh.read_text(encoding="utf-8")).keys())
        missing = en_keys - zh_keys
        extra = zh_keys - en_keys
        if missing or extra:
            errors += 1
            print(f"[{domain}] MISMATCH")
            if missing:
                print(f"  missing in zh-CN: {sorted(missing)}")
            if extra:
                print(f"  extra in zh-CN:   {sorted(extra)}")
        else:
            print(f"[{domain}] OK ({len(en_keys)} keys)")
    return errors


if __name__ == "__main__":
    sys.exit(main())
