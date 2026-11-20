/**
 * Pluggable AI provider + high-level summary / RAG-chat orchestration.
 *
 * Two completion modes:
 *  - `complete()` — non-streaming, used for the page summary (we want the full
 *    summary text back in one shot so we can persist it atomically against the
 *    Page record and render it immediately in the page list).
 *  - `stream()`   — async generator of text deltas, used for the follow-up Q&A
 *    chat so the answer streams token-by-token with inline `[^c1]` citations.
 *
 * `ChatProvider` is intentionally minimal so the AI layer is pluggable:
 * `ZaiProvider` uses the z-ai-web-dev-sdk; `MockProvider` returns a
 * deterministic echo so the app (and the test suite) works fully offline.
 */

import type { RetrievedChunk } from './retrieval'
import { buildSummaryPrompt, type SummaryLength } from './summary-builder'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatProvider {
  /** Returns the full completion text (non-streaming). */
  complete(args: { systemPrompt: string; messages: ChatMessage[] }): Promise<string>
  /** Returns an async generator of text deltas (streaming). */
  stream(args: {
    systemPrompt: string
    messages: ChatMessage[]
  }): AsyncGenerator<string, void, unknown>
}

let cachedProvider: ChatProvider | null = null

const SUMMARY_SYSTEM_PROMPT =
  'You are Doc Summarizer — a precise summarisation assistant. ' +
  'Summarise the user-provided content strictly from the content itself. ' +
  'Do not invent facts, quotes, or numbers not present in the source. ' +
  'Use markdown for structure (bullets, paragraphs, blockquotes). ' +
  'Output ONLY the summary — no preamble, no meta commentary, no "Here is the summary:".'

class ZaiProvider implements ChatProvider {
  async complete(args: {
    systemPrompt: string
    messages: ChatMessage[]
  }): Promise<string> {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const messages: ChatMessage[] = [
      { role: 'system', content: args.systemPrompt },
      ...args.messages,
    ]
    const completion = await zai.chat.completions.create({
      messages,
      thinking: { type: 'disabled' },
    } as any)

    if (typeof completion === 'string') return completion
    const content = (completion as any)?.choices?.[0]?.message?.content
    if (typeof content === 'string') return content
    // Some SDK shapes wrap text in a ReadableStream even without stream:true.
    const body = (completion as any)?.body ?? (completion as any)?._body
    if (body && typeof body.getReader === 'function') {
      const reader = body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
      }
      return acc
    }
    return ''
  }

  async *stream(args: {
    systemPrompt: string
    messages: ChatMessage[]
  }): AsyncGenerator<string, void, unknown> {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const messages: ChatMessage[] = [
      { role: 'system', content: args.systemPrompt },
      ...args.messages,
    ]
    const completion = await zai.chat.completions.create({
      messages,
      stream: true,
      thinking: { type: 'disabled' },
    } as any)

    if (typeof completion === 'string') {
      yield completion
      return
    }
    let body: ReadableStream<Uint8Array> | undefined
    if (completion && typeof (completion as any).getReader === 'function') {
      body = completion as ReadableStream<Uint8Array>
    } else {
      body = (completion as any)?.body ?? (completion as any)?._body
    }
    if (!body) {
      const content = (completion as any)?.choices?.[0]?.message?.content
      if (typeof content === 'string' && content.length > 0) yield content
      return
    }
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') return
        try {
          const obj = JSON.parse(payload)
          const delta = obj?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) yield delta
        } catch {
          // ignore partial JSON
        }
      }
    }
  }
}

class MockProvider implements ChatProvider {
  async complete(args: {
    systemPrompt: string
    messages: ChatMessage[]
  }): Promise<string> {
    const lastUser = [...args.messages].reverse().find((m) => m.role === 'user')
    const text = lastUser?.content ?? ''
    return `[mock summary] ${text.slice(0, 200)}`
  }

  async *stream(args: {
    systemPrompt: string
    messages: ChatMessage[]
  }): AsyncGenerator<string, void, unknown> {
    const lastUser = [...args.messages].reverse().find((m) => m.role === 'user')
    const text = lastUser?.content ?? ''
    yield `[mock reply] `
    yield text.slice(0, 120)
  }
}

export function getChatProvider(): ChatProvider {
  if (cachedProvider) return cachedProvider
  if (process.env.PKC_DISABLE_LLM === '1') {
    cachedProvider = new MockProvider()
    return cachedProvider
  }
  try {
    cachedProvider = new ZaiProvider()
  } catch (e) {
    console.warn('[ai] ZaiProvider unavailable, using MockProvider:', (e as Error).message)
    cachedProvider = new MockProvider()
  }
  return cachedProvider
}

/** Test-only: inject (or clear) a provider. */
export function __setChatProviderForTest(p: ChatProvider | null) {
  cachedProvider = p
}

/**
 * Build the system prompt that grounds the follow-up chat in the retrieved
 * chunks and instructs the model to cite chunks inline using the `[^c1]`
 * markdown marker. Returns the prompt plus a citation map keyed by chunkId.
 */
export function buildRagSystemPrompt(retrieved: RetrievedChunk[]): {
  systemPrompt: string
  citationMap: Record<string, {
    pageTitle: string
    ordinal: number
    heading: string
    preview: string
  }>
} {
  if (!retrieved.length) {
    return {
      systemPrompt:
        'You are Doc Summarizer. No pages have been added to this session yet. ' +
        'Answer briefly and tell the user to add a page (URL, pasted text, or a YouTube link) to enable grounded answers.',
      citationMap: {},
    }
  }
  const chunkLines: string[] = []
  const citationMap: Record<string, {
    pageTitle: string
    ordinal: number
    heading: string
    preview: string
  }> = {}
  retrieved.forEach((c, i) => {
    const shortId = `c${i + 1}`
    const headingSuffix = c.heading && c.heading !== c.pageTitle ? ` › ${c.heading}` : ''
    chunkLines.push(
      `[^${shortId}]: (chunkId=${c.chunkId}) ` +
      `Source: "${c.pageTitle}"${headingSuffix} (chunk ${c.ordinal})\n` +
      c.content,
    )
    citationMap[c.chunkId] = {
      pageTitle: c.pageTitle,
      ordinal: c.ordinal,
      heading: c.heading,
      preview: c.content.slice(0, 140).replace(/\s+/g, ' ').trim(),
    }
  })
  const systemPrompt = [
    'You are Doc Summarizer — a RAG assistant that answers follow-up questions strictly grounded in the pages the user has summarised in this session.',
    'Below are the most relevant chunks retrieved from the session\'s pages.',
    'Rules:',
    '1. Answer ONLY using the information present in the provided chunks. If the answer is not in the chunks, say "I don\'t have that in the summarised pages."',
    '2. Every factual claim MUST be followed by an inline citation in the form [^c1], [^c2], etc. — the marker MUST match the chunkId label.',
    '3. Do not fabricate sources. Do not invent quotes. Do not paraphrase beyond what the chunks support.',
    '4. Use markdown for structure (lists, code blocks, emphasis, blockquotes) where it improves readability.',
    '',
    'Retrieved chunks:',
    chunkLines.join('\n\n---\n\n'),
  ].join('\n')
  return { systemPrompt, citationMap }
}

/**
 * Map short citation markers like [^c1] in the assistant message back to
 * chunk IDs from the citation map. Returns an ordered list of unique chunkIds
 * actually cited in the message.
 */
export function extractCitations(message: string, retrieved: RetrievedChunk[]): string[] {
  const seen = new Set<string>()
  const re = /\[\^(c\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(message)) !== null) {
    const idx = parseInt(m[1].slice(1), 10) - 1
    if (idx >= 0 && idx < retrieved.length) {
      seen.add(retrieved[idx].chunkId)
    }
  }
  return Array.from(seen)
}

/**
 * Generate a page summary at the requested length via a single non-streaming
 * LLM call. The prompt is built by `buildSummaryPrompt` (summary-builder.ts).
 */
export async function generateSummary(
  content: string,
  length: SummaryLength,
  provider?: ChatProvider,
): Promise<string> {
  const p = provider ?? getChatProvider()
  const prompt = buildSummaryPrompt(content, length)
  const out = await p.complete({
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })
  return out.trim()
}
