# Beta 1 Continue Watching Verification

Date: 2026-06-16

## Scope

This record tracks the first Beta 1 remediation slice: reliable continue-watching data and recovery from history.

## Implemented

| Requirement | Evidence |
| --- | --- |
| History schema can restore episode, source, duration, and position | `src-tauri/src/database.rs` schema version 3 adds episode/source/url/duration/position/completed fields |
| Existing databases migrate without data loss | Rust tests cover v1 -> v3 and v2 -> v3 migration paths |
| Playback progress is persisted during playback | `VideoPlayer` saves history every 15 seconds and on pause, ended, and unmount |
| Completed playback does not resume from the tail | `VideoPlayer` marks `completed` when position is at least 95% of duration and stores `positionSeconds = 0` |
| Detail page exposes resume action | `VodDetail` loads matching history and shows a continue button with episode and timestamp |
| Home page exposes continue watching | `Home` shows recent unfinished history items above the content grid |
| History page shows usable resume context | `History` shows episode/source and timestamp instead of only raw percentage |

## Automated Verification

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm test` | Pass: 5 test files, 22 tests |
| `cargo test --manifest-path src-tauri/Cargo.toml database -- --nocapture` | Pass: 11 database tests |
| `npm run check` | Pass: typecheck, Vitest, 102 Rust tests, web build, and Tauri debug build |
| `npm run smoke:beta-continue` | Pass: seeded v3 history, killed Tauri with SIGKILL, relaunched with same data dir, restored position 372s with 0s delta |

## Remaining Verification

| Acceptance item | Current evidence | Gap |
| --- | --- | --- |
| Force quit and reopen resumes within 20 seconds | `npm run smoke:beta-continue` verified 372s restored after SIGKILL and relaunch with 0s delta | Met |
| Same video on different sites does not collide | `history` still keys on `siteKey + vodId` | Met |
| Completed videos resume from the beginning | `completed` stores `positionSeconds = 0` when progress >= 95% | Met in code; should be covered by UI smoke |
| Home continue item opens correct detail and resume target | Home item navigates to detail; detail chooses saved source/episode | Met in code; should be covered by UI smoke |
