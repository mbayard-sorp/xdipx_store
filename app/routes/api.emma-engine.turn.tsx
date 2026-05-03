/**
 * POST /api/emma-engine/turn
 *
 * Phase 9 — Internal engine turn endpoint.
 *
 * The Fly.io IVR bridge calls this per conversation turn when the caller's
 * phone is routed to the v2 pipeline (IVR_PIPELINE_VERSION=v2 or
 * IVR_V2_PHONES allowlist).
 *
 * Authentication: constant-time comparison of the `x-internal-secret` header
 * against the INTERNAL_API_SECRET env var (32+ char shared secret). 401 on mismatch.
 *
 * Rate limiting: keyed by callerPhone, 20 req/min. 429 on breach.
 *
 * Request body (JSON):
 *   {
 *     channel: 'voice'
 *     callerPhone: string    // E.164
 *     customerText: string   // ASR transcript or DTMF-normalized
 *     callSid: string        // Twilio Call SID
 *     conversationId?: string
 *     intentHint?: 'dtmf' | 'speech'
 *   }
 *
 * Response (200, JSON): VoiceReply
 *
 * The GET loader is disabled in production.
 */
import crypto from 'node:crypto'
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { processVoiceMessageV2 } from '~/lib/sms-v2/adapters/voice.server'
import type { ProcessVoiceInput, VoiceReply } from '~/lib/sms-v2/adapters/voice.server'

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison of the x-internal-secret header against the
 * INTERNAL_API_SECRET env var. Returns false if the env var is unset or empty.
 *
 * timingSafeEqual requires equal-length buffers. We pad/truncate with a
 * fixed-length HMAC so the comparison is always constant-time regardless of
 * secret or header length.
 */
function checkInternalSecret(request: Request): boolean {
  const envSecret = process.env['INTERNAL_API_SECRET'] ?? ''
  if (!envSecret) {
    console.error('[engine-turn] INTERNAL_API_SECRET not set — rejecting all requests')
    return false
  }
  const header = request.headers.get('x-internal-secret') ?? ''

  // Normalise both sides to a fixed-length SHA-256 HMAC so timingSafeEqual
  // doesn't leak length information.
  const key = Buffer.from('internal-secret-comparison')
  const expected = crypto.createHmac('sha256', key).update(envSecret).digest()
  const actual = crypto.createHmac('sha256', key).update(header).digest()

  return crypto.timingSafeEqual(expected, actual)
}

// ---------------------------------------------------------------------------
// Rate limiting — simple in-process counter (Fluid Compute / single instance)
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 20

interface RateWindow {
  count: number
  resetAt: number
}

const _rateBuckets = new Map<string, RateWindow>()

function checkRateLimitByPhone(callerPhone: string): boolean {
  const now = Date.now()
  let bucket = _rateBuckets.get(callerPhone)
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
    _rateBuckets.set(callerPhone, bucket)
  }
  bucket.count += 1
  return bucket.count <= RATE_LIMIT_MAX
}

// ---------------------------------------------------------------------------
// Request body validation
// ---------------------------------------------------------------------------

interface TurnRequestBody {
  channel: 'voice'
  callerPhone: string
  customerText: string
  callSid: string
  conversationId?: string | undefined
  intentHint?: 'dtmf' | 'speech' | undefined
}

function parseTurnBody(raw: unknown): TurnRequestBody | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>

  if (b['channel'] !== 'voice') return null
  if (typeof b['callerPhone'] !== 'string' || !b['callerPhone']) return null
  if (typeof b['customerText'] !== 'string') return null
  if (typeof b['callSid'] !== 'string' || !b['callSid']) return null

  const result: TurnRequestBody = {
    channel: 'voice',
    callerPhone: b['callerPhone'],
    customerText: b['customerText'],
    callSid: b['callSid'],
  }

  if (typeof b['conversationId'] === 'string' && b['conversationId']) {
    result.conversationId = b['conversationId']
  }
  if (b['intentHint'] === 'dtmf' || b['intentHint'] === 'speech') {
    result.intentHint = b['intentHint']
  }

  return result
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  // 1. Auth
  if (!checkInternalSecret(request)) {
    console.warn('[engine-turn] auth failed — bad or missing x-internal-secret')
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse body
  let body: TurnRequestBody | null
  try {
    const raw = await request.json()
    body = parseTurnBody(raw)
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body) {
    return Response.json(
      { error: 'Missing required fields: channel (must be "voice"), callerPhone, customerText, callSid' },
      { status: 400 },
    )
  }

  // 3. Rate limit
  if (!checkRateLimitByPhone(body.callerPhone)) {
    console.warn(`[engine-turn] rate limited callerPhone=${body.callerPhone}`)
    return Response.json(
      { error: 'Too many requests. Please slow down.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }

  // 4. Process
  const input: ProcessVoiceInput = {
    callerPhone: body.callerPhone,
    customerText: body.customerText,
    callSid: body.callSid,
    ...(body.conversationId !== undefined && { conversationId: body.conversationId }),
    ...(body.intentHint !== undefined && { intentHint: body.intentHint }),
  }

  let reply: VoiceReply
  try {
    reply = await processVoiceMessageV2(input)
  } catch (err) {
    console.error('[engine-turn] processVoiceMessageV2 crashed', err)
    return Response.json(
      {
        ssml: '<speak>Sorry, I ran into a problem. Please try again.</speak>',
        prompts: { kind: 'say-and-listen' },
      } satisfies VoiceReply,
      { status: 200 }, // 200 so the Fly bridge doesn't trigger a v1 fallback on a 5xx
    )
  }

  return Response.json(reply, { status: 200 })
}

// ---------------------------------------------------------------------------
// Loader — disabled in production
// ---------------------------------------------------------------------------

export function loader({ request: _request }: LoaderFunctionArgs) {
  if (process.env['NODE_ENV'] === 'production') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  return Response.json({ status: 'ok', endpoint: 'api.emma-engine.turn', channel: 'voice' })
}
