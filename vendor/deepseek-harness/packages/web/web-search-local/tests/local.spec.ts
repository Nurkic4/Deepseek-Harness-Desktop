import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LocalSearchProvider,
  parseBing,
  parseDuckDuckGo,
} from '../src/provider.ts'

const options = {
  duckDuckGoUrl: 'https://html.duckduckgo.com/html/',
  bingUrl: 'https://www.bing.com/search',
  timeoutMs: 1_000,
  maxResponseChars: 100_000,
  acceptLanguage: 'zh-CN',
  userAgent: 'test-agent',
}

afterEach(() => { vi.unstubAllGlobals() })

describe('search page parsing', () => {
  it('decodes DuckDuckGo redirect targets and extracts snippets', () => {
    const html = '<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa"> Example A </a><div class="result__snippet"> first  result </div></div>'
    expect(parseDuckDuckGo(html)).toEqual([{ url: 'https://example.com/a', title: 'Example A', snippet: 'first result' }])
  })

  it('extracts Bing results and ignores unsafe links', () => {
    const html = '<li class="b_algo"><h2><a href="https://example.com/b">Example B</a></h2><div class="b_caption"><p>second result</p></div></li><li class="b_algo"><h2><a href="javascript:bad()">Bad</a></h2></li>'
    expect(parseBing(html)).toEqual([{ url: 'https://example.com/b', title: 'Example B', snippet: 'second result' }])
  })
})

describe('LocalSearchProvider', () => {
  it('uses Bing when DuckDuckGo returns no usable results', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('<html></html>', { status: 200 }))
      .mockResolvedValueOnce(new Response('<li class="b_algo"><h2><a href="https://example.com">Found</a></h2></li>', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await new LocalSearchProvider(options).search({ query: 'query', maxResults: 1 })
    expect(result.sources).toEqual([{ url: 'https://example.com', title: 'Found' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not call Bing when DuckDuckGo already fills the requested count', async () => {
    const html = '<div class="result"><a class="result__a" href="https://example.com">Found</a></div>'
    const fetchMock = vi.fn().mockResolvedValue(new Response(html, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await new LocalSearchProvider(options).search({ query: 'query', maxResults: 1 })
    expect(result.sources).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a provider error after both engines fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(new LocalSearchProvider(options).search({ query: 'query' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })
})
