# FongMi Compatibility Matrix

> 范围：Phase 0 基线矩阵。依据 `docs/FONGMI_FULL_REPLICA_PLAN.md`、`docs/FONGMI_UI_REPLICA_PLAN.md`、`TV/docs/CONFIG.md`、`TV/docs/SPIDER.md`、`TV/docs/LIVE.md`、`TV/docs/LOCAL.md`，对照当前 Tauri + Rust + React 实现。本文只记录现状，不提前实现 JS Spider、JAR、WebView 嗅探等后续阶段。

## 状态口径

| 状态 | 含义 |
| --- | --- |
| 已支持 | 当前代码已有可运行链路或明确测试覆盖。 |
| 部分支持 | 当前代码支持字段建模或核心子集，但缺少 FongMi 完整行为。 |
| 类型已建模 | TypeScript/Rust 类型已声明，运行时行为尚未完整接入。 |
| 未支持 | 当前没有可用实现。 |
| 不适用/待决策 | macOS/Tauri 需要另行设计替代能力。 |

## CONFIG 字段矩阵

| FongMi 项 | 当前状态 | 当前实现位置 | 验证/备注 |
| --- | --- | --- | --- |
| VodConfig `sites` | 已支持 | `src-tauri/src/config.rs`, `src-tauri/src/commands/site.rs`, `src/shared/types.ts` | 配置加载、HTTP 站点调用已有 Rust 测试和前端 store 测试。 |
| VodConfig `parses` | 部分支持 | `src-tauri/src/super_parse.rs`, `src-tauri/src/commands/site.rs`, `src/shared/types.ts` | 仅 type=1 JSON parse 子集和直链识别；type 0/2/3/4 未完整复刻。 |
| VodConfig `lives` | 部分支持 | `src-tauri/src/config.rs`, `src-tauri/src/commands/live.rs`, `src/shared/types.ts` | 可加载外部直播源和包装直播直链；Live.api/liveContent 未接入。 |
| VodConfig `spider` | 类型已建模 | `src/shared/types.ts`, `src-tauri/src/config.rs` | 多仓合并保留首个 `spider`，但没有 JAR/JS/Py 运行时。 |
| VodConfig `wallpaper` / `logo` / `notice` | 类型已建模 | `src/shared/types.ts` | 尚未形成启动公告、壁纸、Logo 的完整运行时/UI 行为。 |
| VodConfig `doh` | 类型已建模 | `src/shared/types.ts`, `src/renderer/src/pages/Settings/Settings.tsx` | 设置页有 DoH 输入状态，但 Rust 网络层没有配置级 DoH resolver。 |
| VodConfig `proxy` | 类型已建模 | `src/shared/types.ts`, `src/renderer/src/pages/Settings/Settings.tsx` | 目前没有按 host/regex 匹配的统一代理链路。 |
| VodConfig `rules` | 类型已建模 | `src/shared/types.ts` | WebView 嗅探规则、script、exclude 尚未接入。 |
| VodConfig `headers` | 类型已建模 | `src/shared/types.ts` | 站点级请求 header 可用；配置级响应 header 注入未实现。 |
| VodConfig `hosts` | 类型已建模 | `src/shared/types.ts`, `src/renderer/src/pages/Settings/Settings.tsx` | 没有配置级 DNS 覆盖。 |
| VodConfig `flags` | 部分支持 | `src/shared/types.ts`, `src-tauri/src/commands/site.rs` | `playerContent` 命令传入 `vip_flags`，HTTP Spider 当前未使用。 |
| VodConfig `ads` | 类型已建模 | `src/shared/types.ts`, `src/renderer/src/pages/Settings/Settings.tsx` | 没有统一请求拦截。 |
| VodConfig `danmaku` | 未支持 | `src/shared/types.ts` 缺字段 | 播放结果级 `danmaku` 已建模；配置级自动搜索 API 尚未声明/接入。 |
| Site `key/name/type/api` | 已支持 | `src/shared/types.ts`, `src-tauri/src/commands/site.rs`, `src-tauri/src/spider.rs` | type 0/1/4 HTTP 站点可调用；type 3 被预检标记为不直接支持。 |
| Site `ext` | 部分支持 | `src/shared/types.ts`, `src-tauri/src/commands/site.rs` | 已读入 `SiteConfig.ext`；type 4 Base64 ext 参数未按 FongMi 完整传递。 |
| Site `jar` | 类型已建模 | `src/shared/types.ts` | 无 JAR/JVM bridge。 |
| Site `click` / `playUrl` | 部分支持 | `src-tauri/src/spider.rs`, `src-tauri/src/super_parse.rs` | HTTP playerContent 会回传；`playUrl` fallback 子集可用，click/WebView 行为未接入。 |
| Site `hide/searchable/timeout/header` | 已支持 | `src-tauri/src/commands/config.rs`, `src-tauri/src/commands/site.rs`, `src-tauri/src/spider.rs` | 用于预检、跨站搜索、HTTP 请求超时和 header。 |
| Site `changeable/quickSearch/indexs/categories/style` | 类型已建模 | `src/shared/types.ts` | 前端/运行时未完整实现 FongMi 行为；`quickSearch` 只在筛选搜索候选时有基础判断。 |
| Parse `name/type/url/ext.flag/ext.header` | 部分支持 | `src/shared/types.ts`, `src-tauri/src/super_parse.rs` | type=1 会遍历请求；flag/header 过滤不完整，type 0/2/3/4 缺。 |
| LiveConfig 顶层 `spider/lives/proxy/rules/headers/hosts/ads` | 部分支持 | `src/shared/types.ts`, `src-tauri/src/config.rs`, `src-tauri/src/commands/live.rs` | `lives` 可加载；网络策略字段未运行时接入。 |
| Live `name/url/groups` | 已支持 | `src/shared/types.ts`, `src-tauri/src/commands/live.rs`, `src-tauri/src/live.rs` | 可按配置选择直播源并解析外部内容；内嵌 groups 主要作为类型/配置数据存在。 |
| Live `api/ext/jar` | 未支持 | `src/shared/types.ts` | 未接 `liveContent(url)` 或 live Spider runtime。 |
| Live `click/logo/epg/ua/origin/referer/timeZone/timeout/header/catchup/boot/pass` | 部分支持 | `src/shared/types.ts`, `src-tauri/src/live.rs` | 直播解析会产出频道级 header、format、parse、click、catchup、DRM 等子集；启动源、密码分组 UI、EPG 完整行为未复刻。 |
| Group `name/pass/channel` | 部分支持 | `src-tauri/src/live.rs`, `src/shared/types.ts` | TXT/JSON 可解析 `pass`；前端密码解锁交互未完整实现。 |
| Channel `name/urls/number/logo/epg/ua/click/format/origin/referer/tvgId/tvgName/header/parse/catchup/drm` | 部分支持 | `src-tauri/src/live.rs`, `src/shared/types.ts` | 解析器可产出大部分字段；播放层对 DRM、catchup、EPG 调度只覆盖子集。 |

## SPIDER 方法矩阵

| FongMi/CatVod 方法 | 当前状态 | 当前实现位置 | 验证/备注 |
| --- | --- | --- | --- |
| `init(context, ext)` | 未支持 | 无 type=3 runtime | HTTP Spider 不需要 init；JS/Py/JAR 后续阶段处理。 |
| `homeContent(filter)` | 部分支持 | `src-tauri/src/spider.rs`, `src-tauri/src/commands/site.rs` | HTTP type 0/1/4 子集可用；type=3 未支持。 |
| `homeVideoContent()` | 未支持 | 无独立方法 | 当前 homeContent 可返回 list，但没有按 FongMi 独立调用推荐。 |
| `categoryContent(tid, pg, filter, extend)` | 部分支持 | `src-tauri/src/spider.rs` | HTTP 分类和 JSON `f=` 子集可用；type 4 ext Base64 不完整。 |
| `detailContent(ids)` | 部分支持 | `src-tauri/src/spider.rs` | HTTP XML/JSON 详情可用。 |
| `searchContent(key, quick)` / `searchContent(key, quick, pg)` | 部分支持 | `src-tauri/src/spider.rs`, `src-tauri/src/commands/site.rs` | HTTP 搜索和跨站搜索子集可用；繁简转换、quick 完整语义未实现。 |
| `playerContent(flag, id, vipFlags)` | 部分支持 | `src-tauri/src/spider.rs`, `src-tauri/src/super_parse.rs` | HTTP 站点返回直链/需解析判断；FongMi PlayerResult 字段只覆盖部分。 |
| `liveContent(url)` | 未支持 | 无 Spider live 调用 | Live.api/type=3 直播后续阶段处理。 |
| `proxy(params)` | 未支持 | `src-tauri/src/local_proxy.rs` 仅媒体代理 | 当前 `/stream` 是媒体代理，不会分派到 Spider proxy。 |
| `action(action)` | 未支持 | 无 Spider action 调用 | Vod `action` 字段 TS 已声明，但运行时未接。 |
| `manualVideoCheck()` / `isVideoFormat(url)` | 部分支持 | `src-tauri/src/spider.rs` | 内置 `is_video_format` 可识别常见媒体 URL；Spider 自定义判断未支持。 |
| `destroy()` | 未支持 | 无 type=3 runtime | 没有 Spider 实例生命周期缓存。 |
| Result `class/filters/list/pagecount/msg` | 部分支持 | `src/shared/types.ts`, `src-tauri/src/spider.rs` | Rust Result 缺 `msg`，TS 已声明；filters 作为 Value 透传。 |
| Vod `vod_*` 基础字段 | 部分支持 | `src/shared/types.ts`, `src-tauri/src/spider.rs` | Rust Vod 缺 `action/cate/land/circle/ratio/style` 等展示扩展。 |
| PlayerResult `url/parse/playUrl/click/header` | 部分支持 | `src/shared/types.ts`, `src-tauri/src/spider.rs` | TS 覆盖更多字段；Rust 当前只返回基础字段。 |
| PlayerResult `format/danmaku/subs/drm/artwork/desc/position/lrc` | 类型已建模/未支持 | `src/shared/types.ts` | TS 覆盖 `format/danmaku/subs/drm/artwork/desc/position`，Rust HTTP player 未产出，`lrc` 未建模。 |

## LIVE 格式矩阵

| FongMi LIVE 项 | 当前状态 | 当前实现位置 | 验证/备注 |
| --- | --- | --- | --- |
| 自动识别 JSON/M3U/TXT | 已支持 | `src-tauri/src/live.rs` | `parse_live_content` 自动判断；有 Rust 单元测试。 |
| TXT `名称,#genre#` 分组 | 已支持 | `src-tauri/src/live.rs` | 覆盖普通分组和首个频道前默认分组。 |
| TXT 密码分组 | 部分支持 | `src-tauri/src/live.rs` | 当前解析 `#genre#_pass` 形态；FongMi 文档的 `名称_密码,#genre#` 形态需要继续对照补齐。 |
| TXT 多线路 `#` | 已支持 | `src-tauri/src/live.rs` | 解析为 `Channel.urls`。 |
| TXT/M3U 行内 header `|key=value` | 已支持 | `src-tauri/src/live.rs` | 合并到频道 header。 |
| 指令 `ua/origin/referer/header/format/parse/click/forceKey` | 部分支持 | `src-tauri/src/live.rs` | 除 `forceKey` 没有落到 DRM/播放行为外，其余可映射到频道字段。 |
| M3U `#EXTM3U tvg-url/url-tvg` | 未支持 | `src-tauri/src/live.rs` | 当前只解析全局 catchup，不解析全局 EPG URL。 |
| M3U 全局/频道 catchup | 部分支持 | `src-tauri/src/live.rs` | 解析 type/source/replace；回看 URL 生成/UI 未完成。 |
| M3U `#EXTINF` `tvg-id/tvg-name/tvg-chno/tvg-logo/group-title/http-user-agent` | 已支持 | `src-tauri/src/live.rs` | 映射到频道字段和分组。 |
| M3U `#EXTHTTP` / `#EXTVLCOPT` | 已支持 | `src-tauri/src/live.rs` | 支持 HTTP header、UA、Referer、Origin。 |
| M3U `#KODIPROP` DRM/format/header | 部分支持 | `src-tauri/src/live.rs` | 可解析 license_type/key/drm_legacy/manifest_type/headers；播放层 DRM 能力未完整。 |
| JSON `List<Group>` | 已支持 | `src-tauri/src/live.rs` | 支持 group/channel 基础结构。 |
| EPG XMLTV/gzip/API 模板 | 部分支持 | `src-tauri/src/epg.rs`, `src-tauri/src/commands/live.rs` | 代码中有 EPG 模块；与 FongMi 多 EPG、模板替换、完整日程仍需专项核对。 |
| boot/pass 默认行为 | 未支持 | `src/shared/types.ts` | 字段存在，启动选择和密码跳过行为未完整接入。 |
| 频道收藏/最近/常看/数字选台/相邻预加载 | 部分支持/未支持 | `src/renderer/src/pages/Live/Live.tsx`, `src-tauri/src/database.rs` | 当前已有直播页、频道树、刷新测速等基础；FongMi 体验项未完整复刻。 |

## LOCAL 端点矩阵

| FongMi LOCAL 端点 | 当前状态 | 当前实现位置 | 验证/备注 |
| --- | --- | --- | --- |
| 端口 `9978..9998` 顺序尝试 | 未支持 | `src-tauri/src/local_proxy.rs` | 当前绑定 `127.0.0.1:0` 随机端口，并返回 token。 |
| Token/本地绑定保护 | 已支持 | `src-tauri/src/local_proxy.rs` | `/stream` 要求 token，绑定 `127.0.0.1`。 |
| `/stream` 媒体代理 | 已支持 | `src-tauri/src/local_proxy.rs`, `src-tauri/src/hls.rs` | 支持 HTTP(S)、Range 透传、HLS playlist rewrite、SSRF 防护。 |
| `/action?do=control` | 未支持 | 无本地 HTTP action server | 播放控制目前在前端 store/组件内。 |
| `/action?do=danmaku` | 未支持 | 无本地 HTTP action server | 弹幕层存在，但本地端点未接。 |
| `/action?do=refresh` | 未支持 | 无本地 HTTP action server | Tauri 内部有 live refresh command，不是 FongMi HTTP 端点。 |
| `/action?do=push` | 未支持 | 无本地 HTTP action server | 无本地推送播放端点。 |
| `/action?do=file/search/setting/cast/sync` | 未支持 | 无本地 HTTP action server | 需 Phase 5 设计安全边界。 |
| `/cache?do=get/set/del` | 部分支持 | `src-tauri/src/commands/cache.rs`, `src-tauri/src/database.rs` | Tauri command 有 cache get/set/del；不是 FongMi 本地 HTTP `/cache`。 |
| `/media` | 未支持 | 无本地 HTTP media endpoint | 播放状态在前端 store，不通过本地 HTTP 暴露。 |
| `/file/{path}` | 未支持 | `src-tauri/src/path_safety.rs` 可复用 | 当前没有本地文件浏览/下载端点。 |
| `/upload` / `/newFolder` / `/delFolder` / `/delFile` | 未支持 | 无 | 高风险写操作，后续默认关闭并加确认。 |
| `/parse` | 未支持 | 无 WebView parse page | WebView 嗅探/parse.html 未实现。 |
| `/proxy` Spider 代理 | 未支持 | `src-tauri/src/local_proxy.rs` 仅媒体代理 | 不会调用 `Spider.proxy(params)`。 |
| `/device` | 未支持 | 无 | 需要 macOS 设备信息替代模型。 |

## UI 页面与入口矩阵

| FongMi 页面/弹窗 | mac-tv 对应 | 当前状态 | 当前实现位置 |
| --- | --- | --- | --- |
| `HomeActivity` / `VodFragment` | Home | 部分支持 | `src/renderer/src/pages/Home/Home.tsx` |
| `VodActivity` / `TypeFragment` | Home 分类视图 | 部分支持 | `src/renderer/src/pages/Home/Home.tsx`, `src/renderer/src/stores/useConfigStore.ts` |
| `VideoActivity` | VodDetail + VideoPlayer | 部分支持 | `src/renderer/src/pages/VodDetail/VodDetail.tsx`, `src/renderer/src/components/VideoPlayer/VideoPlayer.tsx` |
| `SearchActivity` | Search | 部分支持 | `src/renderer/src/pages/Search/Search.tsx` |
| `LiveActivity` | Live | 部分支持 | `src/renderer/src/pages/Live/Live.tsx`, `src/renderer/src/components/LiveTree/LiveTree.tsx` |
| `KeepActivity` | Keep | 部分支持 | `src/renderer/src/pages/Keep/Keep.tsx` |
| `HistoryActivity` | History | 部分支持 | `src/renderer/src/pages/History/History.tsx` |
| `SettingActivity` | Settings | 部分支持 | `src/renderer/src/pages/Settings/Settings.tsx` |
| `PushActivity` | Settings 本地服务区 | 未支持 | Settings 只展示当前 local proxy info。 |
| `CastActivity` | 播放器/设置投放入口 | 部分支持 | `src/renderer/src/utils/ipc.ts` 有 `dlna:cast` API，UI 入口需继续核对。 |
| `CrashActivity` | Error recovery | 部分支持 | `src/renderer/src/components/ErrorBoundary.tsx` |
| `FileActivity` / `FolderActivity` | Settings 或独立文件视图 | 未支持 | 无内置文件浏览 UI。 |
| Parse/Speed/Subtitle/Danmaku/Track/Edition/Chapter/History/Live/Pass/Config/DoH 等 Dialog | Drawer/Menu/Modal 体系 | 部分支持/未支持 | `VideoPlayer` 有倍速、诊断、弹幕开关等子集；统一弹窗体系未建立。 |
| 全局导航：首页/直播/搜索/历史/收藏/设置 | Sidebar | 已支持 | `src/renderer/src/components/Sidebar/Sidebar.tsx` |

## 当前测试基线

| 覆盖点 | 当前测试/验证入口 |
| --- | --- |
| 配置解析、多仓、直播包装、GitHub fallback | `src-tauri/src/config.rs` 单元测试 |
| HTTP Spider、XML 解析、直链识别 | `src-tauri/src/spider.rs` 单元测试 |
| Live TXT/M3U/JSON、指令、DRM 子集 | `src-tauri/src/live.rs` 单元测试 |
| 本地媒体代理安全与 Range | `src-tauri/src/local_proxy.rs` 单元测试 |
| super parse 直链、缓存、JSON parse 错误 | `src-tauri/src/super_parse.rs` 单元测试 |
| 前端配置 store、直播 store、播放诊断 | `tests/config-store.test.ts`, `tests/live-store.test.ts`, `tests/player-store.test.ts` |
| 全量工程检查 | `npm run check`，但当前工作区存在大量既有未提交/删除状态，Phase 0 只做文档和 ignore 变更时不强行修复全量基线。 |

## Phase 0 结论

- `TV/` 是 FongMi 本地参考仓库，已通过主仓 `.gitignore` 隔离，避免误提交。
- 当前 mac-tv 已有 TVBox/CatVod HTTP 站点、直播解析、媒体代理和播放器基础，但离 FongMi 完整复刻还差 type=3 Spider runtime、完整解析/嗅探、本地 HTTP API、网络策略、直播高级行为和 UI 弹窗体系。
- 后续 Phase 1 应先扩展配置协议和规范化模型；不要跳阶段直接啃 JAR/WebView，这坑不是一般深。
