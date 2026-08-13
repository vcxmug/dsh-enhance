# @vcxmug/dsh-vision

Native vision (image recognition) for DeepSeek Harness agents.

DeepSeek's own models have no image input yet. This plugin gives any agent
**eyes on demand**: it registers two tools that talk directly to any
**Responses API-compatible multimodal model endpoint** (no MCP bridge, one
composition row):

| Tool | Purpose |
|---|---|
| `vision_describe` | analyze a local image path or http(s) URL, with an optional question and `detail` level (`auto`/`low`/`high`, default `high`) |
| `vision_list_models` | list the models served by the configured endpoint |

## Requirements

- Node 18+ (global `fetch`).
- A multimodal model endpoint that speaks the OpenAI Responses API, and an API key —
  either pasted into the Web settings form, or a JSON file under `$HOME`
  (a file like `{"API_KEY": "sk-..."}` configured via `apiKeyFile`/`apiKeyField`).

## Install (local, no npm publishing)

```bash
npm pack ./packages/dsh-vision
npm install -g ./vcxmug-dsh-vision-0.1.0.tgz
```

Add a pure mount-point row to your agent preset
(`$DSH_HOME/.agent-presets/<id>/agent.cordis.yml`, or edit the preset in the
Web UI: Settings → Agent presets):

```yaml
- id: vision
  name: '@vcxmug/dsh-vision'
```

**Configure in the Web UI:** Settings → Plugins → dsh-vision
(baseUrl, model, apiKey, apiKeyFile, detail, timeouts). Changes apply on the
next tool call — no session restart.

Start a NEW session with that preset. The model sees `vision_describe` and
`vision_list_models` and uses them whenever an image must be understood.

## How it works

- Host-side plugin, one `fetch` call per invocation — no shell, no MCP.
- Local images are base64-encoded inline (`data:` URL) with a byte-exact
  encoder; URLs are passed through (the endpoint fetches them server-side).
- Per-call timeout and caller cancellation are honored (`AbortSignal`).
- The API key is marked `role('secret')` — redacted on the wire and never
  visible to the model.

## Notes

- URL image inputs depend on the endpoint fetching the URL — slower and less
  reliable. Prefer local paths.
