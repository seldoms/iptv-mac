# Agent Rules

Codex is the supervisor for this repository.

## Workflow

1. Codex reads the relevant code and repository instructions first.
2. Codex owns all analysis, file edits, test runs, and final verification.
3. Work is complete only after relevant tests pass or clear manual verification
   steps are documented.

## Current Workflow

- Read `HANDOFF.md` and `docs/SUBSCRIPTION_PLAYBACK.md` before continuing.
- Save subscriptions independently of activation. Failed inspection must not
  prevent saving a backup address.
- VOD loads on demand. Live TV reads a persisted aggregated channel library;
  background refresh must not interrupt current playback.
- Channel identity and line identity differ: preserve CCTV5+, and preserve
  distinct request headers even when two lines use the same URL.
- Run `npm run typecheck`, `npm test`, and `npm run test:rust` for shared changes.
- Build a test app with `npm exec tauri build -- --debug --bundles app`, then
  run `node scripts/subscription-test-env.mjs` for isolated native UI verification.
  The harness creates temporary subscription/database data and retains logs.
- All background work must use `AppState.data_dir`, including test overrides.
- Architecture choices, reference projects, verification, and remaining limits
  are recorded in `docs/SUBSCRIPTION_PLAYBACK.md`.
