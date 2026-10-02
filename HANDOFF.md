# HANDOFF — 跨 Agent 交接单

## 接手顺序

1. 本文件与 `AGENTS.md`。
2. `docs/SUBSCRIPTION_PLAYBACK.md`：当前进度、架构决策、验证与兼容边界。
3. 相关代码：`src-tauri/src/commands/`、`src/renderer/src/stores/`、`src/renderer/src/pages/`。

## 当前状态

- 修复：`DownloadPanel` 被 import、`showDownloads` state 与 `download:openPanel` 事件监听都齐全，**但 JSX 里从未渲染它** → 点侧边栏「下载」或播放器「下载」按钮毫无反应。已补上渲染（`App.tsx` 根部）。下载工具链本身没问题：应用包内已带 `ffmpeg`，系统另有 `ffmpeg` / `yt-dlp`。
- 排查工具：`cargo run --example net_probe -- <url>...`（用应用自身的 `network::http_get` 复测，带耗时），
  `cargo run --example drpy_probe -- <api> [ext] [关键词]`（支持 `DRPY_TID/DRPY_PAGE/DRPY_FILTER/DRPY_EXTEND` 指定真实分类参数）。
- 直播源「打开就报错」的现状：日志里的 `[live:refresh] 直播源下载失败` 全部是上游问题（域名失效/404/403/
  写死在 TVBox 本地代理 `127.0.0.1:9978`/本机网络不可达，已逐个用 curl + 应用同款 UA 复核）。
  唯一例外的 `clun.top` 经应用自身代码路径复测为 2.2s 成功——当时是并行探针把网络挤占导致的瞬时超时。
- 最后更新：2026-10-02，**冷启动不再长时间转圈（首页秒开 + 进度可见 + 总预算）**：
  - 现象：用户反馈"点开就是一个动画，首页呢？"。根因：启动时按候选站点**串行**尝试（最多 6 个），
    单站超时不可控，且缓存预读只覆盖"第一个"候选站 → 没有缓存时就是长时间 spinner。
  - 改法：① 启动先扫一遍候选站的 24h 缓存，**任一命中就立刻渲染首页**（实测日志 `启动秒开（命中缓存）: 360`）；
    ② 加载文案带进度「正在尝试第 N/M 个站点：站点名…」；
    ③ 自动找站加**总预算 25 秒**，超时即停并提示手动选站（不再无限转圈）。
  - 前端日志桥新增**启动链路转发**（`[ConfigStore]`/`[App]`/`[Live]`/`[continuity]`/`[stats]` 前缀的 console.log 也进应用日志），
    这类"卡在哪一步"的问题以后可直接从日志判断。
  - 实测（/Applications 的包）：`getCurrentUrl: https://clun.top/box.json` → `sites: 92 visibleSites: 23`
    → `启动秒开（命中缓存）: 360` → 无前端 error。
- 最后更新：2026-10-02，**直播=录制按钮 / 点播=下载按钮（并统一两个 App 入口）**：
  - 播放器用 `kind: 'vod' | 'live'` 区分（Live.tsx 传 live）：直播显示红色录制按钮，点播显示下载图标。
    录制按钮在宽屏带「录制/停止」字样、窄屏（含小窗）只留红点，与"窄屏不被文字挤占"的约定一致。
  - **`/Applications/IPTV Mac.app` 已同步为最新构建**（旧版 2026-09-06 备份为 `IPTV Mac.app.bak-20260906`）。
    之前用户从启动台打开的是 9 月 6 日旧版，所以看到的是旧界面（直播是下载按钮）——这是本轮"改了却没生效"的真正原因。
    注意：`cp -R` 覆盖已存在的 .app 会套娃，必须先 `rm -rf` 目标再拷。
  - 教训：**改完要同步用户实际会打开的那个入口**，并核对 md5，而不是只看 debug bundle。
- 最后更新：2026-10-02，**小窗整块可拖 + 码率/速度面板开关（并修掉"开关一关就没数据"）**：
  - 小窗拖动：不再依赖顶部那条窄拖动条——小窗模式下**按住画面任意位置即可拖窗口**
    （`windowApi.startDragging()` → `plugin:window|start_dragging`；按钮/进度条/下拉等可交互元素与
    `[data-no-window-drag]` 已排除，进度条不会变成拖窗口）。Tauri 的 `data-tauri-drag-region="deep"` 没用在这里：
    它会跳过按钮却吞掉进度条 div，且双击会触发窗口最大化、与播放器双击全屏冲突。
  - 码率/速度面板：底部控制栏有开关按钮（`Activity` 图标，`aria-pressed`，持久化 `iptv.showStreamStats.v2`）。
    **采样与开关解耦**——采样一直跑、只有显示受开关控制，避免"关一次之后打开要等一轮/被陈旧值带偏"。
    键名带 `.v2`：早期调试残留在 WebKit localStorage 里的 `'0'` 曾把面板默认藏起来（这次踩到并已规避）。
  - 实测（smoke，点播 HLS）：码率 2,349 Kbps / 速度 735 Kbps；进小窗后 929/576 → 834/848（自适应码率切换所致）。
  - **教训**：连续性 smoke 会驱动真实窗口（全屏→小窗→ESC），在用户正在使用时不要反复跑；
    只在需要时跑，或先说明。- 最后更新：2026-10-02，**右上角码率/速度面板修好 + 底部加显隐开关**：
  - 「一直不显示」的真因有两个：① macOS 走**原生 HLS**（`video.src = currentUrl`），统计只挂在 **HLS.js 分片事件**上
    → 原生路径永远没有数据；② 本地代理的字节统计挂错了地方——`content_length.is_some()` 的媒体体走 `stream.write_all`
    直接写出、没有计数（只有 chunked 分支计了）。现在计数放进真正的写出循环，两条分支都算。
  - 数据源重新设计（对原生/HLS.js 都成立）：
    **速度** = 本地代理真实转发吞吐（新增 `proxy:throughput`，返回瞬时 kbps + 累计字节）；
    **码率** = HLS.js 声明值 → 解码字节增量（若浏览器暴露）→ **缓冲窗口法**（转发字节增量 ÷ 已缓冲时长增量）。
    实测 AJA 直播：码率 ≈ 3.7 Mbps、速度 14~23 Mbps（下载领先播放地灌缓冲），两者不再相同 ✅
  - 底部控制栏新增开关按钮（`Activity` 图标，`aria-pressed`），面板显隐持久化到 `iptv.showStreamStats`（默认显示）。
  - smoke 采样顺带输出码率/速度，便于以后回归验证。
- 最后更新：2026-10-02，**回到页面播放的出口 + 直播「录制」用语与红色录制按钮**：
  - 出口（都验证过不中断播放）：全屏 → 同一个最大化按钮 / 双击画面 / **ESC**；小窗 → 顶部「返回」/ **ESC** /
    播放器控制栏同一个按钮（现在是切换语义）。全屏状态新增 `window:isFullscreen` 查询 + `fullscreenchange`/focus/resize 同步，
    用系统绿灯键退出后 UI 不会再卡在全屏样式上。ESC 在小窗模式下也由播放器兜底（不依赖 MiniChrome 是否渲染）。
    smoke 增加 ESC 退全屏 / ESC 退小窗两步，实测 `advancing=true`、`stableInstances=true`。
  - **点播叫「下载」、直播叫「录制」**：播放器加 `kind: 'vod' | 'live'`（Live.tsx 传 live），任务 `live: true` 输出 TS；
    下载页改「下载 / 录制」，直播任务显示「录制中 + 录像」角标。
  - **红色录制按钮**（用户指定）：录制中**闪烁**、其余（含录完）**常亮**；状态集中到 `stores/useRecordingStore`，
    直播页与播放器控制栏共用（原来两套状态会各说各话）；文件名用频道名。
  - **窄屏被挤占**：下载/录制按钮改为**纯图标**（语义放 title/aria-label），控制栏允许换行、
    时间文本 `hidden sm:inline`、右侧按钮组 `shrink-0`。
- 最后更新：2026-10-02，**补齐 JS 宿主契约：rsaX / getPort / getProxy / js2Proxy**：
  - `rsaX(mode, pub, encrypt, input, inBase64, key, outBase64)` 语义对齐 FongMi `Crypto.rsa`：
    PEM→base64 DER（pub 走 X.509 SPKI、私钥走 PKCS#8，内部还要再解一层 SEQUENCE）、
    `RSA/PKCS1`（v1.5 填/去填充）与 `RSA/None/NoPadding`、inBase64/outBase64 开关；纯 BigInt 实现，无新依赖。
    **与 openssl 对拍**：解密 `openssl pkeyutl -encrypt` 的密文得到原文、NoPadding 加密逐字节一致、自往返一致。
  - `getPort()` 返回真实本地代理端口；`getProxy(local)` 返回 `<回环|局域网>/stream?token=<token>&do=js`
    （FongMi 约定，站点续 `&url=`/`&header=` 即可）；`js2Proxy(dynamic, siteType, siteKey, url, headers)` 按 FongMi 拼 URL。
    实现在 Rust 侧生成的 shim（`proxy_shim_source`，单一定义来源），集成测试会真起一个代理再在真实 JS 上下文里校验。
  - 踩过的坑：JS 位运算只有 32 位，base64 逐字符累积位在大输入上会溢出（改成 4 字符一组）；
    PKCS#8 私钥里 `AlgorithmIdentifier` 不能漏跳；裸上下文没有 `console`，日志要 try/catch。
- 最后更新：2026-10-02，**小窗/全屏不打断播放（已自动验证）+ 备选源做实 + 直播状态以真实播放为准**：
  - 小窗中断的根因是**换组件=换播放器实例**；现在同一个 VideoPlayer 始终挂载，小窗只是布局状态
    （`fixed inset-0 z-[9001]` 盖在黑遮罩上），新增 `components/MiniChrome`（拖动条+返回+ESC），
    `MiniPlayer` 仅作冷启动 `?mode=mini` 兜底。**进小窗前会先退出全屏**（浏览器全屏 + 原生窗口全屏），
    并加 `ensurePlaying` 兜底续播。
  - **自动验证**（复用 alpha smoke 通道）：`IPTV_ALPHA_PLAYBACK_SMOKE=1 IPTV_ALPHA_PLAYBACK_SMOKE_MEDIA_URL=<源>
    IPTV_CONTINUITY_SMOKE=1` 启动后，VideoPlayer 会依次 播放→全屏→小窗→还原 并采样，
    结果以 `[renderer/info] [continuity] {...}` 落日志（`advancing` 必须 true、`stableInstances` 必须 true）。
    实测：HLS 点播 `advancing=true`（t 9.99→12.13→18.17→19.67，全程 paused=false）；直播（Al Jazeera）
    `advancing=true`（t 30→30.04→36.07→37.57）。注意 StrictMode 下脚本用模块级标记只跑一次。
  - **备选源**：`switchToAlternativeSource`/`pickAlternativeSource` 本来就有，但 UI 只渲染了数量（死代码）。
    现在铺成一排可点 chip（站点名+备注）+「重新搜索」，点击直接切源。
  - **直播状态以真实播放为准**：新增 `live:reportLineResult`（`apply_playback_result` 纯函数 + 单测）——
    播放器真的播起来就覆盖「无信号」并刷新 `tested_at`，频道级状态重算；同时**判死结论 5 分钟过期**（可播仍 30 分钟），
    避免"显示无信号、双击却能播"长时间存在。
- 最后更新：2026-10-02，**小窗播放中断的根因修复（换组件 → 换布局）**：
  - 之前只做了"加固"（校验播放状态、失败给提示、还原窗口尺寸），**没解决中断本身**。根因是架构性的：
    `App` 在小窗模式下 `return <MiniPlayer/>`，等于**卸载主播放器再新建一个播放器实例** →
    HLS 重新拉清单、重新缓冲，直播还无法 seek 回原位置，用户看到的就是"切小窗画面中断"。
  - 现在：**同一个 VideoPlayer 实例始终挂载**，小窗只是它的一个布局状态
    （`fixed inset-0 z-[9001]`，铺满小窗并盖在 App 的黑色遮罩 `z-[9000]` 之上）；
    新增 `components/MiniChrome`（拖动条 + 返回按钮 + ESC），它**不渲染 video**。
    `MiniPlayer` 只在冷启动 `?mode=mini` 且没有活播放器时兜底恢复。
  - 保证不重建：HLS 初始化的依赖仍是 `[currentUrl, playHeader, playKey]`，**不含小窗状态**；
    小窗相关只有一条"清过渡样式"的 effect。新增标记日志 `[VideoPlayer] 初始化 HLS 实例（切小窗不应再出现此行）`
    —— 复现时若该行再次出现，说明又重建了播放器。
  - 回归测试 `tests/mini-player-continuity.test.ts`（4 条）：初始化依赖、层级、不走旧路径、控件层无 video。
- 最后更新：2026-10-02，**取长补短（DoH 并入）+ 目录收敛为单一项目**：
  - **DoH 并入**：以 `port-pending` 的网络层为底合并 `src-tauri/src/network.rs`（DoH 解析 + 失败重试 + 截断检测），
    保留我们的 `looks_like_config_payload`；`config.rs` 接上配置级 `doh` 字段（`network::set_doh_endpoint`），
    TVBox 配置拉取改走 **DoH 优先**的 `http_get_tvbox_config`。实测饭太硬（47 站点）、王二小（63 站点）稳定加载；
    `fty.xxooo.cf`、`cdn.qiaoji8.com` 是 DNS 记录本身已消失（DoH 也查不到），南风 401。
  - **播放标签记忆**：首页分类标签/二级筛选从组件 `useState` 提到 `useConfigStore`，进播放页返回后保持原标签。
  - **小窗加固**：进小窗前校验播放状态已保存（否则不进、给错误）；MiniPlayer 无地址时显示「未能恢复播放」+ 返回按钮；
    退出小窗还原进入前尺寸。新增**前端日志桥**（`log:frontend`）—— WebView 的 error/warn 会落进 `/tmp/iptv-app.log` 的 `[renderer/...]`。
  - **目录收敛**：删除过时数据目录 `mac-tv`(366M)、`iptv-mac`(298M)、`IPTV`(92K)（历史已并入正式库，23 条）；
    删除 `port-pending`（产物全部并入：decoder/network/resume；`docs/NETWORK_LAYER.md` 已归档进本仓库 docs）；
    删除重复 FongMi 检出 60M、`TVBoxOSC`(488K，可克隆)、`tvbox/TVBoxmacOS`(348M，源码归档到 `IPTV/_archive/`)；
    清理 `target/debug/{incremental,examples}` 3.7G。**此后只维护 `~/sobey/ai/iptv-mac` 一个项目**；
    `~/sobey/ai/IPTV` 仅作参考/归档（FongMi 检出 + 审计日志 + `_archive/`）。
- 最后更新：2026-10-02，**找回被"数据目录分叉"弄丢的观看记录**：
  - 现象：用户昨晚（10-01 22:47 ~ 10-02 00:09）看的片子在历史里"消失"。原因：那个实例是用
    **`IPTV_TEST_DATA_DIR=/Users/seldoms/sobey/ai/IPTV/obs-20261001-1925/data`** 启动的（测试隔离用），
    记录写进了那份数据目录；今天不带该变量重启 → 走了默认目录 `~/Library/Application Support/com.iptvmac.desktop`，
    于是历史看起来"回到旧版本"。
  - 已把旧目录 `iptv.db` 的 history/keep 合并回正式库（4 条历史 + 1 条收藏，另刷新 12 条），
    合并前两个库都备份为 `*.merge-bak-20261002-101958`。
  - **教训**：`IPTV_TEST_DATA_DIR` 只在冒烟测试里用，绝不能拿它跑日常使用；排查"数据不见了"先确认实例用的是哪个数据目录
    （`app.path().app_data_dir()` = `com.iptvmac.desktop`，可用 `ps eww <pid> | grep IPTV_TEST_DATA_DIR` 核对）。
  - 顺带确认：磁盘上另有历史库 `~/Library/Application Support/mac-tv/iptv.db`（6-14）与 `iptv-mac/iptv.db`（6-04），
    是更早的 bundle id 留下的，未再写入。
- 最后更新：2026-10-02，**测活策略重做（增量+限速+限时+优先级）+ 关于页精简**：
  - 旧策略问题：每次刷新都从直播源重新解析，上一轮结果不带过来 → 两万条线路**全量重测**；
    固定 16 并发 + 8s 超时，同源大量频道互相挤爆 → 大面积误判；没有时间预算，被中断就卡在 `refreshing`。
  - 新策略（`commands/live.rs` + `live.rs`）：
    ① **增量**：`LiveLine.tested_at` + `LIVE_PROBE_TTL_SECS=30min`，刷新时先用上次快照回填（`seed_probe_results`，按 URL 匹配），
       只测「没测过/已过期」的线路；② **限时**：`LIVE_PROBE_BUDGET_SECS=180`，到点即停、剩下的下轮再测（保证刷新能收尾）；
    ③ **按主机限流**：`PER_HOST_CONCURRENCY=2`（同一源站不再被自己打爆）；④ **自适应并发**：AIMD 4→8→20，连续 3 次失败减半；
    ⑤ **优先级**：`live::probe_priority` —— 0=中文/CCTV/卫视/港台，1=国际知名台（BBC/CNN/NHK/HBO…），2=其它，
       探测队列按优先级排序，让有限的预算先花在最常看的频道上。
  - 状态语义：`-2=未验证`、`-1=不可用`、`>=0=可达`（0ms 也算可达）；UI 明确显示「未验证」，悬浮可看「X 分钟前探测过」。
  - 关于页：按用户要求**只保留版本号**，移除图标/标题/检查更新/基于 FongMi/本地服务/API Token；
    随之失效的 `ChevronRight` 导入与 `localServer` 状态+取数一并删除（不留死代码）；新增 `tests/about-section.test.ts`。
- 最后更新：2026-10-02，**直播码率/速度显示修复**：
  - 码率：自动清晰度时 `hls.currentLevel` 是 `-1`，旧代码 `hls.levels[-1]` 取到 undefined，经常显示 `--` 或退化成按两次分片间隔估算的离谱值；
    现在回退到 `hls.loadLevel`（正在加载的清晰度），优先用清单声明码率，退化时才用分片平均。
  - 速度：旧代码优先用 `hls.bandwidthEstimate`（链路容量估算，动辄几十 Mbps），退路又是「两次分片完成的间隔」
    （直播分片之间有等待，会把速度算到接近 0）。现在改为**本次分片实际下载耗时**测得的吞吐，并做指数平滑。
  - 异常值防护：非有限/非正/超过 500Mbps 的尖峰一律丢弃并沿用上次有效值；切换地址时清空统计，避免沿用上一个频道。
  - 纯函数抽到 `utils/format.ts`（`formatThroughput`/`smoothThroughput`）并加 8 个测试；悬浮可看两个数字的口径说明。
- 最后更新：2026-10-02，**直播探测误判 + 静默换订阅修复**：
  - 「显示无信号但其实能播」有两个原因：① 单线路探测超时写死 **3s**（慢速源全判死，实测同样频道 8s 全部可播）→
    改为 `LIVE_PROBE_TIMEOUT_MS = 8000`；② `latency = -1` 同时表示「探测失败」和「还没探测」，UI 把 `<=0`
    一律显示「不可用」→ 现在 **-2 = 未探测**（不显示）、**-1 = 探测不通**（不可用）、`>=0` 可达（0ms 也算可达）。
    涉及 `commands/live.rs`、`database.rs` 默认值、`ChannelItem`/`LiveTree`/`Live.tsx` 三处 UI；旧库里 9746 行误判值已一次性迁到 -2。
  - 巡检被强杀会永远停在 `refreshing`（既不重测也不刷新）→ 启动时复位为 `idle`。
  - **去掉静默换订阅**：启动时上次订阅加载失败会挨个试别的订阅并悄悄切过去（日志「已切换到备用订阅」），
    而播放记录/收藏按 siteKey 关联，一切换用户就看到「记录不是之前那个版本」。现在保留用户选择，让他手动重试/切换。
    本次已把 `currentUrl` 恢复为当时的「宝盒备用」（实测可正常加载，77 站点）。
  - 回归守卫：`tests/live-latency.test.ts`（-2 不显示、-1 才不可用、0ms 可达、着色区间）。
- 最后更新：2026-10-02，**直播列表布局修复**（用户反馈：状态文字把频道名全挡住、列表宽度不可调）：
  - `ChannelItem` 重排：**频道名独占第一行**（`flex-1 min-w-0` + `truncate`），「不可用」/「N/M 线路」移到第二行（`mt-0.5`）；
    播放按钮改成 7×7 图标按钮（保留 `aria-label`/`title`）——此前这些文字都是 `shrink-0` 抢宽度，名字被挤没。
  - 直播频道列表**宽度可拖动**：列宽从写死的 `wide:w-56`(224px) 改为内联宽度 + 右侧 `cursor-col-resize` 拖动条
    （夹取 200–600px，双击复位 264px），宽度写入 `localStorage['iptv.liveListWidth']`；窄屏仍为整行布局。
  - 回归守卫：`tests/live-list.test.ts`（名字独占一行 / 无首字占位 / 图标按钮 / 可拖动与夹取）。
- 最后更新：2026-10-02，**饭太硬订阅终于能加进来了 + 两处 UI 修复**：
  - 补齐两个缺失能力（此前饭太硬接口一律报「无法识别配置格式」）：
    1. **移植 FongMi Decoder**：`src/decoder.rs`（`port-pending/` 里躺了很久的成稿，565 行 + 17 个自带测试），
       并在 `config.rs::parse_config_or_live_source` 入口处解码 `[A-Za-z0-9]{8}**` 的 stego-base64 与 `2423` hex+AES。
    2. **配置拉取改用 TVBox 约定 UA**：`network::http_get_tvbox`（`okhttp/3.12.13`）+ 内容不像配置时用浏览器 UA 兜底
       （`fetch_config_text`）。实测 `tvbox.xn--4kq62z5rby2qupq9ub.top` 用浏览器 UA 只回「你好！」9 字节，用 okhttp 才给 63 站点 JSON。
  - 饭太硬 6 个接口复测：**可用 3 个** —— `http://www.xn--sss604efuw.cc/tv`(47 站点/6 直播)、
    `https://cdn09022024.gitlink.org.cn/.../in.bmp`(同)、`http://tvbox.xn--4kq62z5rby2qupq9ub.top/`(63 站点/2 直播/4 解析)；
    `备用 fty.xxooo.cf`、`巧技 cdn.qiaoji8.com` 域名 DNS 已消失；`南风 XC.json`(gh-proxy.net) HTTP 401。
  - 当时「饭太硬 0 个站点出数据」的结论已被 drpy 运行时推翻：其 3 个 JS 站点（虎牙/斗鱼/兔小贝）现在
    home/search/detail/play/category **全部出数据**（虎牙有真实片单与播放入口）。
  - 已把 3 个可用接口写入正式订阅库（18 条），改动前备份在
    `~/Library/Application Support/com.iptvmac.desktop/config-store.json.bak-20261002-090457`。
  - UI：直播列表**去掉「首字方块」**（没有 logo 就直接显示频道名，不再挤占）；侧栏顶部留 28px 给 macOS 红绿灯
    （`titleBarStyle: Overlay` 时红绿灯叠在窗口左上角，原来会压住 logo）。
  - 排查工具：`cargo run --example config_probe -- <url>...`（走应用自身配置加载链路，`SHOW_JS=1` 还会列出 JS 站点）。
- 最后更新：2026-10-02，**修复窗口拖不动**：
  - 原因：Tauri 的 `src/window/scripts/drag.js` 在 `data-tauri-drag-region` 上按下时会先 `preventDefault()`
    + `stopImmediatePropagation()`，再 `invoke('plugin:window|start_dragging')`；而
    **`core:window:default` 不包含 `core:window:allow-start-dragging`**（它只有一堆只读命令），
    capability 里缺这条 → 命令被拒，且因为已经 preventDefault，连系统标题栏拖动也被压掉，表现就是「完全拖不动、也没报错」。
  - 修复：`capabilities/default.json` 补 `core:window:allow-start-dragging`；三处拖动区
    （App 顶部条 / 侧栏 Logo 区 / MiniPlayer 把手）从裸属性改为 `data-tauri-drag-region="deep"`，
    这样点标题文字也能拖（裸属性只认直接点在该元素上：`el === composedPath[0]`）。
  - 回归守卫：`tests/window-drag.test.ts`（有拖动区就必须有该权限；缩放权限同理；必须是 deep）。
  - 排查经验：Tauri 窗口类命令被 ACL 拒绝时**不会报错**，属静默失败；`src-tauri/gen/schemas/capabilities.json`
    是编译后实际生效的 ACL，可直接核验。
- 最后更新：2026-10-02，**代码审计与解耦（第三轮，计划项全部完成）**：
  - 9 个 window 自定义事件全部改为显式 store 状态：`app:miniModeChanged` → `stores/useUiStore.ts`；
    `subscriptions:changed` → `useConfigStore.subscriptions/reloadSubscriptions`；
    `vod:playFailed`/`live:playFailed`/`player:retry`/`player:nextSource`/`player:flushHistory` → `usePlayerStore.playerSignal`
    （`{token,type,scope}`，vod 页与直播页按 scope 消费）；`danmaku:add`/`subtitle:load` → `danmakuRequest`/`subtitleRequest`。
  - 关键细节：store 信号不会自动消失，消费者都带「挂载时记录 token」守卫，否则重新挂载会把旧信号当新信号再处理一次。
  - 新增回归防线：`tests/no-window-events.test.ts`（源码级禁止命名空间 window 事件）与 `tests/player-signal.test.ts`。
  - 待人工验证的交互（自动化覆盖不到）：精简模式进出、播放失败自动换源、换源/重试按钮、订阅增删后顶栏同步、弹幕/字幕加载。
- 最后更新：2026-10-02，**宿主契约修复 + 审计项收尾**：
  - `category(tid, pg, filter, extend)` 的第 4 个参数必须是**对象**（TVBox/FongMi 契约）。此前我们传 JSON 字符串，
    drpy2 的 `var MY_FL=cateObj.extend; MY_FL.type=MY_CATE` 在严格模式下抛 `TypeError: not an object`，
    表现为「点开站点分类就报 [PARSE_ERROR] JS category() 失败: not an object」。修好后 XYQ「优酷」分类返回真实数据。
  - `local` 改为 FongMi `method/Local.java` 契约：`get(rule,key)` / `set(rule,key,value)` / `delete(rule,key)`，键名 `cache_<rule>_<key>`。
    此前是 `get(key)/set(key,value)`，参数错位导致站点本地缓存静默错乱。
  - 新增 `src/site_filter.rs`（站点分类 + 预检统计纯函数 + 6 个测试），`handle_config_inspect` 从 202 行缩到编排层，
    `commands/config.rs` 与 `commands/site.rs` 的重复分类函数合并。
  - **排查经验**：应用日志走 stdout/stderr，用 `open` 启动会丢日志——排查时用
    `nohup "<app>/Contents/MacOS/iptv-mac" > /tmp/iptv-app.log 2>&1 &` 再 `grep`；交叉验证「换个实现也报同样错」时，
    必须确认两次用的**不是同一个宿主**，否则证明不了是站点问题。
- 最后更新：2026-10-02，**代码审计与解耦（第二轮）**：
  - 新增 `src-tauri/src/url_util.rs`（`resolve`/`query_of` + 6 个测试），`config.rs` 与 `js_module.rs` 的 URL 相对解析统一委托给它。
  - 修掉一个真缺陷：`js_module` 的手工按段拼接会把代理型 base（`https://gh-proxy.com/https://raw...`）的双斜杠压成单斜杠；
    gh-proxy 恰好容忍该畸形地址，所以在 gh-proxy 上没爆，换代理/CDN 就会 404。
  - 行为变化（有意）：模块相对解析现在会把中文路径百分号编码（服务器两种形式都给同样内容，reqwest 发请求时本来也会编码）。
  - 遗留：`commands/config.rs::handle_config_inspect`（202 行）待拆；前端 9 个 window 自定义事件待收敛。
- 最后更新：2026-10-02，**代码审计与解耦（第一轮）**，详见 `docs/CODE_AUDIT.md`：
  - 抽 `src/js_runtime.rs`（执行引擎，687 行），`js_spider.rs` 收缩到 116 行只留对外 API，
    依赖方向变为 js_spider → js_session → js_runtime → js_module，**打破了 js_spider ⇄ js_session 的循环依赖**。
  - 新增 `src/renderer/src/utils/format.ts`，统一 `formatClock`/`formatDuration`/`formatBytes`/`formatRelativeTime`，
    替换 VideoPlayer / MiniPlayer / History / Downloads 四处重复实现（注意：播放进度 `formatClock` 允许分钟 > 60 是原语义，别顺手改）。
  - 待办（按优先级）：统一 config.rs 与 js_module.rs 的 URL 相对解析、拆分 202 行的 `handle_config_inspect`、收敛 9 个前端 window 自定义事件。
  - 审计脚本：`python3 scripts/audit-code.py`（超长函数/重复实现）、`python3 scripts/config-health.py`（订阅可解析性体检）。
- 最后更新：2026-10-02，drpy 运行时第三轮：
  1. **会话复用（性能）**：新增 `src-tauri/src/js_session.rs`，把「一个站点（api+ext）」的 Runtime/Context 常驻在专属线程里，`init(ext)` 只做一次；空闲 180s 回收，最多同时保留 3 个会话（LRU），调用超时/线程退出时下次自动重建。同一站点实测：home 3.7s→**2.3s**、search 2.7s→**0.7s**、detail 1.4s→**0.5s**、play 1.4s→**0.0s**、category 1.6s→**0.3s**。
  2. **Cat 系接通**：内嵌 `assets/js/lib/cat.js`（486KB，GPL-3.0，见 assets/js/README.md），并补齐 TVBox/catvod 侧宿主绑定 `SpiderDebug`（未知方法走 Proxy 空操作）与 `aesX`（签名对齐 FongMi `Global.java`，crypto-js 实现 CBC/ECB/CTR/CFB/OFB）。`rsaX`/`getPort`/`getProxy` 目前是占位。
  3. 模块加载失败的报错现在能给出完整原因（此前混淆站点只报一个空错误）。
- Cat 现状：15 条订阅里只有 2 个 Cat 站点（盒子迷2026 的「⚡️┃极影┃影视」「🦉┃夜猫┃秒播」）。运行时侧已通（cat.js 加载成功、home 能执行），但「极影」home 返回 `{"class":[]}`、search 返回空串，「夜猫」在站点内部 JSON.parse 空响应报错 —— 特征都是**上游接口已无数据**，需要有效站点才能验证 Cat 通路的完整可用性。
- 最后更新：2026-10-02，drpy 运行时第二轮：**覆盖率 22/29 真实站点出数据**（批量脚本 `scripts/drpy-regression.py`，抽样 9 条订阅各 3 个 JS 站点）。本轮修复：
  1. **drpy 运行库兜底**：入口本身不可用（401/返回网页）或模块远程依赖失效时，换 `js_module::DRPY_FALLBACKS` 镜像重试同一份站点规则。实测把「高天流云」（自带 drpy2 依赖 `down.nigx.cn/qu.ax/*.js` 全 403）从完全不可用变成 home 返回真实分类。
  2. **严格模式修复**：rquickjs 的 `EvalOptions` 默认 `strict: true`，而 jsjiami 等混淆蜘蛛在末尾做裸赋值 `__JS_SPIDER__ = {...}` → ReferenceError。现在先在全局声明该名字，并用 `strict: false` 求值（与 TVBox/FongMi 宿主一致）。宝盒备用 3/3 站点因此可用。
  3. **单行大模块识别**：`is_module_source` 原来只看行首，遇到压缩成一行的 363KB 模块（`lf_search3_min.js`，`import _0x… from'\x61\x73…'` + `export default{…}` 都在行中）会当脚本跑→语法错误。改用带边界的正则。
  4. **计时器垫片**：`setTimeout`/`clearTimeout`/`setInterval`（阻塞式环境立即执行，setInterval 只跑一次），解掉「setTimeout is not defined」。
  5. 方法级错误现在会带出 QuickJS 真实异常（此前只有 "Exception generated by QuickJS"）；`null`/`undefined` 返回值改成合法 JSON `null`，不再报 `EOF while parsing`。
- 剩余失败样本（7/29）经核对都是**站点侧**问题：CandyMu 豆瓣/短剧网、小盒子4K 网红/360官源、俊佬在线 2 个的 api+ext 都返回 JS 挑战页或 401；小马线路「独播库」的 `files.catbox.moe` 连不上。运行时侧无需再改。
- 最后更新：2026-10-02，drpy 运行时补齐**兜底镜像 + 播放链路验证**：
  - 站点自带的 drpy2 加载失败时，自动换用 `js_module::DRPY_FALLBACKS`（raw.liucn.cc / hjdhnx/dr_py 镜像）重试**同一份站点规则（ext 不变）**，命中会打日志。实测把「高天流云」（其 drpy2 静态依赖 `https://down.nigx.cn/qu.ax/*.js` 全部 403）从完全不可用变成 homeContent 返回真实分类。
  - 播放链路验证通过（心魔在线「😈心魔自用😈」）：home 3.7s → search 2.7s → detail 1.4s → **playerContent 1.4s 返回 `{"jx":1,"parse":1,"url":"https://v.qq.com/..."}`** → category 1.6s，即交给应用既有解析器出流。
  - 新增批量回归脚本 `scripts/drpy-regression.py`（读正式订阅库 → 逐站点跑 `examples/drpy_probe` → 统计 home/search/play 成功率与兜底命中）。
- 最后更新：2026-10-02，**drpy/ESM JS 蜘蛛运行时已落地**（此前这类站点一律报「依赖 ES Module import…当前版本不支持」）。
- 新增 `src-tauri/src/js_module.rs`：ESM `Resolver`/`Loader`（`assets://` + 相对路径 + 远程 http，带 10 分钟缓存）
  + 入口引导（动态 `import()`，失败原因写入 `__SPIDER_ERROR__`）+ 宿主原语（`_http`/`local`/`joinUrl`）
  + JS prelude（`req`/`http`/`joinUrl`/`global` 别名，以及 **`pdfh`/`pdfa`/`pd`** 选择器迷你语法 —— 原版 TVBox 是 Java 侧绑定，这里用内置 cheerio 实现）。
- 内置运行库在 `src-tauri/assets/js/lib/`（cheerio.min.js / crypto-js.js / gbk.js，来源与许可见同目录 README，注意 FongMi 仓库整体是 GPL-3.0）。
- `js_spider.rs`：源码含 `import` 时走模块路径（内存上限 256MB、执行预算 20s），否则沿用原脚本路径；`init(ext)` 两者都会调。
- 真实站点实测（`cargo run --example drpy_probe -- <api> [ext] [关键词]`）：心魔在线「😈心魔自用😈」home 4.7s / search 2.6s / category 1.2s 均返回真实数据；D佬线路「赛事直播」、心魔「低端」同样跑通（返回空数据属站点/上游问题）。
- 已知边界：`高天流云` 那版 drpy2 静态依赖 `https://down.nigx.cn/qu.ax/*.js`，实测 403（已下线/被墙），这类站点即使有运行时也起不来；`聚合短剧·荐片` 的 search 需要 ext 规则而订阅没给，属站点自身问题。
- 性能：目前每次方法调用都会新建 Runtime 并重新装载 cheerio+drpy2（home ≈2-5s），后续可做 Runtime/Context 复用。

- 窗口：`tauri.conf.json` 的 `minWidth` 1024→480、补 `minHeight: 300` 与显式 `resizable/maximizable/minimizable`；新增 `window:applyMode`（对齐窗口装饰与 UI 模式，**不重置尺寸**）；无边框时由 `WindowResizeHandles` 调官方 `startResizeDragging` 提供边缘缩放（权限在 `capabilities/default.json`）。
- 布局：窄于 900px 侧栏换成底部导航、设置页标签横排；窄于 1200px 直播频道列下沉、详情页海报与信息堆叠。
- 精简模式原本 `App.tsx` 只把整页 `hidden` 掉却没渲染 `MiniPlayer`，点「精简模式」会留下空白、无边框、拖不动也缩放不了的小窗口，本次一并修复。
- 本次验证：`tsc -b` 0 错、前端 71 项、`vite build`、`cargo test` 131 项全部通过；`Settings.tsx:461-462` 既有隐式 `any` 已修。
- 断点续播修复已从旧快照移植进来：新增 `src/renderer/src/utils/resume.ts` + `tests/resume.test.ts`（14 例），`VodDetail` 主「播放」、集数按钮、播放器内选集都按历史续播，重试当前集不再把历史进度写成 0。
- 已实现订阅独立保存、点播按需解析、直播全订阅聚合、频道去重、后台巡检与播放器内换线。
- 修复 JSON/XML/type4、多仓相对地址、解析器容错、请求头传递、异步旧响应覆盖等问题。
- 最新 debug `.app` 构建成功，并再次实测直播首播/备用线、点播网页解析/自动第二集出画面。
- 最新 4 次首帧：1566、755、1845、1643 ms；仅受控测试视频，非真实 CCTV 信号。
- 已结束本轮测试服务，日志和临时数据保留；没有提交、推送或覆盖 `/Applications` 安装。
- 仓库原有大量未提交修改、未追踪文件、staged `out/` 删除，切勿回滚。
- 原正式数据 `~/Library/Application Support/com.iptvmac.desktop/config-store.json` 审计确认仍有 42 条外部订阅；`127.0.0.1` 仅存在隔离测试目录。

## 下一步

1. 真机验证本轮改动：把窗口拖到 480 / 900 / 1200px 各档，确认底部导航、直播与设置页重排、详情页堆叠，以及精简模式下的边缘缩放。
2. drpy 运行时后续：① Runtime/Context 复用（现在每次方法调用重装 cheerio+drpy2，home ≈2-5s）② `player_content`（播放链路）在 drpy 站点上的验证 ③ Cat 系（`assets://js/lib/cat.js`）支持的许可评估 ④ 用真实订阅批量回归「多少 JS 站点从报错变成可用」。
2. 待移植（原工作区快照 `IPTV/iptv-mac-v2` 已删除，成果留在 `IPTV/port-pending/`，目录内有 README）：FongMi Decoder（`**` 图片隐写 + `2423` AES 配置，饭太硬 `in.bmp` / 南风 `XC.json` 就靠它）、DoH + TVBox UA 拉取通道（`http_get_tvbox_config`：饭太硬与王二小接口按 UA 分流，浏览器 UA 只返回导航页/「你好！」）。断点续播部分已移植完成。
3. 为 debug 测试 bundle 使用独立 identifier 后，再做一次隔离原生 UI 验证；当前 harness 因与正式 app 共用 `com.iptvmac.desktop` 被 macOS 单实例接管。
4. 优先按用户实际订阅验证公网持续直播、弱网切线与冷启动耗时，记录首帧与失败原因。
5. 验证真实 30 分钟巡检和休眠唤醒；应用关闭时不会巡检。
6. 依具体订阅需求补完整 drpy/Cat/ESM 或动态网页嗅探；JAR/CSP 当前不兼容。
7. 历史/收藏缺订阅身份，跨源同 ID 可能混淆，另行设计兼容数据库迁移。
8. 正式发布前处理签名、公证及发行包验收；当前交付为 debug 测试包。

## 已踩过的坑

- 配置加载成功不代表站点协议支持；不要把 JAR/CSP 当 HTTP API 调用。
- 订阅预检失败不能阻止保存，切换订阅必须防止旧异步结果覆盖新选择。
- 频道按归一化名称去重，线路按 URL 和请求头去重；CCTV5+ 不可归成 CCTV5。
- 部分源失败时保留旧快照；后台刷新不替换当前播放对象。
- 后台数据库连接必须使用 `AppState.data_dir`，否则会绕过测试隔离。
- HLS 重定向后按最终 URL 重写分片；type4 必须保留原始 flag、extend、query。
- 同 bundle ID 多进程会导致 CUA 选错窗口，先核对订阅名是 fixture 的 A VOD。
- 首页站点 tab 不应跟随后台测速排序；站点切换、首页刷新、分类切换都必须让旧请求失效。
- 构建仍有既有 dead_code 和 Vite 大 chunk 警告，不要报告零警告。
- **「点了没反应」先查组件到底渲染了没有**：本项目已出现 3 次同类 bug（MiniPlayer、DownloadPanel、订阅栏早期版本）——`import`、state、事件监听全都齐，只漏了最后那行 `<Component />`，而 tsc/vitest 都不会报错。已加巡检脚本 `node scripts/check-rendered-components.mjs`（发现即退出码 1）。`tsc --noUnusedLocals` 也能抓到（但当前有 20 处历史存量，未开启）。
- **rquickjs 借用规则**：`Runtime::is_job_pending()` / `execute_pending_job()` 会再次借用 runtime，**不能在 `ctx.with` 闭包内调用**（RefCell already borrowed）。模块微任务必须在闭包外驱动，取 `__JS_SPIDER__` 时再进一次 `ctx.with`。
- **模块加载失败要用动态 `import()` + try/catch**：静态 import 失败时模块内无法捕获，只会得到"没有导出蜘蛛对象"；动态 import 才能把真实原因（403、缺库）写进 `__SPIDER_ERROR__`。
- **`pdfh`/`pdfa`/`pd` 是宿主职责**：TVBox(Java) 侧绑定，FongMi 的 JS 库不带；部分 drpy2 构建（如 心魔在线那版）在顶层 `const defaultParser={pdfh,pdfa,pd}` 就会 ReferenceError。现由 `js_module.rs` 的 prelude 用内置 cheerio 实现子集。
- **`req` 必须返回对象**（`{code,status,headers,url,content}`），drpy2 拿 `.content`/`.headers`/`.url`；返回字符串会让站点静默失败。
- 部分订阅的 drpy2 静态 `import "https://down.nigx.cn/qu.ax/*.js"` 实测 403，属依赖下线，站点级不可用，与运行时无关。
- **drpy2 与站点规则是两回事**：订阅里的 `api: ./lib/drpy2.min.js` 只是运行库，`ext: ./js/xxx.js` 才是站点规则。运行库挂了但规则好好的情况很常见（高天流云就是），所以加载运行库失败要换镜像重试，而不是整站判死。
- 兜底镜像只在**入口是 drpy 运行库且加载失败**时启用（`is_drpy_entry`），站点自己的规则脚本不会被替换；命中会打 `[spider] 自带 drpy 运行库不可用，改用兜底镜像` 日志。
- **rquickjs 默认严格模式**：`ctx.eval` 用的 `EvalOptions::default()` 是 `strict: true`，而混淆器生成的蜘蛛普遍裸赋值 `__JS_SPIDER__ = {...}`，严格模式下直接 ReferenceError。脚本路径因此改为 `eval_with_options` + `strict: false`，并在包裹代码前先声明 `globalThis.__JS_SPIDER__`。另注意 `EvalOptions` 是 `#[non_exhaustive]`，只能用 `default()` 再改字段。
- **模块识别不能只看行首**：生态里大量脚本被压缩成一行（例：363KB 的 `lf_search3_min.js`），`import`/`export` 出现在行中间；只看行首会把它当脚本执行并语法报错。
- **没有事件循环**：`setTimeout`/`setInterval` 必须自己垫（立即执行），否则大量站点报 `setTimeout is not defined`。
- **并行跑 `cargo test` 可能挂起**（App 正在运行时出现过一次，单线程 `--test-threads=1` 正常），怀疑测试间共享资源竞争，待查。
- 精简模式是无边框窗口：macOS 下没有系统缩放边框，必须靠 `WindowResizeHandles` 的 `startResizeDragging` 热区；`minHeight` 必须 <= 300，否则 480x300 会被夹高变形。
- 窗口装饰状态会与 UI 模式错位（URL 带 `mode=mini` 但窗口有边框，或反之），启动时用 `window:applyMode` 对齐；否则会卡在"完整界面 + 无边框小窗口"里拖不动、缩放不了。
- 结构断点用 Tailwind 自定义 screens（`nav`=900px、`wide`=1200px），**不要改默认 `sm/md/lg/xl`**，否则全站既有网格会一起位移。
- 工作区里曾有一份旧快照 `IPTV/iptv-mac-v2`（无构建产物、缺新功能），2026-10-02 已删除；**唯一在维护的仓库就是当前目录**。

## 运行环境

- Tauri 2 / Rust / React / SQLite；开发：`npm run dev`。
- 检查：`npm run typecheck`、`npm test`、`npm run test:rust`。
- 组件渲染巡检：`node scripts/check-rendered-components.mjs`。
- 测试包：`npm exec tauri build -- --debug --bundles app`。
- 包路径：`src-tauri/target/debug/bundle/macos/IPTV Mac.app`。
- 隔离测试：`node scripts/subscription-test-env.mjs`，使用随机 localhost 端口和临时数据库。
- 最新日志目录：`/var/folders/1n/h3h1v8390ws_sfn8rfz2r5bw0000gn/T/iptv-subscription-test-J9coPy`。
- JSON/XML/type4/多仓完整验收目录：`/var/folders/1n/h3h1v8390ws_sfn8rfz2r5bw0000gn/T/iptv-subscription-test-27UDQz`。
