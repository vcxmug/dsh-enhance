// Regression suite for the 2026-08-14 "harness dies on every tool call" bug.
//
// Root cause: the plugin tarballs declared @deepseek-ai/dsh-tools and
// @deepseek-ai/schemastery as REGULAR dependencies. pnpm hoisted a SECOND
// copy of dsh-tools into the profile's node_modules. On a cold boot the
// dsh-base row '@deepseek-ai/dsh-tools' resolves from the profile directory
// FIRST, so the tools service was constructed from the duplicate copy.
// dsh-agent-loop (loaded from the installation) looks the tool-runtime
// scheduler up on that service through a MODULE-SCOPED Symbol
// (TOOL_RUNTIME_SCHEDULER). Two module instances mean two different Symbols,
// so the lookup came back undefined and the first tool call of every turn
// died with:
//
//   Cannot read properties of undefined (reading 'prepare')
//
// Hot reloads never tripped it (the row had already activated the real copy
// before the install), only a cold boot did — exactly the divergence that
// killed a production restart. The web server stayed up, so it looked like
// "the agent is dead".
//
// These tests therefore exercise the REAL distribution path — npm pack, then
// `dsh plugin add` (the actual pnpm install) — and pin the FUNDAMENTAL
// invariant, not the symptom:
//
//   1. A profile's node_modules must never contain a package the harness
//      installation already provides: any such copy lands in the profile's
//      module-resolution path and shadows the installation's copy for
//      composition rows, breaking module-scoped identity (Symbols, brands,
//      instanceof checks). Node's resolution of the in-box packages from the
//      profile directory must land OUTSIDE the profile.
//   2. A cold boot of a headless profile with the installed packages and the
//      production mount rows completes a real agent tool loop.
//
// The previous hand-copy test (copying package sources into node_modules,
// skipping pnpm entirely) structurally cannot produce a duplicate copy and
// passed on the broken packages — which is precisely why it is replaced by
// this suite instead of being extended.
//
// Requires Node >= 22.18 (native type stripping) and the `dsh` launcher on
// PATH (or the DSH env var) with the shipped dsh-base + dsh-headless bundles,
// plus npm (packing) and pnpm (dsh plugin's installer backend). A missing
// tool turns the suite RED, never a silent skip — a skipped suite would
// green-light exactly the regression this file exists to catch. Only
// non-POSIX platforms skip. Everything runs inside throwaway temp dirs (no
// registry access needed for the fixed packages — the tarballs carry no
// installable dependencies).
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlm } from './mock-llm.ts'

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const DSH = process.env.DSH ?? 'dsh'
const PLUGIN_TOOLS = ['native_search', 'native_scrape', 'vision_describe', 'vision_list_models']
const MARKER = 'dsh-loop-ok.txt'
const TASK = 'run the bash tool once and report what it printed'
const RUN_TIMEOUT_MS = 45000

test('the dsh launcher is available — it performs the real install', (t) => {
  if (process.platform === 'win32') {
    t.skip('the real-install suite needs a POSIX shell')
    return
  }
  // The entire regression hangs on the REAL distribution path: `dsh plugin
  // add` installs the packed tarballs into the profile (pnpm is only dsh's
  // internal implementation of that step). A missing launcher must turn the
  // suite RED — skipping here would green-light a run that structurally
  // cannot catch the shadow-copy bug, which is exactly the window dressing
  // this suite replaces.
  const probe = spawnSync('sh', ['-c', `command -v ${JSON.stringify(DSH)}`], { encoding: 'utf8' })
  assert.equal(probe.error, undefined, `cannot probe the dsh launcher: ${probe.error?.message}`)
  assert.equal(
    probe.status,
    0,
    `command -v ${DSH} failed: the launcher that runs 'dsh plugin add' is required`,
  )
  assert.match(probe.stdout, /\S/, `command -v ${DSH} printed no path`)
})

interface RunOutcome {
  timedOut: boolean
  error: Error | undefined
  status: number | null
  stdout: string
  stderr: string
}

interface SetupContext {
  home: string
  workdir: string
  profileDir: string
  /** Every package name inside the dsh installation's own node_modules. */
  installNames: string[]
  /** Every package name inside the test profile's node_modules after install. */
  profileNames: string[]
}

type SetupResult = { ctx: SetupContext } | { failure: string }

/** A fresh unique temp directory without mkdtemp's X-suffix template warning. */
function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Run the headless harness to completion (or SIGTERM after the timeout). */
function runHeadless(args: string[], { cwd, env }: { cwd: string; env: NodeJS.ProcessEnv }): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const child = spawn(DSH, args, { cwd, env })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const done = (value: RunOutcome) => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })
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

/** Absolute path of the dsh launcher, resolved through PATH when bare. */
function resolveLauncher(): string | null {
  try {
    const raw = DSH.includes('/')
      ? DSH
      : spawnSync('sh', ['-c', `command -v ${JSON.stringify(DSH)}`], { encoding: 'utf8' }).stdout.trim()
    return raw === '' ? null : realpathSync(raw)
  } catch {
    return null
  }
}

/** The installation's node_modules (the anchor dir owning the launcher). */
function installNodeModules(launcher: string): string | null {
  let dir = dirname(launcher)
  for (let depth = 0; depth < 12; depth += 1) {
    const candidate = join(dir, 'node_modules')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/** Package names found directly under a node_modules dir (one scope level deep). */
function packageNamesUnder(nodeModulesDir: string): string[] {
  if (!existsSync(nodeModulesDir)) return []
  const names: string[] = []
  for (const entry of readdirSync(nodeModulesDir)) {
    if (entry.startsWith('.')) continue
    const entryDir = join(nodeModulesDir, entry)
    if (entry.startsWith('@')) {
      if (!existsSync(entryDir)) continue
      for (const sub of readdirSync(entryDir)) {
        const manifest = join(entryDir, sub, 'package.json')
        if (existsSync(manifest)) {
          try {
            const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }
            if (typeof parsed.name === 'string') names.push(parsed.name)
          } catch { /* not a package manifest */ }
        }
      }
    } else {
      const manifest = join(entryDir, 'package.json')
      if (existsSync(manifest)) {
        try {
          const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }
          if (typeof parsed.name === 'string') names.push(parsed.name)
        } catch { /* not a package manifest */ }
      }
    }
  }
  return names
}

/**
 * Pack both plugins and install the tarballs into a throwaway headless
 * profile through the production command (`dsh plugin add`), then record the
 * evidence both tests assert on. Cached: both tests share one setup.
 */
let setupPromise: Promise<SetupResult> | undefined
let setupContext: SetupContext | undefined

function ensureSetup(): Promise<SetupResult> {
  setupPromise ??= buildSetup().then((ctx) => {
    setupContext = ctx
    return { ctx }
  }, (error: unknown) => ({ failure: error instanceof Error ? error.stack ?? error.message : String(error) }))
  return setupPromise
}

async function buildSetup(): Promise<SetupContext> {
  const probes: Array<[string, string[]]> = [
    [DSH, ['--version']],
    ['npm', ['--version']],
    ['pnpm', ['--version']],
  ]
  for (const [bin, args] of probes) {
    const probe = spawnSync(bin, args, { encoding: 'utf8' })
    if (probe.error !== undefined || probe.status !== 0) {
      throw new Error(`required toolchain binary missing: ${bin} (${probe.error?.message ?? `exit ${probe.status}`})`)
    }
  }
  const launcher = resolveLauncher()
  if (launcher === null) throw new Error(`cannot resolve the dsh launcher (${DSH})`)
  const installModules = installNodeModules(launcher)
  if (installModules === null) throw new Error('cannot locate the dsh installation node_modules')

  const home = makeTempDir('dsh-enhance-verify')
  const workdir = makeTempDir('dsh-enhance-work')
  const tarballDir = makeTempDir('dsh-enhance-tarballs')
  writeFileSync(join(workdir, MARKER), '')

  // Throwaway harness home. The profile directory starts EMPTY on purpose:
  // `dsh plugin add` initializes it exactly like a real first use (bundle
  // template manifest, the pnpm workspace with nodeLinker: hoisted — the
  // hoisting is what turns duplicate dependencies into shadow copies, so a
  // hand-written profile would bypass the very mechanism this suite guards).
  const profileDir = join(home, 'profiles', 'headless')
  mkdirSync(profileDir, { recursive: true })

  const tarballs: string[] = []
  for (const pkg of ['dsh-vision', 'dsh-native-web']) {
    const packed = spawnSync('npm', ['pack', '--pack-destination', tarballDir], {
      cwd: join(REPO_ROOT, 'packages', pkg),
      encoding: 'utf8',
      timeout: 120000,
    })
    if (packed.error !== undefined || packed.status !== 0) {
      throw new Error(`npm pack failed for ${pkg}: ${packed.error?.message ?? packed.stderr}`)
    }
    const name = packed.stdout.trim().split(/\s+/).filter(Boolean).at(-1)
    if (name === undefined) throw new Error(`npm pack produced no tarball name for ${pkg}`)
    tarballs.push(join(tarballDir, name))
  }

  // The production install path: dsh plugin forwards to pnpm in the profile.
  const added = spawnSync(DSH, ['plugin', '--profile', 'headless', 'add', ...tarballs], {
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
    timeout: 120000,
  })
  if (added.error !== undefined || added.status !== 0) {
    throw new Error(`dsh plugin add failed: ${added.error?.message ?? added.stderr ?? added.stdout}`)
  }

  // One profile boot's worth of setup before the resolution probes: boot
  // heals the shared module fallback (home/profiles/node_modules) — the
  // parent-walk from a fresh home resolves nothing without it. --dump-config
  // runs the same healing and also pre-validates the composition.
  const healed = spawnSync(DSH, ['--profile', 'headless', '--dump-config'], {
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
    timeout: 60000,
  })
  if (healed.error !== undefined || healed.status !== 0) {
    throw new Error(`dsh --dump-config failed (composition does not compose): ${healed.error?.message ?? healed.stderr ?? healed.stdout}`)
  }

  // Production mount placement: the profile patch layer.
  writeFileSync(join(profileDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: vision',
    "      name: '@vcxmug/dsh-vision'",
    '    - id: native-web',
    "      name: '@vcxmug/dsh-native-web'",
    '',
  ].join('\n'))

  return {
    home,
    workdir,
    profileDir,
    installNames: packageNamesUnder(installModules),
    profileNames: packageNamesUnder(join(profileDir, 'node_modules')),
  }
}

after(() => {
  if (setupContext !== undefined) {
    rmSync(setupContext.home, { recursive: true, force: true })
    rmSync(setupContext.workdir, { recursive: true, force: true })
  }
})

test('no shadow copy: the profile never duplicates an in-box package', async (t) => {
  if (process.platform === 'win32') {
    t.skip('the bash tool needs a POSIX shell')
    return
  }
  const setup = await ensureSetup()
  if ('failure' in setup) {
    assert.fail(setup.failure)
    return
  }
  const { ctx } = setup

  // The fundamental invariant: nothing the harness installation already
  // provides may appear in the profile's own node_modules. Any such copy sits
  // in the profile's resolution path and shadows the installation's copy for
  // composition rows — the mechanism that produced the duplicate dsh-tools
  // whose module-scoped Symbol no longer matched dsh-agent-loop's.
  const inBox = new Set(ctx.installNames)
  const dupes = ctx.profileNames.filter((name) => inBox.has(name))
  assert.deepEqual(dupes, [], [
    `profile node_modules contains ${dupes.length} package(s) the harness installation already provides — `,
    'a second module instance breaks module-scoped identity (e.g. the ',
    "dsh-tools TOOL_RUNTIME_SCHEDULER Symbol) and kills every tool call after a cold boot: ",
    dupes.join(', '),
  ].join(''))

  // Resolution proof, anchored at the profile directory exactly like the
  // loader's baseUrl (createRequire probes the same node_modules parent-walk;
  // Node's import.meta.resolve ignores its parent argument, so it cannot be
  // used here): the in-box packages must resolve OUTSIDE the profile...
  const profileRequire = createRequire(join(ctx.profileDir, 'probe.cjs'))
  for (const name of ['@deepseek-ai/dsh-tools', '@deepseek-ai/schemastery']) {
    const resolved = profileRequire.resolve(name)
    assert.ok(
      resolved !== ctx.profileDir && !resolved.startsWith(`${ctx.profileDir}/`),
      `'${name}' resolves to a copy inside the profile (${resolved}) — a cold boot would build services from this duplicate`,
    )
  }
  // ...while the plugins themselves must have actually installed (a silently
  // failed install must fail the test instead of passing vacuously).
  for (const name of ['@vcxmug/dsh-vision', '@vcxmug/dsh-native-web']) {
    const resolved = profileRequire.resolve(name)
    assert.ok(
      resolved === ctx.profileDir || resolved.startsWith(`${ctx.profileDir}/`),
      `'${name}' does not resolve inside the profile (${resolved}) — the tarball install did not happen`,
    )
  }
})

test('cold boot with the installed packages completes a real agent tool loop', async (t) => {
  if (process.platform === 'win32') {
    t.skip('the bash tool needs a POSIX shell')
    return
  }
  const setup = await ensureSetup()
  if ('failure' in setup) {
    assert.fail(setup.failure)
    return
  }
  const { ctx } = setup

  const mock = await startMockLlm()
  t.after(async () => {
    await mock.close()
  })

  const env = { ...process.env }
  delete env.DSH_TOOLS_MODE
  const run = await runHeadless(['--profile', 'headless', TASK], {
    cwd: ctx.workdir,
    env: {
      ...env,
      DSH_HOME: ctx.home,
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${mock.port}/v1`,
      DEEPSEEK_API_KEY: 'mock-key',
    },
  })

  assert.equal(run.timedOut, false, `headless run did not finish within ${RUN_TIMEOUT_MS}ms:\n${run.stderr}`)
  assert.equal(run.error, undefined, `failed to spawn ${DSH}: ${run.error}`)
  assert.ok(
    !run.stderr.includes("reading 'prepare'"),
    `tool call crashed with the duplicate-copy symbol error (regression):\n${run.stderr}`,
  )
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
