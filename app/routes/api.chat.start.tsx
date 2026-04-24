import type { ActionFunctionArgs } from 'react-router'
import { serialize as serializeCookie } from 'cookie'
import { randomUUID } from 'node:crypto'
import { db } from '~/lib/db.server'
import { chatSessions } from '../../db/schema'
import { getClientIP, getStoredUTM, getStoredRefCode, hashIP } from '~/lib/attribution.server'
import { logConsent } from '~/lib/consent.server'
import { subscribeToDailyDeal } from '~/lib/klaviyo.server'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'
import { rejectIfBot } from '~/lib/botid.server'
import { loadChatSettings } from '~/lib/emma/settings.server'

const SESSION_COOKIE = '__xdipx_chat'
const SESSION_MAX_AGE = 60 * 60 * 24 // 24h
const POLICY_VERSION = '1.0'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D+/g, '')
  if (!digits) return null
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`
  return null
}

export async function loader() {
  return Response.json(null)
}

export async function action({ request }: ActionFunctionArgs) {
  const bot = await rejectIfBot()
  if (bot) return bot
  const rl = await checkRateLimit(request, 'chat-start', 5, 3600)
  if (!rl.ok) return rateLimited()

  const form = await request.formData()
  const rawEmail = (form.get('email') as string | null)?.trim() || null
  const rawPhone = (form.get('phone') as string | null)?.trim() || null

  const email = rawEmail && EMAIL_RE.test(rawEmail) ? rawEmail.toLowerCase() : null
  const phone = rawPhone ? normalizePhone(rawPhone) : null
  if (rawPhone && !phone) {
    return Response.json({ error: 'Please enter a valid phone number.' }, { status: 400 })
  }
  if (rawEmail && !email) {
    return Response.json({ error: 'Please enter a valid email.' }, { status: 400 })
  }
  if (!email && !phone) {
    return Response.json({ error: 'Email or phone required.' }, { status: 400 })
  }

  const sessionId = randomUUID()
  const utm = getStoredUTM(request)
  const ref = getStoredRefCode(request)

  try {
    await db.insert(chatSessions).values({
      id:        sessionId,
      email,
      phone,
      utm:       utm ? { source: utm.source ?? '', medium: utm.medium ?? '', campaign: utm.campaign ?? '', content: utm.content ?? '' } : null,
      ref,
      ipHash:    hashIP(getClientIP(request)),
      userAgent: request.headers.get('user-agent') ?? null,
      status:    'active',
    })
  } catch (err) {
    console.error('[chat.start] DB insert failed', err)
    return Response.json({ error: 'Could not start chat.' }, { status: 500 })
  }

  try {
    await logConsent(request, { sessionId, consentType: 'chat', policyVersion: POLICY_VERSION })
  } catch (err) {
    console.warn('[chat.start] logConsent failed', err)
  }

  if (email) {
    subscribeToDailyDeal(email).catch((err) => {
      console.warn('[chat.start] klaviyo subscribe failed', err)
    })
  }

  const settings = await loadChatSettings()
  const cookie = serializeCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    path:     '/',
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   SESSION_MAX_AGE,
  })

  return Response.json(
    { ok: true, sessionId, greeting: settings.greeting },
    { headers: { 'Set-Cookie': cookie } },
  )
}
