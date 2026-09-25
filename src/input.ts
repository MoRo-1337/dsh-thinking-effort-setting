import { isRecord, type UnknownRecord } from './types.js'

/** Modalities a pi-ai model entry may declare. Anything else is refused by the route schema. */
export type Modality = 'text' | 'image'

/** The input list that lets the composer attach images and the adapter send them. */
export const TEXT_AND_IMAGE: readonly Modality[] = ['text', 'image']

/**
 * What a model id is known to accept when its endpoint listing says nothing.
 *
 * `image` and `text` are positive answers. `unknown` means this table has no
 * fact, so the caller leaves `input` unset and DSH keeps the text default.
 */
export type KnownInput = 'image' | 'text' | 'unknown'

/**
 * A non-empty modality list the user actually wrote.
 *
 * An empty list is the settings schema's stand-in for "not set". Treating it
 * as a declaration would pin text-only onto a model the user never chose.
 */
export function declaredInput(value: unknown): readonly Modality[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const found: Modality[] = []
  for (const item of value) {
    if (item !== 'text' && item !== 'image') return undefined
    if (!found.includes(item)) found.push(item)
  }
  const ordered: Modality[] = []
  if (found.includes('text')) ordered.push('text')
  if (found.includes('image')) ordered.push('image')
  return ordered
}

function blob(id: unknown, name: unknown): string {
  const left = typeof id === 'string' ? id : ''
  const right = typeof name === 'string' ? name : ''
  return `${left} ${right}`.toLowerCase()
}

/**
 * DeepSeek's published input split, matched on the model id or display name.
 *
 * V4.1 Flash accepts images. The current first-party id is `deepseek-flash`;
 * `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are legacy aliases of
 * that same model, and third-party gateways spell it `deepseek-v4.1-flash`.
 * V4 Pro does not accept images. Older ids such as `deepseek-chat` are not in
 * this table.
 */
export function knownInput(id: unknown, name: unknown): KnownInput {
  const text = blob(id, name)
  if (!text.includes('deepseek')) return 'unknown'
  if (/vision|[-_/]vl\b|\bvl[-_/]/.test(text)) return 'image'
  if (/(^|[^a-z0-9])pro([^a-z0-9]|$)/.test(text)) return 'text'
  if (/\bdeepseek-flash\b/.test(text)) return 'image'
  if (/v4\.1/.test(text) && /flash/.test(text)) return 'image'
  if (/v41/.test(text) && /flash/.test(text)) return 'image'
  if (/deepseek-v4-flash\b/.test(text)) return 'image'
  return 'unknown'
}

/** Whether a hand-declared model still needs its endpoint's model list. */
export function modelNeedsListing(entry: UnknownRecord): boolean {
  if (declaredInput(entry.input) !== undefined) return false
  return knownInput(entry.id, entry.name) === 'unknown'
}

function record(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined
}

/**
 * Read one disclosed modality list.
 *
 * `file`, `pdf`, `audio`, and `video` count as a disclosure but are not written:
 * pi-ai only accepts `text` and `image`. A list that names neither text nor
 * image, yet names some other modality, is text. An unrecognized list is
 * `undefined`, which means the entry did not say.
 */
function modalityList(value: unknown): readonly Modality[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const found = new Set<Modality>()
  let disclosed = false
  for (const item of value) {
    if (typeof item !== 'string') continue
    const token = item.trim().toLowerCase()
    if (token === 'text' || token === 'image') {
      disclosed = true
      found.add(token)
    } else if (token === 'vision') {
      disclosed = true
      found.add('image')
    } else if (token === 'file' || token === 'pdf' || token === 'audio' || token === 'video') {
      disclosed = true
    }
  }
  if (!disclosed) return undefined
  const ordered: Modality[] = []
  if (found.has('text') || found.has('image')) ordered.push('text')
  if (found.has('image')) ordered.push('image')
  return ordered.length > 0 ? ordered : ['text']
}

/** OpenRouter's `text+image+file->text` spelling. */
function modalityString(value: unknown): readonly Modality[] | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const inputSide = value.split('->')[0]?.trim() ?? ''
  if (inputSide.length === 0) return undefined
  return modalityList(inputSide.split('+'))
}

/**
 * Modalities one model-list entry discloses, or `undefined` when it discloses none.
 *
 * A text-only disclosure is returned as `['text']` so it can override the
 * DeepSeek table. Boolean vision flags are used only when no list is present.
 */
export function modalitiesFromListingEntry(entry: unknown): readonly Modality[] | undefined {
  const row = record(entry)
  if (row === undefined) return undefined
  const architecture = record(row.architecture)
  const modalities = record(row.modalities)
  const capabilities = record(row.capabilities)
  for (const list of [architecture?.input_modalities, modalities?.input, row.input_modalities, row.input]) {
    const parsed = modalityList(list)
    if (parsed !== undefined) return parsed
  }
  const fromArchitecture = modalityString(architecture?.modality)
  if (fromArchitecture !== undefined) return fromArchitecture
  if (row.supports_vision === true || row.vision === true || capabilities?.vision === true) return TEXT_AND_IMAGE
  if (row.supports_vision === false || row.vision === false || capabilities?.vision === false) return ['text']
  return undefined
}

function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/**
 * Index a `GET /models` body by the id a hand-declared model uses.
 *
 * Entries that disclose nothing are omitted. A slash-qualified id also indexes
 * its last segment, so `deepseek/deepseek-v4.1-flash` answers `deepseek-v4.1-flash`.
 */
export function indexListing(body: unknown): ReadonlyMap<string, readonly Modality[]> {
  const map = new Map<string, readonly Modality[]>()
  const listing = record(body)
  const data = listing?.data
  const rows: Array<{ key?: string, raw: unknown }> = []
  if (Array.isArray(data)) {
    for (const raw of data) rows.push({ raw })
  } else {
    const models = record(listing?.models)
    if (models !== undefined) {
      for (const [key, raw] of Object.entries(models)) {
        if (record(raw) !== undefined) rows.push({ key, raw })
      }
    }
  }
  for (const row of rows) {
    const entry = record(row.raw)
    const modalities = modalitiesFromListingEntry(entry)
    if (modalities === undefined) continue
    const id = label(row.key, entry?.id)
    if (id === undefined) continue
    map.set(id, modalities)
    const slash = id.lastIndexOf('/')
    if (slash >= 0 && slash < id.length - 1 && !map.has(id.slice(slash + 1))) {
      map.set(id.slice(slash + 1), modalities)
    }
  }
  return map
}

/** Settings key for one route's disclosed answer about one model id. */
export function discoveryKey(route: string, id: string): string {
  return `${route}\0${id}`
}

/**
 * The `input` value to write, or `undefined` when the entry must be left alone.
 *
 * A list the user wrote wins, including an explicit text-only list. A listing
 * that disclosed modalities wins over the DeepSeek table, including a text-only
 * disclosure. Image input is skipped when the resolved entry already accepts
 * images, so a catalog fact is not pinned into the user document.
 */
export function imageInputToWrite(
  userEntry: UnknownRecord,
  resolved: UnknownRecord | undefined,
  listed: readonly Modality[] | undefined,
): readonly Modality[] | undefined {
  if (declaredInput(userEntry.input) !== undefined) return undefined
  const image = listed !== undefined
    ? listed.includes('image')
    : knownInput(userEntry.id, userEntry.name) === 'image' || knownInput(resolved?.id, resolved?.name) === 'image'
  if (!image) return undefined
  if (declaredInput(resolved?.input)?.includes('image') === true) return undefined
  return TEXT_AND_IMAGE
}
