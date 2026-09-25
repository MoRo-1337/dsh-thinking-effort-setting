import { bumpSettingsEpoch } from './epoch.js'
import { declaredInput, type Modality } from './input.js'
import { readSettingsSectionUser } from './settings-model.js'
import { isRecord, type HostContext, type SettingsPathOp, type UnknownRecord } from './types.js'

/** Settings section for the direct DeepSeek adapter. Its field is `inputModalities`. */
export const DEEPSEEK_NAMESPACE = 'llm-deepseek'

/** Settings section for custom and pi-ai providers. Their field is `input`. */
export const PI_AI_NAMESPACE = 'llm-pi-ai'

export const INPUT_USAGE = '用法：/input image true 或 /input image false'

interface ModelSelection {
  readonly provider: string
  readonly model: string
}

export interface PlannedInputWrite {
  readonly namespace: string
  readonly ops: readonly SettingsPathOp[]
  readonly input: readonly Modality[]
  readonly provider: string
  readonly model: string
}

interface ParsedInput {
  readonly modality: Modality
  readonly enabled: boolean
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Parse `/input <text|image> <true|false>`. The leading separator may be included. */
export function parseInputCommand(raw: string): ParsedInput | { readonly error: string } {
  const parts = raw.trim().split(/\s+/u).filter(part => part.length > 0)
  if (parts.length !== 2) return { error: INPUT_USAGE }
  const modality = parts[0]?.toLowerCase()
  const flag = parts[1]?.toLowerCase()
  if (modality !== 'text' && modality !== 'image') return { error: INPUT_USAGE }
  if (flag !== 'true' && flag !== 'false') return { error: INPUT_USAGE }
  return { modality, enabled: flag === 'true' }
}

/**
 * Apply one modality switch to a list.
 *
 * An undeclared list starts from text, which is what DSH assumes. The result
 * keeps text before image. Turning image off leaves text. Turning off the last
 * text input is refused: a model entry has to accept at least one input.
 */
export function withModality(
  current: readonly string[] | undefined,
  modality: Modality,
  enabled: boolean,
): readonly Modality[] | undefined {
  const next = new Set<Modality>(declaredInput(current) ?? ['text'])
  if (enabled) next.add(modality)
  else next.delete(modality)
  // Closing image input always leaves text. Closing the last text input does not.
  if (next.size === 0) return modality === 'image' && !enabled ? ['text'] : undefined
  const ordered: Modality[] = []
  if (next.has('text')) ordered.push('text')
  if (next.has('image')) ordered.push('image')
  return ordered
}

function selectionFrom(value: unknown): ModelSelection | undefined {
  if (!isRecord(value)) return undefined
  const provider = text(value.provider)
  const model = text(value.model)
  if (provider.length === 0 || model.length === 0) return undefined
  return { provider, model }
}

function headerSelection(session: unknown): ModelSelection | undefined {
  if (!isRecord(session) || typeof session.requestHeader !== 'function') return undefined
  const header = (session.requestHeader as () => unknown)()
  if (!isRecord(header)) return undefined
  return selectionFrom(header.config)
}

/**
 * The model the composer will use next.
 *
 * A pending selection wins, then the last request, then the agent's own
 * options, then the profile default. Any one of those is enough.
 */
export function selectedModel(ctx: HostContext, agent: unknown): ModelSelection | undefined {
  const session = isRecord(agent) ? agent.session : undefined
  const projections = ctx.get?.('sessionProjections') as { stateOf?: (session: unknown, key: string) => unknown } | undefined
  if (session !== undefined && typeof projections?.stateOf === 'function') {
    const state = projections.stateOf(session, 'modelSelection')
    if (isRecord(state)) {
      const pending = selectionFrom(state.pending)
      if (pending !== undefined) return pending
      const lastUsed = selectionFrom(state.lastUsed)
      if (lastUsed !== undefined) return lastUsed
    }
  }
  const fromHeader = headerSelection(session)
  if (fromHeader !== undefined) return fromHeader
  if (isRecord(agent)) {
    const fromOptions = selectionFrom(agent.options)
    if (fromOptions !== undefined) return fromOptions
  }
  const defaults = ctx.get?.('agentDefaultModel') as { currentSelection?: () => unknown } | undefined
  if (typeof defaults?.currentSelection === 'function') return selectionFrom(defaults.currentSelection())
  return undefined
}

function providerProfile(section: unknown, provider: string): UnknownRecord | undefined {
  if (!isRecord(section) || !isRecord(section.providers)) return undefined
  const profile = section.providers[provider]
  return isRecord(profile) ? profile : undefined
}

function modelIndex(models: readonly unknown[], id: string): number {
  return models.findIndex(entry => isRecord(entry) && entry.id === id)
}

function piAiWrite(
  section: unknown,
  selection: ModelSelection,
  modality: Modality,
  enabled: boolean,
): PlannedInputWrite | { readonly error: string } | undefined {
  const profile = providerProfile(section, selection.provider)
  if (profile === undefined) return undefined
  const label = `${selection.provider}/${selection.model}`
  if (Array.isArray(profile.models)) {
    const index = modelIndex(profile.models, selection.model)
    if (index < 0) {
      return { error: `当前模型 ${label} 不在已保存的模型列表里，无法写入。请先在设置中添加该模型。` }
    }
    const entry = profile.models[index]
    if (!isRecord(entry)) return { error: `当前模型 ${label} 的配置无法编辑。` }
    const input = withModality(declaredInput(entry.input), modality, enabled)
    if (input === undefined) return { error: '至少保留一种输入。请先开启另一种，再关闭这一种。' }
    const models = [...profile.models]
    models[index] = { ...entry, input: [...input] }
    return {
      namespace: PI_AI_NAMESPACE,
      ops: [{ op: 'set', path: ['providers', selection.provider, 'models'], value: models }],
      input,
      provider: selection.provider,
      model: selection.model,
    }
  }
  const overrides = isRecord(profile.modelOverrides) ? { ...profile.modelOverrides } : {}
  const stored = overrides[selection.model]
  const existing: UnknownRecord = isRecord(stored) ? stored : {}
  const input = withModality(declaredInput(existing.input), modality, enabled)
  if (input === undefined) return { error: '至少保留一种输入。请先开启另一种，再关闭这一种。' }
  overrides[selection.model] = { ...existing, input: [...input] }
  return {
    namespace: PI_AI_NAMESPACE,
    ops: [{ op: 'set', path: ['providers', selection.provider, 'modelOverrides'], value: overrides }],
    input,
    provider: selection.provider,
    model: selection.model,
  }
}

function withoutImageBudgets(entry: UnknownRecord, input: readonly Modality[]): UnknownRecord {
  const next: UnknownRecord = { ...entry, inputModalities: [...input] }
  if (input.includes('image')) return next
  delete next.imagePixelBudget
  delete next.imageMaxBytes
  return next
}

function deepSeekWrite(
  section: unknown,
  selection: ModelSelection,
  modality: Modality,
  enabled: boolean,
): PlannedInputWrite | { readonly error: string } | undefined {
  if (!isRecord(section) || !Array.isArray(section.models)) return undefined
  const index = modelIndex(section.models, selection.model)
  if (index < 0) return undefined
  const entry = section.models[index]
  if (!isRecord(entry)) return { error: `当前模型 ${selection.model} 的配置无法编辑。` }
  const input = withModality(declaredInput(entry.inputModalities), modality, enabled)
  if (input === undefined) return { error: '至少保留一种输入。请先开启另一种，再关闭这一种。' }
  const models = [...section.models]
  models[index] = withoutImageBudgets(entry, input)
  return {
    namespace: DEEPSEEK_NAMESPACE,
    ops: [{ op: 'set', path: ['models'], value: models }],
    input,
    provider: selection.provider,
    model: selection.model,
  }
}

/**
 * The settings edit that stores one modality switch for the selected model.
 *
 * A custom provider is edited in `llm-pi-ai`. A model that is not under that
 * provider is edited in `llm-deepseek` when the saved catalog lists it.
 * Entries that exist only in a lower layer are refused: writing them would
 * replace that layer's other fields.
 */
export function planInputWrite(
  piAiUser: unknown,
  deepseekUser: unknown,
  selection: ModelSelection,
  modality: Modality,
  enabled: boolean,
): PlannedInputWrite | { readonly error: string } {
  const piAi = piAiWrite(piAiUser, selection, modality, enabled)
  if (piAi !== undefined) return piAi
  const deepseek = deepSeekWrite(deepseekUser, selection, modality, enabled)
  if (deepseek !== undefined) return deepseek
  return { error: `当前模型 ${selection.provider}/${selection.model} 不在已保存的配置里，无法写入。` }
}

function resultText(planned: PlannedInputWrite, modality: Modality, enabled: boolean): string {
  const which = modality === 'image' ? '图片' : '文本'
  const verb = enabled ? '已开启' : '已关闭'
  return `${planned.provider}/${planned.model} ${verb}${which}输入，并已写入配置。当前输入：${planned.input.join('、')}。`
}

/** Run one `/input` invocation and persist it through the settings service. */
export async function executeInputCommand(ctx: HostContext, rawInput: string, agent: unknown): Promise<{ readonly kind: 'success' | 'error', readonly text: string }> {
  const parsed = parseInputCommand(rawInput)
  if ('error' in parsed) return { kind: 'error', text: parsed.error }
  const settings = ctx.settings
  if (settings?.writable !== true || typeof settings.mutate !== 'function') {
    return { kind: 'error', text: '当前配置不可写，输入类型没有更改。' }
  }
  const selection = selectedModel(ctx, agent)
  if (selection === undefined) return { kind: 'error', text: '还没有选中模型，无法设置输入类型。' }
  const planned = planInputWrite(
    readSettingsSectionUser(settings, PI_AI_NAMESPACE),
    readSettingsSectionUser(settings, DEEPSEEK_NAMESPACE),
    selection,
    parsed.modality,
    parsed.enabled,
  )
  if ('error' in planned) return { kind: 'error', text: planned.error }
  bumpSettingsEpoch()
  try {
    await settings.mutate(planned.namespace, planned.ops)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'error', text: `写入配置失败：${message}` }
  }
  return { kind: 'success', text: resultText(planned, parsed.modality, parsed.enabled) }
}

/** Register `/input` for the composer's command menu. */
export function installInputCommand(ctx: HostContext): void {
  const commands = ctx.commands
  if (commands === undefined || typeof commands.register !== 'function') return
  ctx.effect(() => {
    const dispose = commands.register({
      name: 'input',
      description: '设置当前模型是否接受图片或文本',
      input: { hint: 'image true|false' },
      handler: invocation => executeInputCommand(ctx, invocation.rawInput, invocation.agent),
    })
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'dsh-thinking-effort-setting: input command')
}
