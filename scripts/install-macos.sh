#!/usr/bin/env bash
# IPTV Mac 一键安装（macOS / Apple Silicon）
#
# 用途：本项目没有 Apple 开发者账号，下载来的 App 会被 Gatekeeper 拦（"无法验证开发者"）。
#      这个脚本负责：下载最新版 → 安装到「应用程序」→ 去掉 quarantine 标记 → 打开。
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/seldoms/iptv-mac/main/scripts/install-macos.sh | bash
#   bash scripts/install-macos.sh pre                  # 滚动预发布 latest（每次推送都重建）
#   bash scripts/install-macos.sh --tag v1.0.2         # 装指定版本（方便回退）
#   bash scripts/install-macos.sh --dry-run            # 只看会下哪个地址，不真装
#   IPTV_MAC_ZIP_URL=https://... bash scripts/install-macos.sh   # 覆盖下载源（镜像/自测）
#
# 只做四件事，不碰你的数据（数据在 ~/Library/Application Support/com.iptvmac.desktop）：
set -euo pipefail

REPO="seldoms/iptv-mac"
ASSET="IPTV-Mac-macos-arm64.zip"
APP="/Applications/IPTV Mac.app"

MODE="stable"; TAG=""; DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \?//'; exit 0 ;;
    -n|--dry-run) DRY_RUN=1; shift ;;
    -t|--tag) TAG="${2:-}"; [ -n "$TAG" ] || { echo "❌ --tag 需要版本号，例如 --tag v1.0.2" >&2; exit 1; }; shift 2 ;;
    pre|stable) MODE="$1"; shift ;;
    *) echo "❌ 未知参数: $1（用 --help 看用法）" >&2; exit 1 ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "❌ 这个脚本只适用于 macOS。" >&2
  exit 1
fi

if [ "$(uname -m)" != "arm64" ]; then
  echo "❌ 官方安装包目前只提供 Apple Silicon（arm64）。Intel 机器请从源码构建：" >&2
  echo "   https://github.com/$REPO#从源码构建" >&2
  exit 1
fi

if [ -n "$TAG" ]; then
  URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"
  LABEL="指定版本 $TAG"
elif [ "$MODE" = "pre" ]; then
  URL="https://github.com/$REPO/releases/download/latest/$ASSET"
  LABEL="滚动预发布 latest"
else
  URL="https://github.com/$REPO/releases/latest/download/$ASSET"
  LABEL="最新正式版"
fi
# 允许覆盖（镜像/内网/自测）：IPTV_MAC_ZIP_URL=https://... bash scripts/install-macos.sh
URL="${IPTV_MAC_ZIP_URL:-$URL}"

if [ "$DRY_RUN" = "1" ]; then
  echo "（dry-run）将下载：$LABEL"
  echo "  $URL"
  echo "  然后安装到：$APP"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ 下载（${LABEL}）"
echo "  $URL"
if ! curl -fsIL -m 30 -o /dev/null "$URL"; then
  echo "❌ 这个地址拿不到安装包（可能版本号写错或还没构建完）。" >&2
  echo "   可用版本见：https://github.com/$REPO/releases" >&2
  exit 1
fi
# -C - 断点续传：这网速下 23MB 经常中断，重来一遍很痛
if ! curl -fL --retry 5 --retry-all-errors -C - -m 1800 --progress-bar -o "$TMP/app.zip" "$URL"; then
  echo "❌ 下载失败：检查网络，或直接到 https://github.com/$REPO/releases 手动下载。" >&2
  exit 1
fi

echo "→ 校验压缩包"
unzip -tq "$TMP/app.zip" >/dev/null || { echo "❌ 压缩包损坏，请重试。" >&2; exit 1; }

echo "→ 解压"
ditto -x -k "$TMP/app.zip" "$TMP/extracted"
SRC="$TMP/extracted/IPTV Mac.app"
if [ ! -d "$SRC" ]; then
  echo "❌ 压缩包里没找到 IPTV Mac.app。" >&2
  exit 1
fi

echo "→ 安装到 $APP"
if [ -d "$APP" ]; then
  # 正在运行就先退出，避免替换半途失败
  osascript -e 'quit app "IPTV Mac"' >/dev/null 2>&1 || true
  sleep 1
  rm -rf "$APP"
fi
ditto "$SRC" "$APP"

# 关键一步：去掉浏览器/GitHub 下载留下的隔离标记，否则 Gatekeeper 会拦
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

VERSION="$(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo '未知')"
echo "✅ 已安装 IPTV Mac $VERSION"
echo "   首次打开如果仍被拦：右键 App → 打开；或到 系统设置 → 隐私与安全性 → 仍要打开。"
open "$APP" || true
