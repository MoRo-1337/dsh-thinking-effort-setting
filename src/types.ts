export type UnknownRecord = Record<string, unknown>

/** One path edit. Mirrors the settings service `mutate` op; the fill only sets. */
export interface SettingsPathOp {
  readonly op: 'set'
  readonly path: readonly string[]
  readonly value: unknown
}

export interface HostSettings {
  readonly writable?: unknown
  /** Absent on the 0.1.7 entry-config model, which exposes values through `describe`. */
  readonly get?: (namespace: string) => unknown
  readonly mutate?: (namespace: string, ops: readonly SettingsPathOp[]) => unknown
  readonly describe?: () => unknown
  readonly register?: (namespace: string, schema: unknown, options?: UnknownRecord) => unknown
  readonly installSection?: (...args: unknown[]) => unknown
}

/**
 * The host context this plugin uses. Typed locally so the package does not
 * depend on a second copy of Cordis when a profile disables peer auto-install.
 */
export interface HostContext {
  readonly settings?: HostSettings
  readonly timeout: (callback: () => void, delay: number) => unknown
  readonly on: (
    event: string,
    callback: (...args: unknown[]) => unknown,
  ) => unknown
  readonly effect: (callback: () => void | (() => void), label?: string) => unknown
}

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
