# 网络层（第一期）现状

> 最后更新：2026-10-02 · 对应改动：`src-tauri/src/network.rs`、`src-tauri/src/decoder.rs`、`src-tauri/src/config.rs`
> 上游背景见 `FONGMI_COMPAT_MATRIX.md` 的 `VodConfig doh` / 配置编码两行。

## 1. 三条链路与接入状态

| 链路 | 实现 | 接入状态 |
| --- | --- | --- |
| 配置/直播内容拉取 | `network::http_get_tvbox_config` | ✅ 已接入 `config.rs`（主配置、多仓子配置、GitHub 兜底） |
| 通用 GET | `network::http_get` / `http_get_with_headers` | 保留原语义，增加失败后 DoH 重试与截断重试 |
| 站点接口 / 媒体 / 图片代理 | `spider.rs`、`local_proxy.rs` 自建 `create_client()` | ❌ 未接入，仍走系统 DNS + Chrome UA |

## 2. 为什么配置拉取必须单独一条通道

实测（2026-10-02，饭太硬导航站）：

| URL | Chrome UA | `okhttp/3.12.13` |
| --- | --- | --- |
| `http://www.饭太硬.cc/tv` | 12486B HTML（导航首页） | **19683B BMP 隐写配置** |
| `http://tvbox.王二小放牛娃.top/` | 9B「你好！」 | **19892B JSON 配置** |

即：**接口按 UA 分流**。用浏览器 UA 会得到 HTTP 200 的正常响应，但内容是错的——这种情况既不报错也不触发任何重试，表现为"订阅能连上却解析不出配置"。因此 `http_get_tvbox_config` 固定发送 TVBox 客户端 UA。

## 3. DoH

- 默认端点 `https://223.5.5.5/resolve`（阿里；Cloudflare/Google 在境内不可达）；TVBox 配置的 `doh` 字段会被 `config.rs` 读取并通过 `network::set_doh_endpoint` 生效，配置未声明时回落默认。
- 解析结果按 host 缓存 5 分钟（`DOH_CACHE`），失败结果不缓存。
- `http_get_tvbox_config` 走"DoH 优先"：先用 DoH 解析出的 IP 建连，失败再走系统 DNS。原因同上——DNS 被污染的域名同样会返回"HTTP 200 但内容错误"。
- 通用 `http_get` 不做 DoH 优先，只在传输失败或响应体截断时用 DoH 结果重试一次；HTTP 4xx/5xx 不重试。
- 纯 IP 主机直接跳过 DoH。

## 4. 配置解码

`decoder::decode(url, text)` 等价移植 FongMi `Decoder.verify`，顺序为：明文 JSON → `XXXXXXXX**<base64>`（图片隐写）→ `2423` 开头 hex + AES-128-CBC。AES 的 key 取 `$#..#$` 之间、iv 取密文尾部 13 字节，两者右侧补 `0` 到 16 字节。另含 `"./`、`"../`、`__JS1__/__JS2__` 相对路径修正。

实现不引入任何新 crate（本机沙箱无法写 `~/.cargo`，加密库装不上），AES-128 / base64 / hex 均为标准库自实现，正确性由 FIPS-197 官方向量、Node `aes-128-cbc` 交叉向量与线上真实配置三重验证。

## 5. 端到端实测（应用真实代码路径）

`create_client()` → `http_get_tvbox_config` → `decoder::decode` → `parse_config_or_live_source`：

| 订阅 | 结果 |
| --- | --- |
| 饭太硬 `www.饭太硬.cc/tv` | ✅ sites=47 lives=6（BMP 隐写解码成功） |
| 江苏福建专用 `in.bmp` | ✅ sites=47 lives=6 |
| 王二小 `tvbox.王二小放牛娃.top` | ✅ sites=63 lives=2 parses=4 |
| 南风 `raw.githubusercontent.com/.../XC.json` | ✅ sites=84 lives=1 parses=7（hex+AES 解码成功） |
| 巧技 `cdn.qiaoji8.com` | ❌ 七牛 CNAME 已无 A 记录，站点侧下线 |

> 注：这 4 条订阅的**站点**几乎全是 `csp_` JAR 爬虫（饭太硬 44/47、王二小 63/63、南风 83/84），mac 端没有 JVM/DRPY 运行时；当前真正可用的是其中的**直播列表**。

## 6. 未完成

1. `spider.rs` / `commands/live.rs` / `epg.rs` / `local_proxy.rs` 接入统一通道（含 UA 策略与 DoH）。
2. `hosts` 字段（配置级 DNS 覆盖）仍未实现。
3. 无熔断/UA 轮换；`http_get` 的最多重试次数是 3。
