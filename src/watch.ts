import { AsyncResource } from 'node:async_hooks'

import { settingsEpoch } from './epoch.js'
import { fillProviderDefaults } from './fill.js'
import { discoverRouteInputs } from './probe.js'
import { readSettingsSection, readSettingsSectionUser, settingsChangeEvent, settingsModelOf } from './settings-model.js'
import { isRecord, type HostContext, type HostSettings } from './types.js'

export const SETTINGS_NAMESPACE = 'llm-pi-ai'
const LOG_PREFIX = '[dsh-thinking-effort-setting]'

/**
 * Most fill passes one trigger may run before it stops re-running itself.
 *
 * A healthy host needs two: the write raises the change event, and the queued
 * pass re-reads the filled section and finds nothing to do. A host whose write
 * never becomes observable would otherwise spin, so the count is bounded.
 */
const MAX_FILL_PASSES = 5

function log(...args: unknown[]): void {
  console.log(LOG_PREFIX, ...args)
}

interface FillOutcome {
  readonly filled: number
  /**
   * Models still missing a level that a later attempt could reach.
   * `undefined` means the section was not readable yet. `0` settles the chain.
   */
  readonly remaining?: number
}

function readUserProviders(settings: HostSettings): { readonly providers: unknown, readonly readable: boolean } {
  const user = readSettingsSectionUser(settings, SETTINGS_NAMESPACE)
  if (!isRecord(user)) return { providers: undefined, readable: false }
  return { providers: user.providers, readable: true }
}

const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

async function resolveApiKey(ctx: HostContext, name: string): Promise<string | undefined> {
  if (!KEY_NAME.test(name)) return undefined
  const get = ctx.get
  if (typeof get === 'function') {
    try {
      const service = get.call(ctx, 'credentials') as { resolve?: (ref: string) => Promise<{ value?: string } | undefined> } | undefined
      if (typeof service?.resolve === 'function') {
        const hit = await service.resolve(name)
        if (typeof hit?.value === 'string' && hit.value.trim().length > 0) return hit.value.trim()
      }
    } catch {
      // A credentials service that throws reads as "no stored key". A public listing can still answer.
    }
  }
  const fromEnv = process.env[name]
  return typeof fromEnv === 'string' && fromEnv.trim().length > 0 ? fromEnv.trim() : undefined
}

async function fillDefaults(settings: HostSettings, ctx: HostContext): Promise<FillOutcome> {
  if (settings.writable !== true) return { filled: 0 }
  const notYet: FillOutcome = { filled: 0 }

  const section = readSettingsSection(settings, SETTINGS_NAMESPACE)
  if (!isRecord(section)) return notYet

  const user = readUserProviders(settings)
  // Resolved and user-layer reads are separate calls. An unreadable user
  // layer makes every entry look unreachable, which is a retry, not a verdict.
  if (!user.readable) return notYet

  const seenEpoch = settingsEpoch()
  const discovered = await discoverRouteInputs(
    section.providers,
    user.providers,
    name => resolveApiKey(ctx, name),
  )
  for (const warning of discovered.warnings) log(warning)

  const result = fillProviderDefaults(section.providers, user.providers, discovered.modalities)
  if (result.skipped.unmatched > 0) {
    log(
      'left', result.skipped.unmatched, 'model(s) unfilled: they come from a lower settings layer,',
      'and a models-array write cannot address them without pinning that layer',
    )
  }
  const reachable = result.skipped.missing - result.skipped.unmatched
  if (result.ops.length === 0) return { filled: 0, remaining: reachable }

  const mutate = settings.mutate
  if (typeof mutate !== 'function') {
    log('settings service cannot address paths; left', result.filled, 'model(s) unfilled')
    return { filled: 0, remaining: reachable }
  }

  // `/input` may have stored a choice while this pass was reading. Writing the
  // older list would drop that choice, so leave it for the pass that follows.
  if (settingsEpoch() !== seenEpoch) return { filled: 0, remaining: reachable > 0 ? reachable : 1 }

  await mutate.call(settings, SETTINGS_NAMESPACE, result.ops)
  const parts = [
    result.filled > 0 ? `filled official thinking levels for ${result.filled} model(s)` : '',
    result.reasoningSet > 0 ? `set the route default to ${result.reasoningSet} provider(s)` : '',
    result.inputsSet > 0 ? `marked image input for ${result.inputsSet} model(s)` : '',
  ].filter(part => part.length > 0)
  log(parts.join('; '))
  return { filled: result.filled + result.reasoningSet + result.inputsSet, remaining: reachable }
}

/** Watch `llm-pi-ai` and fill hand-declared models that have no thinking levels. */
export function installSettingsWatcher(ctx: HostContext): void {
  const settings = ctx.settings
  if (settings === undefined || settingsModelOf(settings) === undefined) {
    log('settings capability unavailable')
    return
  }

  ctx.effect(() => {
    let alive = true
    let retries = 0
    let inFlight = false
    let queued = false
    let current: Promise<FillOutcome> = Promise.resolve({ filled: 0 })
    const timerDisposers: Array<() => void> = []

    /**
     * The context the fill's write runs in.
     *
     * On 0.1.7 the change event is raised from inside the write that caused
     * it, while the host still holds its HMR transaction. A listener that
     * writes back is refused with "HMR transactions cannot be nested", and so
     * is a timer created inside that transaction. This resource is created
     * when the plugin applies, outside the transaction, so the write is accepted.
     */
    const fillScope = new AsyncResource('dsh-thinking-effort-setting:settings-fill')

    const runFill = (): Promise<FillOutcome> => {
      if (inFlight) {
        queued = true
        return current
      }
      inFlight = true
      let finish: (outcome: FillOutcome) => void = () => {}
      let fail: (error: unknown) => void = () => {}
      const run = new Promise<FillOutcome>((resolve, reject) => {
        finish = resolve
        fail = reject
      })
      current = run
      void (async () => {
        try {
          let outcome: FillOutcome = { filled: 0 }
          let passes = 0
          do {
            queued = false
            outcome = await fillDefaults(settings, ctx)
            passes += 1
          } while (alive && queued && passes < MAX_FILL_PASSES)
          if (alive && queued) {
            queued = false
            log('stopped the fill after', passes, 'passes: the settings change never settled')
          }
          finish(outcome)
        } catch (error) {
          fail(error)
        } finally {
          inFlight = false
        }
      })()
      return run
    }

    const schedule = (delay: number): void => {
      if (!alive) return
      const disposer = ctx.timeout(() => {
        if (!alive) return
        void tryOnce()
      }, delay)
      if (typeof disposer === 'function') timerDisposers.push(() => { disposer() })
    }

    const tryOnce = async (): Promise<void> => {
      if (!alive) return
      let settled = false
      let outcome: FillOutcome = { filled: 0, remaining: 0 }
      try {
        outcome = await runFill()
        settled = true
        if (outcome.filled > 0) return
      } catch (error) {
        if (!alive) return
        log('fill error:', error instanceof Error ? error.message : String(error))
      }
      if (!alive) return
      if (settled && outcome.remaining === 0) return
      retries += 1
      if (retries <= 5) schedule(2000)
    }

    schedule(500)

    const model = settingsModelOf(settings)
    let listenerDispose: (() => void) | undefined
    if (model !== undefined) {
      const disposer = ctx.on(settingsChangeEvent(model), (...args: unknown[]) => {
        if (!alive || args[0] !== SETTINGS_NAMESPACE) return
        void fillScope.runInAsyncScope(() => runFill()).catch((error: unknown) => {
          if (alive) log('watch fill error:', error instanceof Error ? error.message : String(error))
        })
      })
      if (typeof disposer === 'function') listenerDispose = () => { disposer() }
    }

    return () => {
      alive = false
      for (const dispose of timerDisposers.splice(0)) dispose()
      listenerDispose?.()
    }
  }, 'dsh-thinking-effort-setting: settings watcher')
}
