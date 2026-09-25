import { discoveryKey, imageInputToWrite, type Modality } from './input.js'
import { isRecord, type SettingsPathOp, type UnknownRecord } from './types.js'

/**
 * The four levels the official composer menu shows, in escalation order.
 *
 * Keys are the menu ids. Values are the `reasoning_effort` spellings. `off`
 * is null on purpose: pi-ai treats a missing `off` mapping as "supported,
 * send nothing", and with `thinkingFormat: deepseek` that absence is what
 * makes Off send `thinking: {type: disabled}`.
 *
 * Undeclared levels (`minimal`, `medium`, `xhigh`) are pinned to null by
 * llm-pi-ai, so the menu is exactly Off, Low, High, Max — the same four the
 * built-in DeepSeek route offers.
 */
export const OFFICIAL_LEVELS: Readonly<Record<string, string | null>> = Object.freeze({
  off: null,
  low: 'low',
  high: 'high',
  max: 'max',
})

/** Route default. Present so the menu has no extra "Default" row, and new sessions start on High. */
export const DEFAULT_REASONING = 'high'

/** Wire protocol that accepts `compat.thinkingFormat`. Other protocols reject the field and drop the route. */
const COMPLETIONS_API = 'openai-completions'

/** pi-ai escalation order. Base levels with no map entry stay selectable; `xhigh` and `max` do not. */
const ESCALATION = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * Menu ids llm-pi-ai would advertise for this effort map.
 *
 * This mirrors `resolveModelReasoning` plus `getSupportedThinkingLevels`: an
 * empty `off` stays out of the map and remains selectable, every other
 * omitted level is pinned unsupported, and `max` appears only because it is
 * declared. The official labels are these ids with the first letter capitalized.
 */
export function selectableEffortIds(
  efforts: Readonly<Record<string, string | null>>,
): readonly string[] {
  const map = new Map<string, string | null>()
  for (const level of ESCALATION) {
    const wire = efforts[level]
    if (wire === undefined) map.set(level, null)
    else if (wire !== null) map.set(level, wire)
  }
  return ESCALATION.filter((level) => {
    const mapped = map.get(level)
    if (mapped === null) return false
    if (level === 'xhigh' || level === 'max') return mapped !== undefined
    return true
  })
}

/** The minimal path edits one fill performs, and how many models they cover. */
export interface ProviderDefaultsResult {
  readonly ops: readonly SettingsPathOp[]
  readonly filled: number
  readonly reasoningSet: number
  /** Models that gained `input: [text, image]` on this pass. */
  readonly inputsSet: number
  readonly skipped: SkippedDefaults
}

/**
 * Work a fill could see but could not write. A model that exists only in a
 * lower settings layer cannot be copied into the user layer: a `models` array
 * is replaced wholesale, so materializing that entry would drop the lower
 * layer's `name`, `input`, and `compat`.
 */
interface SkippedDefaults {
  /** Resolved models that still lack `reasoningEfforts`. */
  missing: number
  /** Of those, the ones the user's own layer does not carry. */
  unmatched: number
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function effortsOf(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined
}

function supportsLevel(efforts: unknown, level: string): boolean {
  const record = effortsOf(efforts)
  return record !== undefined && record[level] !== undefined
}

function thinkingFormatOf(value: unknown): unknown {
  return isRecord(value) ? value.thinkingFormat : undefined
}

function hasThinkingFormat(profile: UnknownRecord | undefined): boolean {
  const format = thinkingFormatOf(profile?.compat)
  return format !== undefined && format !== null
}

/** DeepSeek behind an OpenAI-compatible gateway thinks unless `thinking` is sent. */
function isDeepSeekModel(userEntry: UnknownRecord, resolved: UnknownRecord | undefined): boolean {
  return [userEntry.id, userEntry.name, resolved?.id, resolved?.name]
    .some(part => typeof part === 'string' && /deepseek/i.test(part))
}

function profileApi(userProfile: UnknownRecord | undefined, resolved: UnknownRecord): string {
  const fromUser = text(userProfile?.api)
  if (fromUser.length > 0) return fromUser
  return text(resolved.api)
}

/**
 * Whether this model should gain `compat.thinkingFormat: deepseek`.
 *
 * Only `openai-completions` accepts the field. A route or model that already
 * names a format keeps it. The user's own compat object is what gets the
 * key — resolved compat carries schema defaults that must not be pinned.
 */
function needsDeepSeekFormat(
  userEntry: UnknownRecord,
  resolved: UnknownRecord | undefined,
  userProfile: UnknownRecord | undefined,
  resolvedProfile: UnknownRecord,
): boolean {
  if (profileApi(userProfile, resolvedProfile) !== COMPLETIONS_API) return false
  if (!isDeepSeekModel(userEntry, resolved)) return false
  if (hasThinkingFormat(userProfile) || hasThinkingFormat(resolvedProfile)) return false
  if (thinkingFormatOf(userEntry.compat) !== undefined) return false
  if (thinkingFormatOf(resolved?.compat) !== undefined) return false
  return true
}

/**
 * The official four levels, with any wire spelling already stored left as it is.
 *
 * A map of only `off` / `high` / `max` is what the menu in the screenshot
 * shows: llm-pi-ai pins every missing level to unsupported, so Low disappears.
 * Adding the missing keys is enough. Replacing the whole map would discard a
 * gateway spelling such as `high: ultra`.
 */
function withMissingOfficialLevels(existing: UnknownRecord | undefined): { readonly efforts: UnknownRecord, readonly changed: boolean } {
  const efforts: UnknownRecord = existing === undefined ? {} : { ...existing }
  let changed = false
  for (const [level, wire] of Object.entries(OFFICIAL_LEVELS)) {
    if (efforts[level] !== undefined) continue
    efforts[level] = wire
    changed = true
  }
  return { efforts, changed }
}

function withOfficialLevels(
  userEntry: UnknownRecord,
  efforts: UnknownRecord,
  thinkingFormat: boolean,
  input: readonly Modality[] | undefined,
): UnknownRecord {
  const next: UnknownRecord = { ...userEntry, reasoningEfforts: efforts }
  if (thinkingFormat) {
    const compat = isRecord(userEntry.compat) ? { ...userEntry.compat } : {}
    compat.thinkingFormat = 'deepseek'
    next.compat = compat
  }
  if (input !== undefined) next.input = [...input]
  return next
}

interface ModelRewrite {
  readonly models: unknown[]
  /** Models that gained the official level set on this pass. */
  readonly filled: number
  /** Models that gained image input on this pass. */
  readonly inputsSet: number
  /** True when the user-layer array itself must be written. */
  readonly changed: boolean
  /** Efforts each user-layer model will have after this rewrite. `false` opts out. */
  readonly efforts: readonly unknown[]
}

function inputFor(
  route: string,
  userEntry: UnknownRecord,
  resolved: UnknownRecord | undefined,
  discovered: ReadonlyMap<string, readonly Modality[]> | undefined,
): readonly Modality[] | undefined {
  return imageInputToWrite(userEntry, resolved, discovered?.get(discoveryKey(route, text(userEntry.id))))
}

/**
 * Rewrite the user's model array where a level or image input is missing.
 *
 * The array is written whole. The older settings service walks paths through
 * plain objects only, so a numeric index would replace the array with an
 * object. Entries past the user's own list are counted and left alone.
 */
function rewriteModels(
  route: string,
  userModels: readonly unknown[],
  resolvedModels: readonly unknown[],
  userProfile: UnknownRecord | undefined,
  resolvedProfile: UnknownRecord,
  discovered: ReadonlyMap<string, readonly Modality[]> | undefined,
  skipped: SkippedDefaults,
): ModelRewrite {
  const models = [...userModels]
  const efforts: unknown[] = []
  let filled = 0
  let inputsSet = 0
  let changed = false

  userModels.forEach((userEntry, index) => {
    const resolved = isRecord(resolvedModels[index]) ? resolvedModels[index] : undefined
    if (!isRecord(userEntry)) {
      if (resolved?.reasoningEfforts === undefined) {
        skipped.missing += 1
        skipped.unmatched += 1
      }
      efforts.push(undefined)
      return
    }
    const declared = resolved?.reasoningEfforts ?? userEntry.reasoningEfforts
    const input = inputFor(route, userEntry, resolved, discovered)
    // `false` is an explicit opt-out of reasoning. Leave the levels, and do not add a thinking dialect.
    if (declared === false) {
      efforts.push(false)
      if (input !== undefined) {
        models[index] = { ...userEntry, input: [...input] }
        inputsSet += 1
        changed = true
      }
      return
    }
    const stored = effortsOf(userEntry.reasoningEfforts) ?? effortsOf(declared)
    const merged = withMissingOfficialLevels(stored)
    const thinkingFormat = needsDeepSeekFormat(userEntry, resolved, userProfile, resolvedProfile)
    if (merged.changed) skipped.missing += 1
    if (merged.changed || thinkingFormat || input !== undefined) {
      models[index] = withOfficialLevels(userEntry, merged.efforts, thinkingFormat, input)
      if (merged.changed) filled += 1
      if (input !== undefined) inputsSet += 1
      changed = true
    }
    efforts.push(merged.efforts)
  })

  for (const resolved of resolvedModels.slice(userModels.length)) {
    if (!isRecord(resolved) || resolved.reasoningEfforts !== undefined) continue
    skipped.missing += 1
    skipped.unmatched += 1
  }

  return { models, filled, inputsSet, changed, efforts }
}

function countUnreachable(resolvedModels: readonly unknown[], skipped: SkippedDefaults): void {
  for (const resolved of resolvedModels) {
    if (isRecord(resolved) && resolved.reasoningEfforts !== undefined) continue
    skipped.missing += 1
    skipped.unmatched += 1
  }
}

/**
 * Path edits that give every hand-declared model the official four levels,
 * and image input when that model is known to accept images.
 *
 * `providers` is the resolved section and decides where a level is missing.
 * `user` is the user's own layer and is the only value a payload may quote.
 * `discovered` carries modality lists read from a route's model listing.
 * Catalog `modelOverrides` are left alone: writing `reasoningEfforts` there
 * would replace the installed catalog's own thinking map.
 */
export function fillProviderDefaults(
  providers: unknown,
  user: unknown,
  discovered?: ReadonlyMap<string, readonly Modality[]>,
): ProviderDefaultsResult {
  const skipped: SkippedDefaults = { missing: 0, unmatched: 0 }
  if (!isRecord(providers)) return { ops: [], filled: 0, reasoningSet: 0, inputsSet: 0, skipped }

  const userProviders = isRecord(user) ? user : undefined
  const ops: SettingsPathOp[] = []
  let filled = 0
  let reasoningSet = 0
  let inputsSet = 0

  for (const [route, rawProfile] of Object.entries(providers)) {
    if (!isRecord(rawProfile)) continue
    const userProfile = isRecord(userProviders?.[route]) ? userProviders[route] : undefined
    const resolvedModels = Array.isArray(rawProfile.models) ? rawProfile.models : undefined
    const userModels = Array.isArray(userProfile?.models) ? userProfile.models : undefined

    let efforts: readonly unknown[] = []
    if (resolvedModels !== undefined && userModels !== undefined) {
      const rewritten = rewriteModels(route, userModels, resolvedModels, userProfile, rawProfile, discovered, skipped)
      efforts = rewritten.efforts
      if (rewritten.changed) {
        ops.push({ op: 'set', path: ['providers', route, 'models'], value: rewritten.models })
        filled += rewritten.filled
        inputsSet += rewritten.inputsSet
      }
    } else if (resolvedModels !== undefined) {
      countUnreachable(resolvedModels, skipped)
    }

    const reasoning = rawProfile.reasoning ?? userProfile?.reasoning
    const everyModelSupportsHigh = efforts.length > 0 && efforts.every(level => supportsLevel(level, DEFAULT_REASONING))
    if (reasoning === undefined && everyModelSupportsHigh) {
      ops.push({ op: 'set', path: ['providers', route, 'reasoning'], value: DEFAULT_REASONING })
      reasoningSet += 1
    }
  }

  return { ops, filled, reasoningSet, inputsSet, skipped }
}
