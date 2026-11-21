#!/usr/bin/env python3
"""扫描项目中的硬编码中文文案，产出 docs/i18n-key-map.csv。

分类：
  ui       - 用户可见文案（需翻译）
  comment  - 注释（忽略）
  log      - 开发者日志（忽略）
  prompt   - AI 指令 prompt（保留，但需按语言追加输出指令）
  test     - 测试夹具（忽略）
"""

import csv
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHINESE = re.compile(r"[\u4e00-\u9fff]")
SKIP_DIRS = {"node_modules", "dist", "release", "out", ".git", "__tests__", "locales"}
SCAN_ROOTS = [
    ROOT / "frontend" / "src",
    ROOT / "backend" / "src",
    ROOT / "electron" / "src",
]
SCAN_EXTS = {".vue", ".ts", ".js"}


def classify(line: str, rel: str) -> str:
    s = line.strip()
    if "/test" in rel or rel.endswith(".test.ts") or "__tests__" in rel:
        return "test"
    if s.startswith("//") or s.startswith("/*") or s.startswith("*") or s.startswith("<!--") or s.startswith("#"):
        return "comment"
    if re.search(r"\b(console\.(log|warn|error|info)|log\((?:\"|')(info|warn|error))", s):
        return "log"
    # prompt 模板：多行模板字符串里的指令性文字，粗判
    if re.search(r"(systemPrompt|COMMON_STYLE|CREATE_SKILL_SPEC|const .*Prompt\s*=|prompt:\s*`)", s):
        return "prompt"
    return "ui"


def main() -> None:
    rows: list[tuple[str, str, str, str]] = []
    for scan_root in SCAN_ROOTS:
        if not scan_root.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(scan_root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for filename in filenames:
                path = Path(dirpath) / filename
                if path.suffix not in SCAN_EXTS:
                    continue
                rel = path.relative_to(ROOT).as_posix()
                try:
                    text = path.read_text(encoding="utf-8")
                except UnicodeDecodeError:
                    continue
                for lineno, line in enumerate(text.splitlines(), 1):
                    if not CHINESE.search(line):
                        continue
                    rows.append((rel, str(lineno), classify(line, rel), line.strip()[:300]))

    out = ROOT / "docs" / "i18n-key-map.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["file", "line", "category", "text"])
        writer.writerows(rows)

    counts: dict[str, int] = {}
    for _, _, cat, _ in rows:
        counts[cat] = counts.get(cat, 0) + 1
    print(f"total={len(rows)} " + " ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    print(f"output: {out.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
