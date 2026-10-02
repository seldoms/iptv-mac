# 内置命令行工具

## ffmpeg

- 文件：`ffmpeg`（Mach-O 64-bit arm64，静态构建，仅依赖 macOS 系统框架）
- 版本：ffmpeg 6.0（Apple clang 构建）
- 来源：`eugeneware/ffmpeg-static` 的 GitHub Release 资源 `ffmpeg-darwin-arm64.gz`
  - 原始地址：https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-darwin-arm64.gz
  - 国内可用镜像：`https://gh-proxy.com/<原始地址>`
- 许可：**GPL v2+**（ffmpeg 默认构建含 GPL 组件）。随应用分发时需遵守 GPL 条款；如需闭源分发，
  请改用 LGPL 构建或让用户自备 ffmpeg（应用会回退到系统 PATH）。
- 打包方式：`src-tauri/tauri.conf.json` 的 `bundle.resources` 将其映射为
  `IPTV Mac.app/Contents/Resources/bin/ffmpeg`；运行时由 `commands/download.rs::resolve_tool`
  优先使用包内该文件，找不到再回退到系统 PATH / Homebrew。
- 二进制体积较大（约 45MB），因此不纳入 git；用 `scripts/fetch-ffmpeg.sh` 重新获取。
