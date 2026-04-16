/**
 * xdipx IVR — Fly.io WebSocket server
 *
 * Accepts Twilio ConversationRelay WS connections, runs a streaming Claude
 * turn loop for each caller utterance, and forwards text deltas back to
 * Twilio for ElevenLabs TTS. Phase G adds silent-caller / runaway guards so
 * no call stays connected burning minutes when the caller isn't speaking.
 */
import http from 'node:http'
import crypto from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { streamReply } from './claude.ts'
import { Session } from './session.ts'
import { IVR_LIMITS, type CallEndReason } from './config.ts'
import { recordCall } from './db.ts'
import { loadIvrSettings } from './settings.ts'
import { buildSystemPrompt } from './prompts.ts'
import type { OutboundMessage, TwilioInboundMessage } from './types.ts'

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

  const session = new Session()

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
        // Fetch admin-configured voice + farewells in parallel with the greeting.
        // A DB hiccup falls back to code defaults — see settings.ts.
        loadIvrSettings()
          .then((s) => {
            session.settings = s
            session.systemPrompt = buildSystemPrompt(s.brandVoice)
          })
          .catch(() => { /* already logged in loader */ })
        // Start the silence + duration clocks as soon as the greeting begins.
        armInitialSilence(ws, session)
        session.armDuration(IVR_LIMITS.maxCallDurationMs, () => wrapUp(ws, session))
        return
      }
      case 'prompt': {
        session.promptCount += 1
        session.reEngageCount = 0
        session.clearSilence()
        console.log(`[ivr] prompt callSid=${session.callSid}: ${msg.voicePrompt}`)

        if (session.promptCount > IVR_LIMITS.maxPrompts) {
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

function handlePrompt(ws: WebSocket, session: Session, voicePrompt: string): void {
  if (!voicePrompt.trim()) {
    // Twilio sometimes sends empty prompts on false-positive VAD. Reset the
    // inter-turn timer and wait for real speech rather than bothering Claude.
    armInterTurnSilence(ws, session)
    return
  }
  session.addTurn('user', voicePrompt)

  const started = Date.now()
  let firstTokenAt = 0

  streamReply(session, {
    onToken: (token) => {
      if (ws.readyState !== ws.OPEN) return
      if (!firstTokenAt) {
        firstTokenAt = Date.now()
        const ms = firstTokenAt - started
        console.log(`[ivr] first-token latency callSid=${session.callSid} ms=${ms}`)
        if (ms > IVR_LIMITS.firstTokenSloMs) {
          console.warn(`[ivr] first-token SLO breach callSid=${session.callSid} ms=${ms} slo=${IVR_LIMITS.firstTokenSloMs}`)
        }
      }
      sendText(ws, token, false)
    },
    onDone: () => {
      if (ws.readyState === ws.OPEN) sendText(ws, '', true)
      // Caller's turn to speak — start the inter-turn silence clock.
      armInterTurnSilence(ws, session)
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

function armInitialSilence(ws: WebSocket, session: Session): void {
  session.armSilence(IVR_LIMITS.initialSilenceMs, () => onSilence(ws, session))
}

function armInterTurnSilence(ws: WebSocket, session: Session): void {
  session.armSilence(IVR_LIMITS.interTurnSilenceMs, () => onSilence(ws, session))
}

function onSilence(ws: WebSocket, session: Session): void {
  if (ws.readyState !== ws.OPEN) return
  if (session.reEngageCount < IVR_LIMITS.reEngageAttempts) {
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
