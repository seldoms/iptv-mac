# 当前开发进度

更新时间：**2026-10-02**。状态依据当前代码与自动化测试（前端 **141** 条 / Rust **191** 条）。
历次改动与踩坑记录见 [../HANDOFF.md](../HANDOFF.md)；功能与使用方式见 [../README.md](../README.md)。

> 本文件曾长期停留在 2026-09-05（当时写的"46 项 / 117 项测试"和"drpy/DoH 未完成"早已过期）。
> 只保留"当前真实状态"，历史审计看 [RELEASE_AUDIT_2026-09-05.md](RELEASE_AUDIT_2026-09-05.md)。

## 已完成（能力面）

- **配置**：JSON / JSONC / XML / type4 / 多仓相对地址；FongMi `Decoder`（隐写 base64、`2423` hex+AES）；TVBox 客户端 UA 分流。
- **网络**：DoH 解析（配置级 `doh` 字段生效）+ 失败重试 + 响应截断检测；RFC3986 相对地址解析。
- **JS 蜘蛛**：rquickjs 上的 drpy/ESM 运行时（`assets://` + 相对 + 远程 import、模块解析、单行压缩模块）；
  宿主契约 `req`/`http`/`pdfh`/`pdfa`/`pd`/`local`/`aesX`/**`rsaX`**（与 openssl 对拍）/`getPort`/`getProxy`/`js2Proxy`；站点会话复用。
- **点播**：分类/筛选/搜索/详情/剧集、跨站换源（备选源一排可直接切）、失败自动换源、断点续播、历史与收藏。
- **直播**：全订阅聚合、同频道合并多线路、分类树；测活策略=增量（可播 30 分钟 / 判死 5 分钟）+ 单轮 180s 预算 + 每主机限 2 并发 + AIMD 4→20 + 优先级；**真实播放结果回写**纠正误判。
- **播放器**：全屏/小窗只换布局不重建实例（播放不中断）、进小窗自动退全屏、小窗整块可拖、码率/速度面板（本地代理实测吞吐 + 声明/实测码率）、弹幕/字幕/倍速/投屏/诊断。
- **录制与下载**：直播录制（红点：录制中闪烁/常录完亮，输出 TS）、点播下载，统一任务管理页；内置 ffmpeg 由 `scripts/fetch-ffmpeg.sh` 获取。
- **工程**：`main` 为维护分支；CI（`build-macos`）在 macOS runner 上跑类型检查 + 前端/Rust 测试并发布可下载客户端到 Releases。

## 当前风险 / 未完成

- [ ] **未签名/未公证**：用户首次打开需右键→打开（`xattr -d com.apple.quarantine`）；要免这一步需要 Apple Developer 账号。
- [ ] 只用**真实公网订阅**做过抽样验证，未做长期弱网/鉴权线路的 P90 统计。
- [ ] 30 分钟巡检 + 休眠唤醒 + 重启恢复的长时间运行验收。
- [ ] JAR/CSP（`csp_` 前缀，需 Android/JVM）仍不支持，站点已在列表中隐藏。
- [ ] 仅提供 Apple Silicon（arm64）构建；Intel 需自行从源码编译。
- [ ] 历史/收藏未带订阅身份，不同订阅的同名 ID 可能混淆。
- [ ] **测试通道隔离**（有前科）：smoke 开关曾被持久化、`IPTV_TEST_DATA_DIR` 曾造成数据目录分叉；
     现已加启动自愈与回归测试，但仍需警惕任何"测试开关写进用户持久化数据"的改动。

## 交付物

- 用户下载：GitHub **Releases** 的 `IPTV-Mac-macos-arm64.zip`（`latest` 为最新构建，`v*` tag 为正式版）
- 本机安装：`/Applications/IPTV Mac.app`（由 `npx tauri build --bundles app` 产出后拷贝）
- 订阅/播放专项验证：[SUBSCRIPTION_PLAYBACK.md](SUBSCRIPTION_PLAYBACK.md)｜测试源：[TEST_SOURCES.md](TEST_SOURCES.md)
- 环境部署（可复制给 AI Agent 的提示词）：[SETUP_PROMPT.md](SETUP_PROMPT.md)
