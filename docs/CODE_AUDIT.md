# 代码审计与解耦报告（2026-10-02）

审计范围：`~/sobey/ai/iptv-mac`（Tauri 2 + Rust 后端 + React 前端）。
数据由 `python3 scripts/audit-code.py` 与人工核查产出，可复现。

## 一、结论摘要（按优先级）

| # | 问题 | 证据 | 影响 | 处置 |
| --- | --- | --- | --- | --- |
| P0 | `js_spider ⇄ js_session` **循环依赖** | `js_spider.rs` 调 `js_session::call`；`js_session.rs` 调 `JsSpider::prepare_spider` | JS 运行时四层职责揉在三个模块里，改一处要动两处；上一轮引入 | 抽 `js_runtime.rs`，形成 API → 会话 → 引擎 → 模块加载 的单向依赖 |
| P0 | 前端 **9 个 window 自定义事件**做跨组件通信 | `danmaku:add`/`subtitle:load`/`vod:playFailed`/`live:playFailed`/`app:miniModeChanged`/`player:retry`/`player:nextSource`/`player:flushHistory`/`subscriptions:changed` | 已在 MiniPlayer、DownloadPanel、下载入口上连续踩坑 3 次：事件名/监听时机/浮层层级都无编译期保护 | 逐步改为 store/service 显式调用（本轮先做下载入口，已删掉 `download:openPanel`） |
| P1 | ~~URL 相对解析有两套实现~~ **已修** | 旧 `js_module::resolve_relative` 手工按段拼接，会把 `https://proxy/https://host/x.js` 压成 `https:/host/x.js` | 代理型订阅（gh-proxy）下模块相对导入取错地址；gh-proxy 恰好容忍才没爆 | 已统一到 `url_util`（见进度） |
| P1 | 前端**格式化工具重复** | `formatTime` 在 VideoPlayer/MiniPlayer 各一份；`formatDuration` 在 History/Downloads 各一份；`formatSize` 在 Downloads | 4 处重复，单位/精度不一致风险 | 抽 `utils/format.ts` |
| P2 | 超长函数 | `commands/config.rs:handle_config_inspect()` **202 行**；`live.rs:parse_kodi_prop()` 118；`spider.rs:parse_xml_vod_list()` 111；`local_proxy.rs:is_allowed_media_url()` 104 | 难测、难改，分支组合多 | 拆成「取数 → 解析 → 汇总」小步 |
| P2 | 反向依赖 | `commands::live` → `config`（直播命令依赖订阅配置模块） | 直播与订阅边界模糊 | 明确共享类型归属，或下沉到中性模块 |
| P3 | 死代码 17 处 | `cargo build` 警告：`build_args`/`get_current_program`/`format_now`/`is_leap`/`dedup_channels`/`ClassifiedChannel`/`Filter`/`need_parse` 等 | 噪音掩盖新告警 | 逐个确认后删除或加 `#[allow]` 并注明原因 |

## 二、度量数据

**文件规模**（Rust 13,362 行 / 前端 10,682 行）：

```
Rust 前五：live.rs 1565 · config.rs 1120 · spider.rs 1096 · lib.rs 966 · database.rs 959
前端前五：VideoPlayer 1298 · Settings 1106 · VodDetail 822 · Live 506 · useConfigStore 500
```

**依赖图**（`use crate::` 边）：被依赖最多的是 `error`（16，共享类型，正常）；
上帝模块出度最高的是 `commands::live`（5）、`config`（3）、`commands::site`（3）——整体尚可，
唯一真正的环是 `js_spider ⇄ js_session`。

**全局可变状态**（隐式耦合）：`epg::EPG_CACHE`、`js_module::MODULE_CACHE`、`js_module::LOCAL_STORE`、
`js_session::SESSIONS`。进程级单例，测试无法并行隔离；当前可接受，但新增状态前要评估。

**测试分布**：17 个模块含测试（Rust 141 项），前端 13 个测试文件 75 项。

## 三、解耦计划与验收

1. **抽 `js_runtime.rs`**：把引擎（运行时创建、宿主环境、脚本/模块加载、方法调用、结果序列化）
   从 `js_spider.rs` 移出，`js_spider` 只留公开 API。
   验收：`cargo test` 全绿；`js_spider` 不再 `use crate::js_session`，`js_session` 不再 `use crate::js_spider`。
2. **抽 `utils/format.ts`**：`formatTime/formatDuration/formatSize` 统一，替换 4 处重复。
   验收：`tsc` 0 错、`vitest` 全绿、界面文案不变。
3. **`config.rs` 与 `js_module.rs` 共用 URL 解析**（`url_util.rs`），补边界用例。
4. **`commands/config.rs::handle_config_inspect` 拆分**：取数 / 解析 / 统计三段。
5. **前端事件收敛**：把 `vod:playFailed`/`live:playFailed`/`subscriptions:changed` 等改为 store 调用；
   保留确有必要的浏览器原生事件（fullscreenchange 等）。

每步独立可回滚，且都必须 `cargo test` + `tsc -b` + `vitest run` 全绿。

## 四、进度

- [x] 审计度量与问题清单（本文件）
- [x] 下载入口去事件化（`download:openPanel` 已删除，改为 `/downloads` 路由）
- [x] 抽 `js_runtime.rs` 打破循环依赖：`js_spider`（对外 API，116 行）→ `js_session`（会话复用）
      → `js_runtime`（执行引擎，687 行）→ `js_module`（模块解析/加载）；`js_session` 对 `js_spider` 的引用已为 0
- [x] 抽 `utils/format.ts`：`formatClock`/`formatDuration`/`formatBytes`/`formatRelativeTime`，
      替换 VideoPlayer、MiniPlayer、History、Downloads 四处重复实现（新增 12 个测试）
- [x] 统一 URL 相对解析：新增 `src-tauri/src/url_util.rs`（RFC 3986 + 本地路径回退），
      `config.rs::resolve_relative_url` 与 `js_module::resolve_relative` 都改为委托；
      修掉 `js_module` 手工拼接把代理型 base 的双斜杠压成单斜杠的缺陷
      （`https://gh-proxy.com/https://raw...` + `./x.js`），模块路径额外保留 base 的版本查询串。
      注：统一后中文路径由百分号编码（实测服务器两种形式都给同样内容）
- [x] `handle_config_inspect` 拆分：新增领域模块 `src/site_filter.rs`（站点分类 + 预检统计 + 兼容性判定 + 提示文案，
      10 个纯函数与 6 个测试），命令层只做编排；`commands/config.rs` 与 `commands/site.rs` 的两套重复分类函数合并为一套
- [x] **宿主契约修复（本轮新发现，非计划内）**：`category` 的第 4 个参数按 TVBox/FongMi 契约必须是筛选**对象**（原来传的是 JSON 字符串，
      drpy2 `MY_FL.type=...` 在严格模式下抛 `TypeError: not an object`，导致一批站点分类整片报错）；
      `local` 改为 FongMi `method/Local.java` 的 `get(rule,key)/set(rule,key,value)/delete(rule,key)` 契约（原来少一个命名空间参数，持久化静默错乱）
- [x] 前端事件收敛：9 个 window 自定义事件全部改为显式 store 状态
      - `app:miniModeChanged` → `stores/useUiStore.ts`（miniMode）
      - `subscriptions:changed` → `useConfigStore`（subscriptions + reloadSubscriptions）
      - `vod:playFailed` / `live:playFailed` / `player:retry` / `player:nextSource` / `player:flushHistory`
        → `usePlayerStore.playerSignal`（带 token/type/scope，页面按 scope 消费）
      - `danmaku:add` / `subtitle:load` → `usePlayerStore.danmakuRequest` / `subtitleRequest`
      - 新增两道回归防线：`tests/no-window-events.test.ts`（源码级禁止再出现命名空间 window 事件）、
        `tests/player-signal.test.ts`（信号 token 语义）
      - 细节：store 里的信号不会自动消失，消费者用「挂载时记录 token」守卫，避免重新挂载时把旧信号当新信号再处理一次

## 四之二、审计后的结构

- Rust：`js_spider`（对外 API）→ `js_session`（会话复用）→ `js_runtime`（执行引擎）→ `js_module`（模块解析/加载）；
  `url_util`（URL 解析）、`site_filter`（站点分类/预检）为共享领域模块；命令层只做编排。
- 前端：跨组件通信一律走 zustand store（`useUiStore` / `useConfigStore` / `usePlayerStore`），
  不再有 window 自定义事件；共享格式化为 `utils/format.ts`。

## 五、验证基线

每步完成后必须同时满足：`cargo test`（141 项）全绿、`tsc -b` 0 错、`vitest run` 全绿、
真实站点 `cargo run --example drpy_probe`（心魔在线 360影视）home/search/detail/play 全部出数据。

