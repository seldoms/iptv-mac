# FongMi Full Replica Development Plan

> 目标：以本地 `TV/` 的 FongMi/TV 为主参考，在现有 `iptv-mac` Tauri + Rust + React 架构上完整复刻配置、直播、点播、解析、播放和本地代理功能点；TVBoxOSC 只作为 TVBox/CatVod 接口兼容对照，不推倒重来。

## 1. 参考基线

- 主参考：`TV/`，remote `https://github.com/FongMi/TV.git`，branch `fongmi`，HEAD `5fdff00`。
- 主文档：`TV/docs/CONFIG.md`、`TV/docs/SPIDER.md`、`TV/docs/LIVE.md`、`TV/docs/LOCAL.md`。
- 主代码链路：`VodConfig/LiveConfig -> SiteApi/LiveApi -> BaseLoader(Jar/JS/Py) -> ParseJob -> PlayerManager -> Server`。
- CatVod 契约：`TV/catvod/src/main/java/com/github/catvod/crawler/Spider.java`，包含 `init`、`homeContent`、`homeVideoContent`、`categoryContent`、`detailContent`、`searchContent`、`playerContent`、`liveContent`、`proxy`、`action`、`manualVideoCheck`、`isVideoFormat`、`destroy`。
- 当前 `TVBoxOSC` clone 基本只有 README 和 GitHub Actions，不能作为源码级参考；如需 TVBoxOSC 源码对照，另行拉取 README 中列出的上游镜像。

## 2. 当前 iptv-mac 基线

已具备：

- Tauri 2 + Rust + React 18 + Zustand + SQLite 工程骨架。
- TVBox/CatVod JSON 配置导入，多仓合并，直播 M3U/TXT/JSON 包装，Link3 fallback。
- type 0/1/4 HTTP/XML/JSON 点播站点基础浏览、搜索、详情、播放。
- 直播解析、频道聚合、测速、树状展示、基础 EPG。
- `super_parse` 的直链识别、type=1 JSON parse、`playUrl` fallback。
- HLS/DASH/原生播放、本地媒体代理、HLS playlist rewrite、历史、收藏、继续观看。

主要缺口：

- type=3 Spider 运行时缺失：JAR/Dex 无法原样在 macOS 运行，JS/Py Spider 尚无兼容执行层。
- `homeVideoContent`、`liveContent`、`action`、`manualVideoCheck`、`isVideoFormat`、Spider `proxy` 未完整接入。
- `parses` type 0/2/3/4 未完整实现；WebView 嗅探、规则脚本、并行 super parse 不完整。
- 配置公共字段只解析了一部分，DoH、hosts、proxy、rules、headers、ads、danmaku、wallpaper、logo、notice 缺少统一运行时行为。
- 本地 HTTP API 只有媒体代理子集，未复刻 FongMi `/action`、`/cache`、`/media`、`/file`、`/upload`、`/parse`、`/proxy`、`/device` 等端点。
- 播放层缺少完整 DRM、字幕/弹幕自动搜索、解析弹窗、外部播放器、DLNA/投放、预缓存、规则化错误治理。
- 直播缺少密码分组、boot/pass 完整行为、时移/回看、完整日程、EPG 模板/API、频道收藏/最近/常看、相邻频道预加载。

## 3. 总体架构

保留现有 Tauri + Rust + React，不重写项目：

- Rust 后端作为兼容核心：配置规范化、站点调用、Spider 执行桥、解析调度、本地服务、数据库、网络策略、媒体代理。
- React 前端作为产品界面：点播首页/分类/搜索/详情/播放、直播、设置、历史收藏、诊断和本地服务控制。
- 新增 `CompatRuntime` 层，把 FongMi 的 Android 概念翻译成 macOS 可运行能力：HTTP Spider 走 Rust，JS Spider 走内嵌 JS 运行时，Python Spider 走受控 Python 子进程，JAR Spider 走 JVM 兼容桥或明确的适配器。
- 所有外部配置、Spider、解析器、本地代理请求都必须经过安全边界：路径白名单、请求超时、并发限制、敏感日志脱敏、危险本地文件访问拦截。

## 4. 功能复刻清单

### 4.1 配置系统

- 完整支持 `VodConfig`：`spider`、`wallpaper`、`logo`、`notice`、`sites`、`parses`、`lives`、`doh`、`proxy`、`rules`、`headers`、`hosts`、`flags`、`ads`、`danmaku`。
- 完整支持 `Site` 字段：`key/name/type/api/ext/jar/click/playUrl/hide/timeout/searchable/changeable/quickSearch/indexs/categories/header/style`。
- 完整支持 `Parse` 字段和 flag/header 过滤。
- 完整支持独立 `LiveConfig` 与 Vod 内嵌 `lives`，含 `api/ext/jar/click/logo/epg/ua/origin/referer/timeZone/timeout/header/catchup/groups/boot/pass`。
- 保留现有多仓合并和直播源包装，但补齐相对路径解析、md5 jar 标记、远程/本地/ext JSON 加载缓存。
- 设置页提供配置列表、当前配置、预检、重命名、删除、刷新、配置风险提示、配置源码查看和脱敏导出。

### 4.2 点播与 CatVod 站点兼容

- type 0：XML `ac=videolist` 全流程，含首页、分类、详情、搜索、补图。
- type 1：JSON + filter，分类筛选参数用 `f=`，支持分页搜索。
- type 4：JSON + Base64 ext，分类筛选参数用 URL-safe Base64 `ext=`。
- type 3：实现 Spider 契约：
  - `init(context, ext)`
  - `homeContent(filter)` 与 `homeVideoContent()` 合并首页分类和推荐。
  - `categoryContent(tid, pg, filter, extend)`。
  - `detailContent(ids)`，解析 `vod_play_from` / `vod_play_url` 多线路多剧集。
  - `searchContent(key, quick)` 与 `searchContent(key, quick, pg)`。
  - `playerContent(flag, id, vipFlags)`。
  - `liveContent(url)`。
  - `proxy(params)` 和 `action(action)`。
  - `manualVideoCheck()` / `isVideoFormat(url)`。
  - `destroy()`。
- 跨站搜索遵守 `searchable`、`quickSearch`、`hide`、超时、并发上限和结果来源标记。
- 分类页支持 FongMi `filters`，包括默认值、筛选状态、分页、空态、错误态和取消。

### 4.3 Spider 运行时

- JS Spider：优先落地。引入 Rust 侧 JS runtime 或受控 Node worker，提供 CatVod 常用模块 shim：HTTP、Crypto、Base64、路径、日志、local proxy URL、缓存。
- Python Spider：第二阶段落地。用受控 Python worker，限制工作目录、超时、stdout/stderr、依赖加载和网络权限。
- JAR Spider：第三阶段落地。macOS 不能使用 Android DexClassLoader，采用 JVM bridge 运行兼容 CatVod Java Spider；对 Android Context 相关调用提供最小 shim。无法兼容 Android 专属 API 的 jar 标记为“不支持原因明确”，不能静默失败。
- Spider 实例按 `configUrl + siteKey + jar/api/ext` 缓存，配置切换时调用 `destroy()` 并清理 worker。
- 所有 Spider 调用统一返回 `Result` / `PlayerResult`，错误统一映射到 `AppError`，保留内部诊断但不把敏感信息扔到 UI 上。

### 4.4 解析系统

- 复刻 FongMi `ParseJob`：
  - type 0：WebView 嗅探，加载 `parse.url + webUrl`，拦截媒体 URL。
  - type 1：JSON parse，读取 `url` 或 `data.url`，提取 `ua/User-Agent/Referer/Cookie/header`。
  - type 2：JSON 扩展，把所有 type=1 解析器合并后交给 JAR/JVM parser `JsonXxx.parse(jxs, url)`。
  - type 3：JSON 聚合，把所有解析器 map 交给 JAR/JVM parser `MixXxx.parse(jxs, name, flag, url)`。
  - type 4：super parse，并行尝试适配 flag 的 type=1 JSON parse 和 type=0 WebView sniff，首个成功即取消其它任务。
- 支持 `PlayerResult.playUrl`：
  - `json:URL` 指定临时 JSON 解析。
  - `parse:名称` 指定具名解析器。
  - 普通字符串作为 Web/解析 URL 前缀。
- 支持 `PlayerResult.click` 与站点 `click`，在 WebView 嗅探中执行点击/脚本。
- 支持 `rules.regex/script/exclude`、`ads`、`headers` 注入和 `manualVideoCheck/isVideoFormat`。
- 解析诊断记录解析器名称、类型、耗时、失败原因、最终 URL 协议、脱敏 Header。

### 4.5 播放系统

- 统一播放模型：点播、直播、push、本地文件都产出 `PlaySpec`：`url/header/format/drm/subs/danmaku/artwork/desc/position/sourceKey`。
- HLS：保留 hls.js 和本地代理，补齐 manifest/segment header 透传、Range、redirect、gzip、CORS、MIME 修正、失败重试。
- DASH：补齐 `format=mpd/application/dash+xml`、headers、ClearKey/Widevine 能力边界说明。
- 原生媒体：mp4/webm/mov/flv/ts 等 URL 识别、Range 支持、格式错误诊断。
- DRM：实现 ClearKey；Widevine/PlayReady 在 macOS WebView 能力范围内检测并展示“不支持/需外部播放器”的明确提示。
- 字幕：支持 `subs` 字段，加载 srt/ass/vtt，允许本地/远程字幕手动添加。
- 弹幕：支持 `danmaku` 字段和配置级 `danmaku` 自动搜索；保留现有弹幕层并补齐开关、样式、清屏。
- 历史/继续观看：保存剧集、线路、解析来源、headers hash、position、duration、completed，支持 `PlayerResult.position`。
- 源健康：记录播放成功率、首帧耗时、连续失败、退避期，参与自动换源和直播线路排序。

### 4.6 直播系统

- TXT：支持 `名称,#genre#`、密码分组、频道行、多 URL、`ua/origin/referer/header/format/parse/click/forceKey` 指令继承。
- M3U：支持 `#EXTM3U` 全局 `tvg-url/url-tvg/catchup`，`#EXTINF` 的 `tvg-id/tvg-name/tvg-chno/tvg-logo/group-title/http-user-agent/catchup`，`#EXTHTTP`、`#EXTVLCOPT`、`#KODIPROP`。
- JSON：支持内嵌 groups/channel 全字段。
- 直播 API/Spider：支持 `Live.api` 和 `liveContent(url)`。
- EPG：支持 XMLTV、gzip、API 模板、多个 EPG URL、`{id}/{name}/{epg}` 替换、timeZone、当前/下一节目、完整日程。
- 追看/时移：支持 `catchup.type/regex/source/replace`，生成指定时间窗口的回看 URL。
- 频道体验：密码分组解锁、boot 默认源、pass 跳过密码、频道收藏、最近频道、常看排序、数字选台、键盘导航、相邻频道预加载。
- 线路：同频道多 URL 展开、手动切线、自动退避、测速、协议感知探活。

### 4.7 本地 HTTP API 与代理

- 本地服务端口按 FongMi 行为从 `9978` 到 `9998` 尝试；如被占用，选择第一个可用端口并在设置页展示。
- 保留现有随机 token 防护；FongMi 兼容端点默认仅绑定 `127.0.0.1`。
- 复刻端点：
  - `/action?do=control&type=play|pause|stop|replay|prev|next|repeat`
  - `/action?do=danmaku&text=...`
  - `/action?do=refresh&type=live|detail|player|subtitle|danmaku|vod`
  - `/action?do=push&url=...`
  - `/action?do=file&path=...`
  - `/action?do=search&word=...`
  - `/action?do=setting&text=...&name=...`
  - `/action?do=cast...` 先落本机 push/播放，DLNA 在投放阶段补齐。
  - `/cache` 读写配置/Spider 缓存。
  - `/media` 查询播放状态。
  - `/file` 只允许用户授权目录和应用数据目录，支持 Range。
  - `/upload`、`/newFolder`、`/delFolder`、`/delFile` 必须二次确认或默认关闭。
  - `/parse` 提供 WebView 解析页。
  - `/proxy` 调用 Spider/JAR/JS/Py proxy。
  - `/device` 返回 macOS 设备和服务信息。
- 本地代理支持 HLS playlist rewrite、headers、Range、Content-Range、缓存控制、MIME、错误诊断。

### 4.8 网络策略

- `doh`：实现可选 DoH resolver，含 bootstrap IP。
- `hosts`：实现配置级 DNS 覆盖。
- `proxy`：按 host/regex 匹配代理，多个代理依序尝试。
- `headers`：按 host 注入响应/请求 headers。
- `ads`：请求前拦截广告域名。
- `rules`：用于 WebView 嗅探的 host 匹配、regex 提取、script 执行、exclude 排除。
- 所有网络请求统一走 `NetworkClient`，别让配置、Spider、解析、播放各玩各的，这种代码会臭得很均匀。

### 4.9 macOS 产品层

- UI 保持 mac 桌面体验，不照搬 Android TV 布局。
- 首页：配置公告、站点切换、推荐、分类、筛选、最近观看。
- 详情页：多线路多剧集、解析状态、收藏、继续观看、跨站找源。
- 搜索页：单站/跨站、quick/full、分页、来源筛选。
- 直播页：频道树、节目单、线路、收藏、最近、数字选台、键盘导航。
- 播放器：状态机、诊断抽屉、解析来源、手动切线、字幕/弹幕/速度/PiP/迷你窗口/外部播放器。
- 设置页：配置、Spider 运行时、解析器、本地服务、网络策略、缓存、日志、隐私与安全。

## 5. 阶段计划

### Phase 0：基线清理与参考隔离

- 把 `TV/` 加入 `.gitignore` 或迁出当前仓库，避免误提交嵌套参考仓库。
- 新增兼容矩阵文档：每个 FongMi 字段/接口对应当前状态、实现位置、测试。
- 固定测试基线：`npm run check` 必须先恢复可运行；当前工作区已有大量未提交/删除状态，执行前必须确认哪些是用户改动。
- 验收：计划和矩阵能证明每个功能点有去处，不再靠脑补。

### Phase 1：配置协议完整化

- 扩展 Rust/TS 类型，覆盖 CONFIG/LIVE/SPIDER 全字段。
- 配置加载统一为 `ConfigDocument`：原始 JSON、规范化模型、解析 warnings、来源 base URL、缓存资产。
- 实现相对路径、远程资源、本地文件、md5 jar 标记、danmaku/wallpaper/logo/notice 解析。
- 设置页补齐配置源码查看、预检详情、风险提示。
- 测试：配置 golden fixtures 覆盖 VodConfig、LiveConfig、多仓、相对路径、直播包装、非法配置。

### Phase 2：HTTP 站点与点播完整闭环

- 补齐 type 0/1/4 与 FongMi `SiteApi` 行为一致性：home/homeVideo、category、detail、player、search、fetchPic、categories 白名单。
- 前端补齐分类筛选、分页、首页推荐、站点切换、错误/空态。
- 播放入口统一产出 `PlayerResult -> PlaySpec`。
- 测试：用本地 mock server 验证 XML/JSON/type4 参数、filter、search page、player parse 标记。

### Phase 3：JS Spider runtime

- 实现 JS Spider worker 和 CatVod shim。
- 接入 type=3 `.js`：所有 Spider 方法、实例缓存、destroy、proxy、action。
- 支持 JS Spider 的 HTTP、加密、缓存、相对路径和本地代理 URL。
- 测试：构造最小 JS Spider fixture，覆盖 home/category/detail/search/player/live/proxy/action。

### Phase 4：解析与嗅探

- 重构 `super_parse` 为 `ParseOrchestrator`，完整支持 parse type 0/1/2/3/4。
- 实现隐藏 WebView 嗅探窗口：请求拦截、媒体 URL 判断、rules/script/click、ads/exclude、超时取消。
- 接入解析诊断、并行取消、解析缓存。
- 测试：JSON parse mock、super parse race、WebView 嗅探 smoke、规则 regex/script 单元测试。

### Phase 5：本地 HTTP API 和 Spider proxy

- 把现有 `local_proxy` 拆成 `LocalServer`：media proxy、FongMi API、Spider proxy 三层。
- 实现 `/action`、`/media`、`/cache`、`/parse`、`/proxy`、安全 `/file`。
- 上传/删除类端点默认关闭，设置页明确开关和风险提示。
- 测试：本地 HTTP 集成测试覆盖 token、Range、HLS rewrite、proxy dispatch、action state。

### Phase 6：直播全量能力

- 补齐 LiveParser 与 FongMi 指令兼容：密码分组、KODIPROP DRM、global/channel catchup、headers 继承、boot/pass。
- 实现 `Live.api/liveContent`。
- EPG 支持 XMLTV gzip、API 模板、多 URL、完整日程、timeZone。
- 实现回看 URL 生成、频道收藏/最近/常看、数字选台和键盘导航。
- 测试：TXT/M3U/JSON golden、EPG XML/gzip/template、catchup URL、频道 UI 流程。

### Phase 7：Python 与 JAR 兼容层

- Python worker 接入 `.py` Spider，覆盖 Spider 全接口和 proxy。
- JVM bridge 接入 `csp_ClassName` JAR Spider，提供 CatVod Java 接口与最小 Android Context shim。
- JAR parser 支持 parse type 2/3 的 `JsonXxx` 和 `MixXxx`。
- 对 Android 专属、native so、Dex-only 能力输出明确不兼容原因和日志。
- 测试：最小 Java Spider jar、Json/Mix parser jar、Python Spider fixture。

### Phase 8：播放增强与源治理

- 完整 `PlaySpec`，补齐 headers、format、DRM、subs、danmaku、artwork、desc、position。
- ClearKey DRM、字幕格式、弹幕自动搜索、外部播放器、PiP/迷你窗口完善。
- 源健康数据库、退避、智能选源、自动换源、直播线路排序。
- 长时间播放、切集、切源、关闭窗口、强退恢复全链路验证。

### Phase 9：投放、文件与发布质量

- DLNA/投放能力按 macOS 可行方案实现，至少支持本机推送和外部播放器；完整 DLNA 作为高风险子计划单独验收。
- 本地文件浏览只开放用户授权目录，支持字幕/配置/媒体文件。
- 日志导出、隐私说明、许可证、签名、公证、自动更新、崩溃恢复。
- 发布验收：干净 macOS 安装、配置导入、点播、直播、解析、代理、历史恢复、4 小时播放。

## 6. 测试与验收

- 单元测试：
  - 配置解析、相对路径、字段默认值、warnings。
  - SiteApi 参数构造和 Result 规范化。
  - LiveParser golden fixtures。
  - ParseOrchestrator 决策和并发取消。
  - NetworkClient 的 DoH/hosts/proxy/ads/rules。
- 集成测试：
  - Rust mock HTTP server 模拟 XML/JSON/type4/parse/live/epg。
  - JS/Py/JVM Spider fixture 全接口。
  - LocalServer HTTP 端点、Range、HLS rewrite、Spider proxy。
  - SQLite 迁移和源健康。
- UI/烟测：
  - 配置导入到首页推荐。
  - 分类筛选和分页。
  - 跨站搜索到详情播放。
  - JSON parse 和 WebView sniff 播放。
  - 直播频道切换、EPG、回看。
  - 强退后继续观看。
- 发布门禁：
  - `npm run check` 通过。
  - Tauri debug build 通过。
  - 所有新增本地服务端点有安全测试。
  - 日志脱敏检查通过。
  - 不把 `TV/` 参考仓库提交进主仓库。

## 7. 明确风险与默认决策

- JAR/Dex 是最大坑：Android DexClassLoader 不能在 macOS 原样复刻。默认采用 JVM bridge 兼容 CatVod Java Spider，不承诺 Android-only jar 100% 可跑；每个失败 jar 必须给出可理解原因。
- WebView 嗅探有安全风险：默认隐藏窗口、超时、请求拦截、脚本白名单和配置风险提示必须一起做。
- 本地文件/上传/删除 API 高风险：默认关闭写操作；开启前 UI 明确提示影响范围。
- DoH/hosts/proxy 会影响所有请求：必须集中到 `NetworkClient`，禁止各模块绕开。
- 完全复刻不是一次 PR：必须按阶段合并，每阶段都有可运行闭环和回归测试。

## 8. 第一批执行建议

1. 先处理 `TV/` 嵌套仓库：加入 `.gitignore` 或迁出，避免误提交。
2. 建 `docs/FONGMI_COMPAT_MATRIX.md`，把 CONFIG/SPIDER/LIVE/LOCAL 每个字段和方法映射到实现状态。
3. Phase 1 从配置协议完整化开始，别上来就啃 JAR，那玩意儿坑最大。
4. Phase 3 先做 JS Spider，投入产出最高；Python/JAR 放后面。
5. Phase 4 WebView 嗅探必须和安全策略一起做，别写个能嗅到 URL 的危险玩具。
