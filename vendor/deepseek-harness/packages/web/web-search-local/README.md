# `@deepseek-ai/dsh-web-search-local`

Keyless local search provider for `ctx.web`. It requests DuckDuckGo's lightweight HTML endpoint first and supplements or falls back to Bing when necessary. It makes no auxiliary model call and requires no search API account.

The provider uses fixed HTTPS endpoints, returns normalized sources, honors cancellation, and lets the shared web service enforce the final result count.
