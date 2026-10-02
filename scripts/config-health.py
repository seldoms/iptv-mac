#!/usr/bin/env python3
"""
订阅配置体检：把配置库里的每条订阅拉下来，按应用侧的解析规则判定"能不能加载"。

用法：python3 scripts/config-health.py
"""
import base64
import json
import os
import re
import urllib.parse
import urllib.request

STORE = os.path.expanduser("~/Library/Application Support/com.iptvmac.desktop/config-store.json")
UA = "okhttp/3.12.13"


def fetch(url, timeout=30):
    safe = urllib.parse.quote(url, safe=":/?&=#%[]@!$'()*+,;")
    request = urllib.request.Request(safe, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, response.read()


def strip_jsonc(text):
    out, in_string, escaped, i, n = [], False, False, 0, len(text)
    while i < n:
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
        if char == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] not in "\r\n":
                i += 1
            continue
        if char == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(char)
        i += 1
    return "".join(out)


def try_json(raw):
    """返回 (状态说明, 解析出的对象或 None)"""
    if raw[:3] == b"\xef\xbb\xbf":
        raw = raw[3:]
    # JSONC 里字符串可能带裸控制字符，strict=False 才收得下
    for label, candidate in (("utf-8", raw.decode("utf-8", "replace")),):
        for note, text in (("原样", candidate), ("去注释", strip_jsonc(candidate))):
            for fix in ("", "尾逗号"):
                prepared = re.sub(r",(\s*[}\]])", r"\1", text) if fix else text
                try:
                    return f"JSON({label}/{note}{'/' + fix if fix else ''})", json.loads(prepared, strict=False)
                except Exception:
                    pass
    return None, None


def classify_api(site):
    api = str(site.get("api", ""))
    if api.startswith("csp_"):
        return "JAR"
    if ".py" in api:
        return "Python"
    if api.endswith((".js", ".mjs")):
        return "JS"
    if site.get("type") in (0, 1, 4):
        return "HTTP/XML"
    return "其他"


store = json.load(open(STORE, encoding="utf-8"))
rows = []
for config in store.get("configs", []):
    url, name = config.get("url", ""), config.get("name", "?")
    if not url.startswith("http"):
        rows.append((name, "跳过", "非 http 地址", ""))
        continue
    try:
        status, raw = fetch(url)
    except Exception as error:  # noqa: BLE001
        rows.append((name, "❌ 拉取失败", str(error)[:70], ""))
        continue

    head = raw[:200]
    if b"<!DOCTYPE html" in head or b"<html" in head.lower():
        # 可能是跳转/挑战页，也可能正文在链接里
        rows.append((name, "⚠️ 返回网页", head[:60].decode("utf-8", "replace").replace("\n", " "), ""))
        continue

    kind, data = try_json(raw)
    if data is None:
        # 伪装：** 前缀的 base64 隐写（JPEG/BMP 头）或裸 base64
        note = ""
        if raw[:2] == b"**":
            note = "** 隐写"
        elif raw[:2] in (b"\xff\xd8", b"BM"):
            note = f"{'JPEG' if raw[:2] == b'\\xff\\xd8' else 'BMP'} 隐写"
        rows.append((name, "❌ 解析失败", f"{note or '未知格式'} {len(raw)}B", ""))
        continue

    sites = data.get("sites") or []
    lives = data.get("lives") or []
    parses = data.get("parses") or []
    kinds = {}
    for site in sites:
        kinds[classify_api(site)] = kinds.get(classify_api(site), 0) + 1
    supported = kinds.get("JS", 0) + kinds.get("HTTP/XML", 0)
    summary = " ".join(f"{k}:{v}" for k, v in sorted(kinds.items(), key=lambda kv: -kv[1]))
    rows.append((name, "✅ 可解析" if (sites or lives or parses) else "❌ 非 TVBox 配置",
                 f"{kind} sites={len(sites)} lives={len(lives)} 可用≈{supported}", summary))

print(f"{'订阅':32} {'结果':10} 详情")
print("-" * 110)
for name, state, detail, kinds in rows:
    print(f"{name[:30]:32} {state:10} {detail}")
    if kinds:
        print(f"{'':32} {'':10} 站点类型 {kinds}")

ok = sum(1 for row in rows if row[1].startswith("✅"))
print("-" * 110)
print(f"共 {len(rows)} 条：可解析 {ok}，其余 {len(rows) - ok}")
