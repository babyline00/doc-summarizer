import { test, expect, describe } from 'bun:test'
import {
  retrieveAcrossPages,
  buildPageChunks,
  chunkPlainText,
  type PageChunk,
} from '../retrieval'
import { tokenize } from '../tokenizer'
import { hashingEmbed } from '../embeddings'

/** Build a PageChunk[] from a list of chunk texts for a single page. */
function makePageChunks(pageId: string, pageTitle: string, texts: string[]): PageChunk[] {
  const stored = texts.map((t, i) => ({
    ordinal: i + 1,
    heading: pageTitle,
    content: t,
    tokens: tokenize(t),
  }))
  const vectors = texts.map((t) => hashingEmbed(t))
  return buildPageChunks(pageId, pageTitle, stored, vectors)
}

describe('retrieveAcrossPages', () => {
  test('returns top-K chunks across pages', async () => {
    const pageA = makePageChunks('A', 'React Hooks Guide', [
      'useState is a React hook for state management in function components.',
      'useEffect runs side effects after every render of the component.',
    ])
    const pageB = makePageChunks('B', 'Quantum Physics Primer', [
      'Quantum entanglement links two particles across arbitrary distances.',
      'The uncertainty principle limits simultaneous precise measurement.',
    ])
    const results = await retrieveAcrossPages('React hooks useState state', [...pageA, ...pageB], { topK: 3 })
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(3)
  })

  test('query matches page A but not page B -> A ranks first', async () => {
    const pageA = makePageChunks('A', 'React Hooks Guide', [
      'useState and useEffect are the core React hooks for state and effects.',
    ])
    const pageB = makePageChunks('B', 'Cooking Recipes', [
      'Bake the bread at 200 degrees for 30 minutes until golden brown.',
    ])
    const results = await retrieveAcrossPages('React hooks useState', [...pageA, ...pageB], { topK: 2 })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].pageId).toBe('A')
  })

  test('query about cooking ranks page B first', async () => {
    const pageA = makePageChunks('A', 'React Hooks Guide', [
      'useState is a React hook for state management in function components.',
    ])
    const pageB = makePageChunks('B', 'Cooking Recipes', [
      'Bake the bread at 200 degrees for 30 minutes until golden brown.',
    ])
    const results = await retrieveAcrossPages('bake bread oven', [...pageA, ...pageB], { topK: 2 })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].pageId).toBe('B')
  })

  test('empty pages -> empty result', async () => {
    const results = await retrieveAcrossPages('anything', [], { topK: 5 })
    expect(results).toEqual([])
  })

  test('empty query -> empty result', async () => {
    const pageA = makePageChunks('A', 'Page A', ['some text about React hooks'])
    const results = await retrieveAcrossPages('', pageA, { topK: 5 })
    expect(results).toEqual([])
  })

  test('whitespace-only query -> empty result', async () => {
    const pageA = makePageChunks('A', 'Page A', ['some text about React hooks'])
    const results = await retrieveAcrossPages('   ', pageA, { topK: 5 })
    expect(results).toEqual([])
  })

  test('retrieved chunk carries pageTitle + ordinal + content', async () => {
    const page = makePageChunks('A', 'My Page Title', [
      'React hooks are useful for state management in components.',
    ])
    const results = await retrieveAcrossPages('React hooks', page, { topK: 1 })
    expect(results.length).toBe(1)
    expect(results[0].pageTitle).toBe('My Page Title')
    expect(results[0].ordinal).toBe(1)
    expect(results[0].content).toContain('React hooks')
  })

  test('chunkId is decomposable into pageId::ordinal', async () => {
    const page = makePageChunks('pageXYZ', 'Title', [
      'chunk one about React hooks',
      'chunk two about useEffect cleanup',
    ])
    const results = await retrieveAcrossPages('useEffect cleanup', page, { topK: 2 })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].chunkId.startsWith('pageXYZ::')).toBe(true)
  })
})

describe('chunkPlainText', () => {
  test('returns chunks with ordinals starting at 1', () => {
    const body = Array.from({ length: 5 }, (_, i) => `Paragraph ${i}. `).join('\n\n')
    const chunks = chunkPlainText('My Title', body, { targetTokens: 20, overlapTokens: 0 })
    expect(chunks.length).toBeGreaterThan(0)
    chunks.forEach((c, i) => expect(c.ordinal).toBe(i + 1))
  })
  test('every chunk has the page title as its heading', () => {
    const chunks = chunkPlainText('My Title', 'some body text here', { targetTokens: 20 })
    chunks.forEach((c) => expect(c.heading).toBe('My Title'))
  })
  test('each chunk has precomputed tokens', () => {
    const chunks = chunkPlainText('T', 'React hooks are great for state.', { targetTokens: 100 })
    expect(chunks.length).toBe(1)
    expect(Array.isArray(chunks[0].tokens)).toBe(true)
    expect(chunks[0].tokens).toContain('react')
    expect(chunks[0].tokens).toContain('hooks')
  })
  test('empty text -> no chunks', () => {
    expect(chunkPlainText('T', '')).toEqual([])
  })
})
