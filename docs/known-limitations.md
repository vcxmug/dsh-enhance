# Known limitations

These notes cover common behaviors of self-hosted Firecrawl-compatible
instances. The items below are instance/target-site properties, not
integration bugs.

## 1. `native_scrape` can return empty markdown (instance-side)

A locally built `playwright-service` image can return empty HTML to the API
— symptom: `native_scrape` succeeds with `content: ""`. Search is unaffected.

**Workaround:** rebuild the playwright service image
(`docker compose build playwright-service`) or use the official
`ghcr.io/firecrawl/playwright-service` image.

## 2. `extract` / `agent` / AI formats need an LLM-enabled instance

These features route through the instance's LLM configuration
(`OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OLLAMA_BASE_URL` in the instance's
`.env`). A default self-hosted `.env` leaves these empty, so `extract`,
`agent`, and AI-dependent scrape formats fail. `scrape` (markdown/html) and
`search` are unaffected.

## 3. Some target sites fail all engines

Anti-bot sites (bot-protected or login-walled pages, e.g. sites behind
Cloudflare-style challenges) can fail every scraping engine with
`SCRAPE_ALL_ENGINES_FAILED`. This is the site blocking automation, not the
integration. Workarounds: pick a different source, use search snippets, or
accept the failure.

## 4. Tools error while the instance is down

`native_search` / `native_scrape` resolve the instance lazily on first call:
if the instance is unreachable the first call throws a clear
"no local web instance detected" error, and later calls re-probe once it is
up. `vision_describe` errors only when the endpoint is unreachable or the key
is invalid.

## 5. `example.com` is a poor test target

It intermittently serves a bot-verification page to scrapers; prefer a real
content page for scrape tests.

## 6. URL-based image inputs depend on the endpoint

`vision_describe` with an http(s) URL passes the URL to the endpoint, which
fetches it server-side; endpoints can be slow or fail on external URLs. Prefer
local file paths (base64 inline) for reliable results.

## 7. Some Responses-API endpoints reject `instructions` on `/responses`

Caution: on some Responses API-compatible multimodal model endpoints,
certain `instructions` content (a longer multi-sentence prompt) makes the
call fail with a misleading `model_not_found` / "unknown provider for model"
error, even though the model is listed by `/models` and the same call
without `instructions` succeeds. The plugins therefore send **no
`instructions` field** and put all guidance in the question text.
