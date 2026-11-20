/**
 * Highlights collection routes (per session).
 *
 * POST   /api/sessions/[id]/highlights — body: { text, note?, pageId? }
 *                                   — persist a saved highlight. pageId must
 *                                     belong to this session (if provided).
 * GET    /api/sessions/[id]/highlights — list highlights in this session
 *                                    (newest first), with the page relation
 *                                    eager-loaded for the UI.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const text = (body?.text ?? '').toString().trim()
  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }
  if (text.length > 8000) {
    return NextResponse.json({ error: 'text too long (max 8000 chars)' }, { status: 400 })
  }
  const note =
    typeof body?.note === 'string' && body.note.trim().length > 0
      ? body.note.trim().slice(0, 2000)
      : null
  const rawPageId = typeof body?.pageId === 'string' ? body.pageId : null
  const pageId = rawPageId && rawPageId !== '(none)' ? rawPageId : null

  const session = await db.session.findUnique({ where: { id } })
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (pageId) {
    const page = await db.page.findUnique({ where: { id: pageId } })
    if (!page || page.sessionId !== id) {
      return NextResponse.json(
        { error: 'pageId does not belong to this session' },
        { status: 400 },
      )
    }
  }

  const hl = await db.highlight.create({
    data: { sessionId: id, text, note, pageId },
    include: { page: { select: { id: true, title: true, url: true } } },
  })
  return NextResponse.json(toApiHighlight(hl), { status: 201 })
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const hls = await db.highlight.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: 'desc' },
    include: { page: { select: { id: true, title: true, url: true } } },
  })
  return NextResponse.json(hls.map(toApiHighlight))
}
