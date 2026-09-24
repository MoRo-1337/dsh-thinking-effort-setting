/**
 * Which settings service the running host exposes.
 *
 * `namespace` is DSH through 0.1.6: sections are read with `get` and changes
 * arrive on `settings/updated`. `entry-config` is 0.1.7 and later: there is
 * no `get`, the resolved value and the user's own layer both come from
 * `describe()`, and changes arrive on `settings/document-updated`.
 */
export type SettingsModel = 'namespace' | 'entry-config'

function method(value: unknown, name: string): ((...args: unknown[]) => unknown) | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  const candidate = Reflect.get(value, name)
  return typeof candidate === 'function' ? candidate as (...args: unknown[]) => unknown : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Detect the settings model from the live service. `undefined` means neither shape is present. */
export function settingsModelOf(settings: unknown): SettingsModel | undefined {
  if (settings === undefined || settings === null) return undefined
  if (method(settings, 'register') !== undefined || method(settings, 'installSection') !== undefined) {
    return 'namespace'
  }
  return method(settings, 'describe') === undefined ? undefined : 'entry-config'
}

/** The event that reports a change to one settings section on this host. */
export function settingsChangeEvent(model: SettingsModel): string {
  return model === 'entry-config' ? 'settings/document-updated' : 'settings/updated'
}

function descriptorOf(settings: unknown, namespace: string): Record<string, unknown> | undefined {
  const describe = method(settings, 'describe')
  if (describe === undefined) return undefined
  try {
    const descriptors = describe.call(settings)
    if (!Array.isArray(descriptors)) return undefined
    return record(descriptors.find(candidate => String(record(candidate)?.ns) === namespace))
  } catch {
    return undefined
  }
}

/**
 * The resolved section. On the namespace model this is `get`; on entry-config
 * it is the descriptor's `value`. A missing or throwing service reads as
 * `undefined`.
 */
export function readSettingsSection(settings: unknown, namespace: string): unknown {
  const get = method(settings, 'get')
  if (get !== undefined) {
    try {
      const value = get.call(settings, namespace)
      if (value !== undefined) return value
    } catch {
      // Fall through to the descriptor.
    }
  }
  return descriptorOf(settings, namespace)?.value
}

/**
 * The user's own layer: only keys they wrote. A path write merges into this
 * layer, so the fill must quote it rather than the resolved section, or the
 * write pins schema defaults (`input`, `compat`, `defaultContextWindow`, …)
 * into the profile.
 */
export function readSettingsSectionUser(settings: unknown, namespace: string): unknown {
  return descriptorOf(settings, namespace)?.user
}
