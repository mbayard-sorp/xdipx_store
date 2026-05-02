/**
 * xdipx IVR — Fly.io WebSocket server
 *
 * Accepts Twilio ConversationRelay WS connections, runs a streaming Claude
 * turn loop for each caller utterance, and forwards text deltas back to
 * Twilio for ElevenLabs TTS. Phase G adds silent-caller / runaway guards so
 * no call stays connected burning minutes when the caller isn't speaking.
 *
 * Phase 9: per-turn routing between v1 (local Claude) and v2 (Vercel engine).
 * When IVR_PIPELINE_VERSION=v2 or the caller's phone is in IVR_V2_PHONES,
 * each prompt is forwarded to the Vercel /api/emma-engine/turn endpoint.
 * The v1 local path is the fallback when v2 is unreachable or slow.
 */
import http from 'node:http'
import crypto from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { streamReply } from './claude.ts'
import { Session } from './session.ts'
import { type CallEndReason } from './config.ts'
import { recordCall } from './db.ts'
import { loadIvrSettings } from './settings.ts'
import { buildSystemPrompt } from './prompts.ts'
import { callQaTool } from './tools/catalog.ts'
import type { OutboundMessage, TwilioInboundMessage } from './types.ts'
import { callEngineV2 } from './v2-bridge.ts'

// ---------------------------------------------------------------------------
// Phase 9 — IVR pipeline version flag (mirrors Vercel-side ivr-pipeline-flag)
// ---------------------------------------------------------------------------

/** Parse a comma-separated E.164 allowlist from an env string. */
function parseIvrAllowlist(envVal: string | undefined): Set<string> {
  if (!envVal) return new Set()
  return new Set(envVal.split(',').map((p) => p.trim()).filter(Boolean))
}

const IVR_V2_PHONES = parseIvrAllowlist(process.env['IVR_V2_PHONES'])

function pickIvrPipelineVersion(callerPhone: string): 'v1' | 'v2' {
  if (IVR_V2_PHONES.has(callerPhone)) return 'v2'
  const raw = (process.env['IVR_PIPELINE_VERSION'] ?? 'v1').trim()
  return raw === 'v2' ? 'v2' : 'v1'
}

const PORT = Number(process.env['PORT'] ?? 8080)

// ─── HTTP server (for Fly healthchecks + WS upgrade) ─────────────────────────

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }
  res.writeHead(404)
  res.end()
})

// ─── WebSocket server ────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true })

// Shared secret check on WS upgrade. Twilio hits the URL we returned in TwiML,
// which includes ?token=…; any other caller trying the WS gets 401 at upgrade
// time before we allocate session state.
const EXPECTED_WS_TOKEN = process.env['IVR_WS_SECRET'] ?? ''

/**
 * Override session.limits with any per-call values Vercel passed via URL
 * params. Each param is optional; missing/invalid values keep the default
 * from config.ts (which already honors env vars).
 */
function applyLimitsFromUrl(session: Session, url: URL): void {
  const fields = [
    'initialSilenceMs',
    'interTurnSilenceMs',
    'maxCallDurationMs',
    'maxPrompts',
    'reEngageAttempts',
    'softTokenBudget',
  ] as const
  const overrides: string[] = []
  for (const f of fields) {
    const raw = url.searchParams.get(f)
    if (raw == null || raw === '') continue
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) continue
    session.limits[f] = n
    overrides.push(`${f}=${n}`)
  }
  if (overrides.length > 0) {
    console.log(`[ivr] limits overridden via URL: ${overrides.join(' ')}`)
  }
}

function timingSafeStringEq(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname !== '/relay') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
    return
  }
  const token = url.searchParams.get('token') ?? ''
  if (!EXPECTED_WS_TOKEN || !timingSafeStringEq(token, EXPECTED_WS_TOKEN)) {
    console.warn('[ivr] ws upgrade rejected — bad or missing token')
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})

wss.on('connection', (ws, req) => {
  const remote = req.socket.remoteAddress ?? 'unknown'
  console.log(`[ivr] ws connected from ${remote}`)

  // Extract the resolved greeting from the URL — the Vercel handler appends
  // the exact text to speak. Seeding it here (synchronously, before any
  // prompt can arrive) eliminates the race where a fast caller speaks before
  // the async settings load finishes.
  const wsUrl = new URL(req.url ?? '/', 'http://localhost')
  const greetingFromUrl = decodeURIComponent(wsUrl.searchParams.get('greeting') ?? '')

  const session = new Session()
  applyLimitsFromUrl(session, wsUrl)
  if (greetingFromUrl) session.addTurn('assistant', greetingFromUrl)

  ws.on('message', (raw) => {
    let msg: TwilioInboundMessage
    try {
      msg = JSON.parse(raw.toString()) as TwilioInboundMessage
    } catch (err) {
      console.error('[ivr] malformed message', err)
      return
    }

    switch (msg.type) {
      case 'setup': {
        session.callSid = msg.callSid
        session.fromNumber = msg.from
        session.toNumber = msg.to
        console.log(`[ivr] setup callSid=${session.callSid} from=${session.fromNumber}`)

        // Speak the greeting over WS instead of relying on TwiML's
        // welcomeGreeting attribute, which silently truncates long strings.
        if (greetingFromUrl) sendText(ws, greetingFromUrl, true)

        // Fetch admin-configured voice + farewells in parallel with collections.
        // A DB hiccup falls back to code defaults — see settings.ts.
        Promise.all([
          loadIvrSettings(),
          callQaTool('listCollections', {}).then((r) => {
            const res = r as { ok?: boolean; data?: { collections?: { title: string }[] } }
            return res.ok ? (res.data?.collections?.map(c => c.title) ?? []) : []
          }).catch(() => [] as string[]),
        ])
          .then(([s, collections]) => {
            session.settings = s
            session.systemPrompt = buildSystemPrompt(s.brandVoice, collections, s.farewellGoodbye)
            // If the URL didn't carry the greeting (old Vercel deploy), fall
            // back to a DB-resolved copy so Claude still knows it greeted.
            if (!greetingFromUrl && s.greeting) {
              session.addTurn('assistant', s.greeting)
              sendText(ws, s.greeting, true)
            }
          })
          .catch(() => { /* already logged in loader */ })
        // Start the silence clock, but pad it with estimated greeting TTS
        // duration — the caller can't respond until TTS finishes speaking.
        const greetingBuffer = greetingFromUrl ? estimateTtsMs(greetingFromUrl) : 5_000
        armInitialSilence(ws, session, greetingBuffer)
        session.armDuration(session.limits.maxCallDurationMs, () => wrapUp(ws, session))
        return
      }
      case 'prompt': {
        session.promptCount += 1
        session.reEngageCount = 0
        session.clearSilence()
        console.log(`[ivr] prompt callSid=${session.callSid}: ${msg.voicePrompt}`)

        if (session.promptCount > session.limits.maxPrompts) {
          console.warn(`[ivr] max prompts exceeded callSid=${session.callSid}`)
          endCall(ws, session, 'max_prompts', farewellFor(session, 'maxPrompts'))
          return
        }

        handlePrompt(ws, session, msg.voicePrompt)
        return
      }
      case 'interrupt': {
        console.log(`[ivr] interrupt callSid=${session.callSid}`)
        session.interrupt()
        return
      }
      case 'dtmf': {
        console.log(`[ivr] dtmf callSid=${session.callSid} digit=${msg.digit}`)
        return
      }
      case 'error': {
        console.error(`[ivr] twilio error callSid=${session.callSid}:`, msg.description)
        return
      }
      default: {
        console.warn('[ivr] unknown message type', msg)
      }
    }
  })

  ws.on('close', (code, reason) => {
    session.interrupt()
    session.clearTimers()
    const durationMs = Date.now() - session.startedAt
    console.log(
      `[ivr] ws closed callSid=${session.callSid} code=${code} reason=${reason.toString()} endReason=${session.endReason} prompts=${session.promptCount} durationMs=${durationMs}`,
    )
    if (session.callSid) {
      recordCall({
        callSid: session.callSid,
        fromNumber: session.fromNumber,
        toNumber: session.toNumber || null,
        endReason: session.endReason,
        durationSec: Math.round(durationMs / 1000),
        tokensTotal: session.tokensUsed,
      }).catch((err) => console.error('[ivr] recordCall failed', err))
    }
  })

  ws.on('error', (err) => {
    console.error(`[ivr] ws error callSid=${session.callSid}`, err)
  })
})

// Estimate how long TTS needs to speak text aloud. ~150 words/min with a
// small pad for inter-sentence pauses. Used to offset the silence timer so
// it starts from when the caller actually *hears* the end of the reply.
const TTS_WORDS_PER_SEC = 2.5
function estimateTtsMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.round((words / TTS_WORDS_PER_SEC) * 1000)
}

function handlePrompt(ws: WebSocket, session: Session, voicePrompt: string): void {
  if (!voicePrompt.trim()) {
    // Twilio sometimes sends empty prompts on false-positive VAD. Reset the
    // inter-turn timer and wait for real speech rather than bothering Claude.
    armInterTurnSilence(ws, session)
    return
  }
  session.addTurn('user', voicePrompt)

  // Phase 9: route to v2 engine or fall through to v1 local Claude.
  const pipelineVersion = session.fromNumber
    ? pickIvrPipelineVersion(session.fromNumber)
    : 'v1'

  if (pipelineVersion === 'v2') {
    handlePromptV2(ws, session, voicePrompt)
    return
  }

  handlePromptV1(ws, session, voicePrompt)
}

/**
 * Phase 9 v2 path — call the Vercel engine via HTTP, then speak the SSML
 * reply. Falls back to v1 if the engine is unreachable or returns null.
 */
function handlePromptV2(ws: WebSocket, session: Session, voicePrompt: string): void {
  const started = Date.now()

  callEngineV2({
    channel: 'voice',
    callerPhone: session.fromNumber,
    customerText: voicePrompt,
    callSid: session.callSid,
  }).then((reply) => {
    if (!reply) {
      // v2 engine unavailable — fall through to v1.
      console.warn(`[ivr] v2 engine unavailable callSid=${session.callSid} — falling back to v1`)
      handlePromptV1(ws, session, voicePrompt)
      return
    }

    const elapsed = Date.now() - started
    console.log(`[ivr] v2 reply callSid=${session.callSid} elapsed=${elapsed}ms hangup=${reply.hangup ?? false}`)

    if (ws.readyState !== ws.OPEN) return

    // Strip SSML tags for TTS — the Fly ConversationRelay bridge sends raw
    // text to ElevenLabs. The SSML is for structuring the reply on the
    // Vercel side; we extract the spoken text here.
    const spokenText = reply.ssml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (spokenText) {
      sendText(ws, spokenText, true)
      session.addTurn('assistant', spokenText)
    } else {
      sendText(ws, '', true)
    }

    // Handle hangup signal.
    if (reply.hangup) {
      endCall(ws, session, 'user_hangup', null)
      return
    }

    // Arm silence timer with TTS buffer.
    const ttsBuffer = estimateTtsMs(spokenText)
    armInterTurnSilence(ws, session, ttsBuffer)
  }).catch((err) => {
    console.error(`[ivr] v2 handlePromptV2 unexpected error callSid=${session.callSid}`, err)
    if (ws.readyState === ws.OPEN) {
      sendText(ws, "Sorry — I lost my train of thought. Can you say that again?", true)
    }
    armInterTurnSilence(ws, session)
  })
}

/**
 * Phase 9 v1 path — original local Claude streaming loop.
 * Renamed from handlePrompt to be callable from both routing branches.
 */
function handlePromptV1(ws: WebSocket, session: Session, voicePrompt: string): void {
  const started = Date.now()
  let firstTokenAt = 0
  let spokenText = ''

  streamReply(session, {
    onToken: (token) => {
      if (ws.readyState !== ws.OPEN) return
      if (!firstTokenAt) {
        firstTokenAt = Date.now()
        const ms = firstTokenAt - started
        console.log(`[ivr] first-token latency callSid=${session.callSid} ms=${ms}`)
        if (ms > session.limits.firstTokenSloMs) {
          console.warn(`[ivr] first-token SLO breach callSid=${session.callSid} ms=${ms} slo=${session.limits.firstTokenSloMs}`)
        }
      }
      spokenText += token
      sendText(ws, token, false)
    },
    onDone: () => {
      if (ws.readyState === ws.OPEN) sendText(ws, '', true)
      // The silence timer starts now, but TTS is still speaking the reply.
      // Estimate how much longer TTS needs by subtracting the time that has
      // already elapsed since the first token (TTS has been playing since then).
      const ttsTotal = estimateTtsMs(spokenText)
      const alreadySpoken = firstTokenAt ? Date.now() - firstTokenAt : 0
      const ttsBuffer = Math.min(Math.max(0, ttsTotal - alreadySpoken), 15_000)
      armInterTurnSilence(ws, session, ttsBuffer)
    },
    onError: (err) => {
      console.error(`[ivr] claude error callSid=${session.callSid}`, err)
      if (ws.readyState === ws.OPEN) {
        sendText(ws, "Sorry — I lost my train of thought. Can you say that again?", true)
      }
      armInterTurnSilence(ws, session)
    },
  })
}

// ─── Silence handling ────────────────────────────────────────────────────────

function armInitialSilence(ws: WebSocket, session: Session, ttsBufferMs = 0): void {
  session.armSilence(session.limits.initialSilenceMs + ttsBufferMs, () => onSilence(ws, session))
}

function armInterTurnSilence(ws: WebSocket, session: Session, ttsBufferMs = 0): void {
  session.armSilence(session.limits.interTurnSilenceMs + ttsBufferMs, () => onSilence(ws, session))
}

function onSilence(ws: WebSocket, session: Session): void {
  if (ws.readyState !== ws.OPEN) return
  if (session.reEngageCount < session.limits.reEngageAttempts) {
    session.reEngageCount += 1
    console.log(`[ivr] re-engage callSid=${session.callSid} attempt=${session.reEngageCount}`)
    sendText(ws, "Still with me? Just say what you're calling about.", true)
    armInterTurnSilence(ws, session)
    return
  }
  endCall(ws, session, 'silent_caller', farewellFor(session, 'silent'))
}

function wrapUp(ws: WebSocket, session: Session): void {
  if (ws.readyState !== ws.OPEN) return
  console.log(`[ivr] max duration reached callSid=${session.callSid}`)
  endCall(ws, session, 'max_duration', farewellFor(session, 'maxDuration'))
}

/** Resolve the admin-configured farewell for a given end reason, or null to
 *  hang up silently. Empty string in settings means "no farewell". */
function farewellFor(session: Session, which: 'maxPrompts' | 'maxDuration' | 'silent'): string | null {
  const s = session.settings
  if (!s) return null
  const raw =
    which === 'maxPrompts' ? s.farewellMaxPrompts :
    which === 'maxDuration' ? s.farewellMaxDuration :
    s.farewellSilent
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function endCall(
  ws: WebSocket,
  session: Session,
  reason: CallEndReason,
  farewell: string | null,
): void {
  session.endReason = reason
  session.interrupt()
  session.clearTimers()
  if (farewell) sendText(ws, farewell, true)
  const end: OutboundMessage = { type: 'end', handoffData: JSON.stringify({ reason }) }
  try {
    ws.send(JSON.stringify(end))
  } catch (err) {
    console.error(`[ivr] failed to send end frame callSid=${session.callSid}`, err)
  }
}

function sendText(ws: WebSocket, text: string, last: boolean): void {
  const msg: OutboundMessage = { type: 'text', token: text, last }
  ws.send(JSON.stringify(msg))
}

// ─── Boot ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[ivr] listening on :${PORT} (ws path /relay)`)
})

// Graceful shutdown for Fluid / Fly instance recycling.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`[ivr] ${sig} received — closing`)
    wss.clients.forEach((c) => c.close(1001, 'server shutdown'))
    httpServer.close(() => process.exit(0))
  })
}
