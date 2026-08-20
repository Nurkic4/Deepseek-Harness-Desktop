/** Strict per-session header/body content inserted into the resident conversation layout. */

import {
  useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import clsx from 'clsx'
import {
  Activity, Columns2, Files, Globe2, Maximize2, MessageSquareText, Minimize2,
  PanelRightClose, Plus, TerminalSquare, X,
} from 'lucide-react'
import type { SessionId, SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import type { ViewTab } from '../contract/views.ts'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
}

const DEFAULT_VIEW_ID = 'chat'
const DEFAULT_PANEL_WIDTH = 520
const DEFAULT_PANEL_HEIGHT = 360
type DropEdge = 'before' | 'after'

function ViewIcon({ id }: { id: string }) {
  const props = { size: 14, strokeWidth: 1.8, 'aria-hidden': true as const }
  if (id === 'browser') return <Globe2 {...props} />
  if (id === 'terminal') return <TerminalSquare {...props} />
  if (id === 'file-changes') return <Files {...props} />
  if (id === 'trajectory') return <Activity {...props} />
  return <MessageSquareText {...props} />
}

function WorkbenchPicker({ views, onSelect, label, heading, panel = false }: {
  views: readonly ViewTab[]
  onSelect: (id: string) => void
  label: string
  heading: string
  panel?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const desktop = (window as typeof window & {
    dshDesktop?: {
      showWorkbenchMenu?: (payload: unknown) => Promise<string | null>
      hideWorkbenchMenu?: () => Promise<boolean>
    }
  }).dshDesktop
  // WebContentsView always paints above the renderer DOM. Use the desktop
  // menu window for both picker locations so menus can overlay browser pages.
  const nativeMenu = typeof desktop?.showWorkbenchMenu === 'function'
  const itemKey = views.map(view => `${view.id}:${view.label}`).join('|')

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !nativeMenu || views.length === 0 || !buttonRef.current) return
    let cancelled = false
    const rect = buttonRef.current.getBoundingClientRect()
    const background = getComputedStyle(document.body).backgroundColor
    const channels = background.match(/[\d.]+/g)?.slice(0, 3).map(Number)
    const [red, green, blue] = channels ?? []
    const dark = red !== undefined && green !== undefined && blue !== undefined
      ? red * 0.299 + green * 0.587 + blue * 0.114 < 140
      : window.matchMedia('(prefers-color-scheme: dark)').matches
    void desktop.showWorkbenchMenu?.({
      x: rect.right - 220,
      y: rect.bottom + 6,
      heading,
      dark,
      items: views.map(view => ({ id: view.id, label: view.label })),
    }).then((selected) => {
      if (cancelled) return
      if (selected) onSelectRef.current(selected)
      setOpen(false)
    }).catch(() => {
      if (!cancelled) setOpen(false)
    })
    return () => {
      cancelled = true
      void desktop.hideWorkbenchMenu?.().catch(() => {})
    }
  // `itemKey` keeps the native menu synchronized without reopening it for an
  // equivalent array produced by the view registry on every render.
  }, [desktop, heading, itemKey, nativeMenu, open])

  if (views.length === 0) return null
  return (
    <div
      ref={rootRef}
      className={css.workbenchPicker}
      data-workbench-menu-open={open || undefined}
      data-workbench-menu-placement={panel ? 'panel' : 'overlay'}
    >
      <button
        ref={buttonRef}
        type="button"
        className={css.iconButton}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen(current => !current) }}
      >
        <Plus size={16} strokeWidth={1.8} aria-hidden />
      </button>
      {open && !nativeMenu && (
        <div className={css.workbenchMenu} role="menu" aria-label={label}>
          <p className={css.workbenchMenuHeading}>{heading}</p>
          {views.map(view => (
            <button
              key={view.id}
              type="button"
              role="menuitem"
              className={css.workbenchMenuItem}
              onClick={() => {
                onSelect(view.id)
                setOpen(false)
              }}
            >
              <ViewIcon id={view.id} />
              <span>{view.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Resolve by id and keep stale persisted selections on the stable Chat fallback. */
function resolveActiveView(tabs: readonly ViewTab[], selectedId: string | null): ViewTab | undefined {
  const requestedId = selectedId ?? DEFAULT_VIEW_ID
  return tabs.find(view => view.id === requestedId)
    ?? tabs.find(view => view.id === DEFAULT_VIEW_ID)
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({ id: summary.id, displayTitle: summary.displayTitle })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns the hidden blank-session header or visible title and tabs.
 */
export function ConversationSessionHeader({
  sessionId, useSession, useSessions, useStore, actions,
  renderSlot, views, open, reportActiveView, t,
}: ConversationSessionHeaderProps) {
  useSyncExternalStore(views.subscribe, views.version)
  const tabs = views.list()
  const toolViews = tabs.filter(view => view.id !== DEFAULT_VIEW_ID)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  useLayoutEffect(() => {
    reportActiveView(active?.id ?? DEFAULT_VIEW_ID)
  }, [active?.id, reportActiveView])
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const composerPhase = useSession(s => s.composerPhase)
  const blank = useSession(s => s.blank)
  const hideChrome = blank && composerPhase === 'blank'

  return (
    <header
      className={clsx(css.header, hideChrome && css.headerHidden)}
      aria-hidden={hideChrome || undefined}
    >
      {!hideChrome && (
        <>
          <div className={css.titleRow}>
            <div className={css.titleCluster}>
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  return (
                    <span key={summary.id} className={css.crumbSeg}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      <button
                        type="button"
                        className={clsx(css.crumb, last && css.crumbCurrent)}
                        disabled={last}
                        onClick={() => { open(summary.id) }}
                      >
                        {summary.displayTitle}
                      </button>
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
              </nav>
              <div className={css.headerActions}>
                {renderSlot('conversation.session.header.actions', {})}
              </div>
            </div>
            <div className={css.headerUtilities}>
              {renderSlot('conversation.session.header.utilities', {})}
              <WorkbenchPicker
                views={toolViews}
                onSelect={actions.setView}
                label={t('workbench.add')}
                heading={t('workbench.available')}
              />
            </div>
          </div>
        </>
      )}
    </header>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession({
  sessionId, useSession, useInput, inputActions, useStore, actions,
  renderSlot, views, bindDraftMirror, releaseSessionImages, t,
}: ConversationSessionProps) {
  useSyncExternalStore(views.subscribe, views.version)
  const tabs = views.list()
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const openViewIds = useStore(s => s.openViews ?? [])
  const chat = tabs.find(view => view.id === DEFAULT_VIEW_ID)
  const toolViews = tabs.filter(view => view.id !== DEFAULT_VIEW_ID)
  const activeTool = active?.id === DEFAULT_VIEW_ID ? undefined : active
  const openTools = openViewIds
    .map(id => toolViews.find(view => view.id === id))
    .filter((view): view is ViewTab => view !== undefined)
  if (activeTool !== undefined && !openTools.some(view => view.id === activeTool.id)) {
    openTools.push(activeTool)
  }
  const shortcutViewIds = [DEFAULT_VIEW_ID, ...openTools.map(view => view.id)].join('\0')
  const availableTools = toolViews.filter(view => !openTools.some(openView => openView.id === view.id))
  const composerPhase = useSession(s => s.composerPhase)
  const blank = useSession(s => s.blank)
  const inputState = useInput(s => s)
  const storedDraft = useStore(s => s.draft)
  // `?? null`: persisted snapshots from before the inspect field rehydrate without it.
  const inspect = useStore(s => s.inspect ?? null)
  const splitRef = useRef<HTMLDivElement | null>(null)
  const [draggingView, setDraggingView] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: DropEdge } | null>(null)
  const workbenchLayout = useStore(s => s.workbenchLayout ?? 'right')
  const workbenchSize = useStore(s => s.workbenchSize ?? DEFAULT_PANEL_WIDTH)
  const maximized = useStore(s => s.workbenchMaximized ?? false)

  useEffect(() => {
    const scrollBody = splitRef.current?.closest<HTMLElement>('[data-conversation-scroll]')
    scrollBody?.style.setProperty('--dsh-workbench-panel-size', `${workbenchSize}px`)
    scrollBody?.setAttribute('data-workbench-layout', workbenchLayout)
    return () => {
      scrollBody?.style.removeProperty('--dsh-workbench-panel-size')
      scrollBody?.removeAttribute('data-workbench-layout')
    }
  }, [workbenchLayout, workbenchSize])

  useEffect(() => {
    if (activeTool === undefined && maximized) actions.setWorkbenchMaximized(false)
  }, [actions, activeTool?.id, maximized])

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return
      if (event.shiftKey && event.key.toLocaleLowerCase() === 't') {
        event.preventDefault()
        actions.restoreView()
        return
      }
      if (event.shiftKey || !/^\d$/.test(event.key)) return
      const index = Number(event.key) - 1
      const targetId = shortcutViewIds.split('\0').at(index)
      if (targetId === undefined) return
      event.preventDefault()
      actions.setView(targetId)
    }
    window.addEventListener('keydown', onShortcut)
    return () => { window.removeEventListener('keydown', onShortcut) }
  }, [actions, shortcutViewIds])

  useEffect(() => {
    if (inputState.draft === '' && storedDraft !== '') inputActions.setDraft(storedDraft)
    const unmirror = bindDraftMirror(actions.setDraft)
    return () => { unmirror() }
    // Mount-only (deps pinned to inputActions): later store writes come from
    // the machine mirror, not this seed effect.
  }, [inputActions])

  useEffect(() => () => {
    releaseSessionImages(sessionId)
  }, [releaseSessionImages, sessionId])

  if (blank && composerPhase === 'blank') return null
  const resizePanel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if ((event.buttons & 1) === 0) return
    const rect = splitRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const next = workbenchLayout === 'bottom'
      ? Math.max(240, Math.min(rect.height * 0.72, rect.bottom - event.clientY))
      : Math.max(360, Math.min(rect.width * 0.72, rect.right - event.clientX))
    actions.setWorkbenchSize(next)
  }
  const owner = {
    inspect,
    onInspectDone: () => { actions.setInspect(null) },
  }
  const finishTabDrag = (): void => {
    setDraggingView(null)
    setDropTarget(null)
  }
  const startTabDrag = (event: ReactDragEvent<HTMLDivElement>, viewId: string): void => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', viewId)
    setDraggingView(viewId)
  }
  const targetTabDrag = (event: ReactDragEvent<HTMLDivElement>, viewId: string): void => {
    const sourceView = draggingView ?? event.dataTransfer.getData('text/plain')
    if (sourceView === '' || sourceView === viewId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const edge: DropEdge = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
    setDropTarget(current => current?.id === viewId && current.edge === edge ? current : { id: viewId, edge })
  }
  const dropTab = (event: ReactDragEvent<HTMLDivElement>, targetId: string): void => {
    event.preventDefault()
    const viewId = draggingView ?? event.dataTransfer.getData('text/plain')
    if (viewId !== '' && viewId !== targetId) {
      actions.moveView(viewId, targetId, dropTarget?.id === targetId ? dropTarget.edge : 'before')
    }
    finishTabDrag()
  }
  const moveTabFromKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>, viewId: string, index: number,
  ): void => {
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    const target = openTools.at(index + (event.key === 'ArrowLeft' ? -1 : 1))
    if (target === undefined) return
    event.preventDefault()
    actions.moveView(viewId, target.id, event.key === 'ArrowLeft' ? 'before' : 'after')
  }
  const splitStyle = { '--dsh-workbench-panel-size': `${workbenchSize}px` } as CSSProperties

  return (
    <div className={css.viewArea}>
      <div
        ref={splitRef}
        className={clsx(css.workbenchSplit, activeTool !== undefined && css.workbenchSplitOpen)}
        style={splitStyle}
        data-workbench-maximized={maximized || undefined}
        data-workbench-layout={workbenchLayout}
      >
        <section className={css.chatPane} aria-label={chat?.label ?? 'Chat'}>
          {chat !== undefined && renderSlot('conversation.view', owner, { only: chat.id })}
        </section>

        {activeTool !== undefined && (
          <>
            <div
              className={css.panelResizeHandle}
              role="separator"
              aria-orientation={workbenchLayout === 'bottom' ? 'horizontal' : 'vertical'}
              aria-label={t('workbench.resize')}
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId) }}
              onPointerMove={resizePanel}
            />
            <section className={css.workbenchPanel} data-workbench-panel="" aria-label={activeTool.label}>
              <div className={css.workbenchTabBar}>
                <div className={css.workbenchTabs} role="tablist">
                  {openTools.map((view, index) => (
                    <div
                      key={view.id}
                      className={clsx(
                        css.workbenchTab,
                        view.id === activeTool.id && css.workbenchTabActive,
                        view.id === draggingView && css.workbenchTabDragging,
                        dropTarget?.id === view.id && dropTarget.edge === 'before' && css.workbenchTabDropBefore,
                        dropTarget?.id === view.id && dropTarget.edge === 'after' && css.workbenchTabDropAfter,
                      )}
                      draggable
                      onDragStart={(event) => { startTabDrag(event, view.id) }}
                      onDragOver={(event) => { targetTabDrag(event, view.id) }}
                      onDrop={(event) => { dropTab(event, view.id) }}
                      onDragEnd={finishTabDrag}
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={view.id === activeTool.id}
                        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                        className={css.workbenchTabSelect}
                        onClick={() => { actions.setView(view.id) }}
                        onKeyDown={(event) => { moveTabFromKeyboard(event, view.id, index) }}
                      >
                        <ViewIcon id={view.id} />
                        <span>{view.label}</span>
                      </button>
                      <button
                        type="button"
                        className={css.workbenchTabClose}
                        aria-label={t('workbench.close', { name: view.label })}
                        title={t('workbench.close', { name: view.label })}
                        onClick={() => { actions.closeView(view.id) }}
                      >
                        <X size={13} strokeWidth={1.8} aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
                <div className={css.workbenchPanelActions}>
                  <WorkbenchPicker
                    views={availableTools}
                    onSelect={actions.setView}
                    label={t('workbench.add')}
                    heading={t('workbench.available')}
                    panel
                  />
                  <button
                    type="button"
                    className={css.iconButton}
                    aria-label={workbenchLayout === 'right' ? t('workbench.splitBottom') : t('workbench.splitRight')}
                    title={workbenchLayout === 'right' ? t('workbench.splitBottom') : t('workbench.splitRight')}
                    onClick={() => {
                      actions.setWorkbenchLayout(workbenchLayout === 'right' ? 'bottom' : 'right')
                      actions.setWorkbenchSize(workbenchLayout === 'right' ? DEFAULT_PANEL_HEIGHT : DEFAULT_PANEL_WIDTH)
                    }}
                  >
                    <Columns2
                      size={15}
                      strokeWidth={1.8}
                      aria-hidden
                      style={{ transform: workbenchLayout === 'right' ? 'rotate(90deg)' : undefined }}
                    />
                  </button>
                  <button
                    type="button"
                    className={css.iconButton}
                    aria-label={maximized ? t('workbench.restore') : t('workbench.expand')}
                    title={maximized ? t('workbench.restore') : t('workbench.expand')}
                    onClick={() => { actions.setWorkbenchMaximized(!maximized) }}
                  >
                    {maximized
                      ? <Minimize2 size={15} strokeWidth={1.8} aria-hidden />
                      : <Maximize2 size={15} strokeWidth={1.8} aria-hidden />}
                  </button>
                  <button
                    type="button"
                    className={css.iconButton}
                    aria-label={t('workbench.collapse')}
                    title={t('workbench.collapse')}
                    onClick={() => { actions.setView(DEFAULT_VIEW_ID) }}
                  >
                    <PanelRightClose size={16} strokeWidth={1.8} aria-hidden />
                  </button>
                </div>
              </div>
              <div className={css.workbenchContent}>
                {renderSlot('conversation.view', owner, { only: activeTool.id })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
