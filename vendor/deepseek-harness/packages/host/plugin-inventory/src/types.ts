import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
  /** MCP entries are separated from ordinary plugins in management UIs. */
  readonly category: 'plugin' | 'mcp'
  /** User-facing MCP server name when configured. */
  readonly serverName: string | null
  /** Whether this entry may be toggled without disabling the management plane. */
  readonly configurable: boolean
}

/** One discovered Skill exposed to trusted clients. */
export interface SkillInventoryEntry {
  readonly name: string
  readonly description: string
  readonly source: string
  readonly provider: string
  readonly enabled: boolean
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
  readonly skills: readonly SkillInventoryEntry[]
}
