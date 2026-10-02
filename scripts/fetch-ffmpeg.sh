#!/bin/bash
# 获取内置 ffmpeg（macOS arm64 静态版）到 src-tauri/binaries/ffmpeg
# 用法: ./scripts/fetch-ffmpeg.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/src-tauri/binaries/ffmpeg"
RAW="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-darwin-arm64.gz"
MIRRORED="https://gh-proxy.com/$RAW"
TMP="$(mktemp -d)"

mkdir -p "$ROOT/src-tauri/binaries"
echo "下载 ffmpeg (arm64 静态版)..."
if ! curl -fsSL -m 600 --retry 3 -C - "$RAW" -o "$TMP/ffmpeg.gz"; then
  echo "直连失败，改用镜像 gh-proxy..."
  curl -fsSL -m 600 --retry 3 -C - "$MIRRORED" -o "$TMP/ffmpeg.gz"
fi

gunzip -t "$TMP/ffmpeg.gz"
gunzip -c "$TMP/ffmpeg.gz" > "$TARGET"
chmod +x "$TARGET"
rm -rf "$TMP"

file "$TARGET"
"$TARGET" -version | head -1
echo "已安装到 $TARGET"
