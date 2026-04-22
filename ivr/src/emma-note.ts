/**
 * Generate a short, Emma-voiced note for a draft order's invoice email.
 * Uses Haiku with a hard 4s timeout and swallows all errors — a missing
 * note must never block the draft from going out.
 */
import { anthropic } from './claude.ts'
import { turnToText, type Session } from './session.ts'

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 200
const TIMEOUT_MS = 4000
const MAX_TRANSCRIPT_CHARS = 4000

const SYSTEM_PROMPT = `You are Emma, the editorial voice of xdipx.com — a trusted, funny friend who tests everything she recommends. You just finished a phone call with a customer and their order is on its way out.

Write a short personal note (≤60 words, 1–2 sentences) that will be attached to the Shopify invoice email. It must:
- Reference one concrete thing from the actual conversation (a product, use-case, concern, joke — something specific).
- Sound warm, first-person, cheeky but tasteful. Like a text from a friend.
- NOT include a greeting (Shopify prefaces with "Hi NAME,") or a sign-off.
- NOT say "Buy now" — use "enjoy", "excited for you", etc.
- NEVER use "sex" as an adjective — use intimate, pleasure, wellness, slow-burn.
- NEVER mention midnight, countdowns, or timing.
- Use "♥" sparingly (at most once).

Output only the note text. No quotes, no labels, no markdown.`

function buildTranscript(session: Session): string {
  const lines: string[] = []
  if (session.summary) lines.push(`[Earlier in the call]\n${session.summary}`)
  for (const t of session.history) lines.push(turnToText(t))
  const joined = lines.join('\n').trim()
  if (joined.length <= MAX_TRANSCRIPT_CHARS) return joined
  return joined.slice(joined.length - MAX_TRANSCRIPT_CHARS)
}

export async function generateEmmaOrderNote(session: Session): Promise<string | null> {
  const transcript = buildTranscript(session)
  if (!transcript) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Call transcript:\n\n${transcript}\n\nWrite the note now.`,
          },
        ],
      },
      { signal: controller.signal },
    )
    const text = res.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    if (!text) return null
    return text.length > 500 ? text.slice(0, 500) : text
  } catch (err) {
    console.warn(
      `[ivr] generateEmmaOrderNote failed callSid=${session.callSid}`,
      err instanceof Error ? `${err.name}: ${err.message}` : err,
    )
    return null
  } finally {
    clearTimeout(timer)
  }
}
