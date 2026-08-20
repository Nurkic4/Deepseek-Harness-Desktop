/*
 * Adapted from CloudCLI UI at commit 0d51774:
 * https://github.com/siteboon/claudecodeui
 * Licensed under AGPL-3.0-or-later. This is a modified integration for DSH,
 * not the original CloudCLI UI product. See LICENSE and NOTICE.md here.
 */
import type { ReactNode, Ref } from 'react'
import { Check } from 'lucide-react'
import clsx from 'clsx'
import type { ComposerMenuAnchor } from './useComposerMenuAnchor.ts'
import css from './ComposerModelMenu.module.css'

export function ComposerMenuSurface({ anchor, menuRef, ariaLabel, className, children }: {
  anchor: ComposerMenuAnchor
  menuRef: Ref<HTMLDivElement>
  ariaLabel: string
  className?: string | undefined
  children: ReactNode
}) {
  return (
    <div ref={menuRef} role="menu" aria-label={ariaLabel} className={clsx(css.surface, className)} style={{
      right: anchor.right, bottom: anchor.bottom, maxHeight: anchor.maxHeight, maxWidth: anchor.maxWidth,
    }}>
      {children}
    </div>
  )
}

export function ComposerMenuHeading({ children }: { children: ReactNode }) {
  return <p className={css.heading}>{children}</p>
}

export function ComposerMenuSeparator() {
  return <div className={css.separator} aria-hidden />
}

export function ComposerMenuItem({
  label, description, icon, isSelected, onSelect, role = 'menuitemradio', trailing, className,
  ariaHasPopup, ariaExpanded,
}: {
  label: ReactNode
  description?: ReactNode
  icon?: ReactNode
  isSelected: boolean
  onSelect: () => void
  role?: 'menuitemradio' | 'menuitem'
  trailing?: ReactNode
  className?: string | undefined
  ariaHasPopup?: 'menu' | undefined
  ariaExpanded?: boolean | undefined
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'menuitemradio' ? isSelected : undefined}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      onClick={onSelect}
      className={clsx(css.item, isSelected ? css.selected : css.unselected, className)}
    >
      {icon && <span className={css.icon}>{icon}</span>}
      <span className={css.copy}>
        <span className={css.label}>{label}</span>
        {description && <span className={css.description}>{description}</span>}
      </span>
      <span className={css.trailing}>
        {trailing ?? (isSelected ? <Check className={css.check} /> : null)}
      </span>
    </button>
  )
}
