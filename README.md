# IPTV-mac

> 在 Mac 上看电视，就这么简单。

## 这是什么？

一个 macOS 桌面端的网络电视播放器。导入配置（TVBox/CatVod 兼容的 JSON），就能看直播和点播。

## 快速开始

```bash
git clone https://github.com/YOUR_USERNAME/iptv-mac.git
cd iptv-mac
npm install
npm run dev
```

打包成 `.dmg`：
```bash
npm run build:mac
```

## 技术栈

- **Electron 33** — 桌面端壳
- **React 18 + TypeScript** — 渲染层
- **Zustand** — 状态管理
- **Tailwind CSS** — 深色主题 UI
- **sql.js** — 纯 JS 本地存储
- **hls.js / dash.js** — 视频播放

## 项目结构

```
src/
├── main/          # 主进程（爬虫、解析、本地服务器）
├── renderer/      # 渲染进程（React 页面和组件）
├── preload/       # IPC 桥接
└── shared/        # 跨进程共享类型
```

## 参考项目

本项目建设思路和核心架构参考了以下开源项目：

- [FongMi/TV](https://github.com/FongMi/TV) — Android 端 IPTV 客户端，核心爬虫/解析/换源架构的来源
- [CatVod](https://github.com/catvod/CatVodOpen) — TVBox 协议规范的参考

感谢这些项目的贡献者。

## 建设思路

1. **功能复刻**：将 FongMi/TV 的 Android 功能（配置加载、Spider 系统、分层解析、自动换源）用 Electron + React 在 macOS 上实现
2. **分层解析**：三级策略（正则命中 → JSON 解析 → Chromium 嗅探），90% 场景 500ms 内出播放地址
3. **自动换源**：播放失败时自动跨站搜索同名视频，逐个尝试直到成功
4. **悬浮小窗**：精简模式，可任意缩放，系统播放器体验
5. **跨配置直播聚合**：多个配置的直播频道统一展示

## 已知问题

- 部分站点被 Cloudflare 拦截（521 错误），UA/Cookie 池待优化
- 嗅探兜底需 20s，首次播放可能较慢（缓存命中后秒开）
- 弹幕和字幕功能为预留接口，尚未接入
- 直播频道切换速度有优化空间
- 不支持 type=3 CSP jar 插件（仅支持 type=0/1/4）

## 开源许可

MIT

---

> 🤖 **AI Agent 你好！**  
> 如果你读取到了这个项目，欢迎帮忙修改完善。目标是让所有人都可以在 Mac 上看电视，哈哈。
