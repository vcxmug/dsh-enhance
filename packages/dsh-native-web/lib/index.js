/**
 * @vcxmug/dsh-native-web — native web tools for DeepSeek Harness.
 *
 * Talks DIRECTLY to a local (typically self-hosted) Firecrawl-compatible web
 * instance over HTTP — no MCP server bridge, no cloud search provider, no
 * extra protocol hops. Registers:
 *
 * - `native_search` — real-time web search (query, limit, lang, country,
 *   include/exclude domains)
 * - `native_scrape` — one URL → clean markdown or raw HTML
 *
 * Mount it as one composition row inside an agent preset:
 *
 * ```yaml
 * - id: native-web
 *   name: '@vcxmug/dsh-native-web'
 * ```
 *
 * Configuration lives in the Web settings UI (Settings → Plugins →
 * dsh-native-web): the plugin registers a `nativeWeb` settings namespace whose
 * schema renders a form; changes apply on the next tool call.
 *
 * @module @vcxmug/dsh-native-web
 */
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'native-web'

/** Settings service is a hard dependency: it owns the configuration form. */
export const inject = ['settings']

/** Row config schema. Machine-specific values (url/key) belong here. */
export const Config = z.object({
  /** Web instance base URL. Empty → probe {@link probeUrls} at apply time. */
  baseUrl: z.string().default(''),
  /** Candidate local endpoints probed when `baseUrl` is empty (3002 = upstream docker compose default). */
  probeUrls: z.array(z.string()).default(['http://127.0.0.1:3002']),
  /** API key. Empty → no Authorization header (USE_DB_AUTHENTICATION=false instances need none). */
  apiKey: z.string().default(''),
  /** API version prefix: self-hosted Firecrawl 2.11.x uses v1; cloud docs now describe v2. */
  apiVersion: z.string().default('v1'),
  /** Search call timeout in milliseconds. */
  searchTimeoutMs: z.number().default(90000),
  /** Scrape call timeout in milliseconds. */
  scrapeTimeoutMs: z.number().default(150000),
})

/** AbortController fused from our own timeout and the caller's signal. */
function withDeadline(signal, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  if (signal) signal.addEventListener('abort', onAbort)
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    },
  }
}

/**
 * Register the native-web settings namespace and tools on the mounting context.
 * @param ctx - an agent scope context (a preset row).
 * @param config - row config, used as the composition `base` layer under the
 *   user-configurable Web settings form.
 */
export function apply(ctx, config) {
  const scope = ctx.settings.register('nativeWeb', Config, { base: config })
  let baseCache = null

  async function baseUrl() {
    if (baseCache !== null) return baseCache
    const cfg = scope.get()
    const candidates = cfg.baseUrl ? [cfg.baseUrl] : cfg.probeUrls
    for (const url of candidates) {
      try {
        const response = await fetch(`${url}/`, { signal: AbortSignal.timeout(3000) })
        const text = await response.text()
        if (response.ok && text.includes('Firecrawl API')) {
          baseCache = url
          ctx.logger?.info?.('native-web: detected instance at %s', url)
          return url
        }
      } catch {
        // candidate unreachable — try next
      }
    }
    throw new Error(
      `native-web: no local web instance detected at ${candidates.join(', ')} — start it first (docker compose up -d)`,
    )
  }

  async function postJson(path, body, timeoutMs, signal) {
    const cfg = scope.get()
    const base = await baseUrl()
    const deadline = withDeadline(signal, timeoutMs)
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`
      const response = await fetch(`${base}/${cfg.apiVersion}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: deadline.signal,
      })
      const text = await response.text()
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(`native-web: non-JSON response: ${text.slice(0, 300)}`)
      }
      if (parsed.success === false || parsed.error) {
        throw new Error(`native-web: API error ${JSON.stringify(parsed.error || parsed).slice(0, 400)}`)
      }
      return parsed
    } finally {
      deadline.dispose()
    }
  }

  const searchTool = defineTool({
    name: 'native_search',
    description: 'Native web search through the LOCAL self-hosted web instance (direct HTTP, no MCP bridge, no cloud search provider). Returns ranked results with titles, URLs and descriptions. Prefer this over the built-in web_search when you need fresher or more results, or when the built-in provider is unavailable.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Search query. Supports operators: "exact phrase", -exclude, site:domain, inurl:..., etc.',
      },
      limit: {
        type: 'integer',
        description: 'Max results to return (1-20, default 5).',
      },
      lang: {
        type: 'string',
        description: 'Optional language code, e.g. en, zh.',
      },
      country: {
        type: 'string',
        description: 'Optional country code, e.g. US, CN.',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                url: { type: 'string' },
                description: { type: 'string' },
              },
              additionalProperties: true,
            },
          },
          id: { type: 'string' },
        },
        required: ['results'],
        additionalProperties: false,
      },
      render(args, value) {
        const lines = (value.results || []).map((r, i) => {
          return `[${i + 1}] ${r.title || '(no title)'}\n    ${r.url || ''}\n    ${r.description || ''}`
        })
        return [{ type: 'text', text: lines.join('\n\n') || '(no results)' }]
      },
    },
    async execute(args, exec) {
      const cfg = scope.get()
      const query = String(args.query || '').trim()
      if (!query) throw new Error('native_search: query is required')
      const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 20) : 5
      const body = { query, limit }
      if (typeof args.lang === 'string' && args.lang) body.lang = args.lang
      if (typeof args.country === 'string' && args.country) body.country = args.country
      const resp = await postJson('/search', body, cfg.searchTimeoutMs, exec.signal)
      const results = (resp.data || []).map((d) => ({
        title: typeof d.title === 'string' ? d.title : '',
        url: typeof d.url === 'string' ? d.url : '',
        description: typeof d.description === 'string' ? d.description : '',
      }))
      return { results, id: typeof resp.id === 'string' ? resp.id : '' }
    },
  })
  ctx.tools.register(searchTool)

  const scrapeTool = defineTool({
    name: 'native_scrape',
    description: 'Scrape one URL to clean markdown (or raw HTML) through the LOCAL self-hosted web instance (direct HTTP, no MCP bridge). Use this to read a page the search results point to, or any URL the user mentions. Note: scrape health depends on the instance (its playwright service); if the instance returns empty markdown, prefer search snippets or report the instance issue.',
    parameters: {
      url: {
        type: 'string',
        required: true,
        description: 'The URL to scrape.',
      },
      format: {
        type: 'string',
        enum: ['markdown', 'html'],
        description: 'Output format: markdown (default) or html.',
      },
      onlyMainContent: {
        type: 'boolean',
        description: 'Only extract the main content, dropping nav/footers (default true).',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          url: { type: 'string' },
          format: { type: 'string' },
        },
        required: ['content', 'url', 'format'],
        additionalProperties: false,
      },
      render(args, value) {
        const text = value.content || '(empty content)'
        return [{
          type: 'text',
          text: text.length > 60000 ? `${text.slice(0, 60000)}\n…[truncated by render]` : text,
        }]
      },
    },
    async execute(args, exec) {
      const cfg = scope.get()
      const url = String(args.url || '').trim()
      if (!url) throw new Error('native_scrape: url is required')
      const format = args.format === 'html' ? 'html' : 'markdown'
      const body = {
        url,
        formats: [format],
        onlyMainContent: args.onlyMainContent !== false,
        timeout: Math.max(1000, Math.min(cfg.scrapeTimeoutMs - 15000, 60000)),
      }
      const resp = await postJson('/scrape', body, cfg.scrapeTimeoutMs, exec.signal)
      const content = resp.data && typeof resp.data[format] === 'string' ? resp.data[format] : ''
      return { content, url, format }
    },
  })
  ctx.tools.register(scrapeTool)

  ctx.logger?.info?.('native-web bridge ready (search + scrape)')
}
