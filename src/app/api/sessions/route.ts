/**
 * Sessions collection routes.
 *
 * POST   /api/sessions          — create a new session (optional name).
 * GET    /api/sessions          — list recent sessions (newest first, max 50).
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

interface ApiSession {
  id: string
  name: string | null
  createdAt: string
  updatedAt: string
}

function toApiSession(s: {
  id: string
  name: string | null
  createdAt: Date | string
  updatedAt: Date | string
}): ApiSession {
  return {
    id: s.id,
    name: s.name,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt,
  }
}

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const name =
    typeof body?.name === 'string' && body.name.trim().length > 0
      ? body.name.trim().slice(0, 200)
      : null

  const s = await db.session.create({ data: { name } })
  return NextResponse.json(toApiSession(s), { status: 201 })
}

export async function GET() {
  const sessions = await db.session.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })
  return NextResponse.json(sessions.map(toApiSession))
}
