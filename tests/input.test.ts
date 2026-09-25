import { describe, expect, it } from 'vitest'

import {
  declaredInput,
  imageInputToWrite,
  indexListing,
  knownInput,
  modalitiesFromListingEntry,
} from '../src/input.ts'
import { clearListingCache, discoverRouteInputs } from '../src/probe.ts'

describe('knownInput', () => {
  it('treats V4.1 Flash and its legacy flash ids as image models', () => {
    expect(knownInput('deepseek-v4.1-flash', 'deepseek-v4.1-flash')).toBe('image')
    expect(knownInput('DeepSeek-V4.1-Flash', 'DeepSeek-V4.1-Flash')).toBe('image')
    expect(knownInput('deepseek-flash', 'DeepSeek-V41-Flash')).toBe('image')
    expect(knownInput('deepseek-v4-flash', 'DeepSeek V4 Flash')).toBe('image')
    expect(knownInput('deepseek-v4-flash-vision-exp', 'vision')).toBe('image')
  })

  it('keeps V4 Pro and unrecognized ids off the image list', () => {
    expect(knownInput('deepseek-v4-pro', 'DeepSeek V4 Pro')).toBe('text')
    expect(knownInput('deepseek-v4.1-pro', 'DeepSeek-V4.1-Pro')).toBe('text')
    expect(knownInput('deepseek-chat', 'DeepSeek Chat')).toBe('unknown')
    expect(knownInput('claude-sonnet', 'Claude')).toBe('unknown')
  })
})

describe('listing modalities', () => {
  it('reads OpenRouter, models.dev, and a plain input list', () => {
    expect(modalitiesFromListingEntry({
      architecture: { input_modalities: ['text', 'image', 'file'] },
    })).toEqual(['text', 'image'])
    expect(modalitiesFromListingEntry({
      modalities: { input: ['text', 'image', 'pdf'] },
    })).toEqual(['text', 'image'])
    expect(modalitiesFromListingEntry({
      architecture: { modality: 'text+image+file->text' },
    })).toEqual(['text', 'image'])
    expect(modalitiesFromListingEntry({ input: ['text'] })).toEqual(['text'])
    expect(modalitiesFromListingEntry({ id: 'deepseek-v4-flash' })).toBeUndefined()
    expect(declaredInput([])).toBeUndefined()
  })

  it('indexes a slash-qualified id by its suffix and ignores rows that say nothing', () => {
    const indexed = indexListing({
      data: [
        { id: 'deepseek/deepseek-v4.1-flash', architecture: { input_modalities: ['image'] } },
        { id: 'deepseek-v4-pro', object: 'model' },
      ],
    })
    expect(indexed.get('deepseek/deepseek-v4.1-flash')).toEqual(['text', 'image'])
    expect(indexed.get('deepseek-v4.1-flash')).toEqual(['text', 'image'])
    expect(indexed.has('deepseek-v4-pro')).toBe(false)
  })

  it('lets an explicit user list and a resolved image list block a write', () => {
    expect(imageInputToWrite({ id: 'deepseek-v4.1-flash', input: ['text'] }, undefined, undefined)).toBeUndefined()
    expect(imageInputToWrite(
      { id: 'deepseek-v4.1-flash' },
      { input: ['text', 'image'] },
      undefined,
    )).toBeUndefined()
    expect(imageInputToWrite({ id: 'deepseek-v4.1-flash' }, { input: [] }, undefined)).toEqual(['text', 'image'])
  })
})

describe('discoverRouteInputs', () => {
  it('asks the listing only for models the table does not classify', async () => {
    clearListingCache()
    const seen: string[] = []
    const fetchImpl: typeof fetch = (input) => {
      seen.push(String(input))
      return Promise.resolve(new Response(JSON.stringify({
        data: [{ id: 'vendor/acme-vision', architecture: { input_modalities: ['text', 'image'] } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
    }
    const providers = {
      gateway: {
        api: 'openai-completions',
        baseURL: 'https://gateway.example/v1',
        apiKeyEnv: 'GATEWAY_KEY',
        models: [
          { id: 'deepseek-v4.1-flash' },
          { id: 'acme-vision' },
        ],
      },
    }
    const discovered = await discoverRouteInputs(providers, providers, async () => 'secret-key', fetchImpl)
    expect(seen).toEqual(['https://gateway.example/v1/models'])
    expect(discovered.warnings).toEqual([])
    expect(discovered.modalities.get('gateway\0acme-vision')).toEqual(['text', 'image'])
    expect(discovered.modalities.has('gateway\0deepseek-v4.1-flash')).toBe(false)

    seen.length = 0
    await discoverRouteInputs(providers, providers, async () => 'secret-key', fetchImpl)
    expect(seen).toEqual([])
    clearListingCache()
  })

  it('records a failed listing without throwing', async () => {
    clearListingCache()
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response('no', { status: 403 }))
    const providers = {
      gateway: {
        api: 'openai-responses',
        baseURL: 'https://gateway.example/v1',
        models: [{ id: 'mystery-model' }],
      },
    }
    const discovered = await discoverRouteInputs(providers, providers, async () => undefined, fetchImpl)
    expect(discovered.modalities.size).toBe(0)
    expect(discovered.warnings).toEqual(['model list for gateway answered 403'])
    clearListingCache()
  })
})
