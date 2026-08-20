// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type {
  PluginInventorySettingsTabInjected,
  PluginInventorySettingsTabProps,
} from '../src/client/PluginInventorySettingsTab.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

type Snapshot = Awaited<ReturnType<PluginInventorySettingsTabInjected['list']>>
const t = ((key: PluginInventoryLocaleKey): string => en[key]) as PluginInventorySettingsTabProps['t']
const setEntryEnabled = vi.fn(async () => {})
const setSkillEnabled = vi.fn(async () => {})

function props(list: PluginInventorySettingsTabInjected['list']): PluginInventorySettingsTabProps {
  return { t, list, setEntryEnabled, setSkillEnabled } as PluginInventorySettingsTabProps
}

const SNAPSHOT = {
  entries: [
    {
      entryId: 'plugin-active', moduleName: '@deepseek-ai/dsh-web-search-local', enabled: true,
      fiberPhase: 'active', category: 'plugin', serverName: null, configurable: true,
    },
    {
      entryId: 'plugin-required', moduleName: '@deepseek-ai/dsh-host-plugin-inventory', enabled: true,
      fiberPhase: 'active', category: 'plugin', serverName: null, configurable: false,
    },
    {
      entryId: 'mcp-files', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: false,
      fiberPhase: null, category: 'mcp', serverName: 'filesystem', configurable: true,
    },
  ],
  skills: [
    {
      name: 'review-code', description: 'Review repository changes', source: 'user', provider: 'filesystem',
      enabled: true, modelInvocable: true, userInvocable: true,
    },
    {
      name: 'write-docs', description: 'Write project documentation', source: 'bundled', provider: 'filesystem',
      enabled: false, modelInvocable: true, userInvocable: false,
    },
  ],
} as unknown as Snapshot

describe('PluginInventorySettingsTab', () => {
  it('separates plugin, MCP, and Skill catalogs with category counts', async () => {
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} />)

    expect(await screen.findByRole('tab', { name: 'Plugins 2' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'MCP 1' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Skills 2' })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('web-search-local')).toBeTruthy()
    expect(screen.getByText(en.protectedTag)).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'MCP 1' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('filesystem')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Skills 2' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Review repository changes')).toBeTruthy()
  })

  it('filters only the active category', async () => {
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} />)
    const search = await screen.findByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: 'search-local' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    fireEvent.change(search, { target: { value: 'review-code' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Skills 2' }))
    expect((screen.getByRole('searchbox', { name: en.search }) as HTMLInputElement).value).toBe('')
  })

  it('toggles configurable plugins and skills while protecting management modules', async () => {
    setEntryEnabled.mockClear()
    setSkillEnabled.mockClear()
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} />)
    await screen.findByText('web-search-local')

    const pluginSwitch = screen.getByRole('switch', { name: 'web-search-local: Enabled' })
    fireEvent.click(pluginSwitch)
    await waitFor(() => { expect(setEntryEnabled).toHaveBeenCalledWith('plugin-active', false) })
    expect(screen.getByRole('switch', { name: 'web-search-local: Disabled' })).toBeTruthy()
    expect((screen.getByRole('switch', { name: 'plugin-inventory: Enabled' }) as HTMLInputElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('tab', { name: 'Skills 2' }))
    fireEvent.click(screen.getByRole('switch', { name: 'write-docs: Disabled' }))
    await waitFor(() => { expect(setSkillEnabled).toHaveBeenCalledWith('write-docs', true) })
    expect(screen.getByRole('switch', { name: 'write-docs: Enabled' })).toBeTruthy()
  })

  it('keeps prior state and shows a generic message when a toggle fails', async () => {
    const failing = vi.fn(async () => { throw new Error('private transport detail') })
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} setEntryEnabled={failing} />)
    const toggle = await screen.findByRole('switch', { name: 'web-search-local: Enabled' })
    fireEvent.click(toggle)
    expect((await screen.findByRole('alert')).textContent).toBe(en.toggleError)
    expect(screen.getByRole('switch', { name: 'web-search-local: Enabled' })).toBeTruthy()
    expect(screen.queryByText('private transport detail')).toBeNull()
  })

  it('shows a generic load failure and retries into the empty state', async () => {
    const list = vi.fn<PluginInventorySettingsTabInjected['list']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce({ entries: [], skills: [] })
    render(<PluginInventorySettingsTab {...props(list)} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('ignores a result after unmount', async () => {
    const deferred = Promise.withResolvers<Snapshot>()
    const pending = render(<PluginInventorySettingsTab {...props(() => deferred.promise)} />)
    pending.unmount()
    await act(async () => { deferred.resolve(SNAPSHOT) })
  })
})
