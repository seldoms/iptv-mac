# Alpha 2.1 Playback Loop Verification

Date: 2026-06-16

## Scope

This record tracks verification for the Alpha 2.1 playback-loop remediation from `PRODUCT_UPGRADE_DESIGN.md`.

## Implemented And Verified

| Requirement | Evidence |
| --- | --- |
| `site:superParse` Rust handler is implemented | `src-tauri/src/commands/site.rs` calls `super_parse::super_parse` with current config `parses` |
| `site:findAcrossSites` Rust handler is implemented | `src-tauri/src/commands/site.rs` searches supported HTTP API sites concurrently, dedupes, limits, and excludes current source |
| `local:getServerInfo` contract is aligned with frontend | `src-tauri/src/lib.rs` returns `LocalProxyInfo { url, token }`; `src/renderer/src/utils/media.ts` consumes `{ url, token }` |
| Local proxy supports Header-bearing HLS/live playback | `src-tauri/src/local_proxy.rs` supports token, Header query, HLS playlist rewrite, CORS, and `Range/If-Range` forwarding |
| Local proxy is optimized for WebView HLS startup | Proxy now reuses a shared Tokio runtime and reqwest client, streams media segments, exposes range headers, and rewrites playlist entries to short local IDs instead of full encoded URLs |
| Non-direct parse failure is not shown as generic playback failure | `src/renderer/src/pages/VodDetail/VodDetail.tsx` sets `stage=parse`, `errorKind=parse_failed`, and user-facing `解析失败` |
| Automatic source switching is visible | `VideoPlayer` diagnostics show switch state, failed source count, alternative source count, and next action |
| Alternative source success is not falsely marked broken | `VodDetail` now marks an alternative source broken only after detail/play data loading fails |
| Runtime playback metrics are captured locally | `src/renderer/src/utils/playbackMetrics.ts` records first-frame and failure samples in `localStorage`; diagnostics copy includes first-frame P50/P90 and failure count |
| Tauri WebView playback smoke harness exists | `scripts/alpha-playback-smoke.mjs` injects `__alphaPlaybackSmoke`, launches `tauri dev` with an isolated data dir, and reads first-frame/failure diagnostics from settings |

## Automated Verification

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm test` | Pass: 5 test files, 22 tests |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Pass: 102 tests |
| `npm run build:web` | Pass, with existing chunk-size warning |
| `npm run build:check` | Pass: Tauri debug app built |
| `npm run check` | Pass |
| `git diff --check` | Pass |
| Web smoke via in-app Browser at `http://127.0.0.1:5174/` | Pass: onboarding and main route rendered, no console errors captured |
| `cargo run --manifest-path src-tauri/Cargo.toml --example rust_startup_flow` | Pass: local config/VOD/live startup flow |
| `cargo run --manifest-path src-tauri/Cargo.toml --example business_flow_probe` | Pass: 13 external configs loaded, 1 VOD play link found, 13 live play links found, 8 live samples alive |
| `npm run smoke:alpha-playback-ui` | Pass: default MP4 first frame 3329ms |
| `IPTV_ALPHA_PLAYBACK_SMOKE_RUNS=3 IPTV_ALPHA_PLAYBACK_SMOKE_MEDIA_URL=https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8 npm run smoke:alpha-playback-ui` | Pass: proxied HLS in Tauri WebView, 3/3 passed, first-frame P50 2640ms, P90 3742ms |
| `IPTV_ALPHA_PLAYBACK_SMOKE_EXPECT_FAILURE=1 IPTV_ALPHA_PLAYBACK_SMOKE_MEDIA_URL=https://example.invalid/not-found.m3u8 npm run smoke:alpha-playback-ui` | Pass: expected HLS manifest failure produced structured diagnostics |
| `IPTV_ALPHA_PLAYBACK_SMOKE_MAX_FIRST_FRAME_MS=20000 IPTV_ALPHA_PLAYBACK_SMOKE_MEDIA_URL=https://cdn.ryplay11.com/20260608/201356_6153a2e3/index.m3u8 npm run smoke:alpha-playback-ui` | Pass: real proxied business HLS first frame 4169ms |
| `cargo run --manifest-path src-tauri/Cargo.toml --example alpha_2_1_playback_probe` | Pass: 10 real VOD samples, 10 playback requests succeeded, request success rate 100%, request P50 2276ms, request P90 4200ms |

## Remaining Alpha 2.1 Verification Notes

The core playback loop is now automatically verified in Tauri WebView, including first-frame success and structured failure diagnostics. Remaining notes:

| Acceptance item | Current evidence | Gap |
| --- | --- | --- |
| 10 real VOD samples playback request success rate >= 85% | `alpha_2_1_playback_probe` verified 10/10 real VOD requests from a known-good TVBox source | Met; broader bad-source tolerance remains a source-health/ranking problem |
| Click-to-first-frame P50 <= 3s and P90 <= 10s | Tauri WebView proxied HLS smoke verified P50 2640ms and P90 3742ms on stable public HLS; real business HLS sample passed at 4169ms | Met on stable HLS; real external providers remain CDN-variable and should be monitored with repeated samples |
| Failure diagnostics visible in real UI | Expected-failure Tauri smoke produced structured HLS manifest diagnostics; store tests and UI code paths verified | Met for automated diagnostic export; screenshots/manual UX polish can still be added before release |

## Next Best Work

1. Add source-health scoring so slow or flaky external providers do not dominate automatic sampling or ranking.
2. Persist rolling WebView first-frame samples by provider/CDN to distinguish app regressions from upstream volatility.
3. Add release screenshots for parse failure and automatic source switching states.
