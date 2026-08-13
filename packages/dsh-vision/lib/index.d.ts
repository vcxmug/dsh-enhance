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
import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name (the row id should usually match). */
export declare const name = "vision";
/** Settings and tools are hard dependencies: one owns the form, one the registry. */
export declare const inject: string[];
/** Resolved configuration for one vision tool call. */
export interface VisionConfig {
    baseUrl: string;
    model: string;
    apiKey: string;
    apiKeyFile: string;
    apiKeyField: string;
    detail: 'auto' | 'low' | 'high';
    maxImageBytes: number;
    timeoutMs: number;
}
/** Row config schema. Doubles as the Web settings form schema. */
export declare const Config: z<Schemastery.ObjectS<{
    /** OpenAI Responses API base URL, e.g. `https://api.openai.com/v1` or any compatible endpoint. Empty → the tools fail with a clear "not configured" error. */
    baseUrl: z<string, string>;
    /** Multimodal model name served by the endpoint. Empty → the tools fail with a clear "not configured" error. */
    model: z<string, string>;
    /** Literal API key (secret, redacted on wire). Empty → read `apiKeyFile`. */
    apiKey: z<string, string>;
    /** JSON file under $HOME holding the key (or an absolute path). Empty → require `apiKey`. */
    apiKeyFile: z<string, string>;
    /** Field name inside that JSON file. */
    apiKeyField: z<string, string>;
    /** Default image detail level: auto | low | high. */
    detail: z<"auto" | "low" | "high", "auto" | "low" | "high">;
    /** Local image size cap (bytes) before base64 encoding. */
    maxImageBytes: z<number, number>;
    /** Per-call timeout in milliseconds. */
    timeoutMs: z<number, number>;
}>, Schemastery.ObjectT<{
    /** OpenAI Responses API base URL, e.g. `https://api.openai.com/v1` or any compatible endpoint. Empty → the tools fail with a clear "not configured" error. */
    baseUrl: z<string, string>;
    /** Multimodal model name served by the endpoint. Empty → the tools fail with a clear "not configured" error. */
    model: z<string, string>;
    /** Literal API key (secret, redacted on wire). Empty → read `apiKeyFile`. */
    apiKey: z<string, string>;
    /** JSON file under $HOME holding the key (or an absolute path). Empty → require `apiKey`. */
    apiKeyFile: z<string, string>;
    /** Field name inside that JSON file. */
    apiKeyField: z<string, string>;
    /** Default image detail level: auto | low | high. */
    detail: z<"auto" | "low" | "high", "auto" | "low" | "high">;
    /** Local image size cap (bytes) before base64 encoding. */
    maxImageBytes: z<number, number>;
    /** Per-call timeout in milliseconds. */
    timeoutMs: z<number, number>;
}>>;
/**
 * Register the vision settings namespace and tools on the mounting context.
 * @param ctx - an agent scope context (a preset row).
 * @param config - row config, used as the composition `base` layer under the
 *   user-configurable Web settings form.
 */
export declare function apply(ctx: Context, config?: Partial<VisionConfig>): void;
//# sourceMappingURL=index.d.ts.map