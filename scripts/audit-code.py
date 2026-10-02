#!/usr/bin/env python3
"""审计辅助：找出超长函数、重复实现、隐式耦合点。"""
import pathlib
import re


def long_functions(root: str, extensions: tuple, threshold: int = 80):
    rows = []
    for path in sorted(pathlib.Path(root).rglob("*")):
        if not path.suffix in extensions:
            continue
        lines = path.read_text(encoding="utf-8", errors="replace").split("\n")
        start = name = None
        depth = 0
        for index, line in enumerate(lines):
            match = re.match(r"\s*(?:pub )?(?:async )?fn (\w+)", line)
            if match and start is None:
                start, name, depth = index, match.group(1), 0
            if start is not None:
                depth += line.count("{") - line.count("}")
                if depth <= 0 and index > start:
                    length = index - start
                    if length > threshold:
                        rows.append((length, f"{path}:{start + 1} {name}()"))
                    start = None
    return sorted(rows, reverse=True)


def duplicates(root: str, pattern: str, extensions: tuple):
    hits = []
    for path in sorted(pathlib.Path(root).rglob("*")):
        if path.suffix not in extensions:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for match in re.finditer(pattern, text):
            line = text[: match.start()].count("\n") + 1
            hits.append(f"{path}:{line} {match.group(0)}")
    return hits


print("=== Rust 超长函数（>90 行）===")
for length, where in long_functions("src-tauri/src", (".rs",), 90):
    print(f"  {length:4} 行  {where}")

print("\n=== 前端超长函数（>90 行）===")
for length, where in long_functions("src/renderer/src", (".ts", ".tsx"), 90):
    print(f"  {length:4} 行  {where}")

print("\n=== 重复/分散的格式化与解析实现 ===")
for label, pattern in (
    ("时间/体积格式化", r"function (?:formatDuration|formatSize|formatTime)"),
    ("JSONC/JSON 清洗", r"fn (?:clean_json_text|safe_json_parse|strip_jsonc|parse_jsonc)"),
    ("URL 相对解析", r"fn (?:normalize_config_urls|resolve_relative_url|resolve_relative|join_url)"),
):
    hits = duplicates("src-tauri/src", pattern, (".rs",)) + duplicates(
        "src/renderer/src", pattern, (".ts", ".tsx")
    )
    print(f"  {label}: {len(hits)} 处")
    for hit in hits:
        print(f"      {hit}")
