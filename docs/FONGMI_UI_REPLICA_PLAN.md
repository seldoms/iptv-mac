# FongMi UI Replica Plan for IPTV Mac

> 目标：在现有 Tauri + React 前端上复刻 FongMi 的页面结构、按钮入口、弹窗体系和交互语义，同时适配 macOS 桌面使用方式。不要机械照搬 Android TV/Leanback 视觉皮肤；复刻的是产品信息架构和功能入口，不是把遥控器 UI 硬贴到 Mac 上。

## 1. 参考范围

- FongMi 参考目录：
  - TV 端页面：`TV/app/src/leanback/java/com/fongmi/android/tv/ui/activity`
  - 移动端页面：`TV/app/src/mobile/java/com/fongmi/android/tv/ui/activity`
  - 通用播放弹窗：`TV/app/src/main/java/com/fongmi/android/tv/ui/dialog`
  - 布局 XML：`TV/app/src/leanback/res/layout`、`TV/app/src/mobile/res/layout`
- IPTV Mac 当前页面：
  - `src/renderer/src/pages/Home`
  - `src/renderer/src/pages/Live`
  - `src/renderer/src/pages/Search`
  - `src/renderer/src/pages/VodDetail`
  - `src/renderer/src/pages/History`
  - `src/renderer/src/pages/Keep`
  - `src/renderer/src/pages/Settings`
  - `src/renderer/src/components/VideoPlayer`

## 2. 设计原则

- 复刻 FongMi 的入口完整性：每个 FongMi 页面、按钮、弹窗在 IPTV Mac 都要有对应位置。
- 保留 macOS 桌面操作习惯：鼠标、触控板、键盘快捷键、侧栏、工具栏、分段控件、菜单、抽屉。
- 不做 Android TV 大焦点卡片硬搬：遥控器焦点态改成 hover、active、selected、focus-visible。
- 控件类型按桌面语义重映射：图标按钮用于播放工具；分段控件用于模式切换；菜单用于选项；抽屉用于复杂设置；确认弹窗用于危险操作。
- 所有页面必须覆盖加载、空态、失败、重试、取消、无权限/不支持状态。

## 3. 页面映射

| FongMi 页面 | IPTV Mac 目标页面 | 复刻内容 | macOS 适配 |
| --- | --- | --- | --- |
| `HomeActivity` / `VodFragment` | Home | 壁纸/公告、站点入口、分类、推荐、继续观看、功能入口 | 左侧全局 Sidebar + 顶部站点/搜索工具栏 + 内容瀑布/分区 |
| `VodActivity` / `TypeFragment` | Home 分类视图 | 分类列表、筛选器、分页、Vod 卡片样式 | 顶部横向分类 + 筛选抽屉 + 无限/分页加载 |
| `VideoActivity` | VodDetail + VideoPlayer | 详情、线路、剧集、倒序、更多剧集、播放控制 | 详情页内播放器 + 右侧信息/剧集面板，播放时可沉浸全屏 |
| `SearchActivity` | Search | 搜索框、站点选择、热词/记录、结果、重置 | 桌面搜索栏 + 站点筛选菜单 + 结果网格/列表切换 |
| `LiveActivity` | Live | 分组、频道、线路、EPG、频道弹窗、密码分组 | 三栏结构：分组/频道、播放器、节目单；支持快捷键 |
| `KeepActivity` | Keep | 收藏列表、同步、删除、批量管理 | 表格/网格双模式 + 批量操作工具栏 |
| `HistoryActivity` | History | 历史列表、继续播放、删除、清空 | 按时间分组 + 继续观看主按钮 + 批量选择 |
| `FileActivity` / `FolderActivity` | Settings 或 File view | 本地文件、字幕、配置文件、媒体文件 | 只开放授权目录；文件选择器优先，内置浏览为高级功能 |
| `SettingActivity` | Settings | Vod/Live/Wall/Player/Danmaku/DoH/Cache/Version | 左侧设置分组 + 右侧密集表单，不做大块电视卡片 |
| `PushActivity` | Local Service / Push | 推送 URL、接收播放 | 设置页本地服务区 + 可复制地址 + 推送历史 |
| `CastActivity` | Cast/External Player | 投放设备、播放状态 | 初期合并到播放器“投放/外部播放”菜单 |
| `CrashActivity` | Error Recovery | 崩溃信息、恢复入口 | 启动恢复页 + 日志导出 |

## 4. 核心组件计划

### 4.1 App Shell

- 保留当前 `Sidebar`，扩展为 FongMi 功能入口集合：点播、直播、搜索、历史、收藏、设置、本地服务。
- 顶部工具栏提供当前配置、当前站点、全局搜索、刷新、诊断入口。
- 内容区使用一致的最大宽度和滚动容器，播放页/直播页允许全宽。
- 壁纸/背景来自 `VodConfig.wallpaper`，仅作为轻量背景层；不能影响内容可读性。

### 4.2 VodCard

- 复刻 FongMi 三种卡片样式：
  - `rect`：横图，适合推荐/专题。
  - `oval`：圆形/椭圆，适合人物/频道类内容。
  - `list`：列表，适合搜索/历史/收藏。
- 卡片显示字段：封面、名称、年份、来源站点、备注、进度。
- 支持右键菜单：播放、详情、收藏/取消、跨站找源、复制名称。

### 4.3 FilterBar

- 对应 FongMi `filters`。
- 桌面形态：顶部筛选摘要 + 右侧抽屉展开完整筛选。
- 筛选项用分段按钮/下拉菜单，不堆一屏小胶囊，那个在 Mac 上很烦。
- 支持重置、应用、取消、默认值显示。

### 4.4 EpisodePanel

- 对应 `FlagAdapter`、`EpisodeAdapter`、`QualityAdapter`、`PartAdapter`。
- 线路使用 tabs 或 segmented control。
- 剧集支持网格/列表切换、倒序、分页/分段、当前播放高亮。
- 更多剧集走侧边抽屉，不挤在详情页底部。

### 4.5 PlayerControls

- 对应 `view_control_vod.xml`、`view_control_live.xml`、`view_widget_vod.xml`、`view_widget_live.xml`。
- 必备按钮：
  - 播放/暂停
  - 上一集/下一集
  - 快退/快进
  - 重播
  - 倍速
  - 线路/清晰度
  - 解析器
  - 字幕
  - 弹幕
  - 音轨/版本/章节
  - 画中画
  - 迷你窗口
  - 全屏
  - 诊断
  - 外部播放器/投放
- 直播专属按钮：
  - 上一频道/下一频道
  - 频道列表
  - 节目单
  - 回看
  - 收藏频道
  - 线路切换
- 控制条自动隐藏，鼠标移动、键盘操作、播放状态变化时出现。

### 4.6 Dialog / Sheet System

- FongMi bottom sheet / side sheet 映射：
  - `ParseDialog` -> 解析器选择抽屉
  - `SpeedDialog` -> 倍速菜单
  - `SubtitleDialog` -> 字幕面板
  - `DanmakuDialog` -> 弹幕源选择
  - `DanmakuSettingDialog` -> 弹幕设置面板
  - `TrackDialog` -> 音轨菜单
  - `EditionDialog` -> 版本/清晰度菜单
  - `ChapterDialog` -> 章节抽屉
  - `HistoryDialog` -> 继续观看/播放历史抽屉
  - `LiveDialog` -> 频道/线路抽屉
  - `PassDialog` -> 密码分组弹窗
  - `ConfigDialog` -> 配置导入/编辑弹窗
  - `DohDialog` -> DoH 选择弹窗
  - `UaDialog` -> User-Agent 输入弹窗
  - `MpvConfDialog` -> 外部播放器配置弹窗
  - `RestoreDialog` -> 备份恢复弹窗
- macOS 规则：
  - 短选项用 popover/menu。
  - 多列表用 right drawer。
  - 表单用 modal。
  - 危险操作用确认 dialog。

## 5. 按钮与菜单映射

### 5.1 全局导航

| FongMi 入口 | IPTV Mac 控件 | 行为 |
| --- | --- | --- |
| 点播 | Sidebar item | 打开 Home |
| 直播 | Sidebar item | 打开 Live |
| 搜索 | Sidebar item / Cmd+F | 打开 Search 或聚焦搜索 |
| 收藏 | Sidebar item | 打开 Keep |
| 历史 | Sidebar item | 打开 History |
| 设置 | Sidebar item | 打开 Settings |
| 推送 | Settings 本地服务按钮 | 展示本地服务地址和推送记录 |

### 5.2 首页/点播

| FongMi 控件 | IPTV Mac 控件 | 行为 |
| --- | --- | --- |
| 站点选择 | toolbar dropdown | 切换站点并刷新分类/推荐 |
| 分类 tab | horizontal tabs | 切换 type_id |
| 筛选 | filter drawer button | 打开筛选抽屉 |
| Vod 卡片 | card | 单击详情，右键菜单 |
| 长按收藏/菜单 | context menu | 收藏、跨站找源、复制名称 |
| 刷新 | icon button | 重新加载当前站点 |

### 5.3 详情/剧集

| FongMi 控件 | IPTV Mac 控件 | 行为 |
| --- | --- | --- |
| 播放 | primary button | 播放当前选中剧集 |
| 收藏 | icon toggle | 收藏/取消收藏 |
| 线路 flag | segmented tabs | 切换播放来源 |
| 剧集按钮 | fixed-size episode tile | 播放对应剧集 |
| 倒序 | icon toggle | 剧集正序/倒序 |
| 更多 | drawer button | 打开完整剧集抽屉 |
| 跨站找源 | icon+text button | 搜索同名内容 |

### 5.4 播放器

| FongMi 控件 | IPTV Mac 控件 | 行为 |
| --- | --- | --- |
| action 播放按钮 | icon button | 播放/暂停 |
| speed | menu | 倍速选择 |
| parse | drawer/menu | 解析器选择 |
| quality/edition | menu | 清晰度/版本选择 |
| subtitle | drawer | 字幕选择和位置/大小调整 |
| danmaku | drawer + toggle | 弹幕选择、搜索、显示设置 |
| track | menu | 音轨选择 |
| chapter | drawer | 章节跳转 |
| history | drawer | 继续观看历史 |
| error widget | diagnostic panel | 错误、重试、换源、复制诊断 |

### 5.5 直播

| FongMi 控件 | IPTV Mac 控件 | 行为 |
| --- | --- | --- |
| group list | left column tabs/list | 切换分组 |
| channel list | virtualized list | 播放频道 |
| channel line | source menu | 切换线路 |
| EPG data | right panel / bottom strip | 当前/下一节目与完整日程 |
| pass group | password dialog | 解锁隐藏分组 |
| favorite channel | icon toggle | 收藏频道 |
| numeric key | keyboard handler | 数字选台 |

### 5.6 设置

| FongMi 设置项 | IPTV Mac 位置 |
| --- | --- |
| Vod 配置 URL / 历史 | Settings > 配置 |
| Live 配置 URL / 历史 | Settings > 直播源 |
| Wallpaper | Settings > 外观 |
| Player | Settings > 播放 |
| Danmaku | Settings > 弹幕 |
| Decode / Engine | Settings > 播放内核 |
| Preload | Settings > 缓存/预加载 |
| DoH | Settings > 网络 |
| Incognito | Settings > 隐私 |
| Backup / Restore | Settings > 数据 |
| Cache | Settings > 缓存 |
| Version / Update | Settings > 关于 |

## 6. 快捷键计划

- `Cmd+F`：搜索。
- `Space`：播放/暂停。
- `←/→`：快退/快进。
- `↑/↓`：直播上一频道/下一频道；非直播页面滚动。
- `Cmd+↑/Cmd+↓`：直播频道切换，沿用当前项目已有方向。
- `F`：全屏。
- `P`：画中画。
- `M`：静音。
- `S`：字幕面板。
- `D`：弹幕开关。
- `L`：线路菜单。
- `R`：重试/刷新当前播放。
- `Esc`：关闭弹窗、退出全屏控制层。
- 数字键：直播数字选台；点播输入无焦点时不抢占。

## 7. 响应式布局

- >= 1200px：
  - 常规页面：左 Sidebar + 主内容 + 可选右抽屉。
  - Live：分组/频道 320px + 播放器 flex + EPG 320px。
  - VodDetail：播放器/海报信息 + 右侧剧集/线路面板。
- 900px - 1199px：
  - Sidebar 收窄，只显示图标。
  - Live EPG 下沉到底部抽屉。
  - VodDetail 剧集面板下沉。
- < 900px：
  - Sidebar 折叠为顶部/底部导航。
  - Live 频道列表和 EPG 用 tabs。
  - 播放器控制按钮分两层，低频入口进更多菜单。

## 8. 状态覆盖

每个页面都必须实现：

- 加载中：骨架屏或局部 spinner，不整页白屏。
- 空态：无配置、无站点、无分类、无结果、无收藏、无历史、无 EPG。
- 错误：网络失败、配置无效、Spider 不支持、解析失败、播放失败。
- 重试：页面级重试和局部重试分开。
- 取消：配置导入、站点加载、跨站搜索、解析、直播刷新可取消。
- 不支持：JAR/DRM/DLNA 等平台能力不足时给明确原因。

## 9. 实施阶段

### UI Phase 0：界面清单与组件基线

- 建立 FongMi UI 兼容矩阵：Activity/Dialog/Layout -> IPTV Mac Page/Component。
- 定义通用组件：Toolbar、IconButton、SegmentedControl、Drawer、Modal、ContextMenu、StatusPanel、VirtualList。
- 统一图标策略：优先 lucide-react；播放类按钮用图标，不用文字块硬凑。

### UI Phase 1：首页、搜索、列表

- Home：站点选择、推荐、分类、继续观看、公告/壁纸。
- Search：搜索栏、站点筛选、记录/热词、结果列表/网格、分页。
- VodCard：rect/oval/list 三样式。
- FilterBar：筛选抽屉与重置/应用。

### UI Phase 2：详情与剧集

- VodDetail：海报/元信息/收藏/播放/跨站找源。
- EpisodePanel：线路 tabs、剧集网格、倒序、更多抽屉。
- History resume：继续观看提示与恢复按钮。

### UI Phase 3：播放器控制和弹窗

- 重构 VideoPlayer 控制层，补齐所有播放按钮。
- 实现 Speed/Parse/Subtitle/Danmaku/Track/Edition/Chapter/History/Diagnostic 面板。
- 统一键盘快捷键和控制条自动隐藏。

### UI Phase 4：直播

- Live 三栏布局。
- 分组/频道虚拟列表、密码分组、收藏频道、最近频道。
- EPG 当前/下一节目、完整日程、回看入口。
- 数字选台和频道切换快捷键。

### UI Phase 5：设置与本地服务

- Settings 重组为配置、直播源、播放、弹幕、网络、本地服务、缓存、数据、关于。
- 本地服务展示端口、token 状态、复制地址、推送入口。
- 危险操作统一确认：删除配置、清空缓存、删除文件、关闭安全限制。

### UI Phase 6：视觉 QA 与验收

- Playwright 截图覆盖桌面、窄屏和播放全屏。
- 检查按钮文本不溢出、弹窗不遮挡关键内容、控制条不压住字幕/弹幕。
- 对照 FongMi UI 矩阵逐项确认入口存在。

## 10. 验收标准

- 每个 FongMi Activity/Dialog 都能在 IPTV Mac 找到对应页面、组件或明确“不适用但有替代入口”。
- 配置、直播、点播、搜索、详情、播放、历史、收藏、设置、本地服务入口完整。
- 播放器按钮覆盖 FongMi 主要控制：播放、暂停、上一/下一、重播、倍速、解析、线路、字幕、弹幕、音轨、章节、全屏、PiP、诊断。
- 直播按钮覆盖：分组、频道、线路、EPG、回看、收藏、数字选台、密码分组。
- 所有危险操作都有确认；所有不支持能力有明确提示。
- 通过桌面宽屏、普通 MacBook 宽度、窄屏三档截图检查。
- UI 不引入新的 TypeScript 错误、测试失败、滚动错位和文本溢出。

## 11. 和功能计划的关系

- 本文档只管 UI 复刻和交互映射。
- 功能底座仍以 `docs/FONGMI_FULL_REPLICA_PLAN.md` 为准。
- UI 实施顺序要跟功能阶段解耦：能用假数据和 mock state 先搭界面，但不能把未实现能力伪装成可用；未接通的按钮必须显示禁用或“不支持/开发中”状态。
