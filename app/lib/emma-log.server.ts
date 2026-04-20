import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from './db.server'
import { emmaChatEvents, emmaChatSessions, emmaChatTurns } from '../../db/schema'
import type { EmmaQuickReplyLog } from '../../db/schema'
import { getClientIP, hashIP } from './attribution.server'

const COOKIE_NAME = 'xdipx_emma_sid'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 60 // 60 days

export interface EmmaSessionHandle {
  sessionId: number
  cookieId: string
  /** Non-null when a new cookie needs to be set on the response. */
  setCookieHeader: string | null
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1))
  }
  return null
}

function buildSetCookie(value: string): string {
  const secure = process.env['NODE_ENV'] === 'production' ? '; Secure' : ''
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; HttpOnly${secure}`
}

/**
 * Resolve an existing Emma chat session by cookie, or insert a new one.
 * Idempotent: if the cookie is present but the row was purged, we mint a new
 * session and ask the caller to overwrite the cookie.
 */
export async function getOrCreateEmmaSession(
  request: Request,
  customerGid?: string | null,
): Promise<EmmaSessionHandle> {
  const existing = readCookie(request.headers.get('Cookie'), COOKIE_NAME)
  if (existing) {
    const rows = await db
      .select({ id: emmaChatSessions.id })
      .from(emmaChatSessions)
      .where(eq(emmaChatSessions.cookieId, existing))
      .limit(1)
    if (rows[0]) {
      return { sessionId: rows[0].id, cookieId: existing, setCookieHeader: null }
    }
  }

  const cookieId = randomUUID()
  const ua = (request.headers.get('User-Agent') || '').slice(0, 255)
  const [inserted] = await db
    .insert(emmaChatSessions)
    .values({
      cookieId,
      customerGid: customerGid ?? null,
      ipHash: hashIP(getClientIP(request)),
      userAgent: ua,
    })
    .returning({ id: emmaChatSessions.id })

  return {
    sessionId: inserted!.id,
    cookieId,
    setCookieHeader: buildSetCookie(cookieId),
  }
}

export interface EmmaTurnLogEntry {
  role: 'user' | 'assistant'
  text: string
  hidden?: boolean
  products?: string[]
  quickReply?: EmmaQuickReplyLog | null
  latencyMs?: number
}

export async function logEmmaTurns(sessionId: number, entries: EmmaTurnLogEntry[]): Promise<void> {
  if (entries.length === 0) return
  await db.insert(emmaChatTurns).values(
    entries.map((e) => ({
      sessionId,
      role: e.role,
      text: e.text.slice(0, 8000),
      hidden: e.hidden ?? false,
      products: e.products ?? null,
      quickReply: e.quickReply ?? null,
      latencyMs: e.latencyMs ?? null,
    })),
  )
  await db
    .update(emmaChatSessions)
    .set({
      turnCount: sql`${emmaChatSessions.turnCount} + ${entries.length}`,
      lastActivityAt: new Date(),
    })
    .where(eq(emmaChatSessions.id, sessionId))
}

export async function logEmmaEvent(
  sessionId: number,
  kind: string,
  payload: unknown,
  turnId?: number,
): Promise<void> {
  await db.insert(emmaChatEvents).values({
    sessionId,
    kind: kind.slice(0, 30),
    payload: payload ?? null,
    turnId: turnId ?? null,
  })
}

export async function markCheckoutShared(sessionId: number, url: string): Promise<void> {
  await db
    .update(emmaChatSessions)
    .set({ checkoutUrlShared: url, checkoutSharedAt: new Date() })
    .where(eq(emmaChatSessions.id, sessionId))
}
