/** Keyless DuckDuckGo/Bing HTTPS search provider. */

import { parse } from 'node-html-parser'
import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'

/** Stable provider id used by the base profile. */
export const LOCAL_SEARCH_PROVIDER_ID = 'local-free'
/** Lightweight primary search endpoint. */
export const DEFAULT_DUCKDUCKGO_SEARCH_URL = 'https://html.duckduckgo.com/html/'
/** Broad-index fallback search endpoint. */
export const DEFAULT_BING_SEARCH_URL = 'https://www.bing.com/search'

/** Fully resolved transport settings. */
export interface LocalSearchOptions {
  readonly duckDuckGoUrl: string
  readonly bingUrl: string
  readonly timeoutMs: number
  readonly maxResponseChars: number
  readonly acceptLanguage: string
  readonly userAgent: string
}

type Engine = 'duckduckgo' | 'bing'

/** Search fixed public endpoints without API keys or auxiliary model calls. */
export class LocalSearchProvider implements WebSearchProvider {
  readonly id = LOCAL_SEARCH_PROVIDER_ID

  constructor(private readonly options: LocalSearchOptions) {}

  available(): boolean {
    return isHttpsUrl(this.options.duckDuckGoUrl)
      && isHttpsUrl(this.options.bingUrl)
      && Number.isInteger(this.options.timeoutMs)
      && this.options.timeoutMs > 0
      && Number.isInteger(this.options.maxResponseChars)
      && this.options.maxResponseChars > 0
      && this.options.acceptLanguage.length > 0
      && this.options.userAgent.length > 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const limit = request.maxResults ?? 10
    const errors: string[] = []
    let sources: WebSearchSource[] = []

    try {
      sources = await this.searchEngine('duckduckgo', request.query, signal)
    } catch (error: unknown) {
      if (isAbort(error, signal)) throw aborted(error, signal)
      errors.push(`DuckDuckGo: ${errorMessage(error)}`)
    }

    if (sources.length < limit) {
      try {
        const bing = await this.searchEngine('bing', request.query, signal)
        sources = mergeSources(sources, bing)
      } catch (error: unknown) {
        if (isAbort(error, signal)) throw aborted(error, signal)
        errors.push(`Bing: ${errorMessage(error)}`)
      }
    }

    if (sources.length === 0) {
      const detail = errors.length > 0 ? errors.join('; ') : 'both engines returned no results'
      throw new WebError(`Local web search failed: ${detail}`, 'WEB_PROVIDER_ERROR')
    }
    return { sources, truncated: false }
  }

  private async searchEngine(engine: Engine, query: string, signal?: AbortSignal): Promise<WebSearchSource[]> {
    const endpoint = engine === 'duckduckgo' ? this.options.duckDuckGoUrl : this.options.bingUrl
    const url = new URL(endpoint)
    url.searchParams.set('q', query)
    if (engine === 'bing') url.searchParams.set('count', '10')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`${engine} timed out`)), this.options.timeoutMs)
    const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: combined,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': this.options.acceptLanguage,
          'user-agent': this.options.userAgent,
        },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const html = await response.text()
      if (html.length > this.options.maxResponseChars) {
        throw new Error(`response exceeded ${this.options.maxResponseChars} characters`)
      }
      return engine === 'duckduckgo' ? parseDuckDuckGo(html) : parseBing(html)
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Parse DuckDuckGo's stable no-JavaScript result page. */
export function parseDuckDuckGo(html: string): WebSearchSource[] {
  const root = parse(html)
  const sources: WebSearchSource[] = []
  for (const row of root.querySelectorAll('.result')) {
    const anchor = row.querySelector('.result__a')
    if (anchor === null) continue
    const url = duckDuckGoTarget(anchor.getAttribute('href') ?? '')
    if (!isHttpUrl(url)) continue
    const title = cleanText(anchor.textContent)
    const snippet = cleanText(row.querySelector('.result__snippet')?.textContent ?? '')
    sources.push({ url, ...(title ? { title } : {}), ...(snippet ? { snippet } : {}) })
  }
  return mergeSources([], sources)
}

/** Parse Bing's ordinary search result list. */
export function parseBing(html: string): WebSearchSource[] {
  const root = parse(html)
  const sources: WebSearchSource[] = []
  for (const row of root.querySelectorAll('li.b_algo')) {
    const anchor = row.querySelector('h2 a')
    if (anchor === null) continue
    const url = anchor.getAttribute('href') ?? ''
    if (!isHttpUrl(url)) continue
    const title = cleanText(anchor.textContent)
    const snippet = cleanText(row.querySelector('.b_caption p')?.textContent ?? '')
    sources.push({ url, ...(title ? { title } : {}), ...(snippet ? { snippet } : {}) })
  }
  return mergeSources([], sources)
}

function duckDuckGoTarget(value: string): string {
  try {
    const url = new URL(value, 'https://duckduckgo.com')
    return url.searchParams.get('uddg') ?? url.href
  } catch {
    return ''
  }
}

function mergeSources(first: readonly WebSearchSource[], second: readonly WebSearchSource[]): WebSearchSource[] {
  const merged = new Map<string, WebSearchSource>()
  for (const source of [...first, ...second]) {
    if (!merged.has(source.url)) merged.set(source.url, source)
  }
  return [...merged.values()]
}

function cleanText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError')
}

function aborted(error: unknown, signal?: AbortSignal): WebError {
  return new WebError('Local web search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : error,
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
