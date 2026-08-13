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
npm registry account needed):

```bash
npm pack ./packages/dsh-vision ./packages/dsh-native-web
npm install -g ./vcxmug-dsh-vision-0.1.0.tgz ./vcxmug-dsh-native-web-0.1.0.tgz
```

(`npm install -g ./packages/...` would create symlinks whose dependencies do
not resolve; packing first installs real copies with their dependencies.)

Then, in the DeepSeek Harness Web UI:

1. **Settings → Agent presets** — create a preset (or duplicate an existing
   one) and add the rows you want (copy from `presets/vision.cordis.yml` and
   `presets/native-web.cordis.yml`, or just the two lines):
   ```yaml
   - id: vision
     name: '@vcxmug/dsh-vision'
   - id: native-web
     name: '@vcxmug/dsh-native-web'
   ```
2. **Settings → Plugins → dsh-vision / dsh-native-web** — configure the form:
   endpoint base URL, model, API key, instance URL/key, timeouts, …
3. Start a **new session** with that preset. Changes made later in Settings
   apply on the next tool call — no restart.

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
packages/dsh-vision/        # vision plugin (vision_describe, vision_list_models)
packages/dsh-native-web/    # native web plugin (native_search, native_scrape)
src/dsh-http/               # Go helper binary for the dynamic-plugin form (stdlib only)
presets/                    # pure mount-point composition fragments
docs/                       # known limitations, helper binary, self-test prompt
```

## Notes

- Native web vs MCP: MCP routes each call through the DSH MCP client and a
  `firecrawl-mcp` subprocess — extra hops and session turns. The native route
  is one direct HTTP call to your instance. (Prefer MCP? The upstream
  `@deepseek-ai/dsh-mcp-client` works for that.)
- Dynamic-plugin form (session-scoped, no agent preset): the plugin calls the
  `dsh-http` Go helper — **Go standard library only, zero third-party
  dependencies** — through the shell service with every variable passed via
  environment/stdin, so the API key never appears in a process argv. See
  [docs/helper-binary.md](docs/helper-binary.md) for the contract and build.
- Known limitations: see [docs/known-limitations.md](docs/known-limitations.md).
- End-to-end verification: [docs/self-test-prompt.md](docs/self-test-prompt.md).

## Testing

`npm test` runs one runtime verification: a scripted mock LLM (no API key, no
network) drives a real headless dsh agent loop with both plugins mounted and
asserts the tool loop completes end to end. Requires Node >= 22 and the `dsh`
launcher on PATH (or the `DSH` env var); the test skips when dsh is missing.

License: MIT
