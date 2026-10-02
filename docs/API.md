# 接口文档

接口分为 Renderer 到 Tauri 的 IPC，以及 Tauri 到外部订阅/媒体源的 HTTP 请求。Renderer 通过 `src/renderer/src/utils/ipc.ts` 调用，错误统一以异常或 `{ success, error }` 形式返回。

## 配置与点播 IPC

| 调用 | 参数 | 说明 |
| --- | --- | --- |
| `config:list` | 无 | 返回已保存订阅 `{url,name}` 列表 |
| `cmd_config_save` | `{ url }` | 只保存订阅，不要求在线、不切换当前配置 |
| `cmd_config_load` | `{ url }` | 加载并激活点播配置 |
| `cmd_config_peek_lives` | `{ url }` | 读取订阅中的直播条目 |
| `cmd_site_home_content` | `{ siteKey, filter? }` | 首页内容和分类 |
| `cmd_site_category_content` | `{ siteKey, tid, pg, filter?, extend? }` | 分类分页 |
| `cmd_site_detail_content` | `{ siteKey, ids }` | 影片详情和剧集 |
| `cmd_site_search_content` | `{ siteKey, key, quick?, pg }` | 站内搜索 |
| `cmd_site_player_content` | `{ siteKey, flag, id, vipFlags? }` | 获取播放地址 |
| `cmd_site_super_parse` | `{ params }` | 解析网页或解析器链 |

## 直播 IPC

| 调用 | 参数 | 返回/说明 |
| --- | --- | --- |
| `live:refresh` | 无 | 启动全部已保存订阅的后台巡检 |
| `live:getRefreshStatus` | 无 | 返回刷新状态、进度和下次时间 |
| `live:setRefreshInterval` | `minutes` | 设置 1 到 1440 分钟的周期 |
| `live:getChannelTree` | 无 | 返回缓存的 `countries[].categories[].channels[]` |
| `live:load` | `liveName` | 兼容旧版单直播源加载 |
| `live:loadByUrl` | `url, name?` | 兼容旧版直链加载 |
| `live:epg` | `epgUrl, channelMap?` | 获取节目单 |

直播频道核心字段：`name`、`urls`、`lines`、`bestUrl`、`latency`、`urlHeaders`。`lines` 每项为 `{url, header, latency, alive}`。

## 历史、收藏和本地代理

| 调用 | 参数 |
| --- | --- |
| `history:list` / `history:add` / `history:delete` | 历史记录读写 |
| `keep:list` / `keep:add` / `keep:delete` | 收藏读写 |
| `local:getServerInfo` | 获取媒体代理信息 |

## 错误约定

- `NETWORK_ERROR`：HTTP、超时或连接失败。
- `PARSE_ERROR`：响应不是支持的订阅/详情格式。
- `NOT_FOUND`：没有可用站点、影片、频道或播放地址。
- 播放失败由 Renderer 触发重试/换线事件，并保留用户可见诊断信息。
