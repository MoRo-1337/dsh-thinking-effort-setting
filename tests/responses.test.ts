import { afterEach, describe, expect, it, vi } from 'vitest'

import { adaptDeepSeekResponsesBody, installDeepSeekResponsesFetch, rewriteResponsesInit } from '../src/responses.ts'

const toolTurn = {
  model: 'deepseek-v4.1-flash',
  reasoning: { effort: 'high', summary: 'auto' },
  include: ['reasoning.encrypted_content'],
  input: [
    { role: 'user', content: '分析一下这个项目' },
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'I will look at the root.' }],
    },
    { type: 'function_call', call_id: 'call_1', name: 'list_dir', arguments: '{"path":"."}' },
    { type: 'function_call_output', call_id: 'call_1', output: 'src' },
  ],
}

describe('adaptDeepSeekResponsesBody', () => {
  it('drops OpenAI extras and restores a reasoning item before the first tool call', () => {
    const adapted = adaptDeepSeekResponsesBody(toolTurn) as {
      reasoning: Record<string, unknown>
      include?: unknown
      input: Array<Record<string, unknown>>
    }
    expect(adapted.reasoning).toEqual({ effort: 'high' })
    expect(adapted.include).toBeUndefined()
    expect(adapted.input[2]).toMatchObject({
      type: 'reasoning',
      content: [{ type: 'reasoning_text', text: '.' }],
    })
    expect(adapted.input[3]).toMatchObject({ type: 'function_call', call_id: 'call_1' })
    expect(toolTurn.input).toHaveLength(4)
  })

  it('leaves a tool call that already has a reasoning item ahead of it', () => {
    const body = {
      model: 'DeepSeek-V4-Pro',
      reasoning: { effort: 'max' },
      input: [
        { role: 'user', content: '继续' },
        { type: 'reasoning', id: 'rs_1' },
        { type: 'function_call', call_id: 'call_1', name: 'list_dir', arguments: '{}' },
      ],
    }
    expect(adaptDeepSeekResponsesBody(body)).toBe(body)
  })

  it('does not invent a reasoning item when thinking is off', () => {
    const body = {
      model: 'deepseek-v4.1-flash',
      reasoning: { effort: 'none' },
      input: [{ type: 'function_call', call_id: 'call_1', name: 'list_dir', arguments: '{}' }],
    }
    expect(adaptDeepSeekResponsesBody(body)).toBe(body)
  })

  it('does not rewrite a model that is not DeepSeek', () => {
    const body = {
      model: 'gpt-5',
      reasoning: { effort: 'high', summary: 'auto' },
      include: ['reasoning.encrypted_content'],
      input: [{ type: 'function_call', name: 'list_dir' }],
    }
    expect(adaptDeepSeekResponsesBody(body)).toBe(body)
  })

  it('keeps other include entries', () => {
    const body = {
      model: 'deepseek-flash',
      reasoning: { effort: 'low', summary: 'auto' },
      include: ['reasoning.encrypted_content', 'message.output_text.logprobs'],
      input: '你好',
    }
    const adapted = adaptDeepSeekResponsesBody(body) as { include: string[], reasoning: Record<string, unknown> }
    expect(adapted.reasoning).toEqual({ effort: 'low' })
    expect(adapted.include).toEqual(['message.output_text.logprobs'])
  })
})

describe('rewriteResponsesInit', () => {
  it('rewrites only POST /responses', () => {
    const init = { method: 'POST', body: JSON.stringify(toolTurn) }
    const rewritten = rewriteResponsesInit('https://ai.example/v1/responses', init)
    expect(rewritten).toBeDefined()
    const body = JSON.parse(String(rewritten?.body)) as { reasoning: { summary?: string } }
    expect(body.reasoning.summary).toBeUndefined()
    expect(rewriteResponsesInit('https://ai.example/v1/chat/completions', init)).toBeUndefined()
    expect(rewriteResponsesInit('https://ai.example/v1/responses', { method: 'GET', body: init.body })).toBeUndefined()
  })
})

describe('installDeepSeekResponsesFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards the rewritten body and restores fetch on dispose', async () => {
    const seen: unknown[] = []
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seen.push(init?.body)
      return new Response('{}')
    })
    vi.stubGlobal('fetch', fetchMock)
    const dispose = installDeepSeekResponsesFetch()
    await globalThis.fetch('https://gateway.example/v1/responses', {
      method: 'POST',
      body: JSON.stringify(toolTurn),
    })
    const sent = JSON.parse(String(seen[0])) as { input: Array<{ type?: string }> }
    expect(sent.input.some(item => item.type === 'reasoning')).toBe(true)
    dispose()
    expect(globalThis.fetch).toBe(fetchMock)
  })
})
