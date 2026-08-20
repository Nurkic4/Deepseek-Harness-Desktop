/*
 * Adapted from CloudCLI UI at commit 0d51774:
 * https://github.com/siteboon/claudecodeui
 * Licensed under AGPL-3.0-or-later. This is a modified integration for DSH,
 * not the original CloudCLI UI product. See LICENSE and NOTICE.md here.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export type ComposerMenuAnchor = { right: number; bottom: number; maxHeight: number; maxWidth: number }
const VIEWPORT_MARGIN = 8
const MENU_GAP = 8

export function useComposerMenuAnchor(
  isOpen: boolean,
  onClose: () => void,
  preferredWidth = 320,
  relatedMenuRef?: RefObject<HTMLElement | null>,
) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [anchor, setAnchor] = useState<ComposerMenuAnchor | null>(null)

  const updateAnchor = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const right = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.right)
    setAnchor({
      right,
      bottom: window.innerHeight - rect.top + MENU_GAP,
      maxHeight: Math.max(160, rect.top - MENU_GAP - VIEWPORT_MARGIN),
      maxWidth: Math.max(200, Math.min(preferredWidth, window.innerWidth - right - VIEWPORT_MARGIN)),
    })
  }, [preferredWidth])

  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (
        !triggerRef.current?.contains(target)
        && !menuRef.current?.contains(target)
        && !relatedMenuRef?.current?.contains(target)
      ) onClose()
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', updateAnchor)
    window.addEventListener('scroll', updateAnchor, true)
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    updateAnchor()
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', updateAnchor)
      window.removeEventListener('scroll', updateAnchor, true)
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [isOpen, onClose, relatedMenuRef, updateAnchor])

  return { triggerRef, menuRef, anchor, updateAnchor }
}
