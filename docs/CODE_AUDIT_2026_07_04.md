# IPTV Mac 代码审计报告

**审计日期**: 2026-07-04  
**项目版本**: 1.0.1  
**技术栈**: Tauri 2 + Rust + React 18 + TypeScript + Zustand + Tailwind CSS  
**审计范围**: `src/`（前端）、`src-tauri/src/`（后端）、`tests/`（测试）

---

## 严重性统计

| 严重性 | 前端 (TS/React) | 后端 (Rust) | 合计 |
|--------|:-:|:-:|:-:|
| 🔴 **严重 (Critical)** | 1 | 2 | **3** |
| 🟠 **高危 (High)** | 2 | 3 | **5** |
| 🟡 **中危 (Medium)** | 5 | 5 | **10** |
| 🔵 **低危 (Low)** | 3 | 6 | **9** |

---

## 🔴 严重 (Critical)

### C-1. 全局禁用 TLS 证书校验

- **文件**: `src-tauri/src/network.rs:17`, `local_proxy.rs:84`
- **代码**: `.danger_accept_invalid_certs(true)`
- **风险**: 全局 HTTP 客户端接受无效 TLS 证书，所有 HTTPS 请求（配置加载、直播源、EPG 等）均可被中间人攻击。攻击者可拦截并篡改配置内容，注入恶意播放地址。
- **建议**: 移除该配置；如需支持自签名证书，应改为可选的用户配置项（白名单模式）。

### C-2. 本地代理 SSRF

- **文件**: `src-tauri/src/local_proxy.rs:196-207`
- **代码**: `is_allowed_media_url` 仅检查 URL 前缀（http/https），无内部 IP 过滤
- **风险**: 攻击者可构造 `http://localhost:22`、`http://169.254.169.254/latest/meta-data/` 等 URL，通过代理对内网和云元数据端点发起 SSRF 攻击。
- **建议**: 添加内网 IP 块列表（127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 等）。

### C-3. CSP 放行任意 HTTP(S) 连接

- **文件**: `src/renderer/index.html:8`
- **代码**: `connect-src 'self' https: http: ws: wss:`
- **风险**: `connect-src` 和 `media-src` 放行所有 HTTP/HTTPS 源。虽然 IPTV 应用需要访问任意流媒体 URL，但任何 XSS 漏洞可被用来向任意服务器外传数据。
- **建议**: 保持现状（产品需求使然），但需配合严格输入校验和敏感信息脱敏。

---

## 🟠 高危 (High)

### H-1. 本地代理令牌可预测

- **文件**: `src-tauri/src/local_proxy.rs:57-63`
- **代码**: 令牌由 `SystemTime::now()` 纳秒 + PID 拼接
- **风险**: 时间窗口内可被暴力枚举。与通配 CORS 结合，任意网页可窃取代理访问权限。
- **建议**: 使用 `rand::thread_rng()` 生成 ≥128 位随机令牌。

### H-2. 文件路径遍历

- **文件**: `src-tauri/src/config.rs:211-229`
- **代码**: `file://` URL 未经路径校验，`path_safety.rs` 未被使用
- **风险**: 恶意配置可读取系统任意文件（如 `/etc/passwd`）。
- **建议**: 限制 `file://` 仅允许应用数据目录下的文件，使用 `path_safety.rs` 中的路径规范化函数。

### H-3. XML 解析 Zip Bomb / 正则注入

- **文件**: `src-tauri/src/epg.rs:240-245`, `src-tauri/src/spider.rs:607-751`
- **代码**: 仅检查压缩前大小（50MB），不限制解压后大小；使用正则手写 XML 解析
- **风险**: 50MB gzip 可解压至数 GB 造成解压炸弹 DoS；正则 XML 解析易受实体扩展（Billion Laughs）攻击。
- **建议**: 设置解压后大小上限（如 200MB）；使用 `quick-xml`（已引入但未在 EPG/Spider 中使用）替代手写解析；将正则编译为 LazyLock 静态变量。

### H-4. JSON Parse URL 注入

- **文件**: `src-tauri/src/super_parse.rs:83`
- **代码**: `format!("{}{}", parse_url, urlencoding::encode(web_url))`
- **风险**: `parse_url` 来自配置，恶意配置可重定向解析请求到攻击者端点。
- **建议**: 使用 `url::Url::join()` 进行安全拼接。

### H-5. 前端缺少错误边界

- **风险**: 全应用缺少 React Error Boundary，任何未捕获的组件异常会导致整个应用白屏。
- **建议**: 在 `App.tsx` 根组件添加 `<ErrorBoundary>` 包裹。

---

## 🟡 中危 (Medium)

### M-1. 频繁创建 Tokio 运行时

- **文件**: `commands/config.rs`, `commands/site.rs`, `commands/live.rs` 多处
- **代码**: 每次同步命令调用 `tokio::runtime::Runtime::new()`
- **风险**: 频繁创建多线程运行时浪费资源，长期运行可能耗尽文件描述符。
- **建议**: 改为 `#[tauri::command] async fn` 或复用全局运行时。

### M-2. EPG 缓存无限增长

- **文件**: `src-tauri/src/epg.rs:147`
- **代码**: `static EPG_CACHE: Mutex<Option<HashMap<String, EpgCache>>>`
- **风险**: 无大小限制或 TTL 驱逐策略，内存持续增长。
- **建议**: 添加 LRU 驱逐策略或缓存最大条目上限。

### M-3. CORS 通配符

- **文件**: `src-tauri/src/local_proxy.rs:354-390`
- **代码**: `Access-Control-Allow-Origin: *`
- **风险**: 任意页面可读取代理响应，结合弱令牌可导致跨源数据泄露。
- **建议**: 限制为 `http://tauri://localhost` 或特定 origin。

### M-4. localStorage 存储敏感数据

- **风险**: 上次站点选择、搜索历史、播放指标等数据明文存储。恶意插件或 XSS 可读取所有历史数据。
- **建议**: 敏感数据使用 IPC 到 Rust 后端加密存储，或使用 `sessionStorage`。

### M-5. Zustand Set 类型状态响应性

- **文件**: `src/renderer/src/stores/usePlayerStore.ts`
- **代码**: `brokenSources: new Set<string>()`
- **风险**: Zustand 对 Set 使用浅比较，细粒度订阅不佳，可能有过渲染。
- **建议**: 将 `Set` 转为 `string[]` 或使用自定义 selector。

### M-6. React 列表 Key 稳定性

- **文件**: 多处组件 key 包含数组索引
- **风险**: 列表重排时会引起不必要的卸载和重挂。
- **建议**: 使用稳定的唯一标识符完全替代索引。

### M-7. 事件监听器频繁注册/注销

- **文件**: `src/renderer/src/pages/Live/Live.tsx:177-194`
- **代码**: useEffect 依赖函数引用导致监听器频繁重建
- **建议**: 使用 `useRef` 包裹回调函数。

### M-8. 删除操作未批量执行

- **文件**: `src/renderer/src/pages/History/History.tsx:33-36`
- **代码**: 顺序 await 每个删除操作
- **风险**: 清空大量历史记录时性能极差。
- **建议**: 使用 `Promise.all()` 并行删除。

### M-9. DanmakuLayer 每帧性能开销

- **文件**: `src/renderer/src/components/DanmakuLayer/DanmakuLayer.tsx`
- **代码**: 每帧调用 `ctx.measureText()`
- **风险**: 大规模弹幕时造成性能瓶颈。
- **建议**: 预计算文本宽度并缓存，或使用离屏 Canvas 渲染。

### M-10. 重复的错误类型定义

- **文件**: `src-tauri/src/types.rs:6-101`（死代码，未被使用）
- **建议**: 删除 `types.rs` 中的重复定义。

---

## 🔵 低危 (Low)

### L-1. 前端硬编码加载超时
`VideoPlayer.tsx:417` 硬编码 25 秒加载超时，不支持用户配置。

### L-2. MiniPlayer 与 VideoPlayer HLS 配置不一致
MiniPlayer 启用 `enableWorker: true`，VideoPlayer 设置为 `enableWorker: false`。

### L-3. 未使用的 CSS 类
`index.css` 中定义了部分完整但未在组件中使用的工具类。

### L-4. 搜索历史未做大小限制校验
`Search.tsx` 读取 `cache:get` 结果直接 `JSON.parse`，无长度或格式校验。

### L-5. 直播源硬编码 IP（后端）
`commands/live.rs:27` 中硬编码 `82.156.243.185:33389/fwc.m3u` 作为刷新白名单，存在供应链风险。

### L-6. 线程生命周期管理（后端）
`commands/live.rs:232` 使用 `std::thread::spawn` 创建后台线程，应用关闭时可能访问已释放状态。

### L-7. 设置未加密存储（后端）
`lib.rs:36-38` 设置以纯文本 JSON 存储。

### L-8. 日志脱敏未生效
`logging.rs` 提供日志脱敏函数，但命令处理器中未实际调用。

### L-9. 字幕解析无缓存
`SubtitleLayer.tsx` 每次加载 SRT 都重新解析，相同 url 重复加载存在浪费。

---

## 代码质量亮点

尽管有上述问题，项目也有许多值得肯定的设计：

- **类型安全 IPC**：`ipc.ts` 实现了完整类型安全的 `IpcArgsMap`，约束了所有 Tauri command 的参数类型
- **请求竞争处理**：`useConfigStore` 和 `useLiveStore` 使用单调递增的 `requestId` 处理异步请求竞态，自动忽略过期响应
- **播放诊断系统**：完善的 `PlaybackDiagnostic` 结构化诊断，支持自动换源和失败分析
- **播放指标采集**：`playbackMetrics.ts` 实现了首帧耗时 P50/P90 统计，有助于定位性能问题
- **敏感信息脱敏**：`redact.ts` 对日志和诊断信息中的 Authorization/Cookie/Token 等做了脱敏处理
- **HLS 恢复机制**：VideoPlayer 实现了多层 HLS 恢复（网络错误重试、媒体错误恢复、原生回退）
- **单元测试**：Zustand stores、播放指标、配置加载等有完善的 vitest 测试覆盖
- **Rust 错误处理**：`error.rs` 实现了结构化的 `AppError`，支持公共/内部消息分离

---

## 修复优先级建议

### 立即修复（严重-高危）
1. **C-1**: 移除 `danger_accept_invalid_certs(true)`——全球 TLS 校验关闭是实际的攻击面
2. **C-2**: 本地代理添加内网 IP 块列表——防止 SSRF 攻击
3. **H-1**: 使用密码学安全的随机令牌——代理认证太弱
4. **H-3**: 限制 gzip 解压大小上限——防止解压炸弹 DoS

### 短期修复（高危-中危）
5. **H-2**: file:// 路径添加安全性校验
6. **H-4**: 使用 `url::Url::join()` 安全拼接 URL
7. **M-1**: 复用 Tokio 运行时，避免每次调用创建新运行时
8. **M-4**: 敏感信息不在 localStorage 明文存储

### 常规修复（中危-低危）
9. **H-5**: 添加 Error Boundary
10. **M-5**: Set 转 string[] 或优化 selector
11. **M-8**: Promise.all 批量删除
12. **M-10**: 删除重复死代码

---

## 使用场景与兼容性说明

<与开发者确认后的使用场景>

### 核心流程
1. **自动解析与播放**：用户将订阅源地址粘贴到应用后，应用自动解析配置（TVBox/CatVod 兼容格式），提取站点和直播源列表。用户在首页可切换不同站点，点击即可播放点播内容；直播页面可直接观看直播频道。
2. **直播页面功能**：频道列表分组展示，支持快捷键（Cmd+↑/↓）快速切换频道。单个频道配置多个线路时，播放卡顿或失败后自动进行同频道内的线路切换（auto-failover）。

### 兼容性目标
已内置以下测试订阅源（覆盖 TVBox JSON 格式、直播源直链、单仓/多仓等多种格式），需全部兼容：

| 源名称 | URL | 类型 |
|--------|-----|------|
| 多多内置 | https://iduo.us.ci/gt/leevi0709/one/main/config.bin | 配置 |
| Clun在线 | https://clun.top/box.json | 配置 |
| 心魔在线 | https://gh-proxy.com/raw.githubusercontent.com/yw88075/tvbox/main/yw.json | 配置 |
| 多多在线 | https://gh-proxy.com/raw.githubusercontent.com/leevi0709/one/main/jsm.json | 配置 |
| 分享在线 | http://hucongrong.web3v.work/风水/fxz/fxz.json | 配置 |
| 黄金在线 | https://gitlab.com/lzc1021lzc/hjfggzs.hjys/-/raw/main/hjys.free.json | 配置 |
| 多多影音 | https://gitlab.com/duomv/dzhipy/-/raw/main/index.json | 配置 |
| 真心在线 | https://cnb.cool/fish2018/zx/-/git/raw/master/FongMi.json | 配置 |
| 乐哥在线 | https://乐哥.xyz/dj.json | 配置 |
| CandyMu | https://gitlab.com/noimank/tvbox/-/raw/main/tvbox1.json | 配置 |
| zhangqun1818 | http://zhangqun1818.serv00.net/zq/api.json | 配置 |
| 影视仓单线 | http://影视仓.com/ | 配置 |
| 饭太硬4 | http://fty.888484.xyz/tv | 配置 |
| 饭太硬3 | http://www.饭太硬.art/tv | 配置 |
| 饭太硬2 | http://www.饭太硬.net/tv | 配置 |
| 宝盒备用 | https://gh-proxy.com/https://raw.githubusercontent.com/guot55/yg/main/pg/bh.json | 配置 |
| 装歌线路 | https://欧歌.v.nxog.top/m/ | 配置 |
| 高天流云 | https://gh-proxy.com/https://raw.githubusercontent.com/gaotianliuyun/gao/master/js.json | 配置 |
| 传说线路 | https://chuanshuo.77blog.cn/tv.json | 配置 |
| 俊佬在线 | http://home.jundie.top:81/top98.json | 配置 |
| 小马线路 | https://szyyds.cn/tv/x.json | 配置 |
| 环宇轩线 | https://6492.kstore.space/xnf/xnf.json | 配置 |
| 香雅晴线 | https://gh-proxy.com/https://raw.githubusercontent.com/xyq254245/xyqonlinerule/main/XYQTVBox.json | 配置 |
| 南风线路 | https://gh-proxy.com/https://raw.githubusercontent.com/yoursmile66/TVBox/refs/heads/main/XC.json | 配置 |
| D佬线路 | http://rihou.cc:555/nzk/nzk0722.json | 配置 |
| 七星影仓 | https://7337.kstore.space/qxys/禁止传播.json | 配置 |
| 菜妮丝 | https://tv.菜妮丝.top | 配置 |
| 无意云 | https://ym.wya6.cn/ | 配置 |
| 王二小（网盘4K） | http://tvbox.王二小放牛娃.top | 配置 |
| 盒子迷2026 | https://盒子迷.top/禁止贩卖 | 配置 |
| 宝盒线路2026 | https://3043.kstore.space/bhvip/bh/bh2.json | 配置 |
| 牛二线路 | https://9280.kstore.space/wex.json | 配置 |
| 月光宝盒源 | https://3043.kstore.space/bhvip/bh/box.json | 配置 |
| 王二小备用 | http://tvbox.王二小放牛娃.top/ | 配置 |
| 少儿频道 | https://jihulab.com/ymz1231/xymz/-/raw/main/ymshaoer | 配置 |
| 短剧频道 | http://box.ufuzi.com/tv/qq/短剧频道/api.json | 配置 |
| 巧记Box | http://cdn.qiaoji8.com/tvbox.json | 配置 |
| 欧歌免费 | https://tv.nxog.top/m | 配置 |
| 饭太硬 | http://fty.xxooo.cf/tv | 配置 |
| 小盒子4K | http://xhztv.top/4k.json | 配置 |
| 小盒子单仓 | http://xhztv.top/xhz | 配置 |

⬆ 以上列表可在测试回归时作为兼容性检查清单使用。