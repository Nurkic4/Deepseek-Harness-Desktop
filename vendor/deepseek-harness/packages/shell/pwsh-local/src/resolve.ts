/**
 * PowerShell executable resolution, dependency-free so non-package consumers
 * (the repository's coverage-gate probe in `vitest.config.ts`) can share the
 * ONE resolution definition with the executor and its suites — a probe that
 * resolved differently from the code under test could exempt a file whose
 * suites actually run.
 *
 * @module @deepseek-ai/dsh-pwsh-local/resolve
 */

import { lstatSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Well-known Windows PowerShell install locations plus PATH entries, newest
 * first. Explicitly parameterized (env) so resolution is a pure function of
 * its inputs on every platform.
 * @param env - the environment to probe; defaults to the process environment.
 * @returns candidate `pwsh` executable paths in resolution order.
 */
export function candidatePwshPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files'
  const systemRoot = env.SystemRoot ?? 'C:\\Windows'
  const candidates = [
    join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
  ]
  // Microsoft Store installs (and any user-added location) live on PATH;
  // entries may carry surrounding quotes from `setx`-style definitions.
  for (const entry of (env.PATH ?? '').split(';')) {
    const trimmed = entry.trim().replace(/^"|"$/g, '')
    if (trimmed.length === 0) continue
    candidates.push(join(trimmed, 'pwsh.exe'))
  }
  // Windows PowerShell 5.1 remains the last-resort fallback on legacy hosts.
  candidates.push(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  return candidates
}

/**
 * Well-known Git for Windows Bash locations plus PATH entries that explicitly
 * point at a Git installation. The generic Windows `bash.exe` alias is never
 * used here because it launches WSL rather than Git Bash.
 */
export function candidateGitBashPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files'
  const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const localAppData = env.LOCALAPPDATA
  const candidates = [
    join(programFiles, 'Git', 'bin', 'bash.exe'),
    join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    localAppData ? join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe') : undefined,
  ].filter((candidate): candidate is string => candidate !== undefined)

  for (const entry of (env.PATH ?? '').split(';')) {
    const trimmed = entry.trim().replace(/^"|"$/g, '')
    if (trimmed.length === 0) continue
    if (/\\Git(?:\\|$)/i.test(trimmed) || /\\Git\\(?:cmd|bin)$/i.test(trimmed)) {
      candidates.push(join(trimmed, 'bash.exe'))
      if (/\\cmd$/i.test(trimmed)) candidates.push(join(trimmed, '..', 'bin', 'bash.exe'))
    }
  }
  return [...new Set(candidates)]
}

/**
 * Whether a candidate can be spawned. lstat opens the entry itself instead of
 * following reparse points, so it sees the Store app execution alias where
 * stat hits the target's ACL (EACCES); Node reports that alias as a symlink
 * on current releases and as a plain file on older ones, and CreateProcess
 * resolves either shape. A real directory never matches.
 */
function candidateExists(candidate: string): boolean {
  try {
    const stat = lstatSync(candidate)
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    // ENOENT (the candidate vanished between listing and probing) is the only
    // expected failure; any other error names an unspawnable path, so false
    // is the safe answer for it too.
    return false
  }
}

/**
 * Resolve the pwsh executable this executor spawns.
 * @param configured - an explicit `pwshPath` config value, trusted as-is.
 * @param env - the environment to probe on Windows; defaults to the process environment.
 * @param platform - the platform to resolve for; defaults to the process platform.
 * @returns the first existing well-known location on Windows (PowerShell 7
 *   install, a PATH entry such as the Microsoft Store install, then Windows
 *   PowerShell 5.1), else `pwsh` for PATH resolution.
 */
export function resolvePwshPath(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (configured !== undefined && configured.length > 0) return configured
  if (platform === 'win32') {
    for (const candidate of candidatePwshPaths(env)) {
      if (candidateExists(candidate)) return candidate
    }
  }
  return 'pwsh'
}

/**
 * Resolve Git for Windows Bash without ever falling back to the ambiguous
 * Windows `bash` command (which is commonly the WSL launcher).
 *
 * On non-Windows hosts the normal `bash` lookup remains appropriate. On
 * Windows, an absent installation returns undefined so the executor can emit
 * an actionable error at the Bash call instead of launching WSL accidentally.
 */
export function resolveGitBashPath(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (configured !== undefined && configured.length > 0) return configured
  if (platform !== 'win32') return 'bash'
  for (const candidate of candidateGitBashPaths(env)) {
    if (candidateExists(candidate)) return candidate
  }
  return undefined
}
