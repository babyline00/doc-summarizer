/**
 * Per-session retrieval service.
 *
 * Doc Summarizer summarises one or more pages (URL / pasted text / YouTube
 * transcript) into a single Session. The follow-up chat needs to RAG over the
 * UNION of all chunks across all pages in the session — e.g. a question may be
 * answered by a chunk from page A even though the user is currently viewing
 * page B's summary.
 *
 * `retrieveAcrossPages(query, pages)` is the pure top-K hybrid retriever. It
 * takes a pre-built list of `PageChunk` (chunkId, pageId, pageTitle, tokens,
 * vector) and returns the ranked chunks. The API route is responsible for
 * loading pages from the DB, deserialising their stored tokens + vectors, and
 * building the `PageChunk[]` — this keeps the retriever pure and trivially
 * unit-testable.
 *
 * A tiny in-memory `sessionCorpusCache` is kept so the chat route can skip the
 * DB round-trip on hot sessions; it is invalidated whenever a page is added
 * or removed.
 */

import { tokenize } from './tokenizer'
import { BM25Index } from './bm25'
import { cosine, getEmbeddingProvider } from './embeddings'
import { fuseHits } from './hybrid-search'
import { splitBodyByTokens } from './chunker'

export interface PageChunk {
  chunkId: string
  pageId: string
  pageTitle: string
  ordinal: number
  heading: string
  content: string
  tokens: string[]
  vector: Float32Array
}

export interface RetrievedChunk {
  chunkId: string
  pageId: string
  pageTitle: string
  ordinal: number
  heading: string
  content: string
  bm25Score: number
  vectorScore: number
  fusedScore: number
}

/**
 * Serialised chunk record stored in `Page.tokens` (as JSON array). Parallel
 * to the vectors array stored in `Page.embedding`.
 */
export interface StoredChunk {
  ordinal: number
  heading: string
  content: string
  tokens: string[]
}

const TOP_K = 8

/**
 * Chunk a plain-text page body (no markdown headings) into overlap-windowed
 * token-budgeted chunks, each tagged with the page title as its heading.
 */
export function chunkPlainText(
  title: string,
  text: string,
  opts: { targetTokens?: number; overlapTokens?: number } = {},
): StoredChunk[] {
  const target = opts.targetTokens ?? 256
  const overlap = opts.overlapTokens ?? 48
  const bodies = splitBodyByTokens(text, target, overlap)
  return bodies.map((body, i) => ({
    ordinal: i + 1,
    heading: title,
    content: body,
    tokens: tokenize(body),
  }))
}

/**
 * Embed every stored chunk using the active embedding provider. Returns a
 * vector array parallel to `chunks`.
 */
export async function embedStoredChunks(
  chunks: StoredChunk[],
): Promise<Float32Array[]> {
  const provider = getEmbeddingProvider()
  return Promise.all(chunks.map((c) => provider.embed(c.content)))
}

/**
 * Zip stored chunks + vectors into the PageChunk[] shape the retriever expects.
 * The chunkId is `${pageId}::${ordinal}` so it is unique across the whole
 * session corpus while remaining decomposable.
 */
export function buildPageChunks(
  pageId: string,
  pageTitle: string,
  chunks: StoredChunk[],
  vectors: Float32Array[],
): PageChunk[] {
  return chunks.map((c, i) => ({
    chunkId: `${pageId}::${c.ordinal}`,
    pageId,
    pageTitle,
    ordinal: c.ordinal,
    heading: c.heading,
    content: c.content,
    tokens: c.tokens,
    vector: vectors[i] ?? new Float32Array(0),
  }))
}

/**
 * Hybrid retrieval (BM25 + vector cosine fused via RRF) across all chunks of
 * all pages in a session. Returns the top-K chunks ranked by fused score.
 *
 * Pure: takes the pre-built PageChunk[] and returns RetrievedChunk[] — no IO,
 * no globals (apart from the deterministic embedding provider, which in the
 * test environment falls back to the hashing embedder).
 */
export async function retrieveAcrossPages(
  query: string,
  pages: PageChunk[],
  opts: { topK?: number } = {},
): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? TOP_K
  if (!pages.length) return []
  if (!query || !query.trim()) return []

  // BM25 over the union of all chunks.
  const bm25 = new BM25Index(pages.map((p) => ({ id: p.chunkId, tokens: p.tokens })))
  const bm25Hits = bm25.search(query, topK * 2)

  // Vector similarity over the same union.
  const provider = getEmbeddingProvider()
  const qVec = await provider.embed(query)
  const vecHits = pages
    .map((p) => ({ id: p.chunkId, score: cosine(qVec, p.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 2)

  const fused = fuseHits(
    bm25Hits.map((h) => ({ id: h.id, score: h.score })),
    vecHits.map((h) => ({ id: h.id, score: h.score })),
    { topK },
  )

  const byId = new Map(pages.map((p) => [p.chunkId, p]))
  return fused.map((f) => {
    const p = byId.get(f.id)!
    return {
      chunkId: p.chunkId,
      pageId: p.pageId,
      pageTitle: p.pageTitle,
      ordinal: p.ordinal,
      heading: p.heading,
      content: p.content,
      bm25Score: f.bm25Score,
      vectorScore: f.vectorScore,
      fusedScore: f.fusedScore,
    }
  })
}

// ---------------------------------------------------------------------------
// In-memory session corpus cache (optional hot-path optimisation)
// ---------------------------------------------------------------------------

const sessionCorpusCache = new Map<string, PageChunk[]>()

export function addPageToCorpus(sessionId: string, chunks: PageChunk[]): void {
  const existing = sessionCorpusCache.get(sessionId) ?? []
  sessionCorpusCache.set(sessionId, [...existing, ...chunks])
}

export function removePageFromCorpus(sessionId: string, pageId: string): void {
  const existing = sessionCorpusCache.get(sessionId)
  if (!existing) return
  sessionCorpusCache.set(sessionId, existing.filter((c) => c.pageId !== pageId))
}

export function getSessionCorpus(sessionId: string): PageChunk[] | undefined {
  return sessionCorpusCache.get(sessionId)
}

export function setSessionCorpus(sessionId: string, chunks: PageChunk[]): void {
  sessionCorpusCache.set(sessionId, chunks)
}

export function clearSessionCorpus(sessionId: string): void {
  sessionCorpusCache.delete(sessionId)
}
