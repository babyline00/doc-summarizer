/**
 * DELETE /api/highlights/[id] — remove a single saved Highlight.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    await db.highlight.delete({ where: { id } })
  } catch {
    // not found — idempotent delete
  }
  return NextResponse.json({ ok: true })
}
