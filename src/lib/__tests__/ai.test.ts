import { test, expect, describe } from 'bun:test'
import {
  getChatProvider,
  __setChatProviderForTest,
  buildRagSystemPrompt,
  extractCitations,
  generateSummary,
  type ChatProvider,
  type ChatMessage,
} from '../ai'
import type { RetrievedChunk } from '../retrieval'

const retrieved: RetrievedChunk[] = [
  {
    chunkId: 'A::1',
    pageId: 'A',
    pageTitle: 'React Hooks Guide',
    ordinal: 1,
    heading: 'React Hooks Guide',
    content: 'useState is a React hook for state management.',
    bm25Score: 4.2,
    vectorScore: 0.81,
    fusedScore: 0.016,
  },
  {
    chunkId: 'B::1',
    pageId: 'B',
    pageTitle: 'Cooking Recipes',
    ordinal: 1,
    heading: 'Cooking Recipes',
    content: 'Bake bread at 200 degrees for 30 minutes.',
    bm25Score: 2.1,
    vectorScore: 0.74,
    fusedScore: 0.012,
  },
]

/**
 * Deterministic mock that:
 *  - complete() echoes the last user message (so the summary prompt is visible
 *    in the output — the buildSummaryPrompt instructions show up verbatim)
 *  - stream() yields a follow-up reply built from the last user message
 */
class MockChatProvider implements ChatProvider {
  completeCalls = 0
  streamCalls = 0
  async complete(args: { systemPrompt: string; messages: ChatMessage[] }): Promise<string> {
    this.completeCalls += 1
    const lastUser = [...args.messages].reverse().find((m) => m.role === 'user')
    return `[mock summary] ${lastUser?.content ?? ''}`
  }
  async *stream(args: { systemPrompt: string; messages: ChatMessage[] }): AsyncGenerator<string, void, unknown> {
    this.streamCalls += 1
    const lastUser = [...args.messages].reverse().find((m) => m.role === 'user')
    yield `[mock reply] `
    yield (lastUser?.content ?? '').slice(0, 80)
  }
}

describe('buildRagSystemPrompt', () => {
  test('includes all retrieved chunks', () => {
    const { systemPrompt } = buildRagSystemPrompt(retrieved)
    expect(systemPrompt).toContain('useState')
    expect(systemPrompt).toContain('Bake bread')
  })
  test('includes the citation rules', () => {
    const { systemPrompt } = buildRagSystemPrompt(retrieved)
    expect(systemPrompt.toLowerCase()).toContain('citation')
    expect(systemPrompt).toContain('[^c1]')
  })
  test('empty retrieved -> safe-mode prompt mentioning no pages', () => {
    const { systemPrompt, citationMap } = buildRagSystemPrompt([])
    expect(systemPrompt.toLowerCase()).toContain('no pages')
    expect(Object.keys(citationMap)).toHaveLength(0)
  })
  test('citation map key is the chunkId', () => {
    const { citationMap } = buildRagSystemPrompt(retrieved)
    expect(citationMap['A::1'].pageTitle).toBe('React Hooks Guide')
    expect(citationMap['B::1'].pageTitle).toBe('Cooking Recipes')
  })
})

describe('extractCitations', () => {
  test('returns chunkIds in citation order', () => {
    const msg = 'useState is a hook [^c1]. Bake bread [^c2].'
    const ids = extractCitations(msg, retrieved)
    expect(ids).toEqual(['A::1', 'B::1'])
  })
  test('dedupes repeated citations', () => {
    const msg = 'A [^c1] then again [^c1].'
    expect(extractCitations(msg, retrieved)).toEqual(['A::1'])
  })
  test('ignores out-of-range markers', () => {
    expect(extractCitations('bogus [^c99]', retrieved)).toEqual([])
  })
  test('no citations -> []', () => {
    expect(extractCitations('no markers here', retrieved)).toEqual([])
  })
})

describe('MockChatProvider — complete (summary)', () => {
  test('returns a deterministic summary string', async () => {
    const p = new MockChatProvider()
    const out = await p.complete({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'summarise react hooks' }],
    })
    expect(out).toBe('[mock summary] summarise react hooks')
    expect(p.completeCalls).toBe(1)
  })
})

describe('MockChatProvider — stream (follow-up reply)', () => {
  test('streams deltas that concatenate into a follow-up reply', async () => {
    const p = new MockChatProvider()
    const out: string[] = []
    for await (const d of p.stream({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'what is useState?' }],
    })) {
      out.push(d)
    }
    expect(out.length).toBe(2)
    expect(out.join('')).toBe('[mock reply] what is useState?')
    expect(p.streamCalls).toBe(1)
  })
})

describe('generateSummary', () => {
  test('returns a deterministic summary string', async () => {
    const p = new MockChatProvider()
    const out = await generateSummary('React hooks content here', 'brief', p)
    expect(typeof out).toBe('string')
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('mock summary')
  })
  test('brief prompt contains "3 bullet"', async () => {
    const p = new MockChatProvider()
    const out = await generateSummary('content', 'brief', p)
    expect(out.toLowerCase()).toContain('3 bullet')
  })
  test('medium prompt contains "1 paragraph" and "5 bullet"', async () => {
    const p = new MockChatProvider()
    const out = await generateSummary('content', 'medium', p)
    expect(out.toLowerCase()).toContain('1 paragraph')
    expect(out.toLowerCase()).toContain('5 bullet')
  })
  test('detailed prompt contains "3 paragraphs" and "key quotes"', async () => {
    const p = new MockChatProvider()
    const out = await generateSummary('content', 'detailed', p)
    expect(out.toLowerCase()).toContain('3 paragraphs')
    expect(out.toLowerCase()).toContain('key quotes')
  })
  test('uses the injected provider via __setChatProviderForTest', async () => {
    const p = new MockChatProvider()
    __setChatProviderForTest(p)
    try {
      await generateSummary('content', 'brief')
      expect(p.completeCalls).toBe(1)
    } finally {
      __setChatProviderForTest(null)
    }
  })
})

describe('getChatProvider', () => {
  test('returns the same cached provider on repeated calls', () => {
    __setChatProviderForTest(null)
    const a = getChatProvider()
    const b = getChatProvider()
    expect(a).toBe(b)
    __setChatProviderForTest(null)
  })
})
