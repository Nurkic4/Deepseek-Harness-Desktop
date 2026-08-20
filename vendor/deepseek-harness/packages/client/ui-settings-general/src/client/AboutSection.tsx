/** About page inside the official Settings sidebar. */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { desktopShell } from './desktop-shell.ts'
import css from './AboutSection.module.css'

const HARNESS_URL = 'https://github.com/deepseek-ai/deepseek-harness'
const REPO_URL = 'https://github.com/ChisaAlter/Deepseek-Harness-Desktop'

/** Props the Settings renderer binds for this section. */
export type AboutSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings'>

/** Render the About column for this desktop app and the official Harness. */
export function AboutSection({ t }: AboutSectionProps): ReactNode {
  const [version, setVersion] = useState('')
  const shell = desktopShell()

  useEffect(() => {
    if (!shell) return undefined
    let cancelled = false
    void shell.getConfig?.().then((config) => {
      if (!cancelled && config?.appVersion) setVersion(config.appVersion)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [shell])

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('about.nav')}</h2>
      <p className={css.intro}>{t('about.intro')}</p>
      <ul className={css.list}>
        <li>
          <div className={css.name}>{t('about.app')}</div>
          <p className={css.meta}>{t('about.version', { version: version || '—' })}</p>
          <p className={css.meta}>{t('about.appMeta')}</p>
          <a className={css.link} href={REPO_URL} target="_blank" rel="noreferrer noopener">
            {t('about.source')}
          </a>
        </li>
        <li>
          <a className={css.link} href={HARNESS_URL} target="_blank" rel="noreferrer noopener">
            {t('about.harness')}
          </a>
        </li>
      </ul>
    </div>
  )
}

export { REPO_URL }
