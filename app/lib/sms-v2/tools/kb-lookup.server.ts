/**
 * kbLookup — knowledge-base lookup tool for SMS / IVR / chat.
 *
 * Queries Sanity for policy, compatibility, troubleshooting, and brand FAQ
 * content. Used by DISCOVERY, RESEARCH, PRESENTATION, OBJECTION, and
 * POST_PURCHASE stage handlers as a forward ref.
 *
 * Design:
 * - Wraps all Sanity reads with the shared `cached()` helper (KV + in-memory).
 * - Adds a per-request in-memory cache so multiple stage handlers in the same
 *   turn don't double-query Sanity.
 * - Never throws — returns null and emits a warning on any Sanity error.
 */

import { createClient } from '@sanity/client'
import { toHTML } from '@portabletext/to-html'

// ─── Types ────────────────────────────────────────────────────────────────

export type KbTopic =
  | 'shipping'
  | 'returns'
  | 'compatibility'
  | 'troubleshooting'
  | 'brand'

export interface KbResult {
  topic: KbTopic
  quickAnswer: string        // ≤280 chars; for SMS slot-fill
  bodyExcerpt?: string       // for IVR / web chat richer surface
  sourceId: string           // Sanity _id for tracing
  sourceTitle: string
}

// ─── Sanity client (thin, read-only) ─────────────────────────────────────
// Read env vars lazily (inside the function) so tests can manipulate
// process.env before the first call without hitting a stale module-level const.

const KB_SANITY_API_VERSION = '2024-10-01'

function getSanityClient() {
  const projectId = process.env['SANITY_PROJECT_ID']
  const dataset   = process.env['SANITY_DATASET'] ?? 'production'
  if (!projectId) return null
  return createClient({
    projectId,
    dataset,
    apiVersion: KB_SANITY_API_VERSION,
    useCdn: true,
    token: process.env['SANITY_API_TOKEN'],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

// ─── Request-scoped in-memory cache ──────────────────────────────────────
// Prevents double-queries when multiple stage handlers call kbLookup in the
// same request turn. Keyed by `topic|query|productCategory`.

const _reqCache = new Map<string, KbResult | null>()

function reqCacheKey(topic: KbTopic, query?: string, productCategory?: string): string {
  return `${topic}|${query ?? ''}|${productCategory ?? ''}`
}

// ─── Portable text → plain excerpt ───────────────────────────────────────

function ptToExcerpt(blocks: unknown[] | null | undefined): string {
  if (!blocks || !Array.isArray(blocks) || blocks.length === 0) return ''
  try {
    // toHTML renders all blocks; strip tags for a plain-text excerpt.
    const html = toHTML(blocks as Parameters<typeof toHTML>[0])
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
  } catch {
    // Fallback: manual text extraction from first block's children
    const first = blocks[0] as Record<string, unknown>
    if (first?._type === 'block' && Array.isArray(first.children)) {
      return (first.children as Array<{ text?: string }>)
        .map((c) => c.text ?? '')
        .join('')
        .trim()
        .slice(0, 500)
    }
    return ''
  }
}

// ─── Keyword overlap scorer ───────────────────────────────────────────────
// Scores how well a query matches a list of candidate phrases / keywords.
// Uses bidirectional substring containment: a candidate matches if the query
// contains the candidate phrase OR the candidate phrase contains the query.
// Does NOT fall back to first-word prefix matching (that caused false positives).

function overlapScore(query: string, candidates: string[]): number {
  const q = query.toLowerCase()
  // Also tokenize the query into words for single-word keyword matching
  const qWords = new Set(q.split(/\s+/).filter((w) => w.length > 2))
  return candidates.reduce((score, c) => {
    const cLower = c.toLowerCase()
    // Exact phrase containment (either direction)
    if (q.includes(cLower) || cLower.includes(q)) return score + 2
    // Word-level overlap: candidate words that appear in the query
    const cWords = cLower.split(/\s+/).filter((w) => w.length > 2)
    const wordMatches = cWords.filter((w) => qWords.has(w)).length
    return score + wordMatches
  }, 0)
}

// ─── kbLookup ─────────────────────────────────────────────────────────────

export async function kbLookup(args: {
  topic: KbTopic
  query?: string
  productCategory?: string
}): Promise<KbResult | null> {
  const { topic, query, productCategory } = args

  // Request-scoped cache hit
  const cacheKey = reqCacheKey(topic, query, productCategory)
  if (_reqCache.has(cacheKey)) {
    return _reqCache.get(cacheKey) ?? null
  }

  const client = getSanityClient()
  if (!client) {
    console.warn('[kbLookup] Sanity not configured — SANITY_PROJECT_ID missing')
    _reqCache.set(cacheKey, null)
    return null
  }

  try {
    let result: KbResult | null = null

    // ── shipping / returns: singleton fetch ───────────────────────────────
    if (topic === 'shipping' || topic === 'returns') {
      const docType = topic === 'shipping' ? 'kbShippingPolicy' : 'kbReturnsPolicy'
      const raw = await client.fetch<{
        _id: string
        title?: string
        quickAnswer?: string
        body?: unknown[]
      } | null>(
        `*[_type == $docType] | order(_updatedAt desc)[0]{ _id, title, quickAnswer, body }`,
        { docType },
      )

      if (!raw?.quickAnswer) {
        console.warn(`[kbLookup] no ${docType} doc found or missing quickAnswer`)
        _reqCache.set(cacheKey, null)
        return null
      }

      const excerpt = ptToExcerpt(raw.body as unknown[])
      result = {
        topic,
        quickAnswer: raw.quickAnswer.slice(0, 280),
        ...(excerpt ? { bodyExcerpt: excerpt } : {}),
        sourceId: raw._id,
        sourceTitle: raw.title ?? (topic === 'shipping' ? 'Shipping Policy' : 'Returns Policy'),
      }
    }

    // ── compatibility: filter by categoryTags, return matching rule ───────
    else if (topic === 'compatibility') {
      type CompatRow = {
        _id: string
        productTypeA: string
        productTypeB: string
        compatible: boolean
        note?: string
        categoryTags?: string[]
      }

      // Fetch all rules; apply productCategory + query filtering in memory
      // (table is small — avoids complex GROQ array-contains queries).
      const rows = await client.fetch<CompatRow[]>(
        `*[_type == "kbCompatibilityRule"]{ _id, productTypeA, productTypeB, compatible, note, categoryTags }`,
      )

      if (!rows || rows.length === 0) {
        _reqCache.set(cacheKey, null)
        return null
      }

      // Filter: if productCategory supplied, require it appears in categoryTags
      const qLower = (query ?? '').toLowerCase()
      const catLower = (productCategory ?? '').toLowerCase()

      const candidates = rows.filter((r) => {
        const tags = (r.categoryTags ?? []).map((t) => t.toLowerCase())
        if (catLower) {
          // productCategory must match at least one categoryTag
          if (!tags.includes(catLower)) return false
        }
        if (qLower) {
          // query must overlap with categoryTags or type names
          const allTerms = [...tags, r.productTypeA.toLowerCase(), r.productTypeB.toLowerCase()]
          if (!allTerms.some((t) => qLower.includes(t) || t.includes(qLower.split(/\s+/)[0] ?? ''))) {
            return false
          }
        }
        return true
      })

      if (candidates.length === 0) {
        _reqCache.set(cacheKey, null)
        return null
      }

      // Prefer first match (already filtered to relevant category)
      const bestCompat = candidates[0]
      if (!bestCompat) {
        _reqCache.set(cacheKey, null)
        return null
      }
      const compatText = bestCompat.compatible ? 'Compatible' : 'NOT compatible'
      result = {
        topic,
        quickAnswer: (bestCompat.note ?? `${bestCompat.productTypeA} + ${bestCompat.productTypeB}: ${compatText}.`).slice(0, 280),
        sourceId: bestCompat._id,
        sourceTitle: `${bestCompat.productTypeA} + ${bestCompat.productTypeB}`,
      }
    }

    // ── troubleshooting: match by productCategory then rank by query keywords
    else if (topic === 'troubleshooting') {
      type TsRow = {
        _id: string
        title: string
        productCategory?: string
        symptoms?: string[]
        quickAnswer: string
        body?: unknown[]
      }

      const qLower = (query ?? '').toLowerCase()
      const catLower = (productCategory ?? '').toLowerCase()

      // Fetch all — table is small; filter in memory for simplicity.
      const rows = await client.fetch<TsRow[]>(
        `*[_type == "kbTroubleshooting"]{ _id, title, productCategory, symptoms, quickAnswer, body }`,
      )

      if (!rows || rows.length === 0) {
        _reqCache.set(cacheKey, null)
        return null
      }

      // Filter by category (if supplied)
      const byCategory = catLower
        ? rows.filter((r) => !r.productCategory || r.productCategory.toLowerCase() === catLower)
        : rows

      if (byCategory.length === 0) {
        _reqCache.set(cacheKey, null)
        return null
      }

      // Rank by query keyword overlap with symptoms
      const ranked = byCategory
        .map((r) => ({
          row: r,
          score: qLower ? overlapScore(qLower, r.symptoms ?? []) : 0,
        }))
        .sort((a, b) => b.score - a.score)

      const bestTsEntry = ranked[0]
      if (!bestTsEntry) {
        _reqCache.set(cacheKey, null)
        return null
      }
      const bestTs = bestTsEntry.row
      const tsExcerpt = ptToExcerpt(bestTs.body as unknown[])
      result = {
        topic,
        quickAnswer: bestTs.quickAnswer.slice(0, 280),
        ...(tsExcerpt ? { bodyExcerpt: tsExcerpt } : {}),
        sourceId: bestTs._id,
        sourceTitle: bestTs.title,
      }
    }

    // ── brand FAQ: rank by query overlap with tags + question ─────────────
    else if (topic === 'brand') {
      type FaqRow = {
        _id: string
        question: string
        answer: string
        tags?: string[]
      }

      const qLower = (query ?? '').toLowerCase()

      const rows = await client.fetch<FaqRow[]>(
        `*[_type == "kbBrandFaq"]{ _id, question, answer, tags }`,
      )

      if (!rows || rows.length === 0) {
        _reqCache.set(cacheKey, null)
        return null
      }

      // Rank by overlap: tags + question text
      const ranked = rows
        .map((r) => {
          const candidates = [...(r.tags ?? []), ...r.question.split(/\s+/)]
          const score = qLower ? overlapScore(qLower, candidates) : 0
          return { row: r, score }
        })
        .sort((a, b) => b.score - a.score)

      const bestFaqEntry = ranked[0]
      if (!bestFaqEntry) {
        _reqCache.set(cacheKey, null)
        return null
      }
      const bestFaq = bestFaqEntry.row
      result = {
        topic,
        quickAnswer: bestFaq.answer.slice(0, 280),
        sourceId: bestFaq._id,
        sourceTitle: bestFaq.question,
      }
    }

    _reqCache.set(cacheKey, result)
    return result
  } catch (err) {
    console.warn('[kbLookup] Sanity read error:', err)
    _reqCache.set(cacheKey, null)
    return null
  }
}

// ─── Cache reset helper (for tests / request boundaries) ─────────────────

export function _resetKbLookupCache(): void {
  _reqCache.clear()
}
