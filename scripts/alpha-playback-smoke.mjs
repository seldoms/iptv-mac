import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RESULT_KEY = '__alphaPlaybackSmokeResult'
const RUNS = Number.parseInt(process.env.IPTV_ALPHA_PLAYBACK_SMOKE_RUNS || '1', 10)
const SMOKE_TIMEOUT_MS = Number.parseInt(process.env.IPTV_ALPHA_PLAYBACK_SMOKE_TIMEOUT_MS || '20000', 10)
const MAX_FIRST_FRAME_MS = Number.parseInt(process.env.IPTV_ALPHA_PLAYBACK_SMOKE_MAX_FIRST_FRAME_MS || '10000', 10)
const PROCESS_TIMEOUT_MS = Math.max(SMOKE_TIMEOUT_MS + 90000, 120000)
const EXPECT_FAILURE = process.env.IPTV_ALPHA_PLAYBACK_SMOKE_EXPECT_FAILURE === '1'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function percentile(values, ratio) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.round((sorted.length - 1) * ratio)
  return sorted[index] ?? null
}

function stopProcess(child) {
  if (!child.pid || child.exitCode != null) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {}
  }
}

async function waitForResult(settingsPath, child, outputLines) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < PROCESS_TIMEOUT_MS) {
    if (child.exitCode != null) {
      throw new Error(`Tauri exited before smoke result, code=${child.exitCode}`)
    }

    try {
      const raw = await readFile(settingsPath, 'utf8')
      const settings = JSON.parse(raw)
      if (settings && typeof settings === 'object' && settings[RESULT_KEY]) {
        return settings[RESULT_KEY]
      }
    } catch {
      // The app may not have created settings.json yet.
    }

    await sleep(500)
  }

  const tail = outputLines.slice(-80).join('\n')
  throw new Error(`Timed out waiting for smoke result after ${PROCESS_TIMEOUT_MS}ms\n${tail}`)
}

async function runOnce(index) {
  const dataDir = await mkdtemp(join(tmpdir(), `iptv-alpha-playback-smoke-${index}-`))
  const settingsPath = join(dataDir, 'settings.json')
  const outputLines = []
  const child = spawn('npm', ['run', 'dev:tauri'], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      IPTV_TEST_DATA_DIR: dataDir,
      IPTV_ALPHA_PLAYBACK_SMOKE: '1',
      IPTV_ALPHA_PLAYBACK_SMOKE_TIMEOUT_MS: String(SMOKE_TIMEOUT_MS)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const collectOutput = (chunk) => {
    const text = chunk.toString()
    process.stdout.write(text)
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) outputLines.push(line)
    }
    if (outputLines.length > 300) outputLines.splice(0, outputLines.length - 300)
  }

  child.stdout.on('data', collectOutput)
  child.stderr.on('data', collectOutput)

  try {
    const result = await waitForResult(settingsPath, child, outputLines)
    stopProcess(child)
    await sleep(1000)
    await rm(dataDir, { recursive: true, force: true })
    return result
  } catch (error) {
    stopProcess(child)
    await sleep(1000)
    throw error
  }
}

const results = []
for (let index = 1; index <= RUNS; index += 1) {
  console.log(`\n=== Alpha playback smoke run ${index}/${RUNS} ===`)
  const result = await runOnce(index)
  console.log(`SMOKE_RESULT ${JSON.stringify(result)}`)
  results.push(result)
}

const elapsedSamples = results
  .filter((result) => result.ok && typeof result.elapsedMs === 'number')
  .map((result) => result.elapsedMs)
const failed = results.filter((result) => !result.ok)
const p50 = percentile(elapsedSamples, 0.5)
const p90 = percentile(elapsedSamples, 0.9)

console.log('\n=== Alpha playback smoke summary ===')
console.log(`runs=${results.length} passed=${results.length - failed.length} failed=${failed.length}`)
console.log(`first_frame_ms p50=${p50 ?? '-'} p90=${p90 ?? '-'}`)

if (EXPECT_FAILURE) {
  const failuresWithDiagnostics = failed.filter((result) => result.diagnostic)
  if (failuresWithDiagnostics.length !== results.length) {
    console.error('Smoke failed: expected every run to fail with diagnostics')
    process.exit(1)
  }
  console.log('expected_failure=true diagnostics=present')
  process.exit(0)
}

if (failed.length > 0) {
  console.error(`Smoke failed: ${failed[0].message}`)
  process.exit(1)
}

if (p90 == null || p90 > MAX_FIRST_FRAME_MS) {
  console.error(`Smoke failed: p90 ${p90 ?? '-'}ms exceeds ${MAX_FIRST_FRAME_MS}ms`)
  process.exit(1)
}
