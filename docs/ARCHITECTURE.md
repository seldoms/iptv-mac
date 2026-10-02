# 架构图

## 总体结构

```mermaid
flowchart LR
  UI[React Renderer\nPages / Components] --> Store[Zustand Stores]
  Store --> IPC[IPC Adapter\nsrc/renderer/src/utils/ipc.ts]
  IPC --> Tauri[Tauri 2 Command Boundary]
  Tauri --> Cmd[命令层\nconfig / site / live / cache]
  Cmd --> Spider[Spider 协议适配\nJSON / XML / type4 / JS]
  Cmd --> Parse[Super Parse\n网页静态媒体与解析器容错]
  Cmd --> Live[Live Aggregator\n去重 / 测速 / 巡检]
  Cmd --> Proxy[媒体代理与 HLS 重写]
  Cmd --> DB[(SQLite\ncache / history / keep)]
  Spider --> Net[HTTP Client]
  Parse --> Net
  Live --> Net
  Proxy --> Net
  Net --> Sources[订阅、API、媒体源]
```

## 播放链路

```mermaid
sequenceDiagram
  participant U as 用户
  participant R as React
  participant C as Rust command
  participant S as 站点/直播源
  participant P as Player
  U->>R: 点击影片/频道
  R->>C: detail/player 或 live tree
  C->>S: 请求 API、网页或播放清单
  S-->>C: 详情、播放地址、线路
  C-->>R: 可播放地址 + headers
  R->>P: 启动媒体
  P-->>R: 首帧/失败事件
  R->>C: 记录指标或请求下一线路
```

## 运行时边界

- Renderer 只负责交互、状态和播放器；不直接解析订阅协议。
- Rust command 负责参数校验、网络、协议适配、缓存和错误转换。
- SQLite 缓存是直播聚合库和播放指标的持久边界；配置订阅单独保存。
- 直播刷新是后台任务，发布缓存时不替换当前播放对象。
- 线路身份是 `url + normalized headers`；频道身份是归一化频道名。
