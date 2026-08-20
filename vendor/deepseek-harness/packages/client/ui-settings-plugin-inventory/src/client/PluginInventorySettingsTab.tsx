import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PluginEntryId, PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

export interface PluginInventorySettingsTabInjected {
  list: () => Promise<PluginInventorySnapshot>
  setEntryEnabled: (entryId: PluginEntryId, enabled: boolean) => Promise<void>
  setSkillEnabled: (name: string, enabled: boolean) => Promise<void>
}

type PluginEntry = PluginInventorySnapshot['entries'][number]
type SkillEntry = PluginInventorySnapshot['skills'][number]
type Category = 'plugin' | 'mcp' | 'skill'

export type PluginInventorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginEntry['fiberPhase'], null>, PluginInventoryLocaleKey>

function phaseLabel(phase: PluginEntry['fiberPhase'], t: PluginInventorySettingsTabProps['t']): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped.replace(/^cordis:/, '').replace(/^cordis-plugin-/, '').replace(/^dsh-(?:host-|client-)?/, '')
}

function includesQuery(values: readonly string[], query: string): boolean {
  return query.length === 0 || values.some(value => value.toLocaleLowerCase().includes(query))
}

export function PluginInventorySettingsTab({
  list,
  setEntryEnabled,
  setSkillEnabled,
  t,
}: PluginInventorySettingsTabProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [category, setCategory] = useState<Category>('plugin')
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [actionFailed, setActionFailed] = useState(false)
  const [state, setState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      snapshot => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const pluginEntries = state.status === 'ready'
    ? state.snapshot.entries.filter(entry => entry.category === 'plugin')
    : []
  const mcpEntries = state.status === 'ready'
    ? state.snapshot.entries.filter(entry => entry.category === 'mcp')
    : []
  const skills = state.status === 'ready' ? state.snapshot.skills : []
  const visiblePlugins = useMemo(() => {
    const source = category === 'plugin' ? pluginEntries : category === 'mcp' ? mcpEntries : []
    return source.filter(entry => includesQuery(
      [entry.moduleName, entry.entryId, entry.serverName ?? ''],
      normalizedQuery,
    ))
  }, [category, mcpEntries, normalizedQuery, pluginEntries])
  const visibleSkills = useMemo(
    () => category === 'skill'
      ? skills.filter(skill => includesQuery(
        [skill.name, skill.description, skill.source, skill.provider],
        normalizedQuery,
      ))
      : [],
    [category, normalizedQuery, skills],
  )

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  const togglePlugin = async (entry: PluginEntry, enabled: boolean): Promise<void> => {
    setPending(entry.entryId)
    setActionFailed(false)
    try {
      await setEntryEnabled(entry.entryId, enabled)
      setState(current => current.status !== 'ready' ? current : {
        status: 'ready',
        snapshot: {
          ...current.snapshot,
          entries: current.snapshot.entries.map(item => item.entryId === entry.entryId
            ? { ...item, enabled, fiberPhase: enabled ? item.fiberPhase : null }
            : item),
        },
      })
    } catch {
      setActionFailed(true)
    } finally {
      setPending(null)
    }
  }

  const toggleSkill = async (skill: SkillEntry, enabled: boolean): Promise<void> => {
    setPending(`skill:${skill.name}`)
    setActionFailed(false)
    try {
      await setSkillEnabled(skill.name, enabled)
      setState(current => current.status !== 'ready' ? current : {
        status: 'ready',
        snapshot: {
          ...current.snapshot,
          skills: current.snapshot.skills.map(item => item.name === skill.name ? { ...item, enabled } : item),
        },
      })
    } catch {
      setActionFailed(true)
    } finally {
      setPending(null)
    }
  }

  const counts: Record<Category, number> = {
    plugin: pluginEntries.length,
    mcp: mcpEntries.length,
    skill: skills.length,
  }
  const categoryLabels: Record<Category, PluginInventoryLocaleKey> = {
    plugin: 'pluginCategory',
    mcp: 'mcpCategory',
    skill: 'skillCategory',
  }
  const descriptionKey: Record<Category, PluginInventoryLocaleKey> = {
    plugin: 'pluginDescription',
    mcp: 'mcpDescription',
    skill: 'skillDescription',
  }
  const visibleCount = category === 'skill' ? visibleSkills.length : visiblePlugins.length

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className={css.catalog}>
          <div className={css.toolbar}>
            <div className={css.tabs} role="tablist" aria-label={t('catalog')}>
              {(Object.keys(categoryLabels) as Category[]).map(value => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={category === value}
                  aria-label={`${t(categoryLabels[value])} ${counts[value]}`}
                  className={css.tab}
                  onClick={() => { setCategory(value); setQuery(''); setActionFailed(false) }}
                >
                  <span>{t(categoryLabels[value])}</span>
                  <span className={css.count}>{counts[value]}</span>
                </button>
              ))}
            </div>
            <label className={css.search}>
              <IconSearchOutline16 aria-hidden="true" />
              <span className={css.visuallyHidden}>{t('search')}</span>
              <input
                type="search"
                value={query}
                placeholder={t('search')}
                aria-label={t('search')}
                onChange={event => { setQuery(event.currentTarget.value) }}
              />
            </label>
          </div>
          <p className={css.description}>{t(descriptionKey[category])}</p>
          {actionFailed ? <p className={css.actionError} role="alert">{t('toggleError')}</p> : null}
          {counts[category] === 0 ? <p className={css.status}>{t('empty')}</p> : null}
          {counts[category] > 0 && visibleCount === 0 ? <p className={css.status}>{t('emptySearch')}</p> : null}
          {visibleCount > 0 ? (
            <ul className={css.rows}>
              {category !== 'skill' ? visiblePlugins.map(entry => {
                const title = entry.serverName ?? moduleShortName(entry.moduleName)
                const status = phaseLabel(entry.fiberPhase, t)
                const busy = pending === entry.entryId
                return (
                  <li className={css.row} key={entry.entryId} data-tool-kind={entry.category}>
                    <div className={css.rowBody}>
                      <div className={css.titleLine}>
                        <strong title={entry.moduleName}>{title}</strong>
                        {entry.enabled ? <span className={css.statusDot} data-phase={entry.fiberPhase ?? 'unobserved'} /> : null}
                        <span className={css.stateText}>{entry.enabled ? status : t('disabledTag')}</span>
                        {!entry.configurable ? <span className={css.required} title={t('protectedHint')}>{t('protectedTag')}</span> : null}
                      </div>
                      <span className={css.secondary}>{entry.moduleName}</span>
                    </div>
                    <label className={css.switch} title={!entry.configurable ? t('protectedHint') : undefined}>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={entry.enabled}
                        disabled={!entry.configurable || busy}
                        aria-label={`${title}: ${entry.enabled ? t('enabledTag') : t('disabledTag')}`}
                        onChange={event => { void togglePlugin(entry, event.currentTarget.checked) }}
                      />
                      <span aria-hidden="true" />
                    </label>
                  </li>
                )
              }) : visibleSkills.map(skill => {
                const busy = pending === `skill:${skill.name}`
                return (
                  <li className={css.row} key={skill.name} data-tool-kind="skill">
                    <div className={css.rowBody}>
                      <div className={css.titleLine}>
                        <strong>{skill.name}</strong>
                        <span className={css.stateText}>{skill.enabled ? t('enabledTag') : t('disabledTag')}</span>
                      </div>
                      <span className={css.secondary}>{skill.description}</span>
                      <span className={css.meta}>
                        {skill.provider} · {skill.source}
                        {skill.modelInvocable ? ` · ${t('modelInvocable')}` : ''}
                        {skill.userInvocable ? ` · ${t('userInvocable')}` : ''}
                      </span>
                    </div>
                    <label className={css.switch}>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={skill.enabled}
                        disabled={busy}
                        aria-label={`${skill.name}: ${skill.enabled ? t('enabledTag') : t('disabledTag')}`}
                        onChange={event => { void toggleSkill(skill, event.currentTarget.checked) }}
                      />
                      <span aria-hidden="true" />
                    </label>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
