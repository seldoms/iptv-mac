# 内置 JS 运行库（drpy/Cat 站点依赖）

这些文件供 `assets://js/lib/...` 形式的 ES Module import 使用，由 Rust 侧 `include_str!` 内嵌进二进制，
不经过 Tauri 资源目录。

| 文件 | 用途 | 来源 | 许可 |
| --- | --- | --- | --- |
| `lib/cheerio.min.js` | jQuery 风格 DOM 解析（drpy 的 `pdfh/pdfa/pd` 基础） | FongMi TV `quickjs/src/main/assets/js/lib/`（QuickJS 适配构建） | MIT（cheerio） |
| `lib/crypto-js.js` | AES/MD5/Base64 等（drpy 直接调 `CryptoJS`） | 同上 | MIT（crypto-js） |
| `lib/gbk.js` | GBK/GB2312 解码（`export function gbkTool()`） | 同上 | 随 FongMi 分发，见其仓库 |
| `lib/http.js` | `req`/`http`/`global` 别名的参考实现 | 同上 | GPL-3.0（FongMi TV） |
| `lib/cat.js` | Cat 系站点运行库（`export{Crypto, Uri, _, cheerio, …}`） | 同上 | GPL-3.0（FongMi TV） |

## 许可提醒

FongMi TV 仓库整体是 **GPL-3.0**。上表前两个文件本身是 MIT 的第三方库（cheerio / crypto-js）；
`gbk.js`、`http.js`、`cat.js` 是 FongMi 自带的。

**本项目因此整体以 GPL-3.0 发布**（见仓库根 `LICENSE`）：`cat.js` 与 `gbk.js` 会被 `include_str!` 编进二进制随包分发，
属于"内嵌 GPL 代码的组合作品"。若要以宽松许可（如 MIT）发布，必须先移除这两个文件，
代价是 Cat 系站点与 GBK 解码不可用。

## Cat 系（`cat.js`）现状

站点形如 `import { Crypto, _ } from 'assets://js/lib/cat.js'`，运行时已接通：
`assets://js/lib/cat.js` 命中内嵌资源，宿主绑定补齐了 `SpiderDebug`（TVBox/catvod 注入的日志器）与
`aesX`（签名对齐 FongMi `Global.java`，用 crypto-js 实现 CBC/ECB/CTR/CFB/OFB）；`rsaX` 为纯 BigInt 实现（PEM → DER 解析 + PKCS#1 v1.5 / NoPadding 填去填充 + 模幂），已与 `openssl pkeyutl` 产物逐字节对拍；`getPort`/`getProxy`/`js2Proxy` 返回真实的本地代理端口与带 token 的代理 URL。

样本很少：15 条订阅里只有 2 个 Cat 站点，且这两个站点上游接口已返回空数据，
因此 Cat 通路的可用性还需要有数据的站点来验证。
