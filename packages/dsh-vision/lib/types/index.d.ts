import type { Context } from '@deepseek-ai/cordis'
import type { Schema } from '@deepseek-ai/schemastery'

export const name: string
export const inject: readonly string[]
export const Config: Schema<{
  baseUrl: string
  model: string
  apiKey: string
  apiKeyFile: string
  apiKeyField: string
  detail: 'auto' | 'low' | 'high'
  maxImageBytes: number
  timeoutMs: number
}>
export function apply(ctx: Context, config: typeof Config extends Schema<infer T> ? T : never): void
