/**
 * Official-DeepSeek first-run step. Readiness comes from the same
 * provider/settings/credential join as the Models page: any provider the user
 * can already talk to ends the step, and only a user with none is offered the
 * official DeepSeek route. The step reuses that page's credential editor in
 * the onboarding plugin's shared modal, so the key is entered once.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { providerUsable } from './store.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import styles from './DeepSeekOnboardingDialog.module.css'

/** Registration-side dependencies of {@link DeepSeekOnboardingDialog}. */
export interface DeepSeekOnboardingInjected {
  hooks: {
    /** Shared Models-page join state, bound by the slot renderer. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** Existing wire face reused by the Models credential editor. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}

/** Slot owner props plus the feature's injected dependencies. */
export type DeepSeekOnboardingDialogProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<DeepSeekOnboardingInjected>

const ONBOARDING_PROVIDERS = [
  { provider: 'deepseek-official', displayName: 'DeepSeek' },
  { provider: 'openai', displayName: 'OpenAI' },
  { provider: 'anthropic', displayName: 'Anthropic' },
  { provider: 'google', displayName: 'Google Gemini' },
  { provider: 'openrouter', displayName: 'OpenRouter' },
  { provider: 'xai', displayName: 'xAI' },
  { provider: 'moonshotai-cn', displayName: 'Moonshot / Kimi' },
  { provider: 'minimax-cn', displayName: 'MiniMax' },
  { provider: 'zai-coding-cn', displayName: '智谱 GLM' },
  { provider: 'mistral', displayName: 'Mistral AI' },
  { provider: 'groq', displayName: 'Groq' },
  { provider: 'together', displayName: 'Together AI' },
] as const

/**
 * Prompt a first-run user for the official DeepSeek credential while no
 * provider can serve requests and that credential is writable.
 * @param props - settings-shell owner state and Models feature dependencies.
 * @returns the onboarding modal or null when onboarding needs no intervention.
 */
export function DeepSeekOnboardingDialog(props: DeepSeekOnboardingDialogProps): ReactNode {
  const { complete, controller, useModels, api, t } = props
  const state = useModels(snapshot => snapshot)
  const [selectedProvider, setSelectedProvider] = useState<string>('deepseek-official')
  const choices = ONBOARDING_PROVIDERS.flatMap(choice => {
    const row = state.rows.find(candidate => candidate.entry.provider === choice.provider)
    return row === undefined || state.namespaces.get(row.entry.settingsNs) === undefined
      ? []
      : [{ ...choice, row }]
  })
  const selected = choices.find(choice => choice.provider === selectedProvider) ?? choices[0]
  const anyUsable = state.rows.some(providerUsable)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (anyUsable || state.status === 'error' || (state.status === 'ready' && (!state.writable || choices.length === 0))) complete()
  }, [anyUsable, choices.length, complete, state.status, state.writable])

  if (state.status === 'idle' || state.status === 'loading' || anyUsable || selected === undefined || !state.writable) return null
  const row = selected.row
  const namespace = state.namespaces.get(row.entry.settingsNs)
  if (namespace === undefined) return null

  const finishCredential = (changed: boolean): void => {
    if (!changed) {
      complete()
      return
    }
    void controller.load()
  }

  return (
    <OnboardingModal title={t('onboardingTitle')}>
      <p className={styles.description}>{t('onboardingDescription')}</p>
      <p className={styles.selectionLabel}>{t('onboardingProvider')}</p>
      <div className={styles.providerList}>
        {choices.map(choice => (
          <button
            key={choice.provider}
            type="button"
            className={`${styles.providerButton} ${choice.provider === selected.provider ? styles.providerButtonSelected : ''}`}
            onClick={() => setSelectedProvider(choice.provider)}
          >
            <span className={styles.providerName}>{choice.displayName}</span>
            <span className={styles.providerKind}>{choice.provider}</span>
          </button>
        ))}
      </div>
      <div className={styles.editor}>
        <ProviderEditor
          provider={row.entry.provider}
          displayName={row.entry.displayName}
          namespace={namespace}
          settingsPath={row.entry.settingsPath}
          api={api}
          t={t}
          readOnly={false}
          hideTitle
          credentialOnly
          credentialRequired
          autoFocusCredential
          cancelLabel="onboardingLater"
          submitLabel="onboardingSave"
          submitBusyLabel="onboardingSaving"
          onClose={finishCredential}
        />
      </div>
    </OnboardingModal>
  )
}
