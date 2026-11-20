/**
 * POST /api/sessions/[id]/chat — streaming follow-up Q&A.
 *
 * Body: { message: string }
 *
 * Response: text/plain; charset=utf-8 — a server-streamed concatenation of
 * LLM tokens. After the stream finishes, a final `\n---CITATIONS---\n<json>`
 * footer is appended so the client can render citation chips for any [^c1]
 * markers that appeared in the assistant message.
 *
 * The streaming protocol is intentionally simple (not SSE / OpenAI shape) so a
 * fetch() + ReadableStream reader is enough on the client side.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  retrieveAcrossPages,
  buildPageChunks,
  getSessionCorpus,
  setSessionCorpus,
  type PageChunk,
  type StoredChunk,
} from '@/lib/retrieval'
import {
  getChatProvider,
  buildRagSystemPrompt,
  extractCitations,
} from '@/lib/ai'

export const runtime = 'nodejs'

const CITATION_SEPARATOR = '\n---CITATIONS---\n'

/**
 * Build the per-session in-memory PageChunk[] (the union of all chunks across
 * all pages in the session). Uses the module-level cache; rebuilds from the
 * DB when the cache is cold.
 */
async function buildCorpusForSession(sessionId: string): Promise<PageChunk[]> {
  const cached = getSessionCorpus(sessionId)
  if (cached && cached.length > 0) return cached

  const pages = await db.page.findMany({ where: { sessionId } })
  const all: PageChunk[] = []
  for (const p of pages) {
    let chunks: StoredChunk[] = []
    let vectors: Float32Array[] = []
    try {
      const parsed = JSON.parse(p.tokens)
      if (Array.isArray(parsed)) chunks = parsed as StoredChunk[]
    } catch {
      continue
    }
    try {
      const raw = JSON.parse(p.embedding) as number[][]
      if (Array.isArray(raw)) vectors = raw.map((arr) => Float32Array.from(arr))
    } catch {
      // fall back to zero vectors (chunk will have 0 vector similarity)
    }
    const pc = buildPageChunks(p.id, p.title, chunks, vectors)
    all.push(...pc)
  }
  setSessionCorpus(sessionId, all)
  return all
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const message = (body?.message ?? '').toString().trim()
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  const session = await db.session.findUnique({ where: { id } })
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // 1. Build the per-session corpus and run hybrid retrieval over the union.
  const corpus = await buildCorpusForSession(id)
  const retrieved = await retrieveAcrossPages(message, corpus, { topK: 8 })

  // 2. Load prior messages in this session for the LLM context window.
  const prior = await db.chatMessage.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  })
  const recent = prior
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-8)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  // 3. Persist the user message immediately so it isn't lost on disconnect.
  await db.chatMessage.create({
    data: { sessionId: id, role: 'user', content: message },
  })

  // 4. Build the system prompt + citation map.
  const { systemPrompt, citationMap } = buildRagSystemPrompt(retrieved)

  // 5. Stream the assistant response, buffering the full message so we can
  //    persist it after the stream completes.
  const provider = getChatProvider()
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let fullMessage = ''
      try {
        for await (const delta of provider.stream({
          systemPrompt,
          messages: [...recent, { role: 'user', content: message }],
        })) {
          fullMessage += delta
          controller.enqueue(encoder.encode(delta))
        }
      } catch (e) {
        const err = `\n\n[stream error] ${(e as Error).message}`
        fullMessage += err
        controller.enqueue(encoder.encode(err))
      }

      // 6. Resolve cited chunk IDs from [^cN] markers and build the citation footer.
      const citedChunkIds = extractCitations(fullMessage, retrieved)
      const citations = citedChunkIds
        .map((cid) => {
          const n = retrieved.findIndex((r) => r.chunkId === cid) + 1 // 1-indexed marker
          const meta = citationMap[cid]
          const chunk = retrieved.find((r) => r.chunkId === cid)
          if (!meta || !chunk || n <= 0) return null
          return {
            n,
            chunkId: cid,
            pageId: chunk.pageId,
            pageTitle: meta.pageTitle,
            ordinal: meta.ordinal,
            heading: meta.heading,
            preview: meta.preview,
          }
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)

      // 7. Persist the assistant message with citations.
      await db.chatMessage.create({
        data: {
          sessionId: id,
          role: 'assistant',
          content: fullMessage,
          citations: JSON.stringify(citations),
        },
      })
      await db.session.update({ where: { id }, data: { updatedAt: new Date() } })

      // 8. Emit the structured footer for the client.
      const footer =
        CITATION_SEPARATOR + JSON.stringify({ sessionId: id, citations })
      controller.enqueue(encoder.encode(footer))
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
