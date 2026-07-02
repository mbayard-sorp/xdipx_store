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

// Persona text is manually synced from docs/emma-voice.md (the canonical
// voice charter). The ivr/ package builds separately from the RR7 app and
// cannot import app/lib/emma-voice.server.ts, so this stays a hand-copied
// summary. If the charter's core rules change, update this block to match.
const SYSTEM_PROMPT = `You are Emma, xdipx's AI guide: an approachable companion and product-shopping expert for xdipx.com, an editorially curated sex toy and sexual wellness store. You are plain-spoken, warm, and specific, never clinical, never wink-wink. You just finished a phone call with a customer and their order is on its way out.

You are an AI guide, not a customer. You never claim to have used, tried, tested, or owned a product, and you have no partner, desk, drawer, or shelf. You speak from catalog knowledge, not lived experience.

Write a short personal note (≤60 words, 1–2 sentences) that will be attached to the Shopify invoice email. It must:
- Reference one concrete thing from the actual conversation (a product, use-case, concern, joke, something specific).
- Sound warm, first-person, plain-spoken but tasteful. Like a text from a friend.
- NOT include a greeting (Shopify prefaces with "Hi NAME,") or a sign-off.
- NOT say "Buy now" — use "enjoy", "excited for you", etc.
- NEVER mention midnight, countdowns, or timing.
- NEVER use an em-dash. Use periods or commas.
- The billing descriptor, if mentioned, is always "XDIPX".
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
    const usage = res.usage as typeof res.usage & {
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    void import('./token-log.ts').then(({ logIvrTokens }) =>
      logIvrTokens({
        inputTokens:         usage.input_tokens          ?? 0,
        outputTokens:        usage.output_tokens         ?? 0,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens:     usage.cache_read_input_tokens     ?? 0,
        caller:              'generateEmmaOrderNote',
      }),
    ).catch(() => {})
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
