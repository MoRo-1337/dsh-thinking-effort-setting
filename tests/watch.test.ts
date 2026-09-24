import { afterEach, describe, expect, it, vi } from 'vitest'

import { OFFICIAL_LEVELS } from '../src/fill.ts'
import type { HostContext, SettingsPathOp } from '../src/types.ts'
import { installSettingsWatcher, SETTINGS_NAMESPACE } from '../src/watch.ts'

interface Stored {
  providers: Record<string, unknown>
}

function applyOp(section: Stored, op: SettingsPathOp): Stored {
  const [root, route, field] = op.path
  if (root !== 'providers' || route === undefined || field === undefined) return section
  const providers = { ...section.providers }
  const profile = { ...(providers[route] as Record<string, unknown> | undefined) }
  profile[field] = op.value
  providers[route] = profile
  return { providers }
}

function host(initial: Stored | undefined, writable = true) {
  let user = initial === undefined ? undefined : structuredClone(initial)
  const events = new Map<string, (...args: unknown[]) => void>()
  const mutate = vi.fn(async (_namespace: string, ops: readonly SettingsPathOp[]) => {
    if (user === undefined) return
    for (const op of ops) user = applyOp(user, op)
    events.get('settings/document-updated')?.(SETTINGS_NAMESPACE, 2)
  })
  const settings = {
    writable,
    describe: () => user === undefined
      ? []
      : [{ ns: SETTINGS_NAMESPACE, value: user, user }],
    mutate,
  }
  const timers: Array<() => void> = []
  const ctx: HostContext = {
    settings,
    timeout(callback, delay) {
      const handle = setTimeout(callback, delay)
      const dispose = (): void => { clearTimeout(handle) }
      timers.push(dispose)
      return dispose
    },
    on(event, callback) {
      events.set(event, callback)
      return () => { events.delete(event) }
    },
    effect(callback) {
      const dispose = callback()
      return () => { if (typeof dispose === 'function') dispose() }
    },
  }
  return { ctx, mutate, events, read: () => user }
}

describe('installSettingsWatcher', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the official levels once, then settles when the change is visible', async () => {
    vi.useFakeTimers()
    const fixture = host({
      providers: {
        gateway: {
          api: 'openai-completions',
          models: [{ id: 'DeepSeek-V4.1-Flash', name: 'DeepSeek-V4.1-Flash' }],
        },
      },
    })
    installSettingsWatcher(fixture.ctx)
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(0)

    expect(fixture.mutate).toHaveBeenCalledTimes(1)
    const stored = fixture.read()
    const profile = stored?.providers.gateway as { models: Array<Record<string, unknown>>, reasoning: string }
    expect(profile.models[0]?.reasoningEfforts).toEqual({ ...OFFICIAL_LEVELS })
    expect(profile.models[0]?.compat).toEqual({ thinkingFormat: 'deepseek' })
    expect(profile.reasoning).toBe('high')

    await vi.advanceTimersByTimeAsync(10_000)
    expect(fixture.mutate).toHaveBeenCalledTimes(1)
  })

  it('ignores a change to another settings section', async () => {
    vi.useFakeTimers()
    const fixture = host({
      providers: {
        gateway: {
          api: 'openai-completions',
          reasoning: 'high',
          models: [{ id: 'm', reasoningEfforts: { ...OFFICIAL_LEVELS } }],
        },
      },
    })
    installSettingsWatcher(fixture.ctx)
    await vi.advanceTimersByTimeAsync(500)
    expect(fixture.mutate).not.toHaveBeenCalled()

    fixture.events.get('settings/document-updated')?.('llm-deepseek', 3)
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.mutate).not.toHaveBeenCalled()
  })

  it('retries while the section is not readable yet', async () => {
    vi.useFakeTimers()
    const fixture = host(undefined)
    installSettingsWatcher(fixture.ctx)
    await vi.advanceTimersByTimeAsync(500)
    expect(fixture.mutate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000 * 5)
    expect(fixture.mutate).not.toHaveBeenCalled()
  })
})
