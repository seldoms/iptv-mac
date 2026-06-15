import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RESULT_KEY = '__betaContinueSmokeResult'
const POSITION_SECONDS = Number.parseInt(process.env.IPTV_BETA_CONTINUE_SMOKE_POSITION_SECONDS || '372', 10)
const TOLERANCE_SECONDS = Number.parseInt(process.env.IPTV_BETA_CONTINUE_SMOKE_TOLERANCE_SECONDS || '20', 10)
const PROCESS_TIMEOUT_MS = Number.parseInt(process.env.IPTV_BETA_CONTINUE_SMOKE_PROCESS_TIMEOUT_MS || '120000', 10)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stopProcess(child, signal = 'SIGTERM') {
  if (!child.pid || child.exitCode != null) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {}
  }
}

async function waitForResult(settingsPath, child, outputLines, phase) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < PROCESS_TIMEOUT_MS) {
    if (child.exitCode != null) {
      throw new Error(`Tauri exited before ${phase} smoke result, code=${child.exitCode}`)
    }

    try {
      const raw = await readFile(settingsPath, 'utf8')
      const settings = JSON.parse(raw)
      const result = settings?.[RESULT_KEY]
      if (result?.phase === phase) return result
    } catch {
      // The app may not have created settings.json yet.
    }

    await sleep(500)
  }

  const tail = outputLines.slice(-80).join('\n')
  throw new Error(`Timed out waiting for ${phase} smoke result after ${PROCESS_TIMEOUT_MS}ms\n${tail}`)
}

async function runPhase(dataDir, phase, killSignal) {
  const settingsPath = join(dataDir, 'settings.json')
  const outputLines = []
  const child = spawn('npm', ['run', 'dev:tauri'], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      IPTV_TEST_DATA_DIR: dataDir,
      IPTV_BETA_CONTINUE_SMOKE: '1',
      IPTV_BETA_CONTINUE_SMOKE_PHASE: phase,
      IPTV_BETA_CONTINUE_SMOKE_POSITION_SECONDS: String(POSITION_SECONDS),
      IPTV_BETA_CONTINUE_SMOKE_TOLERANCE_SECONDS: String(TOLERANCE_SECONDS)
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
    const result = await waitForResult(settingsPath, child, outputLines, phase)
    stopProcess(child, killSignal)
    await sleep(1000)
    return result
  } catch (error) {
    stopProcess(child, 'SIGTERM')
    await sleep(1000)
    throw error
  }
}

const dataDir = await mkdtemp(join(tmpdir(), 'iptv-beta-continue-smoke-'))
try {
  console.log('\n=== Beta continue smoke seed ===')
  const seed = await runPhase(dataDir, 'seed', 'SIGKILL')
  console.log(`SMOKE_SEED ${JSON.stringify(seed)}`)
  if (!seed.ok) {
    console.error(`Smoke failed during seed: ${seed.message}`)
    process.exit(1)
  }

  console.log('\n=== Beta continue smoke validate ===')
  const validate = await runPhase(dataDir, 'validate', 'SIGTERM')
  console.log(`SMOKE_VALIDATE ${JSON.stringify(validate)}`)
  if (!validate.ok) {
    console.error(`Smoke failed during validate: ${validate.message}`)
    process.exit(1)
  }

  console.log('\n=== Beta continue smoke summary ===')
  console.log(`expected_position=${POSITION_SECONDS}s actual_position=${validate.actualPositionSeconds}s tolerance=${TOLERANCE_SECONDS}s`)
} finally {
  await rm(dataDir, { recursive: true, force: true })
}
