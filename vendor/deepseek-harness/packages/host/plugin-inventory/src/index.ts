/** Plugin, MCP, and Skill inventory with persistent enablement controls. */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-skill'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
  SkillInventoryEntry,
} from './types.ts'

export type * from './types.ts'

interface PluginManagerSettings {
  disabledEntries: string[]
  disabledSkills: string[]
}

const SETTINGS_NAMESPACE = settingsNamespace('plugin-manager')
const SETTINGS_SCHEMA: z<PluginManagerSettings> = z.object({
  disabledEntries: z.array(z.string()).default([]),
  disabledSkills: z.array(z.string()).default([]),
})

const PROTECTED_MODULES = new Set([
  '@deepseek-ai/dsh-host-plugin-inventory',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-settings-file',
  '@deepseek-ai/dsh-host-apiproxy',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-host-frontend-static',
])

function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

function isMcpModule(moduleName: string): boolean {
  return moduleName === '@deepseek-ai/dsh-mcp-client' || moduleName.includes('/dsh-mcp-client')
}

function configuredServerName(config: unknown): string | null {
  if (config === null || typeof config !== 'object') return null
  const value = (config as Record<string, unknown>).serverName
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Remote service exposing the current tool inventory and management operations. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader', 'settings', 'skills']

  private readonly settings: SettingsScope<PluginManagerSettings>
  private managedDisabledEntries = new Set<string>()
  private managedDisabledSkills = new Set<string>()
  private operation = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
    this.settings = ctx.settings.register(SETTINGS_NAMESPACE, SETTINGS_SCHEMA)
    ctx.effect(async () => {
      await this.applySettings(this.settings.get())
      return this.settings.watch(next => this.applySettings(next))
    }, 'plugin-inventory: restore enablement')
  }

  /** Return the current plugin, MCP, and Skill catalog. */
  @Remote('list')
  async list(): Promise<PluginInventorySnapshot> {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      const category = isMcpModule(entry.options.name) ? 'mcp' : 'plugin'
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
        category,
        serverName: category === 'mcp' ? configuredServerName(entry.options.config) : null,
        configurable: !PROTECTED_MODULES.has(entry.options.name),
      })
    }
    const skills: SkillInventoryEntry[] = (await this.ctx.skills.listAll()).map(skill => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
      provider: skill.provider,
      enabled: this.ctx.skills.isEnabled(skill.name),
      modelInvocable: skill.invocation.modelInvocable,
      userInvocable: skill.invocation.userInvocable,
    }))
    for (const name of this.settings.get().disabledSkills) {
      if (skills.some(skill => skill.name === name)) continue
      skills.push({
        name,
        description: '',
        source: 'managed',
        provider: 'session',
        enabled: false,
        modelInvocable: true,
        userInvocable: true,
      })
    }
    return { entries, skills }
  }

  /** Persist and apply one Loader entry's enabled state. */
  @Remote('setEntryEnabled')
  setEntryEnabled(entryId: PluginEntryId, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      const entry = [...this.ctx.loader.entries()].find(candidate => candidate.id === entryId)
      if (entry === undefined) throw new Error(`plugin entry not found: ${entryId}`)
      if (PROTECTED_MODULES.has(entry.options.name)) throw new Error('this plugin is required by the management interface')
      const wasEnabled = !entry.disabled
      if (wasEnabled !== enabled) await this.ctx.loader.update(entryId, { disabled: !enabled })
      const disabledEntries = new Set(this.settings.get().disabledEntries)
      if (enabled) disabledEntries.delete(entryId)
      else disabledEntries.add(entryId)
      try {
        await this.settings.update({ disabledEntries: [...disabledEntries] })
        this.managedDisabledEntries = disabledEntries
      } catch (error) {
        if (wasEnabled !== enabled) await this.ctx.loader.update(entryId, { disabled: !wasEnabled })
        throw error
      }
    })
  }

  /** Persist and apply one Skill's enabled state. */
  @Remote('setSkillEnabled')
  setSkillEnabled(name: string, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      const wasEnabled = this.ctx.skills.isEnabled(name)
      this.ctx.skills.setEnabled(name, enabled)
      const disabledSkills = new Set(this.settings.get().disabledSkills)
      if (enabled) disabledSkills.delete(name)
      else disabledSkills.add(name)
      try {
        await this.settings.update({ disabledSkills: [...disabledSkills] })
        this.managedDisabledSkills = disabledSkills
      } catch (error) {
        this.ctx.skills.setEnabled(name, wasEnabled)
        throw error
      }
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operation.then(operation, operation)
    this.operation = next.then(() => undefined, () => undefined)
    return next
  }

  private async applySettings(settings: PluginManagerSettings): Promise<void> {
    const nextEntries = new Set(settings.disabledEntries)
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group || PROTECTED_MODULES.has(entry.options.name)) continue
      const shouldDisable = nextEntries.has(entry.id)
      const managedBefore = this.managedDisabledEntries.has(entry.id)
      if (shouldDisable === managedBefore) continue
      await this.ctx.loader.update(entry.id, { disabled: shouldDisable })
    }
    this.managedDisabledEntries = nextEntries

    const nextSkills = new Set(settings.disabledSkills)
    for (const name of new Set([...this.managedDisabledSkills, ...nextSkills])) {
      this.ctx.skills.setEnabled(name, !nextSkills.has(name))
    }
    this.managedDisabledSkills = nextSkills
  }
}

export default PluginInventoryGateway
