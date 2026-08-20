import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import PluginInventoryGateway from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const activePlugin: Plugin.Function = () => {}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}

async function harness(): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(SkillRegistry)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  await ctx.plugin(PluginInventoryGateway)
  const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
  return { ctx, inventory }
}

describe('PluginInventoryGateway', () => {
  it('publishes inventory and management methods under the pluginInventory namespace', async () => {
    const { inventory } = await harness()
    expect(inventory.typertRemote).toMatchObject({
      serviceKey: 'pluginInventory',
      namespace: 'pluginInventory',
    })
    expect(remoteMethods(inventory)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'setEntryEnabled', invocation: { kind: 'direct' } },
      { method: 'setSkillEnabled', invocation: { kind: 'direct' } },
    ])
  })

  it('projects current non-group Loader entries without a second cache', async () => {
    const { ctx, inventory } = await harness()
    const activeId = await ctx.loader.create({ name: 'cordis:active' })
    const pendingId = await ctx.loader.create({ name: 'cordis:pending' })
    const disabledId = await ctx.loader.create({
      name: 'cordis:not-installed',
      disabled: true,
    })
    await ctx.loader.create({ name: 'cordis:active', group: true })

    const snapshot = await inventory.list()
    expect(snapshot.entries).toHaveLength(3)
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      {
        entryId: activeId,
        moduleName: 'cordis:active',
        enabled: true,
        fiberPhase: 'active',
        category: 'plugin',
        serverName: null,
        configurable: true,
      },
      {
        entryId: pendingId,
        moduleName: 'cordis:pending',
        enabled: true,
        fiberPhase: 'pending',
        category: 'plugin',
        serverName: null,
        configurable: true,
      },
      {
        entryId: disabledId,
        moduleName: 'cordis:not-installed',
        enabled: false,
        fiberPhase: null,
        category: 'plugin',
        serverName: null,
        configurable: true,
      },
    ]))

    await ctx.loader.update(activeId, { disabled: true })
    expect((await inventory.list()).entries.find(entry => entry.entryId === activeId)).toEqual({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: false,
      fiberPhase: null,
      category: 'plugin',
      serverName: null,
      configurable: true,
    })

    await ctx.loader.remove(pendingId)
    expect((await inventory.list()).entries.some(entry => entry.entryId === pendingId)).toBe(false)
  })

  it('classifies MCP entries and persists plugin and Skill enablement', async () => {
    const { ctx, inventory } = await harness()
    const mcpId = await ctx.loader.create({
      name: 'cordis:active',
      config: { serverName: 'filesystem' },
    })
    ctx.skills.register({
      name: 'review-code',
      description: 'Review changes',
      source: 'runtime',
      content: 'Review carefully.',
    })

    // The fixture module is rewritten to the MCP package name after loading.
    const mcpEntry = [...ctx.loader.entries()].find(entry => entry.id === mcpId)!
    mcpEntry.options.name = '@deepseek-ai/dsh-mcp-client'
    expect((await inventory.list()).entries.find(entry => entry.entryId === mcpId)).toMatchObject({
      category: 'mcp',
      serverName: 'filesystem',
    })
    expect((await inventory.list()).skills).toEqual([
      expect.objectContaining({ name: 'review-code', enabled: true }),
    ])

    await inventory.setEntryEnabled(mcpId as never, false)
    await inventory.setSkillEnabled('review-code', false)
    expect((await inventory.list()).entries.find(entry => entry.entryId === mcpId)?.enabled).toBe(false)
    expect((await inventory.list()).skills[0]?.enabled).toBe(false)
    expect(await ctx.skills.get('review-code')).toBeUndefined()

    const settings = ctx.settings.describe().find(item => item.ns === 'plugin-manager')
    expect(settings?.value).toEqual({ disabledEntries: [mcpId], disabledSkills: ['review-code'] })
  })
})
