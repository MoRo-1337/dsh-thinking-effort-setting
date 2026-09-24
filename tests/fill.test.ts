import { describe, expect, it } from 'vitest'

import { DEFAULT_REASONING, OFFICIAL_LEVELS, fillProviderDefaults, selectableEffortIds } from '../src/fill.ts'

const LEVELS = { ...OFFICIAL_LEVELS }

/** Schema defaults a resolved model carries and the user never wrote. */
const RESOLVED_MODEL_DEFAULTS = {
  input: [],
  compat: { chatTemplateKwargs: {}, chatTemplateArgs: {} },
}

function resolvedModel(entry: Record<string, unknown>): Record<string, unknown> {
  return { ...RESOLVED_MODEL_DEFAULTS, ...entry, compat: { ...RESOLVED_MODEL_DEFAULTS.compat, ...(entry.compat as object | undefined) } }
}

function fill(providers: Record<string, unknown>, user: Record<string, unknown>) {
  return fillProviderDefaults(providers, user)
}

describe('official menu levels', () => {
  it('advertises Off, Low, High, and Max in that order', () => {
    const ids = selectableEffortIds(OFFICIAL_LEVELS)
    expect(ids).toEqual(['off', 'low', 'high', 'max'])
    expect(ids.map(id => `${id.charAt(0).toUpperCase()}${id.slice(1)}`)).toEqual(['Off', 'Low', 'High', 'Max'])
  })
})

describe('fillProviderDefaults', () => {
  it('fills hand-declared models and leaves resolved defaults unpinned', () => {
    const user = {
      providers: {
        gateway: {
          api: 'openai-completions',
          baseURL: 'https://gateway.example/v1',
          models: [
            { id: 'DeepSeek-V4.1-Flash', name: 'DeepSeek-V4.1-Flash' },
            { id: 'claude-sonnet', name: 'Claude', contextWindow: 200000 },
          ],
        },
      },
    }
    const resolved = {
      providers: {
        gateway: {
          api: 'openai-completions',
          baseURL: 'https://gateway.example/v1',
          defaultContextWindow: 262144,
          models: [
            resolvedModel({ id: 'DeepSeek-V4.1-Flash', name: 'DeepSeek-V4.1-Flash' }),
            resolvedModel({ id: 'claude-sonnet', name: 'Claude', contextWindow: 200000 }),
          ],
        },
      },
    }

    const result = fill(resolved.providers, user.providers)
    expect(result.filled).toBe(2)
    expect(result.reasoningSet).toBe(1)
    expect(result.ops).toEqual([
      {
        op: 'set',
        path: ['providers', 'gateway', 'models'],
        value: [
          {
            id: 'DeepSeek-V4.1-Flash',
            name: 'DeepSeek-V4.1-Flash',
            reasoningEfforts: LEVELS,
            compat: { thinkingFormat: 'deepseek' },
          },
          {
            id: 'claude-sonnet',
            name: 'Claude',
            contextWindow: 200000,
            reasoningEfforts: LEVELS,
          },
        ],
      },
      { op: 'set', path: ['providers', 'gateway', 'reasoning'], value: DEFAULT_REASONING },
    ])
  })

  it('adds Low to an off/high/max map and keeps a custom wire spelling', () => {
    const models = [
      { id: 'deepseek-v4.1-flash', reasoningEfforts: { off: null, high: 'high', max: 'max' } },
      { id: 'custom', reasoningEfforts: { off: null, high: 'ultra' } },
      { id: 'plain', reasoningEfforts: false },
    ]
    const providers = {
      gateway: { api: 'openai-completions', models: models.map(resolvedModel) },
    }
    const result = fill(providers, { gateway: { api: 'openai-completions', models } })
    expect(result.filled).toBe(2)
    expect(result.reasoningSet).toBe(0)
    const written = result.ops[0]?.value as Array<Record<string, unknown>>
    expect(written[0]?.reasoningEfforts).toEqual({ off: null, high: 'high', max: 'max', low: 'low' })
    expect(selectableEffortIds(written[0]?.reasoningEfforts as Record<string, string | null>)).toEqual(['off', 'low', 'high', 'max'])
    expect(written[1]?.reasoningEfforts).toEqual({ off: null, high: 'ultra', low: 'low', max: 'max' })
    expect(written[2]).toEqual(models[2])
  })

  it('does not replace a route reasoning the user already chose', () => {
    const models = [{ id: 'm' }]
    const result = fill(
      { gateway: { api: 'openai-completions', reasoning: 'max', models: models.map(resolvedModel) } },
      { gateway: { api: 'openai-completions', reasoning: 'max', models } },
    )
    expect(result.ops.map(op => op.path.join('.'))).toEqual(['providers.gateway.models'])
    expect(result.reasoningSet).toBe(0)
  })

  it('does not set the route default while any model opts out of reasoning', () => {
    const models = [
      { id: 'thinker' },
      { id: 'fast', reasoningEfforts: false },
    ]
    const result = fill(
      { gateway: { api: 'openai-completions', models: models.map(entry => resolvedModel(entry)) } },
      { gateway: { api: 'openai-completions', models } },
    )
    expect(result.reasoningSet).toBe(0)
    expect(result.ops).toHaveLength(1)
    const written = result.ops[0]?.value as Array<Record<string, unknown>>
    expect(written[0]?.reasoningEfforts).toEqual(LEVELS)
    expect(written[1]).toEqual(models[1])
  })

  it('adds the deepseek dialect only on openai-completions, without copying resolved compat', () => {
    const deepseek = { id: 'deepseek-v4-pro', compat: { supportsDeveloperRole: false } }
    const responses = fill(
      { gateway: { api: 'openai-responses', models: [resolvedModel(deepseek)] } },
      { gateway: { api: 'openai-responses', models: [deepseek] } },
    )
    const written = responses.ops[0]?.value as Array<Record<string, unknown>>
    expect(written[0]).toEqual({ ...deepseek, reasoningEfforts: LEVELS })

    const already = { id: 'deepseek-v4-pro', compat: { thinkingFormat: 'openai' } }
    const kept = fill(
      { gateway: { api: 'openai-completions', models: [resolvedModel(already)] } },
      { gateway: { api: 'openai-completions', models: [already] } },
    )
    const keptModel = (kept.ops[0]?.value as Array<Record<string, unknown>>)[0]
    expect(keptModel?.compat).toEqual({ thinkingFormat: 'openai' })
    expect(keptModel).not.toHaveProperty('input')
  })

  it('leaves catalog overrides and lower-layer models alone', () => {
    const result = fill(
      {
        openai: {
          modelOverrides: { 'gpt-5': resolvedModel({ contextWindow: 128000 }) },
        },
        bundled: {
          models: [resolvedModel({ id: 'from-base' })],
        },
      },
      {
        openai: { modelOverrides: { 'gpt-5': { contextWindow: 128000 } } },
      },
    )
    expect(result.ops).toEqual([])
    expect(result.skipped.unmatched).toBe(1)
  })

  it('does not materialize a model that exists only past the user array', () => {
    const result = fill(
      {
        gateway: {
          api: 'openai-completions',
          models: [
            resolvedModel({ id: 'mine', name: 'Mine' }),
            resolvedModel({ id: 'from-base', name: 'Base', input: ['text', 'image'] }),
          ],
        },
      },
      { gateway: { api: 'openai-completions', models: [{ id: 'mine', name: 'Mine' }] } },
    )
    const written = result.ops[0]?.value as unknown[]
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ id: 'mine', reasoningEfforts: LEVELS })
    expect(result.skipped.unmatched).toBe(1)
  })

  it('is a no-op once the official levels and route default are in place', () => {
    const models = [{
      id: 'DeepSeek-V4.1-Flash',
      reasoningEfforts: LEVELS,
      compat: { thinkingFormat: 'deepseek' },
    }]
    const profile = { api: 'openai-completions', reasoning: DEFAULT_REASONING, models }
    const result = fill({ gateway: profile }, { gateway: profile })
    expect(result.ops).toEqual([])
  })
})
