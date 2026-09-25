import { describe, expect, it, vi } from 'vitest'

import {
  executeInputCommand,
  INPUT_USAGE,
  installInputCommand,
  parseInputCommand,
  planInputWrite,
  selectedModel,
  withModality,
} from '../src/command.ts'
import { bumpSettingsEpoch, settingsEpoch } from '../src/epoch.ts'
import type { HostContext, SettingsPathOp } from '../src/types.ts'

describe('parseInputCommand', () => {
  it('accepts image and text switches', () => {
    expect(parseInputCommand(' image true')).toEqual({ modality: 'image', enabled: true })
    expect(parseInputCommand('image false')).toEqual({ modality: 'image', enabled: false })
    expect(parseInputCommand('TEXT FALSE')).toEqual({ modality: 'text', enabled: false })
  })

  it('rejects any other shape', () => {
    expect(parseInputCommand('')).toEqual({ error: INPUT_USAGE })
    expect(parseInputCommand('image yes')).toEqual({ error: INPUT_USAGE })
    expect(parseInputCommand('audio true')).toEqual({ error: INPUT_USAGE })
  })
})

describe('withModality', () => {
  it('starts from text and refuses an empty list', () => {
    expect(withModality(undefined, 'image', true)).toEqual(['text', 'image'])
    expect(withModality(['text', 'image'], 'image', false)).toEqual(['text'])
    expect(withModality(['image'], 'image', false)).toEqual(['text'])
    expect(withModality(['text'], 'text', false)).toBeUndefined()
    expect(withModality(['text', 'image'], 'text', false)).toEqual(['image'])
  })
})

describe('planInputWrite', () => {
  const piAi = {
    providers: {
      zhongy: {
        api: 'openai-responses',
        models: [
          { id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash', reasoningEfforts: { high: 'high' } },
          { id: 'other', name: 'Other' },
        ],
      },
      anthropic: {
        modelOverrides: { 'claude-sonnet': { contextWindow: 200000 } },
      },
    },
  }
  const deepseek = {
    models: [
      {
        id: 'deepseek-flash',
        name: 'DeepSeek-V4.1-Flash',
        inputModalities: ['text', 'image'],
        imagePixelBudget: 640000,
        imageMaxBytes: 1048576,
        contextWindow: 1000000,
      },
    ],
  }

  it('stores image input on the selected custom-provider model', () => {
    const planned = planInputWrite(piAi, deepseek, { provider: 'zhongy', model: 'deepseek-v4.1-flash' }, 'image', true)
    expect(planned).toMatchObject({ namespace: 'llm-pi-ai', input: ['text', 'image'] })
    if (!('ops' in planned)) return
    const models = planned.ops[0]?.value as Array<Record<string, unknown>>
    expect(models[0]).toMatchObject({ id: 'deepseek-v4.1-flash', input: ['text', 'image'], reasoningEfforts: { high: 'high' } })
    expect(models[1]).toEqual({ id: 'other', name: 'Other' })
  })

  it('stores a text-only choice that automatic detection will not reopen', () => {
    const planned = planInputWrite(
      {
        providers: {
          zhongy: { models: [{ id: 'deepseek-v4.1-flash', input: ['text', 'image'] }] },
        },
      },
      deepseek,
      { provider: 'zhongy', model: 'deepseek-v4.1-flash' },
      'image',
      false,
    )
    expect(planned).toMatchObject({ input: ['text'] })
  })

  it('edits a catalog override without adding a models list', () => {
    const planned = planInputWrite(piAi, deepseek, { provider: 'anthropic', model: 'claude-sonnet' }, 'image', false)
    expect(planned).toMatchObject({ namespace: 'llm-pi-ai' })
    if (!('ops' in planned)) return
    expect(planned.ops[0]?.path).toEqual(['providers', 'anthropic', 'modelOverrides'])
    expect(planned.ops[0]?.value).toEqual({ 'claude-sonnet': { contextWindow: 200000, input: ['text'] } })
  })

  it('turns image off for a saved DeepSeek catalog model and drops image budgets', () => {
    const planned = planInputWrite(piAi, deepseek, { provider: 'deepseek-official', model: 'deepseek-flash' }, 'image', false)
    expect(planned).toMatchObject({ namespace: 'llm-deepseek', input: ['text'] })
    if (!('ops' in planned)) return
    expect(planned.ops[0]?.value).toEqual([
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', inputModalities: ['text'], contextWindow: 1000000 },
    ])
  })

  it('does not edit DeepSeek when the custom provider simply lacks that model', () => {
    const planned = planInputWrite(piAi, deepseek, { provider: 'zhongy', model: 'deepseek-flash' }, 'image', true)
    expect(planned).toEqual({ error: '当前模型 zhongy/deepseek-flash 不在已保存的模型列表里，无法写入。请先在设置中添加该模型。' })
  })
})

describe('executeInputCommand', () => {
  it('writes the selected model and ignores a stale settings pass', async () => {
    const before = settingsEpoch()
    const user = {
      providers: {
        zhongy: { models: [{ id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash' }] },
      },
    }
    const mutate = vi.fn(async (_namespace: string, ops: readonly SettingsPathOp[]) => {
      const models = ops[0]?.value as Array<Record<string, unknown>>
      user.providers.zhongy.models = models as typeof user.providers.zhongy.models
    })
    const ctx: HostContext = {
      settings: {
        writable: true,
        describe: () => [{ ns: 'llm-pi-ai', user }, { ns: 'llm-deepseek', user: { models: [] } }],
        mutate,
      },
      get: () => undefined,
      timeout: () => undefined,
      on: () => undefined,
      effect: () => undefined,
    }
    const result = await executeInputCommand(
      ctx,
      'image true',
      { options: { provider: 'other', model: 'other' }, session: {} },
    )
    expect(result.kind).toBe('error')

    const pending = {
      session: {},
      options: { provider: 'other', model: 'other' },
    }
    const choosing: HostContext = {
      ...ctx,
      get: name => name === 'sessionProjections'
        ? { stateOf: () => ({ pending: { provider: 'zhongy', model: 'deepseek-v4.1-flash' }, lastUsed: null }) }
        : undefined,
    }
    expect(selectedModel(choosing, pending)).toEqual({ provider: 'zhongy', model: 'deepseek-v4.1-flash' })
    const saved = await executeInputCommand(choosing, 'image true', pending)
    expect(saved).toEqual({
      kind: 'success',
      text: 'zhongy/deepseek-v4.1-flash 已开启图片输入，并已写入配置。当前输入：text、image。',
    })
    expect(user.providers.zhongy.models[0]).toMatchObject({ input: ['text', 'image'] })
    expect(settingsEpoch()).toBeGreaterThan(before)
    expect(bumpSettingsEpoch()).toBe(settingsEpoch())
  })

  it('registers /input and unregisters it when the effect is disposed', () => {
    let handler: ((invocation: { rawInput: string, agent: unknown }) => unknown) | undefined
    let dispose: (() => void) | undefined
    const ctx: HostContext = {
      settings: { writable: false },
      commands: {
        register: definition => {
          handler = definition.handler
          return () => { handler = undefined }
        },
      },
      timeout: () => undefined,
      on: () => undefined,
      effect: callback => {
        dispose = callback() as (() => void)
        return undefined
      },
    }
    installInputCommand(ctx)
    expect(handler).toBeTypeOf('function')
    dispose?.()
    expect(handler).toBeUndefined()
  })
})
