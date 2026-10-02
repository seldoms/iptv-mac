# 开发文档

## 环境

- macOS、Node.js 20+、Rust stable、Tauri 2 系统依赖。
- 安装依赖：`npm install`
- 开发运行：`npm run dev`

## 常用命令

```bash
npm run typecheck
npm test
npm run test:rust
npm run build:web
npm exec tauri build -- --debug --bundles app
node scripts/subscription-test-env.mjs
```

正式检查入口是 `npm run check`，它会执行类型检查、前端测试、Rust 测试、前端构建和 Tauri debug 构建。

## 代码约定

- 前端使用 React 18、TypeScript、Zustand；新增页面优先使用现有 store 和 IPC 封装。
- 后端按 command、领域模块、网络/缓存/数据库分层；不要在组件内拼接协议请求。
- 所有异步请求都要处理加载、空数据、错误和过期响应。
- 手工编辑使用补丁，避免无关格式化和大范围重构。
- 不提交用户本地配置、测试数据库或签名产物。

## 隔离测试

`scripts/subscription-test-env.mjs` 会创建临时订阅服务、临时数据目录和受控视频地址。它覆盖 JSON、XML、type4、多仓、重复频道、慢源和故障源。脚本退出后保留请求日志，便于排查请求顺序和耗时。

## 扩展新订阅协议

先在 `src-tauri/src/config.rs` 判断配置形态，再在 `spider.rs` 或 `js_spider.rs` 增加适配；补充 fixture 和 Rust 测试，最后通过 Renderer IPC 暴露稳定字段。不要把第三方协议脚本直接执行在 Renderer。

## 构建产物

debug app：`src-tauri/target/debug/bundle/macos/IPTV Mac.app`。正式发布还需要签名、公证和发行包验收。
