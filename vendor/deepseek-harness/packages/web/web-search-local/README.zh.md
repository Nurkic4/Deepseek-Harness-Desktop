# `@deepseek-ai/dsh-web-search-local`

供 `ctx.web` 使用的免密钥本地搜索提供器。它优先请求 DuckDuckGo 轻量 HTML 入口，在结果不足或失败时使用 Bing 补充。它不会发起辅助模型调用，也不需要搜索 API 账户。

提供器只访问固定 HTTPS 入口，返回统一格式的来源，支持取消，并由共享网页服务执行最终结果数量限制。
