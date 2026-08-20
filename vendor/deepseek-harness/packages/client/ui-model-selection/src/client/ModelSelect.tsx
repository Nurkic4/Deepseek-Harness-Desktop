import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { IconWarningOutline16, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import ComposerModelMenu, {
  DEFAULT_EFFORT_VALUE,
  type ComposerEffortOption,
  type ComposerModelOption,
} from './cloudcli/ComposerModelMenu.tsx'

interface ModelRoute extends ComposerModelOption {
  provider: string
  model: string
}

function routeKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

/** DSH adapter for the vendored CloudCLI composer model menu. */
export function ModelSelect(
  { locked, available, directory, load, select, t }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)

  useEffect(() => {
    if (available) load()
  }, [available, load])

  const routes = useMemo<ModelRoute[]>(() => state.groups.flatMap(group =>
    group.models.map(model => ({
      value: routeKey(group.id, model.id),
      label: model.name,
      provider: group.id,
      model: model.id,
    }))), [state.groups])

  if (!available) return null

  const currentKey = state.current === null
    ? ''
    : routeKey(state.current.provider, state.current.model)
  const currentRoute = routes.find(route => route.value === currentKey)
  const currentModel = state.groups
    .find(group => group.id === currentRoute?.provider)
    ?.models.find(model => model.id === currentRoute?.model)
  const effortOptions: ComposerEffortOption[] = currentModel?.reasoning?.efforts.map(effort => ({
    value: effort.id,
    label: effort.name,
    ...(effort.description === undefined ? {} : { description: effort.description }),
  })) ?? []
  const effort = state.current?.reasoningEffort ?? DEFAULT_EFFORT_VALUE

  const reportFailure = (): void => {
    const message = directory.getSnapshot().error
    if (message === null) return
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
  }

  const choose = (selection: ModelSelection): void => {
    void select(selection).then((accepted) => {
      if (!accepted) reportFailure()
    })
  }

  const chooseModel = (value: string): void => {
    const route = routes.find(option => option.value === value)
    if (route === undefined) return
    const target = state.groups
      .find(group => group.id === route.provider)
      ?.models.find(model => model.id === route.model)
    choose({
      provider: route.provider,
      model: route.model,
      ...(target?.reasoning?.defaultEffort === undefined
        ? {}
        : { reasoningEffort: target.reasoning.defaultEffort }),
    })
  }

  const chooseEffort = (value: string): void => {
    if (state.current === null) return
    choose({
      provider: state.current.provider,
      model: state.current.model,
      ...(value === DEFAULT_EFFORT_VALUE ? {} : { reasoningEffort: value }),
    })
  }

  return (
    <>
      <ComposerModelMenu
        effort={effort}
        effortOptions={effortOptions}
        onSelectEffort={chooseEffort}
        model={currentKey}
        modelFallback={currentRoute?.label ?? t('trigger.fallback')}
        modelOptions={routes}
        onSelectModel={chooseModel}
        modelsLoading={state.status === 'loading'}
        disabled={locked || state.status === 'selecting'}
        onOpen={load}
        labels={{
          aria: t('menu.aria'),
          defaultEffort: t('effort.providerDefault'),
          reasoning: t('menu.effort'),
          model: t('menu.model'),
          loadingModels: t('status.loading'),
        }}
      />
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          onDone={() => { setToast(null) }}
        />
      )}
    </>
  )
}
