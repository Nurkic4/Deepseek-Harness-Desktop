/**
 * Desktop shell bridge: the `window.shell` API the Electron preload exposes.
 * Absent outside the desktop app, so every consumer branches on `desktopShell()`.
 */

/** The preload-exposed desktop API surface used by the settings UI. */
export type DesktopShell = {
  getConfig?: () => Promise<{ appVersion?: string }>
}

/**
 * Read the desktop bridge if present.
 * @returns the preload API, or null in a plain browser.
 */
export function desktopShell(): DesktopShell | null {
  if (typeof window === 'undefined') return null
  const api = (window as Window & { shell?: DesktopShell }).shell
  return api && typeof api === 'object' ? api : null
}
