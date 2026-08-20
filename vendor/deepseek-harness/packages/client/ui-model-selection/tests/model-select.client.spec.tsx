// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const reasoning = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max', description: 'Largest budget' },
  ],
  defaultEffort: 'high',
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning }],
    }],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

afterEach(cleanup)

describe('ModelSelect reasoning effort', () => {
  it('renders adapter metadata and submits the effort as part of the session selection', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: '模型与推理等级' })
    expect(trigger.textContent).toBe('DeepSeek-V4-Flash')
    fireEvent.click(trigger)
    expect(screen.getByRole('menu', { name: '模型与推理等级' })).toBeTruthy()
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Default', 'Off', 'High', 'MaxLargest budget'])
    expect(screen.queryByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Max/ }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(trigger.textContent).toBe('DeepSeek-V4-Flash· Max')
    })
  })

  it('offers Default before every advertised effort, matching the upstream menu', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: '模型与推理等级' }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Default', 'Standard'])
    expect(screen.getByRole('menuitemradio', { name: 'Default' }).getAttribute('aria-checked')).toBe('true')
  })

  it('prompts for a selection when the current model is no longer advertised', () => {
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'removed-model' },
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: '模型与推理等级' })
    expect(trigger.textContent).toContain('选择模型')
    fireEvent.click(trigger)
    expect(screen.queryByText('推理等级')).toBeNull()
    expect(screen.queryByText('removed-model')).toBeNull()
    expect(screen.queryByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '选择模型' }))
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
  })

  it('announces a rejected selection as a transient toast and keeps the in-menu strip for loads', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async () => {
      directory.set(state({ groups, status: 'error', error: 'model-unavailable: session already contains images' }))
      return false
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: '模型与推理等级' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'DeepSeek-V4-Flash' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toContain('模型操作失败：model-unavailable: session already contains images')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens models in a separate hover submenu and closes both menus together', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: '模型与推理等级' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 500,
      y: 600,
      top: 600,
      right: 700,
      bottom: 632,
      left: 500,
      width: 200,
      height: 32,
      toJSON: () => ({}),
    })
    fireEvent.click(trigger)
    const mainMenu = screen.getByRole('menu', { name: '模型与推理等级' })
    expect(mainMenu.style.right).toBe(`${window.innerWidth - 700}px`)
    const modelTrigger = screen.getByRole('menuitem', { name: 'DeepSeek-V4-Flash' })
    expect(modelTrigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.pointerEnter(modelTrigger)
    const modelMenu = screen.getByRole('menu', { name: '模型' })
    const modelOption = screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })
    expect(modelTrigger.getAttribute('aria-expanded')).toBe('true')
    expect(mainMenu.contains(modelMenu)).toBe(false)
    expect(modelMenu.contains(modelOption)).toBe(true)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)
    expect(screen.queryByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeNull()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    render(<ModelSelect
      locked={false}
      available={false}
      directory={createSnapshotStore(state())}
      load={load}
      select={vi.fn().mockResolvedValue(false)}
      t={t}
    />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})
