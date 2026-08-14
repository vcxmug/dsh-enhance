# dsh-enhance

[简体中文](README.zh.md)

A toolkit of native plugins that fill the gaps of the DeepSeek Harness /
DeepSeek models: capabilities the official stack does not have or does poorly,
as **one composition row each**, configured entirely from the **Web settings
UI** — no CLI scripts, no manual YAML editing, no npm publishing.

## What you get

| Capability | Package | Tools | Fills the gap |
|---|---|---|---|
| **Vision** | `packages/dsh-vision` | `vision_describe`, `vision_list_models` | DeepSeek models have no image input; this gives agents eyes on demand through any Responses API-compatible multimodal model endpoint |
| **Native web** | `packages/dsh-native-web` | `native_search`, `native_scrape` | Built-in search depends on a cloud provider (extra token cost); MCP bridges add hops. This talks **directly over HTTP to your local self-hosted web instance** (Firecrawl-compatible), no bridge, no cloud |

Both plugins are host-side Cordis plugins: one `fetch` per tool call, per-call
timeouts, caller-cancellation aware, API keys marked secret and redacted on
the wire.

## Install

One-time, per machine (the packages are installed locally from this repo — no
npm registry account needed). The Harness loader resolves plugin packages from
the profile directory, so install them into the profile rather than globally:

```bash
npm pack ./packages/dsh-vision ./packages/dsh-native-web
dsh plugin --profile web add ./vcxmug-dsh-vision-0.1.0.tgz ./vcxmug-dsh-native-web-0.1.0.tgz
```

`dsh plugin` forwards to pnpm inside the profile directory and records `file:`
dependencies pointing at the tarballs — keep the tarballs somewhere durable so
a reinstall after reboot keeps resolving. (`npm install -g` is not enough: the
profile loader cannot see the global prefix, and installing the package
directories creates symlinks whose dependencies do not resolve.)

The plugins are written in TypeScript (`src/index.ts`, strict mode); the built
`lib/` is committed, so packing and installing work with no build step. After
editing the source, rebuild with `npm install && npm run build` inside the
package directory.

## Mount the rows

Two supported placements — pick one (the rows are pure mount points; copy
from `presets/vision.cordis.yml` and `presets/native-web.cordis.yml`):

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

Then, in the Web UI: **Settings → Plugins → dsh-vision / dsh-native-web** —
configure the form: endpoint base URL, model, API key, instance URL/key,
timeouts, … Changes apply on the next tool call — no restart.

## Requirements

- DeepSeek Harness 0.1.0-rc.6+ (the `web` profile; agent presets under
  `$DSH_HOME/.agent-presets`)
- Node 18+ (global `fetch`)
- Vision: any multimodal model endpoint that speaks the OpenAI Responses API
  (`/responses`) — official or third-party endpoints
- Native web: a reachable self-hosted Firecrawl-compatible instance
  (docker compose, see [firecrawl/firecrawl](https://github.com/firecrawl/firecrawl));
  `USE_DB_AUTHENTICATION=false` instances accept any API key

## Repository layout

```
packages/dsh-vision/        # vision plugin (TS in src/, built lib/ committed)
packages/dsh-native-web/    # native web plugin (TS in src/, built lib/ committed)
presets/                    # pure mount-point composition fragments
docs/                       # known limitations and self-test prompt
```

## Notes

- Native web vs MCP: MCP routes each call through the DSH MCP client and a
  `firecrawl-mcp` subprocess — extra hops and session turns. The native route
  is one direct HTTP call to your instance. (Prefer MCP? The upstream
  `@deepseek-ai/dsh-mcp-client` works for that.)
- Known limitations: see [docs/known-limitations.md](docs/known-limitations.md).
- End-to-end verification: [docs/self-test-prompt.md](docs/self-test-prompt.md).

## Testing

`npm test` runs one runtime verification: a scripted mock LLM (no API key, no
network) drives a real headless dsh agent loop with both plugins mounted and
asserts the tool loop completes end to end. Requires Node >= 22.18 (native
TypeScript execution, no build step) and the `dsh` launcher on PATH (or the
`DSH` env var); the test skips when dsh is missing.

`npm run typecheck` checks the test sources; `npm run build` rebuilds both
plugins' `lib/` from `src/`. Both need dev dependencies installed first
(`npm install` at the repo root and inside each package directory).

License: MIT
