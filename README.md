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

设置页保存订阅地址，不要求当时在线，也不会切换当前点播。点播页顶部可切换订阅。
直播页默认展示全部已保存订阅的聚合频道库：同频道合并、多线路保留，后台默认每
30 分钟巡检，页面可手动触发巡检。打开直播页先读本地缓存，不等待全量网络测速。

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

隔离的完整流程测试：

```bash
npm exec tauri build -- --debug --bundles app
node scripts/subscription-test-env.mjs
```

测试环境包含 JSON、XML、type 4、多仓、重复直播频道、慢源和故障源；应用数据位于
脚本输出的临时目录，退出后保留请求日志。默认视频使用公开 MDN 测试片段，需联网。
详细结果、兼容范围和剩余问题见 [订阅与播放验证](docs/SUBSCRIPTION_PLAYBACK.md)。

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

- [项目文档总索引](docs/README.md)
- [架构图](docs/ARCHITECTURE.md)
- [设计蓝图](docs/DESIGN_BLUEPRINT.md)
- [开发文档](docs/DEVELOPMENT.md)
- [接口文档](docs/API.md)
- [当前开发进度](docs/PROGRESS.md)
- [发布前全量审计](docs/RELEASE_AUDIT_2026-09-05.md)
- [订阅与播放验证](docs/SUBSCRIPTION_PLAYBACK.md)
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
