/**
 * Pure helpers for the home page "Find you in a product" surface.
 *
 * Scoring, ranking, rail-title composition, and Emma's adaptive one-liner.
 * Kept dependency-free (no React, no server) so they're trivially testable
 * and safe to import from both server loaders and client components.
 */

import type {
  Audience,
  Category,
  DiscoveryProduct,
  DiscoveryState,
  Mood,
  Rail,
  ScoredProduct,
} from '~/types/discovery'
import { CATEGORIES } from '~/types/discovery'

const SCORE_MOOD = 3
const SCORE_AUDIENCE = 2
const SCORE_MATTERS = 2

/**
 * Score = 3·|mood ∩| + 2·|aud ∩| + 2·|matters ∩|.
 * Returns 0 when no chips are selected (caller falls back to "browse all").
 */
export function scoreProduct(p: DiscoveryProduct, s: DiscoveryState): number {
  let score = 0
  for (const m of s.mood)     if (p.mood.includes(m))     score += SCORE_MOOD
  for (const a of s.audience) if (p.audience.includes(a)) score += SCORE_AUDIENCE
  for (const k of s.matters)  if (p.matters.includes(k))  score += SCORE_MATTERS
  return score
}

export interface RankOptions {
  /** Hard cap of items per rail. Variant A uses 4; variant B uses 4 for top, 3 for rest. */
  perRail?: number
  /** Skip empty categories. Variant A keeps them (renders empty state); B drops them. */
  dropEmpty?: boolean
}

/**
 * Bucket products by top-level category, score each, sort within rails by
 * score desc, then order rails by aggregate score desc. With no selections,
 * categories stay in canonical order (Pleasure / Play / Body / Wear).
 */
export function rankRails(
  products: DiscoveryProduct[],
  state: DiscoveryState,
  opts: RankOptions = {},
): Rail[] {
  const { perRail = 4, dropEmpty = false } = opts
  const hasAny = state.mood.length > 0 || state.audience.length > 0 || state.matters.length > 0
  const filtered = products.filter(p => p.price <= state.budget)

  const buckets: Record<Category, ScoredProduct[]> = {
    Pleasure: [], Play: [], Body: [], Wear: [],
  }
  const totals: Record<Category, number> = { Pleasure: 0, Play: 0, Body: 0, Wear: 0 }
  const aggScore: Record<Category, number> = { Pleasure: 0, Play: 0, Body: 0, Wear: 0 }

  for (const p of filtered) {
    const score = hasAny ? scoreProduct(p, state) : 0
    buckets[p.category].push({ product: p, score })
    totals[p.category] += 1
    aggScore[p.category] += score
  }

  for (const cat of CATEGORIES) {
    buckets[cat].sort((a, b) => b.score - a.score)
  }

  const order: Category[] = [...CATEGORIES]
  if (hasAny) {
    // Stable sort: when scores tie, keep canonical Pleasure/Play/Body/Wear order.
    order.sort((a, b) => {
      const diff = aggScore[b] - aggScore[a]
      if (diff !== 0) return diff
      return CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b)
    })
  }

  const rails: Rail[] = order.map(cat => ({
    category: cat,
    score:    aggScore[cat],
    total:    totals[cat],
    items:    buckets[cat].slice(0, perRail),
  }))

  return dropEmpty ? rails.filter(r => r.items.length > 0) : rails
}

/* ─── Audience phrase map ────────────────────────────────────────────── */

const AUDIENCE_PHRASES: Record<Audience, string> = {
  Me:           'for Me',
  Us:           'for Us',
  'A Partner':  'for Them',
  'Date Night': 'for Date Night',
  Solo:         'Solo',
  Gift:         'as a Gift',
}

export function audiencePhrase(a: Audience): string {
  return AUDIENCE_PHRASES[a]
}

/* ─── Rail titles ────────────────────────────────────────────────────── */

export interface RailTitleSegment {
  text:        string
  /** True when this segment came from a chip selection (rendered italic in UI). */
  emphasized:  boolean
}

/**
 * Compose a rail title as ordered segments so the UI can italicize the
 * variable parts. The first selected mood and audience drive the title;
 * other selections don't pile on (keeps headlines readable).
 *
 * No selections → ["Pleasure"]
 * Mood "Sensual" → ["Sensual" *, " ", "Pleasure"]
 * Mood + Audience "Us" → ["Sensual" *, " ", "Pleasure", " ", "for Us" *]
 * Audience only → ["Pleasure", " ", "for Date Night" *]
 * Matters only → ["Beginner-Friendly" *, " ", "Pleasure"]
 */
export function railTitleSegments(cat: Category, s: DiscoveryState): RailTitleSegment[] {
  const mood = s.mood[0]
  const aud = s.audience[0]
  const matter = s.matters[0]
  const segments: RailTitleSegment[] = []

  if (mood) {
    segments.push({ text: mood, emphasized: true }, { text: ' ', emphasized: false })
  } else if (matter && !aud) {
    segments.push({ text: matter, emphasized: true }, { text: ' ', emphasized: false })
  }

  segments.push({ text: cat, emphasized: false })

  if (aud) {
    segments.push(
      { text: ' ', emphasized: false },
      { text: AUDIENCE_PHRASES[aud], emphasized: true },
    )
  }

  return segments
}

export function railTitlePlain(cat: Category, s: DiscoveryState): string {
  return railTitleSegments(cat, s).map(seg => seg.text).join('')
}

/* ─── Emma's adaptive one-liner ──────────────────────────────────────── */

/**
 * Emma's voice on the home surface: warm, knowing, never clinical.
 * She references prior answers when present so the page reads like a
 * conversation even on variant A (where she's silent in the corner).
 *
 * No em dashes per house rule (CLAUDE.md). Periods/commas only.
 */
export function getEmmaLine(s: DiscoveryState): string {
  const m = s.mood[0]
  const a = s.audience[0]
  const k = s.matters[0]
  const lower = (v: string) => v.toLowerCase()

  if (!m && !a && !k) {
    return "Hi, I'm Emma. Tap anything that resonates. There are no wrong answers, and I'll shape what you see."
  }
  if (m && a && k) {
    return `${lower(m)}, ${lower(a)}, and ${lower(k)}. Beautiful brief. I've reshuffled everything below to match.`
  }
  if (m && a) {
    const youOrThem = a === 'Me' ? 'you' : lower(a)
    return `${lower(m)} for ${youOrThem}. Lovely. Tell me what matters most and I'll narrow further.`
  }
  if (m && k) {
    return `${lower(m)} and ${lower(k)}. Good combo. Want to tell me who this is for?`
  }
  if (a && k) {
    return `${lower(k)}, ${lower(a)}. Noted. What kind of feeling are you after?`
  }
  if (m) {
    return `${lower(m)}. Got it. Is this for you, the two of you, or someone else?`
  }
  if (a) {
    return `For ${lower(a)}. Noted. What kind of feeling are you after?`
  }
  if (k) {
    return `${lower(k)} matters. Good to know. What mood are you in?`
  }
  return ''
}

/**
 * Conversational question copy for variant B. Each later question
 * interpolates the prior answer so the thread reads as one back-and-forth.
 */
export const emmaQuestions = {
  intro: {
    headline: 'Hi. Let\'s find you in a product.',
    sub:      "Three quick taps. There are no wrong answers, and you can change anything later. Let's start with how you're feeling.",
  },
  mood: {
    headline: 'What kind of feeling are you chasing?',
    sub:      "Mood first. We'll get to the practicals after.",
  },
  audience: (mood?: Mood) => ({
    headline: mood
      ? `Beautiful, ${mood.toLowerCase()}. Who's this for?`
      : "And who's this for?",
    sub: 'Just you, the two of you, or someone else.',
  }),
  matters: (audience?: Audience) => {
    const phrase =
      audience === 'Me' ? 'for you'
      : audience === 'Us' ? 'for the two of you'
      : audience ? `for ${audience.toLowerCase()}`
      : ''
    return {
      headline: `Anything that has to be true${phrase ? ' ' + phrase : ''}?`,
      sub: 'Optional. Pick a few if it helps me narrow.',
    }
  },
  done: (mood?: Mood, audience?: Audience) => {
    const m = mood ? `, ${mood.toLowerCase()}` : ''
    const a =
      audience === 'Me' ? ', for you'
      : audience === 'Us' ? ', for both of you'
      : audience ? `, for ${audience.toLowerCase()}`
      : ''
    return {
      headline: `Here's what I'd reach for${m}${a}. Take your time.`,
      sub: 'Each rail below is shaped by what you said. Tap any answer up here to change it and the rails update instantly.',
    }
  },
} as const

/**
 * Returning-user welcome banner copy. Used by both variants.
 * Rendered as plain text; UI can italicize {mood} / {audience} segments.
 */
export function welcomeBackSegments(s: Pick<DiscoveryState, 'mood' | 'audience'>): {
  prefix: string
  mood:   string | null
  middle: string
  audience: string | null
  suffix: string
} {
  const mood = s.mood[0] ?? null
  const aud = s.audience[0] ?? null
  if (mood && aud) {
    return {
      prefix:   'Welcome back. Still in a ',
      mood:     mood.toLowerCase(),
      middle:   ' mood ',
      audience: AUDIENCE_PHRASES[aud].toLowerCase(),
      suffix:   '?',
    }
  }
  if (mood) {
    return { prefix: 'Welcome back. Still in a ', mood: mood.toLowerCase(), middle: ' mood', audience: null, suffix: '?' }
  }
  if (aud) {
    return { prefix: 'Welcome back. Still shopping ', mood: null, middle: '', audience: AUDIENCE_PHRASES[aud].toLowerCase(), suffix: '?' }
  }
  return { prefix: 'Welcome back.', mood: null, middle: '', audience: null, suffix: '' }
}
