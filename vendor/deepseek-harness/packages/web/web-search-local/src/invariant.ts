/** Package-owned invariant companion for the stateless local search provider. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-web-search-local'

/** Cordis companion plugin name. */
export const name = 'web-search-local-invariant'
/** Service required before package ownership can be registered. */
export const inject = ['invariants']

const install: InvariantInstaller = () => {}

/** Register the package's empty companion because the provider retains no runtime state. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
