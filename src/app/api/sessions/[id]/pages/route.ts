/**
 * Pages collection routes (per session).
 *
 * POST   /api/sessions/[id]/pages — body: { url? | text? | youtubeUrl?, summaryLength? }
 *                                 — fetch + extract + chunk + embed + LLM summary, persist Page,
 *                                   add chunks to in-memory corpus cache. Returns the new Page.
 * GET    /api/sessions/[id]/pages — list pages in this session (newest first).
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractPageContent } from '@/lib/page-extractor'
import { extractVideoId } from '@/lib/youtube-extractor'
import {
  chunkPlainText,
  embedStoredChunks,
  buildPageChunks,
  addPageToCorpus,
  type StoredChunk,
} from '@/lib/retrieval'
import { generateSummary } from '@/lib/ai'
import type { SummaryLength } from '@/lib/summary-builder'

export const runtime = 'nodejs'

function normalizeLength(s: unknown): SummaryLength {
  if (s === 'brief' || s === 'medium' || s === 'detailed') return s
  return 'medium'
}

function toApiPage(p: any) {
  return {
    id: p.id,
    sessionId: p.sessionId,
    url: p.url,
    title: p.title,
    content: p.content,
    summary: p.summary,
    summaryLength: p.summaryLength,
    sourceType: p.sourceType,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
  }
}

async function fetchYouTubeTranscript(videoId: string): Promise<string> {
  const mod: any = await import('youtube-transcript')
  const YT = mod.YoutubeTranscript ?? mod.default?.YoutubeTranscript ?? mod.default
  if (!YT || typeof YT.fetchTranscript !== 'function') {
    throw new Error('youtube-transcript module shape not recognised')
  }
  const segments = await YT.fetchTranscript(videoId, { lang: 'en' })
  if (!Array.isArray(segments) || segments.length === 0) return ''
  return segments
    .map((s: any) => (typeof s === 'string' ? s : s?.text))
    .filter((t: unknown) => typeof t === 'string' && t.length > 0)
    .join(' ')
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const url = typeof body?.url === 'string' ? body.url.trim() : null
  const text = typeof body?.text === 'string' ? body.text.trim() : null
  const youtubeUrl = typeof body?.youtubeUrl === 'string' ? body.youtubeUrl.trim() : null
  const summaryLength = normalizeLength(body?.summaryLength)

  if (!url && !text && !youtubeUrl) {
    return NextResponse.json(
      { error: 'Provide one of: url, text, or youtubeUrl' },
      { status: 400 },
    )
  }

  const session = await db.session.findUnique({ where: { id } })
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  let sourceType: string
  let title: string
  let mainText: string
  let pageUrl: string | null = null

  try {
    if (youtubeUrl) {
      sourceType = 'youtube'
      const videoId = extractVideoId(youtubeUrl)
      if (!videoId) {
        return NextResponse.json({ error: 'Could not parse a YouTube video ID from that URL' }, { status: 400 })
      }
      pageUrl = `https://www.youtube.com/watch?v=${videoId}`
      const transcript = await fetchYouTubeTranscript(videoId)
      if (!transcript || !transcript.trim()) {
        return NextResponse.json(
          { error: 'No transcript available for this video (it may be disabled or the video may be private)' },
          { status: 422 },
        )
      }
      title = `YouTube transcript · ${videoId}`
      mainText = transcript
    } else if (url) {
      sourceType = 'url'
      pageUrl = url
      const res = await fetch(url, {
        redirect: 'follow',
        headers: {
          'user-agent':
            'Mozilla/5.0 (compatible; DocSummarizer/1.0; +https://github.com/example/doc-summarizer)',
          accept: 'text/html,application/xhtml+xml',
        },
      })
      if (!res.ok) {
        return NextResponse.json({ error: `Fetch failed: HTTP ${res.status}` }, { status: 502 })
      }
      const html = await res.text()
      const ex = extractPageContent(html)
      title = ex.title || url
      mainText = ex.mainText
      if (!mainText || mainText.trim().length < 20) {
        return NextResponse.json(
          { error: 'No readable main text found on that page (it may be JS-rendered or paywalled)' },
          { status: 422 },
        )
      }
    } else {
      // pasted text
      sourceType = 'text'
      title = text!.slice(0, 80).replace(/\s+/g, ' ').trim() || 'Pasted text'
      mainText = text!
    }
  } catch (e) {
    return NextResponse.json(
      { error: 'Content extraction failed', detail: (e as Error).message },
      { status: 500 },
    )
  }

  // Chunk + embed (per-chunk tokens + vectors, stored as JSON on the Page row).
  let storedChunks: StoredChunk[]
  let vectors: Float32Array[]
  try {
    storedChunks = chunkPlainText(title, mainText)
    if (storedChunks.length === 0) {
      // Edge case: extremely short content produced no chunks. Force at least one.
      storedChunks = [
        {
          ordinal: 1,
          heading: title,
          content: mainText,
          tokens: [],
        },
      ]
    }
    vectors = await embedStoredChunks(storedChunks)
  } catch (e) {
    return NextResponse.json(
      { error: 'Embedding failed', detail: (e as Error).message },
      { status: 500 },
    )
  }

  // Summary — non-streaming LLM call. Continue even if it fails (page is still useful).
  let summary: string
  try {
    summary = await generateSummary(mainText, summaryLength)
  } catch (e) {
    summary = `(summary unavailable: ${(e as Error).message})`
  }

  // Persist the Page row.
  const page = await db.page.create({
    data: {
      sessionId: id,
      url: pageUrl,
      title,
      content: mainText,
      summary,
      summaryLength,
      sourceType,
      tokens: JSON.stringify(storedChunks),
      embedding: JSON.stringify(vectors.map((v) => Array.from(v))),
    },
  })

  // Add to the in-memory corpus cache so the chat route can skip the DB round-trip.
  const pageChunks = buildPageChunks(page.id, title, storedChunks, vectors)
  addPageToCorpus(id, pageChunks)

  return NextResponse.json(toApiPage(page), { status: 201 })
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const pages = await db.page.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(pages.map(toApiPage))
}
