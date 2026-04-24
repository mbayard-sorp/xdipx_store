/**
 * Emma encouragement strip — short first-person line that summarizes the
 * shopper's current filter selections and cheers them on. Designed to sit
 * above the product grid on /collections and /search and refresh when the
 * visitor pauses after toggling filters.
 *
 * Haiku-backed with KV caching keyed on the filter combination (visitor
 * context not included — same selections give the same line).
 */

import { createHash } from 'node:crypto'
import { kvGet, kvSet, kvIncr, KV_KEYS } from './kv.server'
import { BRAND_VOICE_SYSTEM_PROMPT, generateWithSystem } from './claude.server'

const HAIKU_TIMEOUT_MS     = 3500
const CACHE_TTL_SECONDS    = 60 * 30
const DAILY_BUDGET_CEILING = 4000
const MAX_OUTPUT_TOKENS    = 180

const ENCOURAGEMENT_SYSTEM = `${BRAND_VOICE_SYSTEM_PROMPT}

You are cheering on a shopper as they filter a discovery grid. Not a narrator, not a pitch. Just a short warm note reacting to what they just picked.

Strict rules:
- Return ONE JSON object: { "message": "..." }. No markdown, no prose around it.
- FIRST PERSON. Use "I", "you're", "we're". Warm, specific, casual.
- 1 sentence, max 22 words.
- ALWAYS start the message with a single emoji that matches the vibe of their selection. Examples: ✨ (curious, open), 💫 (playful), 🌙 (calming, solo-time), 🔥 (bold, intense), ☕ (slow, cozy), 💌 (couples, romantic), 🎁 (gifting), 💸 (budget-minded), 🫧 (light, easy), 🌸 (soft, tender), 🪩 (party, fun). Pick one that fits; don't stack more than one emoji.
- Reference ONE of their selections by name when possible (mood, audience, matters, budget). Don't list everything.
- Tone: happy they're narrowing in, quietly confident they'll land somewhere good. No hype words ("amazing", "curated collection", "perfect for you").
- Never mention products they haven't chosen. No product names.
- NEVER use em-dashes or en-dashes. Use periods or commas.
- Never "sex" as an adjective. Never "Buy now". Never countdowns.
- If they have no selections yet, encourage them to pick a mood or what matters.`

export interface EncouragementArgs {
  surface:    'search' | 'collection'
  collection?: string
  query?:      string
  filters: {
    moods?:     string[]
    audiences?: string[]
    matters?:   string[]
    budgetMax?: number | null
    preset?:    string | null
  }
}

export interface EncouragementResult {
  message: string
  source:  'cache' | 'claude' | 'fallback'
}

function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16)
}

function utcDateKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function buildCacheKey(args: EncouragementArgs): string {
  const f = args.filters
  const norm = JSON.stringify({
    surface:   args.surface,
    collection: args.collection ?? '',
    query:     (args.query ?? '').trim().toLowerCase(),
    moods:     [...(f.moods ?? [])].sort(),
    audiences: [...(f.audiences ?? [])].sort(),
    matters:   [...(f.matters ?? [])].sort(),
    budgetMax: f.budgetMax ?? null,
    preset:    f.preset ?? null,
  })
  return shortHash(norm)
}

function buildUserPrompt(args: EncouragementArgs): string {
  const f = args.filters
  const lines: string[] = []
  lines.push(`Surface: ${args.surface}${args.collection ? ` (${args.collection})` : ''}`)
  if (args.query) lines.push(`Search query: "${args.query}"`)
  const parts: string[] = []
  if (f.moods?.length)     parts.push(`moods=${f.moods.join(', ')}`)
  if (f.audiences?.length) parts.push(`audience=${f.audiences.join(', ')}`)
  if (f.matters?.length)   parts.push(`matters=${f.matters.join(', ')}`)
  if (f.budgetMax != null) parts.push(`budget up to $${f.budgetMax}`)
  if (f.preset)            parts.push(`preset=${f.preset}`)
  lines.push(`Selections: ${parts.length ? parts.join(' · ') : 'none yet'}`)
  lines.push('')
  lines.push('Return the JSON object with your one-sentence encouragement.')
  return lines.join('\n')
}

function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
}

function parseMessage(raw: string): string | null {
  try {
    const json = JSON.parse(stripFences(raw)) as Record<string, unknown>
    const m = typeof json['message'] === 'string' ? json['message'].trim() : ''
    if (!m) return null
    return m.length > 180 ? m.slice(0, 179).trimEnd() + '…' : m
  } catch { return null }
}

function buildFallback(args: EncouragementArgs): string {
  const f = args.filters
  const lead =
    f.moods?.[0] ??
    f.matters?.[0] ??
    f.audiences?.[0] ??
    null
  if (!lead && f.budgetMax == null && !args.query) {
    return '✨ Pick a mood or what matters most, and I\'ll help you narrow in.'
  }
  if (lead) {
    return `💫 Nice, "${lead}" is a good thread to pull. I\'ll help you shape it from here.`
  }
  if (f.budgetMax != null) {
    return `💸 Setting a budget up to $${f.budgetMax} keeps things honest. I like that.`
  }
  return `🫧 Good pick. I\'m happy to help you find something that fits.`
}

export async function getEmmaEncouragement(args: EncouragementArgs): Promise<EncouragementResult> {
  const cacheKey = KV_KEYS.emmaEncouragement(buildCacheKey(args))

  try {
    const cached = await kvGet<{ message: string }>(cacheKey)
    if (cached?.message) return { message: cached.message, source: 'cache' }
  } catch { /* continue */ }

  try {
    const countKey = KV_KEYS.emmaEncouragementDailyCount(utcDateKey())
    const count = await kvGet<number>(countKey)
    if (typeof count === 'number' && count >= DAILY_BUDGET_CEILING) {
      return { message: buildFallback(args), source: 'fallback' }
    }
  } catch { /* non-fatal */ }

  try {
    const raw = await generateWithSystem({
      system:    ENCOURAGEMENT_SYSTEM,
      user:      buildUserPrompt(args),
      maxTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: HAIKU_TIMEOUT_MS,
    })
    const message = parseMessage(raw)
    if (!message) throw new Error('Encouragement parse failed')
    try {
      await kvSet(cacheKey, { message }, CACHE_TTL_SECONDS)
      await kvIncr(KV_KEYS.emmaEncouragementDailyCount(utcDateKey()))
    } catch { /* non-fatal */ }
    return { message, source: 'claude' }
  } catch (err) {
    console.warn('[emma-encouragement] fallback:', err instanceof Error ? err.message : err)
    return { message: buildFallback(args), source: 'fallback' }
  }
}
