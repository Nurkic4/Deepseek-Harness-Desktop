/**
 * Register a keyless HTTPS search provider backed by DuckDuckGo with Bing fallback.
 * @module @deepseek-ai/dsh-web-search-local
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { LocalSearchProvider } from './provider.ts'
import type { LocalSearchOptions } from './provider.ts'

export {
  DEFAULT_BING_SEARCH_URL,
  DEFAULT_DUCKDUCKGO_SEARCH_URL,
  LOCAL_SEARCH_PROVIDER_ID,
  LocalSearchProvider,
} from './provider.ts'
export type { LocalSearchOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-local'

/** The web service this provider contributes to. */
export const inject = ['web']

/** Keyless search transport configuration. */
export interface Config {
  /** DuckDuckGo HTML search endpoint. */
  duckDuckGoUrl?: string
  /** Bing HTML search endpoint used after DuckDuckGo fails or returns too few results. */
  bingUrl?: string
  /** Per-engine HTTPS timeout in milliseconds. */
  timeoutMs?: number
  /** Maximum accepted search response length in characters. */
  maxResponseChars?: number
  /** Language preference sent to both search engines. */
  acceptLanguage?: string
  /** Product user agent sent to both search engines. */
  userAgent?: string
}

export const Config: z<Config> = z.object({
  duckDuckGoUrl: z.string().default('https://html.duckduckgo.com/html/'),
  bingUrl: z.string().default('https://www.bing.com/search'),
  timeoutMs: z.number().default(15_000),
  maxResponseChars: z.number().default(2_000_000),
  acceptLanguage: z.string().default('zh-CN,zh;q=0.9,en;q=0.7'),
  userAgent: z.string().default('Deepseek-Harness-Desktop/0.1 (+https://github.com/ChisaAlter/Deepseek-Harness-Desktop)'),
})

/** Register the local HTTPS provider. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as Required<Config>
  const options: LocalSearchOptions = {
    duckDuckGoUrl: resolved.duckDuckGoUrl,
    bingUrl: resolved.bingUrl,
    timeoutMs: resolved.timeoutMs,
    maxResponseChars: resolved.maxResponseChars,
    acceptLanguage: resolved.acceptLanguage,
    userAgent: resolved.userAgent,
  }
  ctx.web.registerSearchProvider(new LocalSearchProvider(options))
}
