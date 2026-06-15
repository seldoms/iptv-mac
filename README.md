# mac-tv

macOS IPTV 播放器，基于 Tauri 2 / Rust / React 18 构建。

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
- HLS/DASH 播放与失败换线
- 点播浏览、搜索、详情和播放
- 历史、收藏、缓存和设置
- macOS 小窗与窗口状态管理

产品路线见 [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md)。

## 参考项目

- [FongMi/TV](https://github.com/FongMi/TV)
- [CatVod](https://github.com/catvod/CatVodOpen)

## 许可

MIT
