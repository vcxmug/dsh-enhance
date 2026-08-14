# @vcxmug/dsh-native-web

Native (no-MCP, no-cloud) web tools for DeepSeek Harness agents.

The built-in web search depends on a cloud provider (extra token cost), and
MCP bridges add protocol hops and session turns. This package instead talks
**directly over HTTP to your local Firecrawl-compatible web instance** — one
`fetch` per call, no bridge, no cloud dependency.

| Tool | Purpose |
|---|---|
| `native_search` | real-time web search (query, limit, lang/country) |
| `native_scrape` | one URL → clean markdown or raw HTML |

## Requirements

- Node 18+ (global `fetch`).
- A reachable web instance — typically self-hosted Firecrawl
  (docker compose, see the [firecrawl repo](https://github.com/firecrawl/firecrawl)).
  Any Firecrawl-compatible instance works, local or remote.

## Install (local, no npm publishing)

```bash
npm pack ./packages/dsh-native-web
dsh plugin --profile web add ./vcxmug-dsh-native-web-0.1.0.tgz
```

(`dsh plugin` installs into the profile directory — where the Harness loader
resolves plugin packages from. Keep the tarball somewhere durable: the
profile records a `file:` dependency on it.)

Add a pure mount-point row — either to a profile's `cordis.patch.yml` as an
`insert` patch (every session of that profile) or to an agent preset
(scoped; `$DSH_HOME/.agent-presets/<id>/agent.cordis.yml`, or the Web UI:
Settings → Agent presets):

```yaml
- id: native-web
  name: '@vcxmug/dsh-native-web'
```

**Configure in the Web UI:** Settings → Plugins → dsh-native-web
(baseUrl — empty auto-probes 3002 —, apiKey, apiVersion, timeouts).
Changes apply on the next tool call — no session restart.

Start a NEW session with that preset. The model sees `native_search` and
`native_scrape` and prefers them for fresh, local, token-cheap web access.

## Why native instead of MCP?

- MCP: session → DSH MCP client → `firecrawl-mcp` process → instance API.
- Native: session → instance API (one direct call).

No intermediate process, no protocol bridge, no extra tool-lifecycle turns —
and no cloud search provider, so fresh results stay on your own instance.

## Known limitations

- `native_scrape` health depends on the instance's playwright service; a
  misbuilt playwright service can return empty markdown while search still
  works (see `docs/known-limitations.md` in the repo root).
- URL-based inputs and large pages depend on instance configuration.
