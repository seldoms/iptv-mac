# IPTV Mac Upgrade Notes - 2026-06-16

## Overview

This update moves IPTV Mac from a basic TVBox-style desktop shell toward a more reliable macOS IPTV player. The work focuses on two product goals:

- Alpha 2.1: make playback reliable, explain failures, and recover through parsing, local proxying, and source switching.
- Beta 1: make continue-watching reliable across episodes, sources, app restarts, and force exits.

## Product Strategy

- Added a product upgrade design covering positioning, customer journeys, opportunity-solution tree, priorities, and roadmap.
- Reframed the product around successful viewing sessions, visible recovery, local-only diagnostics, source health, and reliable continuation.
- Updated the roadmap to reflect the current implementation state and next priorities.
- Made the GitHub repository public and folded stale local remediation notes into the maintained roadmap and verification records.

## Playback Reliability

- Implemented `site:superParse` in Rust so non-direct VOD playback can use configured parse rules.
- Implemented `site:findAcrossSites` in Rust for cross-site same-title fallback candidates.
- Added a token-protected local media proxy with HLS playlist rewriting, header forwarding, CORS, range support, shared runtime/client reuse, media streaming, and bounded proxy item storage.
- Improved `VideoPlayer` protocol handling so HLS, DASH, and native playback paths are treated more appropriately.
- Added structured playback diagnostics with stage, error kind, protocol, source id, attempts, and next action.
- Added diagnostic copy, retry-current, switch-source, first-frame metrics, and failure samples.
- Added a Tauri WebView smoke harness for first-frame success and structured failure diagnostics.

## Continue Watching

- Migrated history schema to v3 with episode id/name/index, source index/name, URL identifier, duration, position, and completed state.
- Persisted playback progress every 15 seconds and on pause, end, player unmount, and source/episode switches.
- Marked videos watched past 95% as completed and reset resume position to the beginning.
- Added a detail-page continue button that restores the saved source, episode, and timestamp.
- Added a home-page continue-watching section.
- Improved the history page to show episode/source/timestamp context instead of only a raw percentage.
- Added an automated force-restart smoke test that seeds continue-watching history, kills Tauri with `SIGKILL`, relaunches with the same data directory, and verifies the resume target.

## Validation

- `npm run check` passes: TypeScript, Vitest, Rust tests, web build, and Tauri debug build.
- Vitest passes: 5 test files, 22 tests.
- Rust tests pass: 102 tests.
- `npm run smoke:alpha-playback-ui` validates Tauri WebView playback paths.
- `npm run smoke:beta-continue` validates continue-watching persistence across force restart.
- `git diff --check` passes.

## Known Follow-ups

- Add source-health scoring so repeated real playback successes/failures affect search, fallback, and live source ranking.
- Expand protocol-specific user-facing error copy for DASH, native media, CORS/header issues, and unsupported formats.
- Add release screenshots for parse failure, automatic source switching, diagnostics, and continue-watching states.
- Continue improving macOS release readiness: signing, notarization, automatic updates, crash recovery, and long-play memory checks.
