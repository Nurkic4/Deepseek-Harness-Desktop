/** Read-only Host plugin inventory registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { desktopShell } from './desktop-shell.ts'
import { MarketplaceSettingsTab, type MarketplaceSettingsTabInjected } from './MarketplaceSettingsTab.tsx'
import { PluginInventorySettingsTab, type PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { en, zh, type PluginInventoryLocaleKey } from './locales.ts'

export type { PluginInventorySettingsTabInjected, PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
export type { MarketplaceSettingsTabInjected, MarketplaceSettingsTabProps } from './MarketplaceSettingsTab.tsx'
export type { PluginInventoryLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-only Host plugin inventory copy. */
    'settings.pluginInventory': PluginInventoryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory', 'connection', 'sessions']

/** Contribute the lazy inventory tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-inventory: dictionaries')

  const t = ctx.locale.bind(NS)
  const connection = ctx.get('connection') as ConnectionHandle
  const sessions = ctx.get('sessions') as ISessions
  const list: PluginInventorySettingsTabInjected['list'] = async () => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) {
      throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
    }
    const snapshot = result.value
    const sessionId = sessions.list.getSnapshot().current
    if (sessionId === undefined) return snapshot
    const scoped = await connection.api.skills.list({ sessionId })
    if (!scoped.result.ok) return snapshot
    const byName = new Map(snapshot.skills.map(skill => [skill.name, skill]))
    for (const skill of scoped.result.value.skills) {
      const existing = byName.get(skill.name)
      byName.set(skill.name, {
        name: skill.name,
        description: skill.description,
        source: existing?.source ?? 'active-preset',
        provider: existing?.provider ?? 'session',
        enabled: existing?.enabled ?? true,
        modelInvocable: skill.modelInvocable,
        userInvocable: true,
      })
    }
    return { ...snapshot, skills: [...byName.values()] }
  }
  const setEntryEnabled: PluginInventorySettingsTabInjected['setEntryEnabled'] = async (entryId, enabled) => {
    const result = await ctx.remote.pluginInventory.setEntryEnabled(entryId, enabled)
    if (!result.ok) throw new Error(`pluginInventory.setEntryEnabled failed: ${result.error.code}: ${result.error.message}`)
  }
  const setSkillEnabled: PluginInventorySettingsTabInjected['setSkillEnabled'] = async (name, enabled) => {
    const result = await ctx.remote.pluginInventory.setSkillEnabled(name, enabled)
    if (!result.ok) throw new Error(`pluginInventory.setSkillEnabled failed: ${result.error.code}: ${result.error.message}`)
  }
  const injected = (): PluginInventorySettingsTabInjected => ({ list, setEntryEnabled, setSkillEnabled })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'all',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, PluginInventorySettingsTab))

  const shell = desktopShell()
  if (shell?.listMarketplace && shell.listInstalledPlugins && shell.installPlugin && shell.uninstallPlugin) {
    const market: MarketplaceSettingsTabInjected = {
      listMarketplace: (options) => shell.listMarketplace!(options),
      listInstalled: () => shell.listInstalledPlugins!(),
      installPlugin: (spec, options) => shell.installPlugin!(spec, options),
      uninstallPlugin: (name) => shell.uninstallPlugin!(name),
      openExternal: (url) => shell.openExternal?.(url) ?? Promise.resolve(false),
      saveGithubToken: async (token) => { await shell.saveConfig?.({ githubToken: token }) },
      hasGithubToken: async () => Boolean((await shell.getConfig?.())?.hasGithubToken),
      onProgress: (handler) => shell.onPluginProgress?.(handler) ?? (() => {}),
    }
    ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
      name: 'settings.plugins.tab',
      id: 'marketplace',
      order: 5,
      label: () => t('marketTab'),
      locale: NS,
      inject: () => market,
    }, MarketplaceSettingsTab))
  }
}
