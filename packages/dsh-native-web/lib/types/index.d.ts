import type { Context } from '@deepseek-ai/cordis'
import type { Schema } from '@deepseek-ai/schemastery'

export const name: string
export const inject: readonly string[]
export const Config: Schema<{
  baseUrl: string
  probeUrls: string[]
  apiKey: string
  apiVersion: string
  searchTimeoutMs: number
  scrapeTimeoutMs: number
}>
export function apply(ctx: Context, config: typeof Config extends Schema<infer T> ? T : never): void
