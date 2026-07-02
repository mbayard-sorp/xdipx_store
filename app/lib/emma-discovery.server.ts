/**
 * Emma Discovery rail — generates a small JSON payload describing how Emma is
 * "shopping along" with the visitor on /search and /collections/$handle.
 *
 * Haiku-backed with KV caching (10-min TTL per query + filter + recent-view
 * hash). On timeout, error, or daily budget cap, falls back to a templated
 * response so the rail always renders something.
 *
 * Payload shape:
 *   greeting:       short, first-name-aware line ("Hey Mike — quick note")
 *   narrator:       one sentence reacting to the current query/filter state
 *   starredHandles: up to 3 { handle, reason } pairs — Emma's picks from the grid
 *   refinements:    up to 3 { label, params } chips to tighten the view
 *   didYouMean:     up to 3 { label, params } alternate queries
 */

import { createHash } from 'node:crypto'
import { kvGet, kvSet, kvIncr, KV_KEYS } from './kv.server'
import { BRAND_VOICE_SYSTEM_PROMPT, generateWithSystem } from './claude.server'

const HAIKU_TIMEOUT_MS     = 4000
const CACHE_TTL_SECONDS    = 60 * 10           // 10 min
const DAILY_BUDGET_CEILING = 4000
const MAX_OUTPUT_TOKENS    = 500
const MAX_CANDIDATES       = 20

const DISCOVERY_SYSTEM = `${BRAND_VOICE_SYSTEM_PROMPT}

You are annotating a live discovery grid for a visitor browsing /search or a collection. Treat this like shopping alongside a friend: short, warm, specific.

Strict rules:
- Return ONE valid JSON object only. No markdown, no prose before/after.
- Never invent products. Only reference handles from the candidate list I provide.
- greeting: ≤8 words, address the person by name if provided else "friend".
- narrator: 1 sentence, ≤28 words. First person, from catalog knowledge, not lived experience. If the visitor has cart items, recent views, or past orders, reference ONE of them by name and say why that signal is shaping your picks. Never say "we" or "our curated collection" or generic marketing copy.
- starredHandles: ≤3, each with a 1-sentence "reason" ≤18 words (no quotes).
- refinements: ≤3 tighter chips the visitor could tap next. Each has a short label and a params object keyed by the URL search params supported (mood, audience, matters, budgetMax, q).
- refinementsNote: 1 short first-person sentence (≤20 words) about how you arrived at these picks. Explain the thinking: what thread you're following from their context. Casual, warm, specific. No product names.
- didYouMean: ≤3 alternate starting points if the current query feels off. Same param shape.
- If there's no query and no filter, refinements can be discovery nudges (e.g. "Under $40", "Couples").`

export interface DiscoveryCandidate {
  handle:       string
  title:        string
  vendor?:      string | null
  price?:       number | null
  tags?:        string[]
  mattersTags?: string[]
  moodTags?:    string[]
}

export interface DiscoveryArgs {
  surface:      'search' | 'collection'
  query:        string
  collection?:  string
  filters:      {
    moods?:      string[]
    audiences?:  string[]
    matters?:    string[]
    budgetMax?:  number | null
  }
  firstName?:     string | null
  recentViews?:   string[]
  cartTitles?:    string[]
  orderedTitles?: string[]
  candidates:     DiscoveryCandidate[]
}

export interface DiscoveryRefinement {
  label:  string
  params: Record<string, string | number>
}

export interface DiscoveryResult {
  greeting:         string
  narrator:         string
  starredHandles:   { handle: string; reason: string }[]
  refinements:      DiscoveryRefinement[]
  refinementsNote?: string
  didYouMean:       DiscoveryRefinement[]
  source:           'cache' | 'claude' | 'fallback'
}

// ── Helpers ────────────────────────────────────────────────────────────────

function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16)
}

function utcDateKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function buildCacheKey(args: DiscoveryArgs): string {
  const sortedFilters = JSON.stringify({
    moods:      [...(args.filters.moods ?? [])].sort(),
    audiences:  [...(args.filters.audiences ?? [])].sort(),
    matters:    [...(args.filters.matters ?? [])].sort(),
    budgetMax:  args.filters.budgetMax ?? null,
  })
  const topHandles = args.candidates.slice(0, 12).map(c => c.handle).join(',')
  const recent = (args.recentViews ?? []).slice(0, 5).join(',')
  const cart = (args.cartTitles ?? []).slice(0, 5).join(',')
  const ordered = (args.orderedTitles ?? []).slice(0, 5).join(',')
  return shortHash([
    args.surface,
    args.collection ?? '',
    args.query.trim().toLowerCase(),
    sortedFilters,
    topHandles,
    recent,
    cart,
    ordered,
    args.firstName ?? '',
  ].join('|'))
}

function buildUserPrompt(args: DiscoveryArgs): string {
  const lines: string[] = []
  lines.push(`Surface: ${args.surface}${args.collection ? ` (collection: ${args.collection})` : ''}`)
  lines.push(`Visitor: ${args.firstName ? args.firstName : 'anonymous'}`)
  if (args.query) lines.push(`Current query: "${args.query}"`)
  const f = args.filters
  const activeFilters: string[] = []
  if (f.moods?.length)     activeFilters.push(`moods=${f.moods.join('/')}`)
  if (f.audiences?.length) activeFilters.push(`audiences=${f.audiences.join('/')}`)
  if (f.matters?.length)   activeFilters.push(`matters=${f.matters.join('/')}`)
  if (f.budgetMax != null) activeFilters.push(`budgetMax=$${f.budgetMax}`)
  lines.push(`Active filters: ${activeFilters.length ? activeFilters.join(', ') : 'none'}`)
  if (args.recentViews?.length) {
    lines.push(`Recently viewed handles: ${args.recentViews.slice(0, 5).join(', ')}`)
  }
  if (args.cartTitles?.length) {
    lines.push(`Currently in cart: ${args.cartTitles.slice(0, 5).join(' · ')}`)
  }
  if (args.orderedTitles?.length) {
    lines.push(`Previously ordered: ${args.orderedTitles.slice(0, 5).join(' · ')}`)
  }
  lines.push('')
  lines.push(`Candidate products (top ${args.candidates.length}):`)
  for (const c of args.candidates.slice(0, MAX_CANDIDATES)) {
    const tags = [
      ...(c.mattersTags ?? []).map(t => `matters:${t}`),
      ...(c.moodTags ?? []).map(t => `mood:${t}`),
    ].slice(0, 6).join(', ')
    const price = c.price != null ? ` $${c.price.toFixed(2)}` : ''
    const vendor = c.vendor ? ` by ${c.vendor}` : ''
    lines.push(`- ${c.handle}: "${c.title}"${vendor}${price}${tags ? ` [${tags}]` : ''}`)
  }
  lines.push('')
  lines.push('Return the JSON object.')
  return lines.join('\n')
}

function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
}

function clampString(s: unknown, max: number): string {
  if (typeof s !== 'string') return ''
  const t = s.trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

function parseRefinements(raw: unknown): DiscoveryRefinement[] {
  if (!Array.isArray(raw)) return []
  const out: DiscoveryRefinement[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const rec = r as Record<string, unknown>
    const label = clampString(rec['label'], 40)
    const params = rec['params'] && typeof rec['params'] === 'object' ? rec['params'] as Record<string, unknown> : null
    if (!label || !params) continue
    const safeParams: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(params)) {
      if (!['mood', 'audience', 'matters', 'budgetMax', 'q'].includes(k)) continue
      if (typeof v === 'string' || typeof v === 'number') safeParams[k] = v
    }
    out.push({ label, params: safeParams })
    if (out.length >= 3) break
  }
  return out
}

function parseDiscoveryJson(raw: string, candidates: DiscoveryCandidate[]): Omit<DiscoveryResult, 'source'> | null {
  try {
    const json = JSON.parse(stripFences(raw)) as Record<string, unknown>
    const allowed = new Set(candidates.map(c => c.handle))
    const starredRaw = Array.isArray(json['starredHandles']) ? json['starredHandles'] : []
    const starred: { handle: string; reason: string }[] = []
    for (const s of starredRaw) {
      if (!s || typeof s !== 'object') continue
      const rec = s as Record<string, unknown>
      const handle = typeof rec['handle'] === 'string' ? rec['handle'] : ''
      const reason = clampString(rec['reason'], 140)
      if (allowed.has(handle) && reason) starred.push({ handle, reason })
      if (starred.length >= 3) break
    }
    const greeting = clampString(json['greeting'], 60)
    const narrator = clampString(json['narrator'], 200)
    if (!narrator) return null
    const refinementsNote = clampString(json['refinementsNote'], 160)
    const refinements = parseRefinements(json['refinements'])
    return {
      greeting,
      narrator,
      starredHandles: starred,
      refinements,
      ...(refinementsNote && refinements.length ? { refinementsNote } : {}),
      didYouMean:     parseRefinements(json['didYouMean']),
    }
  } catch {
    return null
  }
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'your', 'from', 'pack',
  'set', 'kit', 'size', 'mini', 'pro', 'plus', 'new', 'all', 'one',
])

function tokenize(s: string): Set<string> {
  const out = new Set<string>()
  for (const raw of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOPWORDS.has(raw)) continue
    out.add(raw)
  }
  return out
}

function candidateKeywords(c: DiscoveryCandidate): Set<string> {
  const tokens = tokenize(c.title)
  for (const t of c.mattersTags ?? []) tokens.add(t.toLowerCase())
  for (const t of c.moodTags    ?? []) tokens.add(t.toLowerCase())
  for (const t of c.tags        ?? []) tokens.add(t.toLowerCase())
  return tokens
}

interface ScoredPick {
  handle: string
  reason: string
  score:  number
}

function scoreCandidates(args: DiscoveryArgs): ScoredPick[] {
  const recentSet = new Set(args.recentViews ?? [])
  const queryTokens = args.query ? tokenize(args.query) : new Set<string>()
  const cartTokens    = (args.cartTitles    ?? []).map(t => ({ title: t, tokens: tokenize(t) }))
  const orderedTokens = (args.orderedTitles ?? []).map(t => ({ title: t, tokens: tokenize(t) }))

  const scored: ScoredPick[] = []
  for (const c of args.candidates) {
    const kw = candidateKeywords(c)
    let score = 0
    let reason = ''

    const cartHit = cartTokens.find(({ tokens }) => {
      for (const t of tokens) if (kw.has(t)) return true
      return false
    })
    if (cartHit) {
      score += 5
      reason = `Pairs with your ${cartHit.title}.`
    }

    if (!reason) {
      const orderedHit = orderedTokens.find(({ tokens }) => {
        for (const t of tokens) if (kw.has(t)) return true
        return false
      })
      if (orderedHit) {
        score += 4
        reason = `Same energy as your ${orderedHit.title}.`
      }
    }

    if (recentSet.has(c.handle)) {
      score += 3
      if (!reason) reason = `Saw you circling this one.`
    }

    if (queryTokens.size) {
      let queryHits = 0
      for (const t of queryTokens) if (kw.has(t)) queryHits++
      if (queryHits) {
        score += queryHits * 2
        if (!reason) reason = `Close match for "${args.query}".`
      }
    }

    if (!reason) continue
    scored.push({ handle: c.handle, reason, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 3)
}

function buildFallback(args: DiscoveryArgs): Omit<DiscoveryResult, 'source'> {
  const name = args.firstName?.trim() || 'friend'
  const greeting = `Hey ${name}, quick note`
  const cartRef    = args.cartTitles?.[0]
  const orderedRef = args.orderedTitles?.[0]
  let narrator: string
  if (cartRef) {
    narrator = `I saw ${cartRef} in your cart. I'm leaning toward picks that pair with it.`
  } else if (orderedRef) {
    narrator = `Since you've already got ${orderedRef}, I'm steering toward things that build on that.`
  } else if (args.recentViews?.length) {
    narrator = `I noticed you circling a few of these. I'll star the ones that feel like the closest match.`
  } else if (args.query) {
    narrator = `I'm combing through "${args.query}" picks right now. I'll star the ones worth a second look.`
  } else if (args.collection) {
    narrator = `I've been wandering this shelf too. I'll mark the ones I keep reaching for.`
  } else {
    narrator = `I'll watch as you scroll and star anything that feels like you.`
  }

  let starredHandles = scoreCandidates(args).map(({ handle, reason }) => ({ handle, reason }))
  if (starredHandles.length === 0) {
    starredHandles = args.candidates.slice(0, 2).map(c => ({
      handle: c.handle,
      reason: 'Been testing this one. A reliable pick.',
    }))
  }

  return {
    greeting,
    narrator,
    starredHandles,
    refinements: [],
    didYouMean:  [],
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function getEmmaDiscovery(args: DiscoveryArgs): Promise<DiscoveryResult> {
  const cacheKey = KV_KEYS.emmaDiscovery(buildCacheKey(args))

  // 1. Cache hit
  try {
    const cached = await kvGet<Omit<DiscoveryResult, 'source'>>(cacheKey)
    if (cached && cached.narrator) {
      return { ...cached, source: 'cache' }
    }
  } catch { /* continue */ }

  // 2. Daily budget
  try {
    const countKey = KV_KEYS.emmaDiscoveryDailyCount(utcDateKey())
    const count = await kvGet<number>(countKey)
    if (typeof count === 'number' && count >= DAILY_BUDGET_CEILING) {
      return { ...buildFallback(args), source: 'fallback' }
    }
  } catch { /* non-fatal */ }

  // 3. Claude call
  try {
    const raw = await generateWithSystem({
      system:    DISCOVERY_SYSTEM,
      user:      buildUserPrompt(args),
      maxTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: HAIKU_TIMEOUT_MS,
      caller:    'emma-discovery',
    })
    const parsed = parseDiscoveryJson(raw, args.candidates)
    if (!parsed) throw new Error('Discovery JSON parse failed')
    try {
      await kvSet(cacheKey, parsed, CACHE_TTL_SECONDS)
      await kvIncr(KV_KEYS.emmaDiscoveryDailyCount(utcDateKey()))
    } catch { /* non-fatal */ }
    return { ...parsed, source: 'claude' }
  } catch (err) {
    console.warn('[emma-discovery] fallback:', err instanceof Error ? err.message : err)
    return { ...buildFallback(args), source: 'fallback' }
  }
}
