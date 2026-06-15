# mac-tv

macOS IPTV 播放器，基于 Tauri 2 / Rust / React 18 构建。

公开仓库：[seldoms/iptv-mac](https://github.com/seldoms/iptv-mac)

## 开发

要求：

- Node.js 20+
- Rust stable
- Tauri 2 的 macOS 系统依赖

```bash
npm install
npm run dev
```

`npm run dev` 会启动 Vite 前端和 Rust/Tauri 桌面应用。

## 构建

```bash
npm run build
```

生成 macOS `.app` 和 `.dmg`：

```bash
npm run build:mac
```

## 验证

```bash
npm run check
```

该命令依次执行 TypeScript 检查、前端测试、Rust 测试、前端构建和
Tauri debug 构建。

重点烟测：

```bash
npm run smoke:alpha-playback-ui
npm run smoke:beta-continue
```

## 技术栈

- Tauri 2
- Rust
- React 18 + TypeScript
- Zustand
- Tailwind CSS
- SQLite
- hls.js / dash.js

## 项目结构

```text
src/
├── renderer/    React 前端
└── shared/      前端共享类型
src-tauri/       Rust 后端、Tauri commands、SQLite 和媒体代理
tests/           前端与共享逻辑测试
```

## 功能

- TVBox/CatVod 配置导入
- 直播源聚合、测速、分类和树状展示
- HLS/DASH/原生播放、本地媒体代理、失败诊断和自动换线
- 点播浏览、跨站搜索、分层解析、详情和播放
- 继续观看、历史、收藏、缓存和设置
- macOS 小窗与窗口状态管理

## 文档

- [产品路线图](docs/PRODUCT_ROADMAP.md)
- [产品升级设计](docs/PRODUCT_UPGRADE_DESIGN.md)
- [本次更新说明](docs/UPDATE_NOTES_2026_06_16.md)
- [Alpha 2.1 播放闭环验证](docs/ALPHA_2_1_VERIFICATION.md)
- [Beta 1 继续观看验证](docs/BETA_1_CONTINUE_WATCHING_VERIFICATION.md)

## 参考项目

- [FongMi/TV](https://github.com/FongMi/TV)
- [CatVod](https://github.com/catvod/CatVodOpen)

## 许可

MIT
