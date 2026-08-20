# Agent Note: Keyless desktop web search

Status: implemented

## Problem

The desktop assembly needs current web information without requiring a second paid search account or consuming another model turn. Automatic update checks also create unrelated background network traffic and repeatedly advertise upstream releases even though this distribution carries local modifications that require deliberate integration.

## Decision

The base profile selects `@deepseek-ai/dsh-web-search-local` as its only search provider. The provider requests DuckDuckGo's non-JavaScript HTTPS result page first, supplements incomplete results with Bing, normalizes both pages into `WebSearchSource` values, deduplicates by URL, honors cancellation, and requires no credential.

The same profile mounts `@deepseek-ai/dsh-web-fetch-http` and enables `web_fetch`, so the model can retrieve a selected result through the existing guarded HTTP provider. Search endpoints remain fixed configuration values; arbitrary result-page retrieval retains the fetch provider's URL, redirect, private-address, size, and timeout checks.

The Electron shell exposes no version-check or update-install IPC methods. Settings, application menus, the tray, and startup contain no update action or scheduled update request. Maintainers update the source tree and rebuild the application explicitly.

## Alternatives considered

**DeepSeek native search.** It produces structured results but makes an auxiliary model request, requires compatible DeepSeek credentials, and couples search availability to a separate endpoint and model.

**A hosted search API.** Exa, OpenAI web search, and similar services offer stable structured responses but add credentials, quotas, or per-call charges to a personal desktop workflow.

**A self-hosted metasearch service.** SearXNG provides stronger engine independence and operational control, but a separate service is unnecessary for the expected personal request volume.

**Automatic desktop or runtime updates.** They reduce release lag but can overwrite local integration choices or reintroduce upstream behavior. Explicit source integration keeps upgrades reviewable.

## Consequences

Ordinary searches have no search-provider fee and usually need one lightweight HTTPS request. Bing adds coverage when DuckDuckGo fails or returns fewer sources than requested. Search-engine markup and traffic controls can still break extraction, so provider errors remain visible rather than being replaced with fabricated results. Explicit upgrades trade convenience for control over locally modified behavior.
