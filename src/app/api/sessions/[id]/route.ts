/**
 * Single session routes.
 *
 * GET    /api/sessions/[id]     — full session detail: pages + messages + highlights.
 * DELETE /api/sessions/[id]     — cascade-delete the session and all its children.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clearSessionCorpus } from '@/lib/retrieval'

export const runtime = 'nodejs'

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

function toApiMessage(m: any) {
  return {
    id: m.id,
    sessionId: m.sessionId,
    role: m.role,
    content: m.content,
    citations: m.citations,
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
  }
}

function toApiHighlight(h: any) {
  return {
    id: h.id,
    text: h.text,
    note: h.note,
    pageId: h.pageId,
    page: h.page ?? null,
    createdAt: h.createdAt instanceof Date ? h.createdAt.toISOString() : h.createdAt,
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const s = await db.session.findUnique({
    where: { id },
    include: {
      pages: { orderBy: { createdAt: 'desc' } },
      messages: { orderBy: { createdAt: 'asc' } },
      highlights: {
        orderBy: { createdAt: 'desc' },
        include: { page: { select: { id: true, title: true, url: true } } },
      },
    },
  })
  if (!s) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  return NextResponse.json({
    id: s.id,
    name: s.name,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt,
    pages: s.pages.map(toApiPage),
    messages: s.messages.map(toApiMessage),
    highlights: s.highlights.map(toApiHighlight),
  })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  clearSessionCorpus(id)
  try {
    await db.session.delete({ where: { id } })
  } catch {
    // not found — idempotent delete
  }
  return NextResponse.json({ ok: true })
}
