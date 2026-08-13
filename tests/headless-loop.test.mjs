// Runtime verification of the two plugins inside a REAL agent loop, with no
// API key and no network: a scripted mock LLM (tests/mock-llm.mjs) asks the
// agent to run the `bash` tool; the headless dsh profile executes it; the
// harness's own waterfall chain (tools/execute -> tools/result -> completion)
// must survive the mount, and the agent must finish cleanly (exit 0).
//
// Methodology mirrors the DSH repo's mock:llm + headless approach:
//   mock LLM (first reply = bash tool call) -> real agent loop -> evidence.
//
// Requires the `dsh` launcher on PATH (or the DSH env var) with the shipped
// dsh-base + dsh-headless bundles, and a POSIX shell. The test SKIPS when
// dsh is unavailable; everything else runs inside throwaway temp dirs.
//
// NOTE: the mock server lives in THIS process, so the harness child must be
// spawned asynchronously — a blocking spawnSync would freeze the event loop
// and the mock could never answer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlm } from './mock-llm.mjs'

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const DSH = process.env.DSH ?? 'dsh'
const PLUGIN_TOOLS = ['native_search', 'native_scrape', 'vision_describe', 'vision_list_models']
const MARKER = 'dsh-loop-ok.txt'
const TASK = 'run the bash tool once and report what it printed'
const RUN_TIMEOUT_MS = 45000

/** A fresh unique temp directory without mkdtemp's X-suffix template warning. */
function makeTempDir(prefix) {
  const dir = join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Run the headless harness to completion (or SIGTERM after the timeout). */
function runHeadless(args, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(DSH, args, { cwd, env })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const done = (value) => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const killer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, RUN_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(killer)
      done({ timedOut, error, status: null, stdout, stderr })
    })
    child.on('close', (status) => {
      clearTimeout(killer)
      done({ timedOut, error: undefined, status, stdout, stderr })
    })
  })
}

test('both plugins mount; a full agent tool loop completes end to end', async (t) => {
  if (process.platform === 'win32') {
    t.skip('the bash tool needs a POSIX shell')
    return
  }
  const probe = spawnSync(DSH, ['--version'], { encoding: 'utf8' })
  if (probe.error !== undefined || probe.status !== 0) {
    t.skip(`dsh launcher not found (set DSH env to the launcher): ${probe.error?.message ?? `exit ${probe.status}`}`)
    return
  }

  const home = makeTempDir('dsh-enhance-verify')
  const workdir = makeTempDir('dsh-enhance-work')
  writeFileSync(join(workdir, MARKER), '')

  // Throwaway harness home with a headless profile (dsh-base + dsh-headless,
  // both shipped with the installation) and our two packages copied into its
  // node_modules. No registry, no pnpm, nothing leaves the temp directory.
  const profileDir = join(home, 'profiles', 'headless')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-headless',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } },
  }, null, 2))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  for (const pkg of ['dsh-vision', 'dsh-native-web']) {
    const src = join(REPO_ROOT, 'packages', pkg)
    const dst = join(profileDir, 'node_modules', '@vcxmug', pkg)
    mkdirSync(dst, { recursive: true })
    cpSync(src, dst, { recursive: true, filter: (entry) => !entry.includes('node_modules') })
  }
  const overlay = join(home, 'mount-plugins.yml')
  writeFileSync(overlay, [
    '- insert:',
    '    - id: vision',
    "      name: '@vcxmug/dsh-vision'",
    '    - id: native-web',
    "      name: '@vcxmug/dsh-native-web'",
    '',
  ].join('\n'))

  const mock = await startMockLlm()
  t.after(async () => {
    await mock.close()
    rmSync(home, { recursive: true, force: true })
    rmSync(workdir, { recursive: true, force: true })
  })

  const env = { ...process.env }
  delete env.DSH_TOOLS_MODE
  const run = await runHeadless(
    ['--profile', 'headless', '--patch', overlay, TASK],
    {
      cwd: workdir,
      env: {
        ...env,
        DSH_HOME: home,
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${mock.port}/v1`,
        DEEPSEEK_API_KEY: 'mock-key',
      },
    },
  )

  assert.equal(run.timedOut, false, `headless run did not finish within ${RUN_TIMEOUT_MS}ms:\n${run.stderr}`)
  assert.equal(run.error, undefined, `failed to spawn ${DSH}: ${run.error}`)
  assert.equal(run.status, 0, `headless run failed (exit ${run.status}):\n${run.stderr}`)
  assert.match(run.stdout, /MOCK-OK/, `agent never reached the final completion:\n${run.stdout}`)
  assert.ok(
    run.stdout.includes(MARKER),
    `bash output missing from the final report — the tool call did not really execute:\n${run.stdout}`,
  )

  const requests = mock.log
  const toolRequest = requests.find((entry) => entry.toolCount > 0)
  assert.ok(toolRequest, 'expected an LLM request carrying the tool list')
  for (const name of PLUGIN_TOOLS) {
    assert.ok(toolRequest.tools.includes(name), `tool "${name}" missing from the agent's tool list`)
  }
  assert.ok(requests.some((entry) => entry.hasToolResult), 'tool result never reached the model')
})
