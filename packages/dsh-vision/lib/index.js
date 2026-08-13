/**
 * @vcxmug/dsh-vision — native vision for DeepSeek Harness agents.
 *
 * DeepSeek's own models have no image input yet. This plugin gives any agent
 * "eyes on demand": it registers `vision_describe` (analyze a local image or
 * URL through any Responses API-compatible multimodal model endpoint) and
 * `vision_list_models` (list the endpoint's available models).
 *
 * Mount it as one composition row inside an agent preset:
 *
 * ```yaml
 * - id: vision
 *   name: '@vcxmug/dsh-vision'
 * ```
 *
 * Configuration lives in the Web settings UI (Settings → Plugins → dsh-vision):
 * the plugin registers a `vision` settings namespace whose schema renders a
 * form; changes apply on the next tool call, no session restart needed.
 *
 * @module @vcxmug/dsh-vision
 */
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** Cordis plugin name (the row id should usually match). */
export const name = 'vision'

/** Settings service is a hard dependency: it owns the configuration form. */
export const inject = ['settings', 'tools']

/** Row config schema. Doubles as the Web settings form schema. */
export const Config = z.object({
  /** OpenAI Responses API base URL, e.g. `https://api.openai.com/v1` or any compatible endpoint. Empty → the tools fail with a clear "not configured" error. */
  baseUrl: z.string().default(''),
  /** Multimodal model name served by the endpoint. Empty → the tools fail with a clear "not configured" error. */
  model: z.string().default(''),
  /** Literal API key (secret, redacted on wire). Empty → read `apiKeyFile`. */
  apiKey: z.string().role('secret').default(''),
  /** JSON file under $HOME holding the key (or an absolute path). Empty → require `apiKey`. */
  apiKeyFile: z.string().default(''),
  /** Field name inside that JSON file. */
  apiKeyField: z.string().default('API_KEY'),
  /** Default image detail level: auto | low | high. */
  detail: z.union([z.const('auto'), z.const('low'), z.const('high')]).default('high'),
  /** Local image size cap (bytes) before base64 encoding. */
  maxImageBytes: z.number().default(20 * 1024 * 1024),
  /** Per-call timeout in milliseconds. */
  timeoutMs: z.number().default(150000),
})

/** Byte-exact base64 (global btoa is UTF-8 and corrupts binary). */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function bytesToBase64(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | (b1 >> 4)]
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '='
    out += i + 2 < bytes.length ? B64[b2 & 63] : '='
  }
  return out
}

function mimeOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  const ext = m ? m[1].toLowerCase() : ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/png'
}

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
 * Register the vision settings namespace and tools on the mounting context.
 * @param ctx - an agent scope context (a preset row).
 * @param config - row config, used as the composition `base` layer under the
 *   user-configurable Web settings form.
 */
export function apply(ctx, config) {
  const scope = ctx.settings.register('vision', Config, { base: config })

  async function resolveApiKey() {
    const cfg = scope.get()
    if (cfg.apiKey) return cfg.apiKey
    if (!cfg.apiKeyFile) {
      throw new Error('vision: no API key configured — set apiKey or apiKeyFile in Settings → Plugins → dsh-vision')
    }
    const file = isAbsolute(cfg.apiKeyFile) ? cfg.apiKeyFile : join(homedir(), cfg.apiKeyFile)
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      throw new Error(`vision: cannot read api key file ${file} — set the apiKey in Settings → Plugins → dsh-vision, or fix apiKeyFile`)
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`vision: api key file ${file} is not valid JSON`)
    }
    const key = parsed[cfg.apiKeyField]
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error(`vision: no "${cfg.apiKeyField}" found in ${file}`)
    }
    return key
  }

  async function toImageUrl(image, signal) {
    const cfg = scope.get()
    if (/^https?:\/\//i.test(image)) return image
    let bytes
    try {
      bytes = await readFile(image, { signal })
    } catch (error) {
      throw new Error(`vision: cannot read image ${image}: ${error.message}`)
    }
    if (bytes.length > cfg.maxImageBytes) {
      throw new Error(`vision: image ${image} is ${bytes.length} bytes, over the ${cfg.maxImageBytes}-byte cap`)
    }
    return `data:${mimeOf(image)};base64,${bytesToBase64(bytes)}`
  }

  async function callVision(imageUrl, question, detail, signal) {
    const cfg = scope.get()
    if (!cfg.baseUrl) throw new Error('vision: baseUrl not configured — set it in Settings → Plugins → dsh-vision')
    if (!cfg.model) throw new Error('vision: model not configured — set it in Settings → Plugins → dsh-vision')
    const key = await resolveApiKey()
    const deadline = withDeadline(signal, cfg.timeoutMs)
    try {
      const response = await fetch(`${cfg.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: cfg.model,
          // NOTE: no `instructions` field — some /responses endpoints reject
          // certain instructions content with a misleading model_not_found
          // error; guidance lives in the question text instead.
          input: [{
            role: 'user',
            content: [
              { type: 'input_text', text: question },
              { type: 'input_image', image_url: imageUrl, detail },
            ],
          }],
        }),
        signal: deadline.signal,
      })
      let json
      try {
        json = await response.json()
      } catch {
        throw new Error(`vision: endpoint returned non-JSON (HTTP ${response.status}): ${String(response.statusText || '').slice(0, 100)}`)
      }
      if (!response.ok || json.error) {
        throw new Error(`vision: API error ${JSON.stringify(json.error || json).slice(0, 400)}`)
      }
      const parts = []
      for (const item of json.output || []) {
        if (item.type === 'message') {
          for (const c of item.content || []) {
            if (c.type === 'output_text') parts.push(c.text)
          }
        }
      }
      let answer = parts.join('\n').trim()
      if (!answer) answer = '(empty response)'
      const status = json.status || 'unknown'
      if (status === 'incomplete' && json.incomplete_details) {
        answer += `\n[incomplete: ${JSON.stringify(json.incomplete_details).slice(0, 300)}]`
      }
      return { answer, model: cfg.model, status }
    } finally {
      deadline.dispose()
    }
  }

  const describeTool = defineTool({
    name: 'vision_describe',
    description: 'Analyze an image with an external multimodal model (OpenAI Responses API). The current main model has no vision, so use this tool whenever an image must be understood: describe contents, read text in a screenshot, identify UI elements, check diagrams, etc. image may be a local file path (preferred; base64-encoded and sent inline) or an http(s) URL (depends on the endpoint fetching the URL, slower and less reliable).',
    parameters: {
      image: {
        type: 'string',
        required: true,
        description: 'Local file path (preferred) or http(s) URL of the image to analyze.',
      },
      question: {
        type: 'string',
        description: 'Optional question about the image; omitted = general detailed description.',
      },
      detail: {
        type: 'string',
        enum: ['auto', 'low', 'high'],
        description: 'Optional image detail level: auto, low, high. Default: high (low loses fidelity on small images).',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          answer: { type: 'string' },
          model: { type: 'string' },
          status: { type: 'string' },
        },
        additionalProperties: false,
      },
      render(args, value) {
        return [{ type: 'text', text: value.answer }]
      },
    },
    async execute(args, exec) {
      const cfg = scope.get()
      const image = String(args.image || '').trim()
      if (!image) throw new Error('vision_describe: image is required')
      const question = (typeof args.question === 'string' && args.question.trim())
        ? args.question.trim()
        : 'Describe this image in detail, including any visible text.'
      const detail = ['auto', 'low', 'high'].includes(args.detail) ? args.detail : cfg.detail
      const imageUrl = await toImageUrl(image, exec.signal)
      return callVision(imageUrl, question, detail, exec.signal)
    },
  })
  ctx.tools.register(describeTool)

  const listTool = defineTool({
    name: 'vision_list_models',
    description: 'List the models available on the configured vision API endpoint (OpenAI-compatible). Useful for picking a different model or diagnosing availability.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: {
          models: { type: 'array', items: { type: 'string' } },
          provider: { type: 'string' },
        },
        additionalProperties: false,
      },
      render(args, value) {
        return [{ type: 'text', text: `Available vision models: ${value.models.join(', ')}` }]
      },
    },
    async execute(args, exec) {
      const cfg = scope.get()
      if (!cfg.baseUrl) throw new Error('vision: baseUrl not configured — set it in Settings → Plugins → dsh-vision')
      const key = await resolveApiKey()
      const deadline = withDeadline(exec.signal, 30000)
      try {
        const response = await fetch(`${cfg.baseUrl}/models`, {
          headers: { 'Authorization': `Bearer ${key}` },
          signal: deadline.signal,
        })
        let json
        try {
          json = await response.json()
        } catch {
          throw new Error(`vision: endpoint returned non-JSON (HTTP ${response.status}): ${String(response.statusText || '').slice(0, 100)}`)
        }
        if (!response.ok || json.error) {
          throw new Error(`vision: API error ${JSON.stringify(json.error || json).slice(0, 300)}`)
        }
        const models = (json.data || []).map((m) => m.id).filter((x) => typeof x === 'string')
        return { models, provider: cfg.baseUrl }
      } finally {
        deadline.dispose()
      }
    },
  })
  ctx.tools.register(listTool)

  ctx.logger?.info?.('vision bridge ready (config: Settings → Plugins → dsh-vision)')
}
