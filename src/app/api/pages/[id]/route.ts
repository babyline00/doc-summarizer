/**
 * DELETE /api/pages/[id] — remove a single Page from its session.
 *
 * Also drops the page's chunks from the in-memory session corpus cache so the
 * follow-up chat can't reference the deleted page's content.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { removePageFromCorpus } from '@/lib/retrieval'

export const runtime = 'nodejs'

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const page = await db.page.findUnique({ where: { id }, select: { sessionId: true } })
  if (!page) {
    return NextResponse.json({ error: 'Page not found' }, { status: 404 })
  }
  removePageFromCorpus(page.sessionId, id)
  await db.page.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
