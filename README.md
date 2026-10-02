# IPTV Mac

macOS 上的 TVBox / CatVod 兼容播放器，基于 **Tauri 2 + Rust + React 18**。
支持饭太硬等常见订阅、点播浏览与跨站换源、直播聚合与录制、断点续播。

公开仓库：[seldoms/iptv-mac](https://github.com/seldoms/iptv-mac)

---

## ⬇️ 下载安装（macOS / Apple Silicon）

```bash
curl -fsSL https://raw.githubusercontent.com/seldoms/iptv-mac/main/scripts/install-macos.sh | bash
```

一行命令搞定：下载最新版 → 装到「应用程序」→ **自动去掉 Gatekeeper 的隔离标记** → 打开。
（本项目没有 Apple 开发者账号，所以没做签名公证；这条命令等价于帮你完成"右键→打开"那一步。）

| 想装的东西 | 命令 / 入口 |
| --- | --- |
| 最新**正式版**（默认） | 上面那行 |
| 每次推送都重建的**滚动版** | `…install-macos.sh \| bash -s pre` |
| **指定版本**（方便回退） | `…install-macos.sh \| bash -s -- --tag v1.0.2` |
| 只看会下哪个地址 | `bash scripts/install-macos.sh --dry-run` |
| 手动下载 | [Releases](https://github.com/seldoms/iptv-mac/releases) 里的 `.zip` / `.dmg` |
| 从源码构建 / 让 AI 装环境 | 见下方「[从源码构建](#从源码构建)」与[部署提示词](docs/SETUP_PROMPT.md) |

> 仅 Apple Silicon（arm64）；Intel 需自行从源码编译。

---

## 快速开始

### 直接下载安装（普通用户）

**方式一：一行命令（推荐）** —— 自动下载最新版、装到「应用程序」并去掉 Gatekeeper 的隔离标记：

```bash
curl -fsSL https://raw.githubusercontent.com/seldoms/iptv-mac/main/scripts/install-macos.sh | bash
# 想要每次推送都重新构建的滚动版：把结尾换成 `| bash -s pre`
```

**方式二：手动** —— 打开 **[Releases](https://github.com/seldoms/iptv-mac/releases)** 下载 `IPTV-Mac-macos-arm64.zip`
（或 `.dmg`），解压后把 `IPTV Mac.app` 拖进「应用程序」。

> **关于"无法验证开发者"**：本项目**没有 Apple 开发者账号**（签名/公证需要付费账号），所以下载来的包会被 Gatekeeper 拦。
> 用上面的一行命令会自动处理；手动装的请 **右键 App → 打开**，或到「系统设置 → 隐私与安全性 → 仍要打开」；
> 也可以自己执行 `xattr -d com.apple.quarantine "/Applications/IPTV Mac.app"`。
> CI 里已做 ad-hoc 签名（保证包内签名自洽），但这不能替代公证。

> 目前只提供 Apple Silicon（arm64）；Intel 机器请从源码构建（见下）。

### 让 AI 帮你把开发环境装好

把 [部署提示词](docs/SETUP_PROMPT.md) 里的整段内容复制给你的 AI Agent（Claude Code / Codex / Cursor 等），
它会自动补齐依赖、拉代码、跑测试并启动应用；同一份文档里也有「手动命令」可以直接敲。

### 从源码构建

要求：Node.js 20+、Rust stable、Tauri 2 的 macOS 系统依赖。

```bash
npm install
bash scripts/fetch-ffmpeg.sh   # 内置 ffmpeg：被 .gitignore 排除，但 tauri 把它声明为打包资源
npm run dev                    # 开发模式（Vite + Tauri）
npm run build:mac              # 产出 .app 与 .dmg
```

构建产物在 `src-tauri/target/release/bundle/`。要装到 `/Applications`：

```bash
rm -rf "/Applications/IPTV Mac.app"
cp -R "src-tauri/target/release/bundle/macos/IPTV Mac.app" "/Applications/IPTV Mac.app"
```

> ⚠️ `cp -R` **不能**直接覆盖已存在的 `.app`（会套娃成 `IPTV Mac.app/IPTV Mac.app`），必须先 `rm -rf`。
> 本机打包若卡在 DMG 步骤，用 `npx tauri build --bundles app` 只出 `.app`，DMG 交给 CI。

### 首次使用

1. 打开 App，默认已带若干内置订阅；不足时进 **设置 → 订阅** 粘贴订阅地址并保存。
2. 首页顶部是**站点标签**（一份订阅里通常几十个站点），点「站点名」可搜索、切换、测速。
3. 选一个站点 → 首页显示分类标签与影片网格。若某站点打不开，换一个即可（站点状态会记忆）。

---

## 使用指南

### 首页（点播）

- **站点**：顶部标签切换；`←` / `→` 循环切换，`Enter` / `空格` 打开站点选择器；`⌘F` 搜索站点。
- **分类标签**：点选后显示该分类内容；选中标签有高亮底色，**进播放页/详情页再返回仍会记住**（切换站点才重置，每个站点各记一份）。
- **筛选**：标签右侧「筛选」可展开二级条件。
- **搜索**：跨站搜索同名片源。
- **历史 / 收藏**：历史按更新时间排序，显示**所属站点名**，点击即续播（断点续播）。

### 播放器

| 操作 | 方式 |
|---|---|
| 全屏 | 控制栏的最大化按钮 / **双击画面** |
| 退出全屏 | 同一个按钮 / **双击画面** / **`Esc`** |
| 精简小窗 | 控制栏的 PiP 图标 |
| 移动小窗 | **按住画面任意位置拖动**（也可拖顶部条） |
| 回到界面 | 小窗右上角「返回界面」/ **`Esc`** / 控制栏同一个按钮 |
| 码率/速度面板 | 控制栏的仪表图标开关（会记住），位置默认右上角 |
| 换源 | 播放失败自动换源；「其他站点的同名片源」一排可直接点选切换 |
| 弹幕 / 字幕 / 倍速 / 投屏 / 诊断 | 控制栏对应按钮 |

**全屏与小窗都不会打断播放**：切换只改变布局，不重建播放器实例，缓冲与播放位置连续（有自动化用例守护）。

**右上角面板**：`速度` 是本地代理实测下载吞吐；`码率` 取清单声明码率，原生播放路径下为实测均值。两个数字含义不同，起播时的突发下载不会当成码率。

### 直播

- 频道按国家/分类树状展示；同频道多线路合并，状态分三档：**未验证**（还没测过）、**不可用**（测过不通）、`120ms` 之类（可达）。
- **双击频道**即可播放；播放成功会**回写真实状态**（探测误判会被纠正）。
- 巡检策略：增量（可播结论 30 分钟、判死 5 分钟过期）+ 单轮 180 秒预算 + 每主机限 2 并发 + 自适应并发 + 优先级（中文/CCTV → 国际知名台 → 其它）。
- **录制**：控制栏红色圆点按钮（宽屏带「录制」字样）或直播页顶部「录制」。
  录制中**一直闪烁**、未录制/录完**一直常亮**，再点一次停止（已录部分保留，输出 TS）。
- `⌘↑` / `⌘↓` 切换上/下一个频道。

### 下载 / 录制

- **点播 → 下载**，**直播 → 录制**，两者都在「下载 / 录制」页查看进度；直播任务带「录像」角标。
- 需要系统里有 `ffmpeg`：放到应用包内 `Contents/Resources/bin/`，或 `brew install ffmpeg`。
- 输出目录与工具状态在该页面顶部显示。

### 快捷键汇总

| 快捷键 | 作用 |
|---|---|
| `Esc` | 退出全屏 / 退出小窗 |
| 双击画面 | 全屏 ↔ 窗口 |
| `←` / `→` | 首页切换站点标签 |
| `Enter` / `空格` | 打开站点选择器、播放聚焦的频道 |
| `⌘F` | 站点搜索框聚焦 |
| `⌘R` | 刷新当前列表 |
| `⌘↑` / `⌘↓` | 直播上/下一个频道 |

---

## 数据、日志与排错

数据目录：`~/Library/Application Support/com.iptvmac.desktop/`

| 文件 | 说明 |
|---|---|
| `iptv.db` | 历史、收藏、直播频道库、站点缓存 |
| `config-store.json` | 订阅列表与当前订阅 |
| `settings.json` | 界面偏好（明文，不含凭据） |

**看日志**：从终端启动即可拿到完整输出，前端日志以 `[renderer/...]` 前缀混在其中：

```bash
"/Applications/IPTV Mac.app/Contents/MacOS/iptv-mac" 2>&1 | tee /tmp/iptv.log
```

### 常见问题

- **首页一直转圈？** 现在会**先用本地缓存秒开**，并把进度显示成「正在尝试第 N/M 个站点：xxx」，25 秒仍没结果就停下来让你手选站点。
- **某个订阅加不进来？** 配置拉取会带 TVBox 客户端 UA 并优先走 **DoH** 解析（应对按 UA 分流 / DNS 被污染）。若域名 DNS 记录本身已消失，则无法恢复。
- **直播显示「无信号」但能播？** 状态语义已区分「未验证/不可用」，且**真实播放会回写**纠正误判；判死结论 5 分钟就过期重测。
- **小窗/全屏回不去？** 小窗右上角「返回界面」或 `Esc`；全屏 `Esc` 或双击画面。进入时会有几秒操作提示。
- **搜不到/播放失败？** 换一个站点（同样内容常有多站），或在详情页用「其他站点的同名片源」直接切。
- **测试模式误入？** 界面上有「退出测试模式（回到正常界面）」按钮；App 启动时也会自动清理残留的测试开关。

---

## 最近的核心工作

| 方向 | 内容 |
|---|---|
| **JS 蜘蛛运行时** | rquickjs 上实现 drpy/ESM 运行时（`assets://` + 相对 + 远程 import）、站点会话复用；补齐宿主契约 `req`/`pdfh`/`pdfa`/`pd`/`local`/`aesX`/**`rsaX`**/`getPort`/`getProxy`/`js2Proxy`（`rsaX` 与 OpenSSL 对拍通过） |
| **配置与网络** | FongMi `Decoder`（隐写 base64、`2423` hex+AES）、**DoH 解析 + 失败重试 + 截断检测**、RFC3986 相对地址解析、站点分类/摘要 |
| **直播测活** | 增量 + 单轮预算 + 按主机限流 + AIMD 自适应并发 + 优先级排序；**真实播放结果回写**；判死结论 5 分钟过期；启动自愈卡住的巡检状态 |
| **播放连续性** | 全屏/小窗只换布局不重建播放器（同一实例，HLS 与缓冲不丢）；进小窗自动退全屏；切换后必要时自动续播；小窗整块可拖 |
| **播放器信息** | 码率/速度面板（本地代理真实吞吐 + 声明/实测码率）、显隐开关、下载（点播）与录制（直播）分离、红色录制状态灯 |
| **易用性** | 首页缓存秒开与找站进度、分类标签按站点记忆并高亮、历史显示站点名、备选源可直接切换、下载页引导、返回入口显眼化 |
| **工程质量** | 前端 141 项 + Rust 191 项回归测试、真实站点探针（`config_probe`/`live_probe`/`drpy_probe`）、前端日志桥（`[renderer/...]`）、单项目目录收敛 |

---

## 开发

```bash
npm run dev            # Vite + Tauri 开发模式
npm run typecheck      # tsc
npm test               # 前端回归测试（vitest）
npm run test:rust      # Rust 测试
npm run check          # 上面全套 + 前端构建 + debug 构建
npm run build:mac      # 打包 .app 与 .dmg
```

**测试注意**：

- `cargo test` 请加 `-- --test-threads=1`（并行时应用在跑会偶发挂起）。
- 自动化 smoke 开关（`IPTV_ALPHA_PLAYBACK_SMOKE` / `IPTV_CONTINUITY_SMOKE` 等）**会驱动真实窗口**，别在用户使用时段跑；这些开关历史上曾被持久化到 `settings.json` 导致"点开 App 直接播放测试视频"，现在启动时会自动清理（见 `scrub_stale_smoke_settings`）。
- 不要在日常使用中用 `IPTV_TEST_DATA_DIR`（会把数据写到别的目录，看起来像"记录丢了"）。

### 项目结构

```text
src/renderer/     React 前端（页面、组件、zustand store）
src/shared/       前端共享类型与内置源
src-tauri/        Rust 后端：commands、SQLite、HLS 代理、JS 运行时、解码器
tests/            前端回归测试
src-tauri/examples/  真实站点探针（config_probe / live_probe / drpy_probe / net_probe）
docs/             架构、审计、兼容矩阵与验证文档
```

### 技术栈

Tauri 2 · Rust · React 18 + TypeScript · Zustand · Tailwind CSS · SQLite · hls.js / dash.js · rquickjs

---

## 文档索引

- [部署提示词（复制给 AI Agent 即可装环境）](docs/SETUP_PROMPT.md)
- [文档总索引](docs/README.md)
- [架构](docs/ARCHITECTURE.md) ｜ [设计蓝图](docs/DESIGN_BLUEPRINT.md) ｜ [开发](docs/DEVELOPMENT.md) ｜ [接口](docs/API.md)
- [网络层（DoH/重试）](docs/NETWORK_LAYER.md) ｜ [FongMi 兼容矩阵](docs/FONGMI_COMPAT_MATRIX.md)
- [订阅与播放验证](docs/SUBSCRIPTION_PLAYBACK.md) ｜ [测试源清单](docs/TEST_SOURCES.md)
- [代码审计](docs/CODE_AUDIT.md) ｜ [当前进度](docs/PROGRESS.md) ｜ [交接单](HANDOFF.md)

## 许可

本项目以 **GPL-3.0** 发布，完整条款见 [LICENSE](LICENSE)。

**为什么是 GPL-3.0**：`src-tauri/assets/js/lib/cat.js`（Cat 系站点运行库）与 `gbk.js` 来自
[FongMi/TV](https://github.com/FongMi/TV)（GPL-3.0），并会由 Rust 侧 `include_str!` **编进二进制随包分发**；
分发内嵌 GPL 代码的组合作品时，整体需要遵循 GPL-3.0。如果你想以 MIT 之类的宽松许可发布，必须先移除这两个文件
（代价是 Cat 系站点与 GBK 解码不可用），见 [内置 JS 运行库说明](src-tauri/assets/js/README.md)。

| 组件 | 许可 |
| --- | --- |
| 本项目代码 | GPL-3.0-only |
| `lib/cat.js`、`lib/gbk.js`（FongMi TV 自带，已内嵌） | GPL-3.0 |
| `lib/cheerio.min.js`、`lib/crypto-js.js` | MIT（cheerio / crypto-js） |
| 内置 ffmpeg（`scripts/fetch-ffmpeg.sh` 下载，不随仓库分发） | 见 ffmpeg 上游许可（LGPL/GPL，取决于构建） |

再分发时请保留本 LICENSE 与上述署名。
