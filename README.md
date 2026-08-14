# dsh-enhance

[简体中文](README.zh.md)

A toolkit of native plugins that fill the gaps of the DeepSeek Harness /
DeepSeek models: capabilities the official stack does not have or does poorly,
as **one composition row each**, configured entirely from the **Web settings
UI**. Installation is **one command** (`./install.sh`); there is no npm
publishing and no manual YAML editing.

## What you get

| Capability | Package | Tools | Fills the gap |
|---|---|---|---|
| **Vision** | `packages/dsh-vision` | `vision_describe`, `vision_list_models` | DeepSeek models have no image input; this gives agents eyes on demand through any Responses API-compatible multimodal model endpoint |
| **Native web** | `packages/dsh-native-web` | `native_search`, `native_scrape` | Built-in search depends on a cloud provider (extra token cost); MCP bridges add hops. This talks **directly over HTTP to your local self-hosted web instance** (Firecrawl-compatible), no bridge, no cloud |

Both plugins are host-side Cordis plugins: one `fetch` per tool call, per-call
timeouts, caller-cancellation aware, API keys marked secret and redacted on
the wire.

## Quick start

1. **Prerequisites** — `dsh` on PATH, `npm`, `pnpm`, Linux with GNU coreutils
   (GNU `sed` is detected explicitly). Node >= 22.18 for the repo tooling
   (`--verify` / `npm test`); the plugins themselves run on Node 18+.
2. **Install everything**:
   ```bash
   ./install.sh
   ```
   Idempotent — safe to re-run. It packs both plugins, installs them into the
   `web` profile, mounts the two rows in the profile's patch layer (every
   session of that profile gets the tools), creates the `enhance` agent preset
   (shipped `standard` preset + built-in `web_search` disabled) and sets it as
   the default for new sessions. No restart is needed when `dsh web` is
   already running — the patch layer hot-reloads; otherwise just start
   `dsh web`. (`./install.sh --restart` performs a managed restart itself;
   see [bin/restart-web.sh](bin/restart-web.sh).)
3. **Configure the tools** in the Web UI: **Settings → Plugins → dsh-vision /
   dsh-native-web** (field-by-field guidance below). Until configured, the
   tools fail on call with a clear "not configured" error — expected.
4. **Verify end to end**: open any session and send the
   [self-test prompt](docs/self-test-prompt.md).
5. **Check the regression suite** (optional but recommended):
   ```bash
   ./install.sh --verify   # or: npm test
   ```

## How `install.sh` works

Every step detects its own previous result and becomes a no-op (an installed
profile short-circuits pack+install entirely):

1. hard-checks `dsh` / `npm` / `pnpm` / `realpath` / GNU `sed` — missing tools
   fail loudly, never skip;
2. packs both plugins and installs them with `dsh plugin --profile <name> add`
   — the real production install path; tarballs are kept under
   `$DSH_HOME/enhance-pkgs` so the profile's `file:` dependencies keep
   resolving across reinstalls (moving `$DSH_HOME` afterwards requires
   re-running `install.sh`);
3. appends the two mount rows to the profile's `cordis.patch.yml` — pure mount
   points; a half-mounted state self-heals (only the missing rows are added);
4. copies the **installation's own shipped `standard` preset** to the
   `enhance` agent preset with the built-in `web_search` disabled, and sets it
   as the default for future sessions. It deliberately does not copy the
   cordis preset: two cordis-family presets in one process collide on the
   host inspect provider;
5. optional `--restart` (web profile only, managed via `bin/restart-web.sh`)
   and `--verify` (runs `npm test`).

## Configuration

Everything below is edited in the Web settings form (Settings → Plugins);
changes apply on the next tool call, no restart.

### dsh-vision

| Field | Meaning |
|---|---|
| `baseUrl` | Responses-API-compatible endpoint base, e.g. `https://api.openai.com/v1` — any provider speaking `/responses` works |
| `model` | Multimodal model served by that endpoint |
| `apiKey` | Literal key (stored secret, redacted on the wire). Empty → read `apiKeyFile` |
| `apiKeyFile` | JSON file under `$HOME` (or an absolute path) holding the key, read with `apiKeyField` |
| `apiKeyField` | Field name inside that JSON file (default `API_KEY`) |
| `detail` | Default image detail: `auto` / `low` / `high` |
| `maxImageBytes` | Local image size cap before base64 encoding (default 20 MB) |
| `timeoutMs` | Per-call timeout |

### dsh-native-web

| Field | Meaning |
|---|---|
| `baseUrl` | Your self-hosted instance root, e.g. `http://127.0.0.1:3002`. Empty → probe `probeUrls` at call time |
| `probeUrls` | Candidate endpoints probed when `baseUrl` is empty |
| `apiKey` | Instance API key. Empty → no `Authorization` header (`USE_DB_AUTHENTICATION=false` instances need none) |
| `apiVersion` | API prefix: self-hosted Firecrawl 2.11.x uses `v1`; cloud docs describe `v2` |
| `searchTimeoutMs` / `scrapeTimeoutMs` | Per-call timeouts |

The web instance itself (docker compose, see
[firecrawl/firecrawl](https://github.com/firecrawl/firecrawl)) must be
running: the tools resolve it lazily and fail with a clear
"no local web instance detected" error on the first call if it is down.

## Mounting the rows (manual reference)

`install.sh` uses placement A automatically. The two placements are equivalent
— pick one if you install by hand (the rows are pure mount points; copy from
`presets/vision.cordis.yml` and `presets/native-web.cordis.yml`):

**A. Profile patch layer — every session of that profile, from the start.**
Append an insert patch to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: vision
      name: '@vcxmug/dsh-vision'
    - id: native-web
      name: '@vcxmug/dsh-native-web'
```

The patch layer is hot-reloaded by a running `dsh`, survives reboots, and
needs no preset picking or session restarts.

**B. One agent preset — scoped to sessions on that preset.** In the Web UI:
Settings → Agent presets — create a preset (or duplicate an existing one) and
add the rows:

```yaml
- id: vision
  name: '@vcxmug/dsh-vision'
- id: native-web
  name: '@vcxmug/dsh-native-web'
```

Two cautions: `config:` keys in either placement act as the settings form's
base layer; and do not duplicate a preset that registers first-party inspect
providers (the `cordis` creative preset does) while sessions on the original
run in the same process — both mounts register the same process-global
providers and the second mount is rejected.

## Updating & uninstalling

**Updating** the plugins: rebuild/pack a new tarball version and add it to the
profile — `dsh plugin --profile <name> add <new.tgz>` updates the recorded
`file:` spec. Then re-run `./install.sh` to refresh the rest of the chain.

**Uninstalling**:

```bash
dsh plugin --profile web remove @vcxmug/dsh-vision @vcxmug/dsh-native-web
rm -rf "$DSH_HOME/.agent-presets/enhance"
# and remove the `agent-presets:` block from $DSH_HOME/settings.yaml if you
# no longer want the default-preset override
```

## Requirements

- DeepSeek Harness 0.1.0-rc.6+ (the `web` profile; agent presets under
  `$DSH_HOME/.agent-presets`)
- Runtime (the plugins): Node 18+ (global `fetch`); repo tooling
  (tests/typecheck): Node >= 22.18
- Vision: any multimodal model endpoint that speaks the OpenAI Responses API
  (`/responses`) — official or third-party endpoints
- Native web: a reachable self-hosted Firecrawl-compatible instance
  (`USE_DB_AUTHENTICATION=false` instances accept any API key)

## Repository layout

```
install.sh                  # one-command installer for the whole chain
bin/restart-web.sh          # managed `dsh web` restart with health check
packages/dsh-vision/        # vision plugin (TS in src/, built lib/ committed)
packages/dsh-native-web/    # native web plugin (TS in src/, built lib/ committed)
presets/                    # pure mount-point composition fragments
docs/                       # known limitations and self-test prompt
tests/                      # install-path regression suite + scripted mock LLM
```

## Notes

- **Why the plugins carry no runtime `dependencies`**: the packages the
  Harness installation itself provides (`@deepseek-ai/dsh-tools`,
  `schemastery`, ...) are declared as optional peer dependencies. Installing
  them as regular dependencies would hoist a *second copy* into the profile's
  `node_modules`, shadow the Harness's own copy for composition rows, and
  break module-scoped identity (e.g. the `dsh-tools` tool-runtime Symbol) —
  every tool call then dies with
  `Cannot read properties of undefined (reading 'prepare')` after a cold
  boot. The regression suite pins this invariant; see
  `tests/install-and-loop.test.ts`.
- Native web vs MCP: MCP routes each call through the DSH MCP client and a
  `firecrawl-mcp` subprocess — extra hops and session turns. The native route
  is one direct HTTP call to your instance. (Prefer MCP? The upstream
  `@deepseek-ai/dsh-mcp-client` works for that.)
- Known limitations: see [docs/known-limitations.md](docs/known-limitations.md).
- End-to-end verification: [docs/self-test-prompt.md](docs/self-test-prompt.md).

## Testing

`npm test` runs the install-path regression suite (no API key, no registry for
the fixed packages): it packs both plugins with `npm pack`, installs the real
tarballs into a throwaway profile with `dsh plugin add` (the production
command), then asserts the fundamental invariant — the profile's node_modules
never duplicates a package the Harness installation already provides — and
finally drives a real headless agent tool loop through a scripted mock LLM.
Requires Node >= 22.18 (native TypeScript execution, no build step), the `dsh`
launcher on PATH (or the `DSH` env var), npm and pnpm. A missing tool fails
the suite (it never skips): a skipped run would green-light exactly the
regression this suite exists to catch.

`npm run typecheck` checks the test sources; `npm run build` rebuilds both
plugins' `lib/` from `src/`. Both need dev dependencies installed first
(`npm install` at the repo root and inside each package directory).

License: MIT
