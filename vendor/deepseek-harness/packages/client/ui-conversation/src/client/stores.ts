/**
 * Per-session chat store shared by conversation and details registrations.
 * The plugin creates its handle at apply time so identity follows the fiber.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { CallId, ChatStoreState, SelectionTarget } from './contract/views.ts'

/** Declared action shape used to give the exported factory a stable return type. */
type ChatActions = {
  select: (draft: ChatStoreState, target: SelectionTarget | null) => void
  setDraft: (draft: ChatStoreState, text: string) => void
  setView: (draft: ChatStoreState, view: string) => void
  closeView: (draft: ChatStoreState, view: string) => void
  restoreView: (draft: ChatStoreState) => void
  moveView: (draft: ChatStoreState, view: string, target: string, edge: 'before' | 'after') => void
  setWorkbenchLayout: (draft: ChatStoreState, layout: 'right' | 'bottom') => void
  setWorkbenchSize: (draft: ChatStoreState, size: number) => void
  setWorkbenchMaximized: (draft: ChatStoreState, maximized: boolean) => void
  setInspect: (draft: ChatStoreState, target: { callId: CallId } | null) => void
}

/**
 * Declares the per-session chat state and write surface.
 * @returns the store handle.
 */
export function createChatStore(): EngineStoreHandle<ChatStoreState, ChatActions> {
  return defineStore({
    // Anchored to the contract shape: consumers read the store through
    // PropsStore<ChatStore>'s SnapshotSelectorHook<ChatStoreState>, so init
    // and the contract cannot drift.
    init: (): ChatStoreState => ({
      selection: null,
      draft: '',
      view: null,
      openViews: [],
      closedViews: [],
      workbenchLayout: 'right',
      workbenchSize: 520,
      workbenchMaximized: false,
      inspect: null,
    }),
    persist: 'dsh.conversation.chat',
    actions: {
      select: (d, target: SelectionTarget | null) => { d.selection = target },
      setDraft: (d, text: string) => { d.draft = text },
      setView: (d, view: string) => {
        const previousView = d.view
        d.view = view
        if (view === 'chat') return
        const openViews = [...(d.openViews ?? [])]
        // Older persisted sessions only recorded the active view. Preserve it
        // as an open tool before switching to the newly requested panel.
        if (previousView !== null && previousView !== 'chat' && !openViews.includes(previousView)) {
          openViews.push(previousView)
        }
        if (!openViews.includes(view)) openViews.push(view)
        d.openViews = openViews
        d.closedViews = (d.closedViews ?? []).filter(id => id !== view)
      },
      closeView: (d, view: string) => {
        const openViews = (d.openViews ?? []).filter(id => id !== view)
        d.openViews = openViews
        d.closedViews = [view, ...(d.closedViews ?? []).filter(id => id !== view)].slice(0, 12)
        if (d.view === view) d.view = openViews.at(-1) ?? 'chat'
      },
      restoreView: (d) => {
        const [view, ...rest] = d.closedViews ?? []
        if (view === undefined) return
        d.closedViews = rest
        if (!(d.openViews ?? []).includes(view)) d.openViews = [...(d.openViews ?? []), view]
        d.view = view
      },
      moveView: (d, view: string, target: string, edge: 'before' | 'after') => {
        const openViews = d.openViews ?? []
        if (view === target || !openViews.includes(view) || !openViews.includes(target)) return
        const reordered = openViews.filter(id => id !== view)
        const targetIndex = reordered.indexOf(target)
        reordered.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, view)
        d.openViews = reordered
      },
      setWorkbenchLayout: (d, layout: 'right' | 'bottom') => { d.workbenchLayout = layout },
      setWorkbenchSize: (d, size: number) => { d.workbenchSize = Math.round(size) },
      setWorkbenchMaximized: (d, maximized: boolean) => { d.workbenchMaximized = maximized },
      setInspect: (d, target: { callId: CallId } | null) => { d.inspect = target },
    },
  })
}
