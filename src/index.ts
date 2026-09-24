import type { HostContext } from './types.js'
import { installSettingsWatcher } from './watch.js'

export const name = 'dsh-thinking-effort-setting'
export const inject = ['settings', 'timer'] as const

/**
 * Fill hand-declared `llm-pi-ai` models that have no thinking levels.
 *
 * The composer already renders the official Effort menu — Model, then Effort,
 * then Off / Low / High / Max — once a model declares `reasoningEfforts`.
 * Custom-provider imports declare none, so that row never appears. A map that
 * already has some levels but not `low` hides Low the same way. This plugin
 * adds every missing official level into the user's own settings layer and
 * leaves the composer UI untouched.
 */
export function apply(ctx: HostContext): void {
  installSettingsWatcher(ctx)
}
