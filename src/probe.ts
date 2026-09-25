import {
  discoveryKey,
  indexListing,
  modelNeedsListing,
  type Modality,
} from './input.js'
import { isRecord, type UnknownRecord } from './types.js'

/** Largest model list this plugin will read. A bigger body is treated as no disclosure. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/** How long a listing answer, including a failure, is reused. */
const CACHE_TTL_MS = 10 * 60 * 1000

const LISTABLE = new Set(['openai-completions', 'openai-responses', 'anthropic-messages'])

interface CacheEntry {
  readonly expires: number
  readonly listing: ReadonlyMap<string, readonly Modality[]>
}

const cache = new Map<string, CacheEntry>()

/** Drop cached listings. Tests use this so one case cannot answer the next. */
export function clearListingCache(): void {
  cache.clear()
}

export interface DiscoveryResult {
  /** Keyed by {@link discoveryKey}. Absent means the listing did not classify that model. */
  readonly modalities: ReadonlyMap<string, readonly Modality[]>
  readonly warnings: readonly string[]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function field(user: UnknownRecord | undefined, resolved: UnknownRecord, key: string): string {
  const fromUser = text(user?.[key])
  if (fromUser.length > 0) return fromUser
  return text(resolved[key])
}

function listingUrl(baseURL: string, api: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(baseURL)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
  const base = baseURL.replace(/\/+$/, '')
  if (api === 'anthropic-messages') {
    const root = base.endsWith('/v1') ? base.slice(0, -3) : base
    return `${root}/v1/models?limit=1000`
  }
  if (!LISTABLE.has(api) && api.length > 0) return undefined
  return `${base}/models`
}

function usableKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const value = raw.trim()
  if (value.length === 0) return undefined
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 255) return undefined
  }
  return value
}

async function readBounded(response: Response): Promise<string | undefined> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    return undefined
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) return undefined
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {
      // The body is already decided; cancelling a finished read is cleanup.
    })
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

interface RouteQuery {
  readonly route: string
  readonly url: string
  readonly api: string
  readonly apiKeyEnv: string
  readonly ids: readonly string[]
}

function routesToQuery(providers: unknown, user: unknown): readonly RouteQuery[] {
  if (!isRecord(providers) || !isRecord(user)) return []
  const queries: RouteQuery[] = []
  for (const [route, rawProfile] of Object.entries(providers)) {
    if (!isRecord(rawProfile)) continue
    const userProfile = isRecord(user[route]) ? user[route] : undefined
    const userModels = Array.isArray(userProfile?.models) ? userProfile.models : undefined
    if (userModels === undefined) continue
    const ids = userModels.flatMap(entry => {
      if (!isRecord(entry) || !modelNeedsListing(entry)) return []
      const id = text(entry.id)
      return id.length > 0 ? [id] : []
    })
    if (ids.length === 0) continue
    const api = field(userProfile, rawProfile, 'api')
    const url = listingUrl(field(userProfile, rawProfile, 'baseURL'), api)
    if (url === undefined) continue
    queries.push({
      route,
      url,
      api,
      apiKeyEnv: field(userProfile, rawProfile, 'apiKeyEnv'),
      ids,
    })
  }
  return queries
}

async function loadListing(
  query: RouteQuery,
  resolveKey: (name: string) => Promise<string | undefined>,
  fetchImpl: typeof fetch,
  warnings: string[],
): Promise<ReadonlyMap<string, readonly Modality[]>> {
  const cached = cache.get(query.url)
  if (cached !== undefined && cached.expires > Date.now()) return cached.listing

  const empty = new Map<string, readonly Modality[]>()
  const remember = (listing: ReadonlyMap<string, readonly Modality[]>): ReadonlyMap<string, readonly Modality[]> => {
    cache.set(query.url, { expires: Date.now() + CACHE_TTL_MS, listing })
    return listing
  }
  let key: string | undefined
  if (query.apiKeyEnv.length > 0) {
    try {
      key = usableKey(await resolveKey(query.apiKeyEnv))
    } catch {
      key = undefined
    }
  }
  const headers = new Headers({ accept: 'application/json' })
  if (query.api === 'anthropic-messages') {
    headers.set('anthropic-version', '2023-06-01')
    if (key !== undefined) headers.set('x-api-key', key)
  } else if (key !== undefined) {
    headers.set('authorization', `Bearer ${key}`)
  }
  let response: Response
  try {
    response = await fetchImpl(query.url, { method: 'GET', headers, signal: AbortSignal.timeout(8_000) })
  } catch {
    warnings.push(`could not read the model list for ${query.route}`)
    return remember(empty)
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    warnings.push(`model list for ${query.route} answered ${response.status}`)
    return remember(empty)
  }
  const textBody = await readBounded(response)
  if (textBody === undefined) {
    warnings.push(`model list for ${query.route} was too large to read`)
    return remember(empty)
  }
  try {
    return remember(indexListing(JSON.parse(textBody) as unknown))
  } catch {
    warnings.push(`model list for ${query.route} was not a model list`)
    return remember(empty)
  }
}

/**
 * Ask each custom route what its unclassified models accept.
 *
 * Routes whose models are already declared, or are covered by the DeepSeek
 * table, are not contacted. A failed read leaves those models unknown.
 */
export async function discoverRouteInputs(
  providers: unknown,
  user: unknown,
  resolveKey: (name: string) => Promise<string | undefined>,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<DiscoveryResult> {
  const modalities = new Map<string, readonly Modality[]>()
  const warnings: string[] = []
  for (const query of routesToQuery(providers, user)) {
    const listing = await loadListing(query, resolveKey, fetchImpl, warnings)
    for (const id of query.ids) {
      const found = listing.get(id)
      if (found !== undefined) modalities.set(discoveryKey(query.route, id), found)
    }
  }
  return { modalities, warnings }
}
