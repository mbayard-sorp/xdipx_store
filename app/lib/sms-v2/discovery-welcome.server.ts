/**
 * app/lib/sms-v2/discovery-welcome.server.ts
 *
 * Haiku-generated warm welcome for the FIRST turn of a discovery
 * conversation. Replaces the static MOOD opener bank for first contact —
 * after the first turn, the gate machine takes over with the bank-driven
 * questions.
 *
 * Why this exists:
 *   - The static MOOD bank had openers like "Oh hey. Before I throw stuff
 *     at you..." which work but lack warmth and don't invite vulnerability.
 *   - Customers shopping for sexual-wellness products need a sense of
 *     safety / non-judgment in the opening turn before they'll share
 *     enough for a good recommendation.
 *   - Personalizing the opener per call (returning vs new, what they said
 *     in their first message) makes Emma feel like a real person, not a
 *     scripted bot.
 *
 * Cost / latency:
 *   - One Haiku call per first contact, ~150-200 tokens out, ~150 tokens in.
 *     Sub-cent per call. Latency typically 800-1500ms.
 *   - On voice this adds to the first-token latency budget. Worth it for
 *     the trust-building moment, but we fall back to a static greeting on
 *     any error so a Haiku failure can't break the call.
 */
import Anthropic from '@anthropic-ai/sdk'
import { getSmsConfig, fillReturningGreeting, SMS_DEFAULTS } from './sms-config.server'

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

let _anthropic = new Anthropic({
  apiKey: (process.env['ANTHROPIC_API_KEY'] ?? '').trim(),
})

/** Test hook — swap the client to avoid real API calls. */
export function _setAnthropicClient(client: Anthropic): void {
  _anthropic = client
}

const SYSTEM = `You are Emma, the editorial voice of xdipx.com — an editorially-curated sexual-wellness storefront. Generate the FIRST turn of a discovery conversation.

VOICE RULES (non-negotiable):
- Trusted-friend tone. Personal, warm, curious. Never clinical, never sleazy.
- Suggestive is fine, explicit is not.
- Never use "sex" as an adjective. Use "intimate", "pleasure", "wellness", "satisfaction".
- No em-dashes. Use commas, periods, or hyphens in compounds.
- No countdowns, no "buy now", no "I'll take it" CTAs in this turn.
- Brand: XDIPX (pronounced "ex-dip-ex").

WHAT THIS TURN DOES:
1. Acknowledge that these picks are personal — set a safe, non-judgmental tone.
2. Offer to help find exactly the right thing.
3. If returning customer: warm welcome back, invite them to keep building their collection.
4. If first-time: name it gently — first time is amazing, no judgment, you'll find what fits.
5. Make it clear that if they're open to sharing, you're open to listening — vulnerability is safe.
6. End with ONE open mood/feeling/sensation question, with 2-3 concrete examples so they have something to grab onto. Examples: "something gentle and warming", "something powerful and intense", "playful and fun", "slow and tender".

CHANNEL ADAPTATION:
- voice: spoken aloud by TTS. Use short complete sentences. NEVER include URLs, asterisks, markdown, or special characters that don't read well aloud. Aim for 35-60 words total.
- sms: short, no markdown, line breaks fine. Aim for 40-70 words.
- web: can be slightly longer / use line breaks for readability. Aim for 50-90 words.

OUTPUT:
- Return ONLY Emma's prose. No JSON, no preamble, no quotes around the answer.
- The first character must be Emma's first word.
- Do NOT mention specific products by name in this turn — that comes later after we know what they want.
- Do NOT ask multiple questions stacked on top of each other. ONE mood question at the end.`

export interface WelcomeInput {
  channel: 'sms' | 'voice' | 'web'
  customerFirstName?: string | null | undefined
  customerGid?: string | null | undefined
  /** Their first inbound message — gives context if they named a category. */
  customerText: string
}

export interface WelcomeOutput {
  prose: string
  inputTokens: number
  outputTokens: number
}

/**
 * Generate a warm, personal first-turn welcome via Haiku.
 *
 * Falls back to a safe static greeting on any error — the call must continue
 * even if the welcome generation fails.
 */
export async function generateDiscoveryWelcome(
  input: WelcomeInput,
): Promise<WelcomeOutput> {
  const isReturning = !!input.customerGid
  const firstNameLine = input.customerFirstName
    ? `Returning customer first name: ${input.customerFirstName}`
    : ''

  const userMsg = [
    `Channel: ${input.channel}`,
    `Returning customer: ${isReturning ? 'yes' : 'no — first contact'}`,
    firstNameLine,
    `First message from customer: "${input.customerText}"`,
    '',
    "Generate Emma's warm first-turn welcome. Remember: the goal is for the customer to feel safe sharing what they want.",
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const resp = await _anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 220,
      system: SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    })

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    if (!text) return await staticFallback(input)

    return {
      prose: text,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
    }
  } catch (err) {
    console.error('[discovery-welcome] Haiku call failed — falling back', err)
    return await staticFallback(input)
  }
}

async function staticFallback(input: WelcomeInput): Promise<WelcomeOutput> {
  // Safe, voice-friendly default. Used when Haiku is unreachable or empty.
  // The returning-customer greeting prefix is admin-editable via
  // /admin/voice-and-sms (key `smsReturningGreeting`); we fall back to
  // SMS_DEFAULTS.returningGreeting on DB timeout so a Neon hiccup never
  // breaks the welcome path.
  let opener = ''
  if (input.customerFirstName) {
    let template = SMS_DEFAULTS.returningGreeting
    try {
      const cfg = await getSmsConfig()
      template = cfg.returningGreeting
    } catch (err) {
      console.error('[discovery-welcome] sms config load failed — using default returning greeting', err)
    }
    const filled = fillReturningGreeting(template, input.customerFirstName).trim()
    if (filled) opener = `${filled} `
  }
  const prose = `${opener}I know our picks are personal, so I want to help you find exactly the right thing. If you're open to sharing, I'm open to hearing. To start: is there a mood or feeling you're after? Something gentle and warming, something powerful and intense, or somewhere in between?`
  return { prose, inputTokens: 0, outputTokens: 0 }
}
