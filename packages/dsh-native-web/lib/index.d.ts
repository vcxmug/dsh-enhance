/**
 * @vcxmug/dsh-native-web — native web tools for DeepSeek Harness.
 *
 * Talks DIRECTLY to a local (typically self-hosted) Firecrawl-compatible web
 * instance over HTTP — no MCP server bridge, no cloud search provider, no
 * extra protocol hops. Registers:
 *
 * - `native_search` — real-time web search (query, limit, lang, country)
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
import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name. */
export declare const name = "native-web";
/** Settings and tools are hard dependencies: one owns the form, one the registry. */
export declare const inject: string[];
/** Resolved configuration for one native-web tool call. */
export interface NativeWebConfig {
    baseUrl: string;
    probeUrls: string[];
    apiKey: string;
    apiVersion: string;
    searchTimeoutMs: number;
    scrapeTimeoutMs: number;
}
/** Row config schema. Machine-specific values (url/key) belong here. */
export declare const Config: z<Schemastery.ObjectS<{
    /** Web instance base URL. Empty → probe {@link probeUrls} at apply time. */
    baseUrl: z<string, string>;
    /** Candidate local endpoints probed when `baseUrl` is empty (3002 = upstream docker compose default). */
    probeUrls: z<string[], string[]>;
    /** API key. Empty → no Authorization header (USE_DB_AUTHENTICATION=false instances need none). */
    apiKey: z<string, string>;
    /** API version prefix: self-hosted Firecrawl 2.11.x uses v1; cloud docs now describe v2. */
    apiVersion: z<string, string>;
    /** Search call timeout in milliseconds. */
    searchTimeoutMs: z<number, number>;
    /** Scrape call timeout in milliseconds. */
    scrapeTimeoutMs: z<number, number>;
}>, Schemastery.ObjectT<{
    /** Web instance base URL. Empty → probe {@link probeUrls} at apply time. */
    baseUrl: z<string, string>;
    /** Candidate local endpoints probed when `baseUrl` is empty (3002 = upstream docker compose default). */
    probeUrls: z<string[], string[]>;
    /** API key. Empty → no Authorization header (USE_DB_AUTHENTICATION=false instances need none). */
    apiKey: z<string, string>;
    /** API version prefix: self-hosted Firecrawl 2.11.x uses v1; cloud docs now describe v2. */
    apiVersion: z<string, string>;
    /** Search call timeout in milliseconds. */
    searchTimeoutMs: z<number, number>;
    /** Scrape call timeout in milliseconds. */
    scrapeTimeoutMs: z<number, number>;
}>>;
/**
 * Register the native-web settings namespace and tools on the mounting context.
 * @param ctx - an agent scope context (a preset row).
 * @param config - row config, used as the composition `base` layer under the
 *   user-configurable Web settings form.
 */
export declare function apply(ctx: Context, config?: Partial<NativeWebConfig>): void;
//# sourceMappingURL=index.d.ts.map