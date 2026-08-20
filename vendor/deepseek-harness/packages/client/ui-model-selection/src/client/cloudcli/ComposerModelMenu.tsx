/*
 * Adapted from CloudCLI UI at commit 0d51774:
 * https://github.com/siteboon/claudecodeui
 * Licensed under AGPL-3.0-or-later. This is a modified integration for DSH,
 * not the original CloudCLI UI product. See LICENSE and NOTICE.md here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { useComposerMenuAnchor, type ComposerMenuAnchor } from './useComposerMenuAnchor.ts'
import { ComposerMenuHeading, ComposerMenuItem, ComposerMenuSeparator, ComposerMenuSurface } from './ComposerMenuPrimitives.tsx'
import css from './ComposerModelMenu.module.css'

export const DEFAULT_EFFORT_VALUE = '__default__'

export interface ComposerEffortOption {
  value: string
  label?: string
  description?: string
}

export interface ComposerModelOption {
  value: string
  label: string
}

interface ComposerModelMenuProps {
  effort: string
  effortOptions: ComposerEffortOption[]
  onSelectEffort: (effort: string) => void
  model: string
  modelFallback: string
  modelOptions: ComposerModelOption[]
  onSelectModel: (model: string) => void
  modelsLoading: boolean
  disabled?: boolean
  onOpen?: () => void
  labels: { aria: string; defaultEffort: string; reasoning: string; model: string; loadingModels: string }
}

export default function ComposerModelMenu({
  effort, effortOptions, onSelectEffort, model, modelFallback, modelOptions,
  onSelectModel, modelsLoading, disabled = false, onOpen, labels,
}: ComposerModelMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [modelMenuAnchor, setModelMenuAnchor] = useState<ComposerMenuAnchor | null>(null)
  const modelOwnerRef = useRef<HTMLDivElement | null>(null)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const closeModelTimer = useRef<number | null>(null)
  const close = useCallback(() => { setIsOpen(false) }, [])
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 320, modelMenuRef)

  useEffect(() => {
    if (!isOpen) setModelMenuAnchor(null)
  }, [isOpen])

  useEffect(() => () => {
    if (closeModelTimer.current !== null) window.clearTimeout(closeModelTimer.current)
  }, [])

  const cancelModelClose = useCallback(() => {
    if (closeModelTimer.current === null) return
    window.clearTimeout(closeModelTimer.current)
    closeModelTimer.current = null
  }, [])

  const closeModelMenuSoon = useCallback(() => {
    cancelModelClose()
    closeModelTimer.current = window.setTimeout(() => {
      closeModelTimer.current = null
      setModelMenuAnchor(null)
    }, 140)
  }, [cancelModelClose])

  const openModelMenu = useCallback(() => {
    cancelModelClose()
    const rect = modelOwnerRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const viewportMargin = 8
    const gap = 4
    const preferredWidth = 280
    const spaceOnRight = window.innerWidth - rect.right - gap - viewportMargin
    const opensRight = spaceOnRight >= 192
    const right = opensRight
      ? Math.max(viewportMargin, window.innerWidth - rect.right - gap - preferredWidth)
      : Math.max(viewportMargin, window.innerWidth - rect.left + gap)
    setModelMenuAnchor({
      right,
      bottom: Math.max(viewportMargin, window.innerHeight - rect.bottom),
      maxHeight: Math.max(160, rect.bottom - viewportMargin),
      maxWidth: Math.max(192, Math.min(preferredWidth, opensRight ? spaceOnRight : rect.left - gap - viewportMargin)),
    })
  }, [cancelModelClose])

  useEffect(() => {
    if (modelMenuAnchor === null) return
    const update = (): void => { openModelMenu() }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [modelMenuAnchor !== null, openModelMenu])

  const resolvedEffortOptions = useMemo<ComposerEffortOption[]>(
    () => (effortOptions.length > 0 ? [{ value: DEFAULT_EFFORT_VALUE }, ...effortOptions] : []),
    [effortOptions],
  )
  const effortLabel = effort === DEFAULT_EFFORT_VALUE
    ? labels.defaultEffort
    : effortOptions.find(option => option.value === effort)?.label ?? effort
  const selectedModelOption = useMemo(
    () => modelOptions.find(option => option.value === model) ?? null,
    [model, modelOptions],
  )
  const modelLabel = selectedModelOption?.label || modelFallback
  const hasEffortSection = resolvedEffortOptions.length > 0
  const hasModelSection = modelOptions.length > 0 || modelsLoading
  if (!hasEffortSection && !hasModelSection) return null

  const triggerLabel = hasModelSection ? modelLabel : effortLabel
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updateAnchor()
          setIsOpen((current) => {
            if (!current) onOpen?.()
            return !current
          })
        }}
        className={css.trigger}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={labels.aria}
        title={labels.aria}
        disabled={disabled}
      >
        <span className={css.triggerLabel}>{triggerLabel}</span>
        {hasModelSection && hasEffortSection && effort !== DEFAULT_EFFORT_VALUE && (
          <span className={css.triggerEffort}>· {effortLabel}</span>
        )}
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={labels.aria}>
          {hasEffortSection && (
            <>
              <ComposerMenuHeading>{labels.reasoning}</ComposerMenuHeading>
              {resolvedEffortOptions.map(option => (
                <ComposerMenuItem
                  key={option.value}
                  label={option.value === DEFAULT_EFFORT_VALUE ? labels.defaultEffort : option.label ?? option.value}
                  description={option.description}
                  isSelected={option.value === effort}
                  onSelect={() => { onSelectEffort(option.value); setIsOpen(false) }}
                  className={css.capitalize}
                />
              ))}
            </>
          )}

          {hasModelSection && (
            <>
              {hasEffortSection && <ComposerMenuSeparator />}
              <div
                ref={modelOwnerRef}
                role="none"
                className={css.modelOwner}
                onPointerEnter={openModelMenu}
                onPointerLeave={closeModelMenuSoon}
                onFocusCapture={openModelMenu}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeModelMenuSoon()
                }}
              >
                <ComposerMenuItem
                  role="menuitem"
                  label={modelLabel}
                  isSelected={false}
                  onSelect={openModelMenu}
                  trailing={<ChevronRight className={css.chevron} />}
                  className={css.muted}
                  ariaHasPopup="menu"
                  ariaExpanded={modelMenuAnchor !== null}
                />
                {modelMenuAnchor !== null && createPortal(
                  <ComposerMenuSurface
                    anchor={modelMenuAnchor}
                    menuRef={modelMenuRef}
                    ariaLabel={labels.model}
                    className={css.modelSurface}
                  >
                    <ComposerMenuHeading>{labels.model}</ComposerMenuHeading>
                    {modelOptions.length === 0 && modelsLoading && <p className={css.loading}>{labels.loadingModels}</p>}
                    {modelOptions.map(option => (
                      <ComposerMenuItem
                        key={option.value}
                        label={option.label || option.value}
                        isSelected={option.value === model}
                        onSelect={() => {
                          onSelectModel(option.value)
                          setModelMenuAnchor(null)
                          setIsOpen(false)
                        }}
                      />
                    ))}
                  </ComposerMenuSurface>,
                  document.body,
                )}
              </div>
            </>
          )}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  )
}
