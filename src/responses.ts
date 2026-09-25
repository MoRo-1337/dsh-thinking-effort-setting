import { isRecord } from './types.js'

/**
 * DeepSeek's Responses API thinks only when `reasoning.effort` is a level,
 * and a later tool round stays off unless some earlier `reasoning` item is
 * in the input. pi-ai sends OpenAI's `summary` and `reasoning.encrypted_content`
 * on top of the effort. On a DeepSeek gateway those extras are not the switch,
 * and a tool call that came back without a reasoning item keeps every following
 * step from thinking — a greeting that happened to think unsticks the session,
 * a task that starts on tools never does.
 */

const PLACEHOLDER_TEXT = '.'

function isDeepSeekModel(value: unknown): boolean {
  return typeof value === 'string' && /deepseek/i.test(value)
}

function isResponsesCreate(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith('/responses')
  } catch {
    return /\/responses$/.test(url)
  }
}

/** Off and `none` are the Responses spellings that leave thinking disabled. */
function keepsThinking(effort: unknown): boolean {
  return typeof effort === 'string' && effort.length > 0 && effort !== 'none' && effort !== 'off'
}

function placeholder(): Record<string, unknown> {
  return {
    type: 'reasoning',
    status: 'completed',
    content: [{ type: 'reasoning_text', text: PLACEHOLDER_TEXT }],
  }
}

/**
 * Rewrite one Responses body for a DeepSeek model.
 *
 * Returns the same reference when nothing applies, so the caller can skip
 * re-serializing. `summary` is dropped and `reasoning.encrypted_content` is
 * removed from `include`. A tool call with no reasoning item ahead of it gains
 * one, only while the selected effort still asks the model to think.
 */
export function adaptDeepSeekResponsesBody(body: unknown): unknown {
  if (!isRecord(body) || !isDeepSeekModel(body.model)) return body
  const reasoning = isRecord(body.reasoning) ? body.reasoning : undefined
  if (reasoning === undefined || !keepsThinking(reasoning.effort)) return body

  let next: Record<string, unknown> | undefined
  const edit = (): Record<string, unknown> => {
    if (next === undefined) next = { ...body, reasoning: { ...reasoning } }
    return next
  }

  if ('summary' in reasoning) {
    const cleaned = { ...(edit().reasoning as Record<string, unknown>) }
    delete cleaned.summary
    edit().reasoning = cleaned
  }

  if (Array.isArray(body.include) && body.include.includes('reasoning.encrypted_content')) {
    const include = body.include.filter(item => item !== 'reasoning.encrypted_content')
    if (include.length === 0) delete edit().include
    else edit().include = include
  }

  if (Array.isArray(body.input)) {
    const input = [...body.input]
    let seenReasoning = false
    for (let index = 0; index < input.length; index += 1) {
      const item = input[index]
      if (!isRecord(item)) continue
      if (item.type === 'reasoning') {
        seenReasoning = true
        continue
      }
      if (item.type !== 'function_call' && item.type !== 'custom_tool_call') continue
      if (seenReasoning) break
      input.splice(index, 0, placeholder())
      edit().input = input
      break
    }
  }

  return next ?? body
}

function bodyText(body: BodyInit | null | undefined): string | undefined {
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body))
  return undefined
}

/** A new init when this POST /responses call needs the DeepSeek shape. */
export function rewriteResponsesInit(url: string, init: RequestInit): RequestInit | undefined {
  if ((init.method ?? 'GET').toUpperCase() !== 'POST') return undefined
  if (!isResponsesCreate(url)) return undefined
  const text = bodyText(init.body)
  if (text === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return undefined
  }
  const adapted = adaptDeepSeekResponsesBody(parsed)
  if (adapted === parsed) return undefined
  return { ...init, body: JSON.stringify(adapted) }
}

/**
 * Point global `fetch` at the DeepSeek Responses rewrite.
 *
 * pi-ai builds an OpenAI client per request and calls global `fetch` with
 * `this` unset. The wrapper does the same when it forwards.
 */
export function installDeepSeekResponsesFetch(): () => void {
  const current = globalThis.fetch
  const wrapped: typeof fetch = (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : undefined
    const rewritten = url !== undefined && init !== undefined ? rewriteResponsesInit(url, init) : undefined
    if (rewritten !== undefined && url !== undefined) return Reflect.apply(current, undefined, [url, rewritten])
    return Reflect.apply(current, undefined, [input, init])
  }
  globalThis.fetch = wrapped
  return () => {
    if (globalThis.fetch === wrapped) globalThis.fetch = current
  }
}
