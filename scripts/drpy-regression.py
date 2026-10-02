#!/usr/bin/env python3
"""
对用户订阅里的 JS（drpy/ESM）站点做批量回归：逐个跑 drpy_probe，统计各方法成功率。

用法：python3 scripts/drpy-regression.py [每个订阅取样数]
"""
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from urllib.parse import urljoin

STORE = os.path.expanduser("~/Library/Application Support/com.iptvmac.desktop/config-store.json")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROBE = os.path.join(ROOT, "src-tauri", "target", "debug", "examples", "drpy_probe")
PER_SUB = int(sys.argv[1]) if len(sys.argv) > 1 else 2
TIMEOUT = 90


def fetch(url):
    """订阅地址里可能带中文域名/路径，urllib 默认按 ascii 编码会直接报错"""
    safe = urllib.parse.quote(url, safe=":/?&=#%[]@!$'()*+,;")
    request = urllib.request.Request(safe, headers={"User-Agent": "okhttp/3.12.13"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8-sig", "replace")


def strip_line_comments(text):
    """字符串感知地去掉 // 行注释（不能直接按行删，会把 URL 里的 // 一起截断）"""
    out, in_string, escaped, i = [], False, False, 0
    while i < len(text):
        char = text[i]
        if in_string:
            out.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            i += 1
            continue
        if char == '"':
            in_string = True
            out.append(char)
            i += 1
            continue
        if char == "/" and i + 1 < len(text) and text[i + 1] == "/":
            while i < len(text) and text[i] != "\n":
                i += 1
            continue
        out.append(char)
        i += 1
    return "".join(out)


def load_config(text):
    """兼容 TVBox 常见的 JSONC：注释 / 尾逗号 / 字符串里的裸控制字符"""
    last_error = None
    for candidate in (text, strip_line_comments(text)):
        for prepared in (candidate, re.sub(r",(\s*[}\]])", r"\1", candidate)):
            try:
                return json.loads(prepared, strict=False)
            except Exception as error:  # noqa: BLE001
                last_error = error
    raise last_error


store = json.load(open(STORE, encoding="utf-8"))
results = []

for sub in store.get("configs", []):
    url, name = sub.get("url"), sub.get("name", "?")
    if not url or not url.startswith("http"):
        continue
    try:
        config = load_config(fetch(url))
    except Exception as error:  # noqa: BLE001
        print(f"✗ [{name}] 配置拉取失败: {error}")
        continue

    sites = config.get("sites", [])
    js_sites = [s for s in sites if str(s.get("api", "")).endswith((".js", ".mjs"))]
    if not js_sites:
        continue
    print(f"\n=== {name}（站点 {len(sites)}，JS {len(js_sites)}，取样 {min(PER_SUB, len(js_sites))}）===")

    for site in js_sites[:PER_SUB]:
        api = urljoin(url, site.get("api", ""))
        ext = urljoin(url, site.get("ext") or "") or None
        command = [PROBE, api] + ([ext] if ext else [])
        try:
            output = subprocess.run(command, capture_output=True, text=True, timeout=TIMEOUT).stdout
            note = ""
        except subprocess.TimeoutExpired:
            output, note = "", "probe 超时"

        home_ok = bool(re.search(r"^✅ homeContent", output, re.M))
        search_ok = bool(re.search(r"^✅ searchContent", output, re.M))
        play_ok = bool(re.search(r"^✅ playerContent", output, re.M))
        fallback = "兜底镜像" in output or "改用兜底 drpy" in output
        error = ""
        if not home_ok:
            match = re.search(r"^❌ homeContent: (.+)$", output, re.M)
            error = (match.group(1) if match else note or "无输出")[:120]
        results.append({"sub": name, "site": site.get("name"), "api": api, "home": home_ok,
                        "search": search_ok, "play": play_ok, "fallback": fallback, "error": error})
        print(f"  {'✅' if home_ok else '❌'} {site.get('name')}  home={home_ok} search={search_ok} play={play_ok} 兜底={fallback} {error}")

total = len(results)
home_ok = sum(1 for r in results if r["home"])
search_ok = sum(1 for r in results if r["search"])
play_ok = sum(1 for r in results if r["play"])
fallback_used = sum(1 for r in results if r["fallback"])
print(f"\n=== 汇总：{total} 个站点 → homeContent {home_ok} / search {search_ok} / playerContent {play_ok}；用过兜底 {fallback_used} ===")
log_dir = os.path.join(ROOT, "obs-20261001-1925", "logs")
os.makedirs(log_dir, exist_ok=True)
with open(os.path.join(log_dir, "drpy-regression.json"), "w", encoding="utf-8") as handle:
    json.dump(results, handle, ensure_ascii=False, indent=2)
