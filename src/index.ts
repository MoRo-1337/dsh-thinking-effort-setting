import { installInputCommand } from './command.js'
import { installDeepSeekResponsesFetch } from './responses.js'
import type { HostContext } from './types.js'
import { installSettingsWatcher } from './watch.js'

export const name = 'dsh-thinking-effort-setting'
export const inject = ['settings', 'timer', 'commands'] as const

/**
 * Fill hand-declared `llm-pi-ai` models that have no thinking levels.
 *
 * The composer already renders the official Effort menu — Model, then Effort,
 * then Off / Low / High / Max — once a model declares `reasoningEfforts`.
 * Custom-provider imports declare none, so that row never appears. A map that
 * already has some levels but not `low` hides Low the same way. The same
 * imports also omit `input`, so DSH treats the model as text-only and refuses
 * images. This plugin adds every missing official level, and writes image
 * input when the model is known to accept it, into the user's own settings
 * layer. `/input image true` and `/input image false` store an explicit
 * choice for the selected model in that same layer. DeepSeek on
 * `openai-responses` is rewritten per request onto that API's `reasoning.effort`
 * shape, so a tool round that came back without a reasoning item does not
 * turn thinking off for the rest of the session. The composer UI stays the
 * stock one.
 */
export function apply(ctx: HostContext): void {
  installSettingsWatcher(ctx)
  installInputCommand(ctx)
  ctx.effect(() => installDeepSeekResponsesFetch(), 'dsh-thinking-effort-setting: responses')
}
