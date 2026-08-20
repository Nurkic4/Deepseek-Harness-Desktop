/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'

describe('dsh-base bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    // The base layer is one insert list over the empty profile root.
    const rows = (parsed as { insert?: { id?: string; config?: Record<string, unknown> }[] }[]).flatMap(
      patch => patch.insert ?? [],
    )
    expect(rows.length).toBeGreaterThan(50)
    expect(rows.some(row => row.id === 'agent-loop')).toBe(true)
    expect(rows.find(row => row.id === 'session-telemetry-otel')?.config?.['mode']).toEqual({
      __jsExpr: "process.env.DSH_TELEMETRY_MODE || 'DISABLED'",
    })
    expect(rows.filter(row => row.id === 'subagent-codex')).toHaveLength(0)
    expect(rows.filter(row => row.id === 'subagent-claude-code')).toHaveLength(0)
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-subagent-codex')
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-subagent-claude-code')
    expect(rows.find(row => row.id === 'web')?.config).toMatchObject({
      searchProvider: 'local-free',
      fetchProvider: 'local-http',
    })
    expect(rows.some(row => row.id === 'web-search-local')).toBe(true)
    expect(rows.some(row => row.id === 'web-fetch-http')).toBe(true)
    expect(rows.find(row => row.id === 'tool-web')?.config?.['fetch']).toBe(true)
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-web-search-local')
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-web-search-deepseek')
  })

  it('uses Git Bash as the cross-platform default tool and keeps pwsh Windows-only', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const parsed = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('base patch must parse to a patch list')
    const rows = parsed.flatMap((patch): Record<string, unknown>[] =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: Record<string, unknown>[] }).insert ?? []
        : [],
    )
    expect(rows.find(candidate => candidate.id === 'tool-bash')?.disabled).toBe(false)
    // Executors remain platform-specific. Windows uses the pwsh-derived hybrid
    // executor, which routes bash requests to Git Bash and pwsh requests to
    // PowerShell without registering two ctx.shell services.
    for (const [id, win32, linux] of [
      ['bash-sandbox', true, false],
      ['pwsh-sandbox', false, true],
      ['tool-pwsh', false, true],
    ] as const) {
      const row = rows.find(candidate => candidate.id === id)
      if (row === undefined) throw new Error(`base patch must mount ${id}`)
      const expression = (row.disabled as { __jsExpr?: string } | undefined)?.__jsExpr
      if (expression === undefined) throw new Error(`${id} must gate on a !!js disabled expression`)
      expect(Boolean(evaluate({ process: { platform: 'win32' } }, expression)), `${id} on win32`).toBe(win32)
      expect(Boolean(evaluate({ process: { platform: 'linux' } }, expression)), `${id} on linux`).toBe(linux)
    }
    // The platform layer folded into these rows: no separate patch file ships.
    expect(existsSync(resolve(root, 'windows.cordis.patch.yml'))).toBe(false)
  })
})
