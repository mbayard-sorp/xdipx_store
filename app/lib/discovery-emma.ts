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

// Hand-tuned phrasing for known audience labels. Anything outside this map
// falls back to a lowercased pass-through (see audiencePhrase) — works for
// any future merchandiser-added audience without a code change.
const AUDIENCE_PHRASES: Record<string, string> = {
  Me:           'for Me',
  Us:           'for Us',
  'A Partner':  'for Them',
  'Date Night': 'for Date Night',
  Solo:         'Solo',
  Gift:         'as a Gift',
}

export function audiencePhrase(a: Audience): string {
  // Vocabulary is dynamic (sourced from Shopify), so fall back to a
  // lowercased pass-through for any audience value we don't have a
  // hand-tuned phrase for.
  return AUDIENCE_PHRASES[a] ?? a.toLowerCase()
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
      { text: audiencePhrase(aud), emphasized: true },
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
/**
 * Variant A locked copy. Reviewed by emma-empathy-reviewer 2026-05-15.
 * Single source of truth for the sidekick one-liner — only edit through
 * a fresh copy + empathy review pass.
 *
 * Interpolation placeholders: {mood} {audience} {matters} {category}.
 */
export const EMMA_LINES = {
  intro:       "Hi, I'm Emma. Tap anything that calls to you. No wrong answers, and I'll shift what you see as you go.",
  moodOnly:    "{mood}. Good start. Is this for you, the two of you, or someone else?",
  audOnly:     "For {audience}. Noted. What kind of feeling are you chasing?",
  mattersOnly: "{matters} matters. Good to know. What mood are you in?",
  moodAud:     "{mood} for {audience}. I like that brief. Tell me what matters most and I'll narrow it down.",
  moodMatters: "{mood} and {matters}. Solid combo. Want to tell me who this is for?",
  audMatters:  "{matters}, for {audience}. Got it. What feeling are you hoping to land on?",
  full:        "{mood}, for {audience}, with {matters} in mind. That's a real brief. Everything below is shaped around it.",
  welcomeBack: "Welcome back. Still in a {mood} mood for {audience}? No pressure to stick with it.",
  railEmpty:   "Nothing in {category} quite fits that brief. Try loosening one filter and see what opens up.",
} as const

/** Sidekick CTA labels — locked copy. */
export const SIDEKICK_CTAS = {
  primary:   'Ask Emma',
  secondary: 'Save my picks',
} as const

const lower = (v: string) => v.toLowerCase()
const audienceWord = (a: Audience) =>
  a === 'Me' ? 'you' : a === 'Us' ? 'us' : lower(a)

function joinAudiences(arr: Audience[]): string {
  return arr.map(audienceWord).join(' or ')
}
function joinMoods(arr: Mood[]): string {
  return arr.map(lower).join(' or ')
}
function joinMatters(arr: string[]): string {
  // Matters tags keep their original capitalization (proper-noun feel).
  return arr.join(', ')
}

function fill(template: string, values: { mood?: string; audience?: string; matters?: string; category?: string }): string {
  return template
    .replace('{mood}', values.mood ?? '')
    .replace('{audience}', values.audience ?? '')
    .replace('{matters}', values.matters ?? '')
    .replace('{category}', values.category ?? '')
}

export function getEmmaLine(s: DiscoveryState): string {
  const hasM = s.mood.length > 0
  const hasA = s.audience.length > 0
  const hasK = s.matters.length > 0
  const mood = hasM ? joinMoods(s.mood) : ''
  const audience = hasA ? joinAudiences(s.audience) : ''
  const matters = hasK ? joinMatters(s.matters) : ''

  if (!hasM && !hasA && !hasK) return EMMA_LINES.intro
  if (hasM && hasA && hasK) return fill(EMMA_LINES.full,        { mood, audience, matters })
  if (hasM && hasA)         return fill(EMMA_LINES.moodAud,     { mood, audience })
  if (hasM && hasK)         return fill(EMMA_LINES.moodMatters, { mood, matters })
  if (hasA && hasK)         return fill(EMMA_LINES.audMatters,  { audience, matters })
  if (hasM)                 return fill(EMMA_LINES.moodOnly,    { mood })
  if (hasA)                 return fill(EMMA_LINES.audOnly,     { audience })
  if (hasK)                 return fill(EMMA_LINES.mattersOnly, { matters })
  return ''
}

/**
 * Welcome-back banner copy for returning sessions. Pulls the most-recent
 * mood + audience from the persisted state so the line reads like a memory.
 * Returns null when there isn't enough context to greet meaningfully.
 */
export function getWelcomeBackLine(s: DiscoveryState): string | null {
  if (s.mood.length === 0 && s.audience.length === 0) return null
  const mood = s.mood[0] ? lower(s.mood[0]) : ''
  const audience = s.audience[0] ? audienceWord(s.audience[0]) : ''
  if (!mood || !audience) return null
  return fill(EMMA_LINES.welcomeBack, { mood, audience })
}

/** Rail empty-state copy. */
export function getRailEmptyLine(category: Category): string {
  return fill(EMMA_LINES.railEmpty, { category })
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
      audience: audiencePhrase(aud).toLowerCase(),
      suffix:   '?',
    }
  }
  if (mood) {
    return { prefix: 'Welcome back. Still in a ', mood: mood.toLowerCase(), middle: ' mood', audience: null, suffix: '?' }
  }
  if (aud) {
    return { prefix: 'Welcome back. Still shopping ', mood: null, middle: '', audience: audiencePhrase(aud).toLowerCase(), suffix: '?' }
  }
  return { prefix: 'Welcome back.', mood: null, middle: '', audience: null, suffix: '' }
}
