# 在 Mac 上部署开发环境（给 AI Agent 的提示词）

把下面整段**直接复制**给你的 AI Agent（Claude Code / Codex / Cursor / 本应用自带的 Agent 都行），
它会在这台 Mac 上把环境装好、编译并启动本项目。若你更喜欢自己敲命令，见文末「手动命令」。

---

## 复制这一段 ↓

```text
请在我的 macOS 上把 IPTV Mac（仓库 https://github.com/seldoms/iptv-mac）的开发环境部署好，要求：

1. 先检测并补齐依赖（已装的跳过，不要重复安装；缺失的用 Homebrew 安装）：
   - Xcode Command Line Tools（xcode-select --install，若未装）
   - Homebrew（/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"）
   - Node.js 20+（brew install node@20 或 nvm）
   - Rust stable（curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh）
   - ffmpeg（brew install ffmpeg）
   - 交叉编译/打包所需的 macOS 工具（tauri 依赖 WebKit，系统自带即可）
   每一步装完都要校验版本（node -v / cargo -V / ffmpeg -version），失败要直接告诉我原因。

2. 克隆并安装依赖：
   git clone https://github.com/seldoms/iptv-mac.git
   cd iptv-mac && npm install

3. 取回内置 ffmpeg（仓库不提交这个大文件，但 tauri 配置把它声明为打包资源，缺失会编译失败）：
   bash scripts/fetch-ffmpeg.sh

4. 跑一遍校验，全部通过再继续：
   npm run typecheck
   npm test
   cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1
   （注意：cargo test 必须加 -- --test-threads=1，并行跑会偶发挂起）

5. 启动开发模式（会弹出应用窗口）：
   npm run dev

6. 如果要产出可安装的 macOS 客户端：
   npm run build:mac        # 产物在 src-tauri/target/release/bundle/
   注意：本机打包若卡在 DMG 步骤，可只用 --bundles app：
   npx tauri build --bundles app

7. 最后向我汇报：装了什么版本、哪一步失败过、`npm run dev` 是否成功弹出窗口。
   如果有任何权限/证书类弹窗，请告诉我该怎么点，不要自己猜着跳过。
```

---

## 手动命令（不依赖 Agent）

```bash
# 1. 依赖
xcode-select --install                       # 已装会提示已安装
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node@20 ffmpeg
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 2. 代码
git clone https://github.com/seldoms/iptv-mac.git && cd iptv-mac
npm install
bash scripts/fetch-ffmpeg.sh

# 3. 校验（Rust 测试必须单线程）
npm run typecheck && npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1

# 4. 开发 / 打包
npm run dev
npm run build:mac        # 或: npx tauri build --bundles app
```

## 常见坑

| 现象 | 原因 / 处理 |
|---|---|
| `resource path \`binaries/ffmpeg\` doesn't exist` | 没执行 `bash scripts/fetch-ffmpeg.sh`（该文件被 .gitignore 排除，但 tauri 把它声明为打包资源） |
| `cargo test` 长时间无输出 | 并行执行会挂起，加 `-- --test-threads=1` |
| DMG 打包卡住 | 本机 `hdiutil` 挂载偶发失败；用 `npx tauri build --bundles app`，或交给 CI |
| 打开 App 提示"无法验证开发者" | 未签名：右键 → 打开，或 `xattr -d com.apple.quarantine "/Applications/IPTV Mac.app"` |
| 数据看起来"丢了" | 检查是否用过 `IPTV_TEST_DATA_DIR`（会把数据写到别的目录）；正常数据在 `~/Library/Application Support/com.iptvmac.desktop/` |
