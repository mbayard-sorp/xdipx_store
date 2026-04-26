/**
 * SEO keyword targeting — gen-time helper.
 *
 * Reads approved keywords from Sanity (seoKeyword docs), filters by tag
 * overlap with the content being generated, scores them, and returns a
 * structured block that gets injected into Claude prompts in claude.server.ts.
 *
 * Self-graceful: if Sanity is unconfigured or no keywords are approved, returns
 * an empty context and copy generation falls back to the pre-keyword behaviour.
 */
import { createClient } from '@sanity/client'
import { cached } from '~/lib/kv.server'
import type { ProductTypeDial } from '~/types'

export type SeoIntent = 'informational' | 'transactional' | 'navigational' | 'commercial'
export type SeoKind = 'head' | 'long-tail' | 'question' | 'branded'
export type SeoContentType = 'pdp' | 'blog' | 'faq' | 'collection'

export interface SeoKeyword {
  _id: string
  term: string
  kind?: SeoKind
  intent?: SeoIntent
  cluster?: { slug?: string; title?: string; pillarTerm?: string } | null
  volume?: number
  difficulty?: number
  relevanceScore?: number
  productTypeDials?: string[]
  moodTags?: string[]
  audienceTags?: string[]
  mattersTags?: string[]
  contentTypes?: string[]
}

export interface KeywordContext {
  primary:    SeoKeyword | null
  secondary:  SeoKeyword[]
  longTail:   SeoKeyword[]
  questions:  SeoKeyword[]
  avoid:      string[]
}

export interface BuildKeywordContextInput {
  productType?: ProductTypeDial | undefined
  moods?:       string[] | undefined
  audiences?:   string[] | undefined
  matters?:     string[] | undefined
  contentType:  SeoContentType
  /** Optional topic title for blog articles — used as the LLM ranker hint. */
  topic?:       string | undefined
  /** Author voice — `seoMode: 'off'` short-circuits to an empty context. */
  seoMode?:     'aggressive' | 'natural' | 'off' | undefined
  count?: { primary?: number; secondary?: number; longTail?: number; questions?: number } | undefined
}

const EMPTY_CONTEXT: KeywordContext = {
  primary:   null,
  secondary: [],
  longTail:  [],
  questions: [],
  avoid:     [],
}

const projectId  = process.env['SANITY_PROJECT_ID']
const dataset    = process.env['SANITY_DATASET'] ?? 'production'
const apiVersion = '2024-10-01'

function getReadClient() {
  if (!projectId) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient({
    projectId,
    dataset,
    apiVersion,
    useCdn: true,
    token: process.env['SANITY_API_TOKEN'],
    perspective: 'published',
  } as any)
}

/**
 * Pre-rank score: relevance × log(volume + 1) ÷ (1 + difficulty/100).
 * Pure function — keeps the hot path deterministic so cache keys stay stable.
 */
function score(k: SeoKeyword): number {
  const rel  = k.relevanceScore ?? 0.5
  const vol  = k.volume ?? 0
  const diff = k.difficulty ?? 50
  return (rel * Math.log(vol + 1)) / (1 + diff / 100)
}

/**
 * Tag-overlap pre-filter executed in GROQ. Keeps the candidate set small
 * before any in-memory ranking. We accept keywords that either:
 *   - share at least one tag with the input on any of the three vocabularies, or
 *   - match the productTypeDial, or
 *   - have no tags at all (general-purpose keywords always eligible).
 * This is intentionally permissive — narrow filters miss long-tail opportunities.
 */
const KEYWORD_PROJECTION = `
  _id, term, kind, intent, volume, difficulty, relevanceScore,
  productTypeDials, moodTags, audienceTags, mattersTags, contentTypes,
  "cluster": cluster->{ "slug": slug.current, title, pillarTerm }
`

async function fetchCandidates(input: BuildKeywordContextInput): Promise<SeoKeyword[]> {
  const client = getReadClient()
  if (!client) return []

  const productType = input.productType ?? null
  const moods       = input.moods     ?? []
  const audiences   = input.audiences ?? []
  const matters     = input.matters   ?? []
  const contentType = input.contentType

  const groq = `
    *[_type == "seoKeyword" && status == "approved" && flagged != true && (
      // Content type matches or is "any" / unspecified
      !defined(contentTypes) || count(contentTypes) == 0 ||
      "any" in contentTypes || $contentType in contentTypes
    ) && (
      // No taxonomy tags at all = general-purpose, always eligible
      (!defined(productTypeDials) || count(productTypeDials) == 0) &&
      (!defined(moodTags)         || count(moodTags) == 0) &&
      (!defined(audienceTags)     || count(audienceTags) == 0) &&
      (!defined(mattersTags)      || count(mattersTags) == 0)
    ) || (
      // Or shares at least one tag with the input
      ($productType != null && $productType in productTypeDials) ||
      count((moodTags     ?? [])[@ in $moods])     > 0 ||
      count((audienceTags ?? [])[@ in $audiences]) > 0 ||
      count((mattersTags  ?? [])[@ in $matters])   > 0
    )]{ ${KEYWORD_PROJECTION} }
  `
  try {
    return (await client.fetch<SeoKeyword[]>(groq, {
      contentType,
      productType,
      moods,
      audiences,
      matters,
    })) ?? []
  } catch (err) {
    console.error('[seo-keywords] fetchCandidates error:', err)
    return []
  }
}

async function fetchAvoidList(): Promise<string[]> {
  const client = getReadClient()
  if (!client) return []
  try {
    const rows = await client.fetch<{ term: string }[]>(
      `*[_type == "seoKeyword" && (status == "rejected" || flagged == true)]{ term }`,
    )
    return (rows ?? []).map(r => r.term).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Hash inputs into a deterministic cache key. Sorts arrays so order doesn't
 * matter and most products in a category collapse to the same entry — high
 * cache hit rate during bulk regeneration.
 */
function cacheKey(input: BuildKeywordContextInput): string {
  const sortedMoods     = [...(input.moods     ?? [])].sort()
  const sortedAudiences = [...(input.audiences ?? [])].sort()
  const sortedMatters   = [...(input.matters   ?? [])].sort()
  const parts = [
    'seo-kw:v1',
    input.contentType,
    input.productType ?? 'none',
    sortedMoods.join(','),
    sortedAudiences.join(','),
    sortedMatters.join(','),
    input.topic ? input.topic.slice(0, 80).toLowerCase() : '',
  ]
  return parts.join('|')
}

/**
 * Picks the final keyword set from the pre-filtered, pre-scored candidates.
 * Pure function so the cache layer can replay it deterministically.
 */
function pickFromCandidates(
  candidates: SeoKeyword[],
  count: { primary: number; secondary: number; longTail: number; questions: number },
): KeywordContext {
  const sorted = [...candidates].sort((a, b) => score(b) - score(a))
  const used   = new Set<string>()
  const take = (predicate: (k: SeoKeyword) => boolean, n: number): SeoKeyword[] => {
    const out: SeoKeyword[] = []
    for (const k of sorted) {
      if (out.length >= n) break
      if (used.has(k._id)) continue
      if (predicate(k)) { out.push(k); used.add(k._id) }
    }
    return out
  }

  // Primary: prefer "head" terms; fall back to highest-scored anything.
  const primary =
    take(k => k.kind === 'head', count.primary)[0]
    ?? take(() => true, 1)[0]
    ?? null

  // Secondary: long-tail or commercial intent — these carry weight on PDPs/articles.
  const secondary = take(k => k.kind === 'long-tail' || k.intent === 'commercial', count.secondary)
  // Long-tail: anything not yet picked, biased to long-tail kind.
  const longTail = take(k => k.kind === 'long-tail', count.longTail)
  // Questions: surfaceable in FAQ Q&A.
  const questions = take(k => k.kind === 'question', count.questions)

  return { primary, secondary, longTail, questions, avoid: [] }
}

/**
 * Public API. Returns a structured KeywordContext for a single piece of content.
 * Cached for 7 days in KV (keyed on tag combo) — most products in the same
 * category share the same keyword shortlist.
 */
export async function buildKeywordContext(
  input: BuildKeywordContextInput,
): Promise<KeywordContext> {
  if (input.seoMode === 'off') return EMPTY_CONTEXT
  if (!projectId) return EMPTY_CONTEXT

  const counts = {
    primary:   input.count?.primary   ?? 1,
    secondary: input.count?.secondary ?? 4,
    longTail:  input.count?.longTail  ?? 8,
    questions: input.count?.questions ?? 3,
  }

  const key = cacheKey(input)
  return cached(key, 7 * 24 * 60 * 60, async () => {
    const [candidates, avoid] = await Promise.all([
      fetchCandidates(input),
      fetchAvoidList(),
    ])
    const ctx = pickFromCandidates(candidates, counts)
    return { ...ctx, avoid }
  })
}

/**
 * Render a KeywordContext into a prompt-ready XML block. Placed in the user
 * message (not the system prompt) so it contextualizes the specific generation
 * and doesn't bloat every base call.
 *
 * Returns an empty string when there are no keywords to weave — copy generation
 * falls back to the pre-keyword behaviour.
 */
export function renderKeywordBlock(ctx: KeywordContext): string {
  if (!ctx.primary && ctx.secondary.length === 0 && ctx.longTail.length === 0 && ctx.questions.length === 0) {
    return ''
  }
  const lines: string[] = ['<keyword_targets>']
  if (ctx.primary) {
    lines.push(`  <primary intent="${ctx.primary.intent ?? 'unknown'}">${ctx.primary.term}</primary>`)
  }
  if (ctx.secondary.length) {
    lines.push('  <secondary>')
    for (const k of ctx.secondary) lines.push(`    - ${k.term}`)
    lines.push('  </secondary>')
  }
  if (ctx.longTail.length) {
    lines.push('  <long_tail>')
    for (const k of ctx.longTail) lines.push(`    - ${k.term}`)
    lines.push('  </long_tail>')
  }
  if (ctx.questions.length) {
    lines.push('  <questions>')
    for (const k of ctx.questions) lines.push(`    - ${k.term}`)
    lines.push('  </questions>')
  }
  if (ctx.avoid.length) {
    const trimmed = ctx.avoid.slice(0, 12)
    lines.push(`  <avoid>${trimmed.join(' | ')}</avoid>`)
  }
  lines.push('</keyword_targets>')
  return lines.join('\n')
}

/**
 * Convenience wrapper: build context + render in one call. Most callers want both.
 * Returns `''` if no keywords are available so prompt assembly stays clean.
 */
export async function buildKeywordBlock(input: BuildKeywordContextInput): Promise<string> {
  const ctx = await buildKeywordContext(input)
  return renderKeywordBlock(ctx)
}
