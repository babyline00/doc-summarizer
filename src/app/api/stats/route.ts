/**
 * GET /api/stats — corpus size summary (used by the UI header).
 */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  const [sessions, pages, messages, highlights] = await Promise.all([
    db.session.count(),
    db.page.count(),
    db.chatMessage.count(),
    db.highlight.count(),
  ])
  return NextResponse.json({ sessions, pages, messages, highlights })
}
