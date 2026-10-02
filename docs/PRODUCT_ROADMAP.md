# IPTV Mac 产品开发路线图

## 1. 产品方向

### 产品定位

面向 macOS 用户的个人网络电视聚合播放器，核心价值是：

1. 配置容易导入，首次使用路径清晰。
2. 点击后尽快播放，失败时能够解释并自动恢复。
3. 历史、收藏和播放进度可靠，用户可以随时继续观看。
4. 直播源可治理，同一频道自动聚合并选择更优线路。

TVBox/CatVod 兼容是导入能力，不作为用户理解产品的前提。

### 核心质量指标

| 指标 | 首个正式版目标 |
| --- | --- |
| 首次配置导入成功率 | >= 90% |
| 点击播放到首帧 P50 | <= 3 秒 |
| 点击播放到首帧 P90 | <= 10 秒 |
| 播放请求成功率 | >= 85% |
| 自动换源成功率 | >= 60% |
| 30 分钟无致命中断率 | >= 90% |
| 历史进度恢复成功率 | >= 99% |
| 崩溃后数据可恢复率 | 100% |

所有指标默认只存储在本机。任何远程遥测必须单独征得用户同意。

## 2. 开发原则

1. 先完成"导入 -> 找到内容 -> 成功播放 -> 继续观看"的闭环。
2. 工程概念隐藏在高级设置中，普通用户不需要理解 Spider、站点 key 或解析器。
3. 每个异步操作都必须有状态、超时、取消和可理解的错误信息。
4. 不内置来源不明的影视配置，示例内容必须合法且可说明来源。
5. 每个 Sprint 都必须可以独立验收，不以"代码已写完"作为完成标准。
6. 新功能不得降低播放成功率、启动速度和数据可靠性。

## 3. 当前基线

### 已具备

- Tauri 2 + Rust + React 18 桌面应用骨架（已更名为 IPTV Mac）。
- TVBox/CatVod JSON 配置导入。
- HTTP 类型站点浏览、搜索和详情。
- HLS、DASH 和原生视频播放。
- 分层解析与跨站自动换源。
- 直播源解析、聚合、测试和分类。
- 历史、收藏、本地缓存和精简窗口。
- 基础 EPG 解析与当前/下一节目展示。
- IPC、窗口和本地服务安全加固。
- 统一 AppError（含 8 种错误码）和用户可见错误文案。
- 结构化日志，含 URL Token、Bearer、Cookie 脱敏。
- 数据库 schema 版本化迁移（v1→v3），含 schema_version 表。
- 5 个 Vitest 文件 / 22 个前端测试，以及 102 个 Rust 测试。
- `npm run check` 一条命令检查：类型检查、前端测试、Rust 测试、构建。

### 主要缺口

- 播放状态机和用户可见诊断已接入，协议级错误分类和源健康反馈仍需扩展。
- 继续观看主链路已落地，能恢复剧集、线路和时间点；收藏页来源状态、批量管理和源健康联动仍需完善。
- 源健康数据没有完整反馈到内容选择和用户界面。
- EPG 前后端参数契约尚未统一。
- 已有自动化测试、Tauri WebView 播放烟测和强退恢复烟测；发布回归清单仍需补齐。
- 自动更新、崩溃恢复和日志脱敏尚未形成完整闭环。

## 4. 里程碑总览

| 阶段 | 目标 | 建议周期 | 发布结果 |
| --- | --- | --- | --- |
| Sprint 0 | 建立可持续开发和质量基线 | 1 周 | Internal Alpha |
| Sprint 1 | 首次使用和配置导入闭环 | 1-2 周 | Alpha 1 |
| Sprint 2 | 播放状态、失败诊断和恢复 | 2 周 | Alpha 2 |
| Sprint 3 | 继续观看、历史与收藏闭环 | 1-2 周 | Beta 1 |
| Sprint 4 | 源健康度和智能选源 | 2 周 | Beta 2 |
| Sprint 5 | 直播与节目单体验 | 2 周 | RC 1 |
| Sprint 6 | macOS 产品化和正式发布 | 1-2 周 | 1.0 |

周期用于排布工作量，不作为压缩质量门槛的理由。

## 5. Sprint 0：质量与数据基础

**状态：已完成**

### 用户结果

后续迭代不再反复破坏播放、历史和配置能力，问题可以被稳定复现。

### 开发任务

- [x] 引入 Vitest，覆盖纯函数和主进程服务逻辑。
- [x] 为配置解析、直播解析、去重选优和路径边界增加单元测试。
- [x] 为历史、收藏、缓存增加数据库集成测试。
- [x] 建立数据库 schema version 和迁移执行器。
- [x] 定义统一的 `AppError`、错误码和用户可见错误文案。
- [x] 增加结构化日志，并对 URL 查询参数、Cookie、Authorization 和 API Token 脱敏。
- [x] 增加 `check` 脚本，统一执行类型检查、测试和构建；依赖审计保留为发布检查。
- [x] 修正 README 中的技术版本和真实启动方式。

### 主要代码落点

- `src-tauri/src/database.rs`
- `src-tauri/src/config.rs`
- `src-tauri/src/live.rs`
- `src-tauri/src/network.rs`
- `src/shared/types.ts`
- `tests/`

### 验收标准

- `npm run check` 一条命令可以完成全部质量检查。
- 核心纯函数与数据库 CRUD 有自动化测试。
- 数据库升级失败时保留原文件并给出可恢复提示。
- 日志中不出现完整 Cookie、Token 或含敏感查询参数的播放地址。

## 6. Sprint 1：首次使用与配置导入

### 用户结果

新用户打开应用后知道下一步做什么，并能验证配置是否可用。

### 开发任务

- [x] 已移除渲染层硬编码默认配置和自动导入未知第三方源。
- [x] 已新增首次使用向导：欢迎、导入方式、连接测试、完成。
- [ ] 支持 M3U/TXT URL 和本地文件导入（当前仅支持 JSON URL 导入）。
- [x] 导入前预检配置，展示站点数、直播源数、协议和风险提示。
- [x] 配置导入支持取消（导航离开）、重试、重命名和删除确认。
- [x] 首页、直播和搜索增加无配置、配置失效和无内容空状态。
- [x] 提供"稍后导入"模式和"先进入应用"入口，不强制导入。
- [x] 配置源集中到 Settings 页面的"配置管理"标签，含列表、切换、重命名、删除。

### 主要代码落点

- `src/renderer/src/App.tsx`
- `src/renderer/src/pages/Onboarding/`
- `src/renderer/src/pages/Settings/Settings.tsx`
- `src/renderer/src/stores/useConfigStore.ts`
- `src-tauri/src/commands/config.rs`
- `src-tauri/src/config.rs`

### 验收标准

- [x] 全新安装不访问任何未知第三方影视配置。
- [x] 用户可在 3 个步骤内完成一次配置导入（输入 URL → 预检 → 导入）。
- [x] 无效 URL、超时、格式错误和空配置有不同提示。
- [x] 导入成功后直接进入有内容的首页或直播页。
- [ ] M3U/TXT 和本地文件导入待补齐。

## 7. Sprint 2：可靠播放与失败诊断

### 用户结果

用户知道播放器正在做什么；失败时可以自动换源，也可以手动处理。

### 开发任务

- [x] 建立统一播放状态机：`idle → resolving → connecting → buffering → playing → recovering → failed`（类型定义和 store 层完成，VideoPlayer 部分接入）。
- [x] 播放器展示解析阶段、耗时、当前线路和可取消操作（状态覆盖层已实现）。
- [ ] 统一 HLS、DASH、原生播放和嗅探错误分类（HLS manifest/timeout/parse 已结构化，DASH/原生和 HTTP 状态仍需扩展）。
- [x] 自动换源展示候选数量和当前尝试（`sourceSwitchState` + `alternativeSources`）。
- [x] 新增播放诊断抽屉：错误阶段、错误类型、耗时、首帧、脱敏线路和脱敏 Header。
- [x] 增加手动重试、切换线路、复制诊断信息。
- [ ] 修复同 URL 重播、切集、切源和精简模式之间的状态一致性。
- [x] 在本机记录首帧时间 (`playbackFirstFrameAt`) 和播放失败时间 (`playbackLastErrorAt`)。

### 建议状态模型

```ts
type PlaybackPhase =
  | 'idle'
  | 'resolving'
  | 'connecting'
  | 'buffering'
  | 'playing'
  | 'recovering'
  | 'failed'
```

### 主要代码落点

- `src/renderer/src/components/VideoPlayer/VideoPlayer.tsx`
- `src/renderer/src/stores/usePlayerStore.ts`
- `src/renderer/src/pages/VodDetail/VodDetail.tsx`
- `src-tauri/src/super_parse.rs`
- `src-tauri/src/spider.rs`
- `src/shared/types.ts`

### 验收标准

- [x] 从点击剧集到成功或失败始终有可见状态（覆盖层 + 状态机字段已具备）。
- [x] 播放诊断抽屉可见，支持复制诊断、重试当前和切换线路。
- [x] 自动换源具备取消机制和并发保护。
- [ ] 错误提示已区分解析失败、HLS manifest 失败和超时；跨域、格式不支持、DASH/原生错误仍需补齐。
- [ ] 关闭详情页、切集和退出应用时残留嗅探窗口待验证。

## 8. Sprint 3：继续观看与个人内容

### 用户结果

用户离开后可以准确回到上次的内容、剧集、线路和时间点。

### 开发任务

- [x] 扩展历史模型，增加 episodeId、episodeName、episodeIndex、sourceIndex、sourceName、urlIdentifier、duration、positionSeconds、completed 字段。
- [x] 播放时每 15 秒节流保存进度，暂停、完播和播放器卸载时补写。
- [x] 播放完成后标记已看完，不再从片尾位置恢复。
- [x] 进入详情页时提示"从上次位置继续"。
- [x] 首页增加继续观看，按更新时间排序。
- [ ] 收藏页面显示来源状态和可用性，并可搜索替代源。
- [ ] 历史和收藏支持单项删除、批量管理和清空确认（单项删除和清空已实现，批量管理待实现）。
- [x] 对现有数据库执行无损迁移（schema version v3 已应用，覆盖 v1/v2 迁移测试）。

### 主要代码落点

- `src-tauri/src/database.rs`
- `src/shared/types.ts`
- `src/renderer/src/components/VideoPlayer/VideoPlayer.tsx`
- `src/renderer/src/pages/Home/Home.tsx`
- `src/renderer/src/pages/History/History.tsx`
- `src/renderer/src/pages/Keep/Keep.tsx`

### 验收标准

- [x] 强制退出应用后重新打开，播放位置误差不超过 20 秒（`npm run smoke:beta-continue` 验证 SIGKILL 后 372s 恢复，误差 0s）。
- [x] 同一视频在不同站点下不会互相覆盖历史（仍沿用 `siteKey + vodId` 唯一键）。
- [x] 已播放超过 95% 的内容默认从头开始。
- [x] 首页继续观看可直接恢复正确剧集和线路。

## 9. Sprint 4：源健康度与智能选源

### 用户结果

应用减少重复尝试失效源，并自动选择更稳定的线路。

### 开发任务

- [ ] 建立站点和线路健康表：成功率、首帧耗时、最近错误、连续失败次数。
- [ ] 将探测从单纯 HEAD 请求升级为协议感知检测。
- [x] 相同直播频道按标准化名称合并线路（refresh 流程中处理）。
- [ ] 选源评分综合成功率、延迟、清晰度、新鲜度和近期失败（当前仅 H.265/H.264 加分）。
- [ ] 失效源进入退避期，避免每次播放重复等待。
- [ ] Settings 源管理页展示健康等级、最近检测时间和手动重测。
- [ ] 支持禁用、排序和批量清理配置源（重命名和删除已实现）。
- [ ] 后台刷新支持暂停、限速和失败恢复（取消已通过 navigation 间接实现）。

### 主要代码落点

- `src-tauri/src/commands/live.rs`
- `src-tauri/src/live.rs`
- `src-tauri/src/commands/auto_refresh.rs`
- `src-tauri/src/database.rs`
- `src/renderer/src/pages/Settings/`
- `src/renderer/src/pages/Live/Live.tsx`

### 验收标准

- [ ] 连续失败的线路不会在退避期内被优先选择。
- [ ] 用户可看到选中某条线路的原因。
- [ ] 后台源检测不明显影响正在播放的视频。
- [x] 频道聚合后仍能手动展开并选择原始线路（树形展开可用）。

## 10. Sprint 5：直播与节目单

### 用户结果

直播可以像电视一样快速切换、查看当前节目并回到常看频道。

### 开发任务

- [ ] 统一 EPG IPC 契约，正确传递 EPG URL 和频道映射。
- [x] 展示当前节目和下一节目（播放器下方 EPG 信息栏）。
- [ ] 支持完整日程查看。
- [ ] 支持收藏频道、最近频道和常看频道排序。
- [x] 支持 Cmd+↑/↓ 频道切换（数字选台和键盘焦点导航待实现）。
- [ ] 预加载相邻频道元数据，缩短切台等待。
- [x] 自动线路切换和频道刷新入口已实现（频道不可用反馈体验待优化）。
- [ ] 支持节目提醒；时移和回看仅在源明确支持时开放。
- [x] 直播布局优化完成：左侧频道树 + 主区域播放器 + EPG 栏。

### 主要代码落点

- `src-tauri/src/epg.rs`
- `src/renderer/src/stores/useLiveStore.ts`
- `src/renderer/src/pages/Live/Live.tsx`
- `src/renderer/src/components/LiveTree/`
- `src/renderer/src/components/ChannelItem/`

### 验收标准

- [x] EPG 可按频道通过 tvgId/tvgName 匹配（时区处理一致性待验证）。
- [ ] 最近频道可在两次操作内重新播放。
- [ ] 键盘可以完成搜索、选台、切台和返回播放区。
- [x] 无 EPG 时界面正常降级，不显示空白占位。

## 11. Sprint 6：macOS 产品化与 1.0 发布

### 用户结果

应用可以被普通 macOS 用户稳定安装、更新和长期使用。

### 开发任务

- [x] 应用名称已改为 IPTV Mac（package.json name）。图标、签名、公证和 DMG 待完成。
- [ ] 接入自动更新，支持下载进度、稍后安装和失败回滚。
- [ ] 实现启动异常和数据库损坏恢复界面。
- [x] 日志脱敏已实现（redact_url / redact_bearer / redact_cookie），导出和预览功能待实现。
- [ ] 菜单栏、系统媒体键和精简窗口体验待完善（PiP 按钮和 MiniPlayer 组件已有）。
- [ ] 建立发布检查表和最小支持系统版本。
- [ ] 补齐隐私说明、内容来源说明和开源许可证清单。
- [x] 直播刷新性能整改已完成。启动速度、列表滚动帧率、内存和长时间播放待压测。

### 验收标准

- 干净 macOS 环境可完成安装、首次启动、播放和升级。
- 应用异常退出后不会破坏配置和历史数据。
- 连续播放 4 小时无持续性内存增长。
- 正式包通过签名、公证和依赖审计。

## 12. 明确暂缓

以下能力不进入 1.0 主路径，除非前述质量指标已经达到目标：

- JS/JAR/Python Spider 全兼容。
- 云端账户和跨设备同步。
- DLNA 完整投放与控制。
- 弹幕生态和在线字幕搜索。
- 插件市场。
- AI 推荐或内容理解。

这些功能有价值，但会扩大安全边界、兼容成本和支持成本。

## 13. 每个 Sprint 的完成定义

一项任务只有同时满足以下条件才算完成：

- 代码已通过类型检查、测试、构建和依赖审计。
- 有成功路径、失败路径和取消路径。
- 用户可见文案不暴露内部工程术语。
- 数据结构变更包含迁移和回滚方案。
- 日志不包含敏感信息。
- 关键流程有明确验收步骤。
- README 或用户文档已同步。

## 14. 下一步执行顺序

Alpha 2.1 和 Beta 1 主链路已经落地，下一批实现顺序如下：

1. 建立源健康评分，记录站点/线路成功率、首帧耗时、最近错误和连续失败次数。
2. 扩展 DASH、原生媒体、CORS/Header 和格式不支持的协议级错误分类与用户文案。
3. 补齐 Sprint 1 剩余导入能力：M3U/TXT URL、本地文件导入和导入风险提示。
4. 完成发布回归清单：签名、公证、依赖审计、长时间播放、异常退出和数据库损坏恢复。
5. 补充公开发布素材：失败诊断、自动换源、继续观看和直播布局截图。

暂不并行开发 DLNA、插件市场、跨设备同步或 AI 推荐，直到播放成功率、继续观看和源健康指标稳定达标。

----

最后更新：2026-06-16 — Alpha 2.1 播放闭环与 Beta 1 继续观看主链路已自动验证；下一阶段聚焦源健康、协议错误分类和 macOS 发布准备。
