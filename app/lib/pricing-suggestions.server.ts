import crypto from 'node:crypto'
import { generateWithSystem } from './claude.server'
import { kvGet, kvSet } from './kv.server'

export interface MarkupSuggestion {
  productType: string
  highMarginDiscount: number
  mediumMarginDiscount: number
  rationale: string
}

const SUGGESTION_TTL = 3600 // 1 hour

function cacheKey(types: Array<{ productType: string; count: number }>): string {
  const sorted = [...types].sort((a, b) => a.productType.localeCompare(b.productType))
  const hash = crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16)
  return `pricing:markup-suggestions:${hash}`
}

function clampDiscount(v: unknown): number | null {
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') {
    const parsed = parseFloat(v.replace('%', '').trim())
    if (isNaN(parsed)) return null
    // Tolerate models that return whole-number percents like "35" instead of 0.35
    n = parsed > 1 ? parsed / 100 : parsed
  } else return null
  if (isNaN(n)) return null
  return Math.min(0.6, Math.max(0, n))
}

export interface SuggestResult {
  suggestions: MarkupSuggestion[]
  debug?: {
    rawLength: number
    parsedCount: number
    rejectedCount: number
    rejectedReasons: string[]
    rawPreview: string
    error?: string
  }
}

export async function suggestMarkupsByType(opts: {
  types: Array<{ productType: string; count: number }>
  globalHighDiscount: number
  globalMediumDiscount: number
  bypassCache?: boolean
}): Promise<SuggestResult> {
  const { types, globalHighDiscount, globalMediumDiscount, bypassCache } = opts

  if (types.length === 0) return { suggestions: [] }

  const key = cacheKey(types)
  if (!bypassCache) {
    const cached = await kvGet<MarkupSuggestion[]>(key)
    if (cached && cached.length > 0) return { suggestions: cached }
  }

  const typeList = types.map(t => `- ${t.productType} (${t.count} products)`).join('\n')

  const system = [
    'You are a pricing strategist for xdipx.com, an editorially-curated sexual-wellness storefront.',
    'Context: 20% margin floor. Building brand share. Generous pricing is OK. Not a luxury brand.',
    `Current global discounts: high-margin products ${Math.round(globalHighDiscount * 100)}% off MSRP, medium-margin products ${Math.round(globalMediumDiscount * 100)}% off MSRP.`,
    'Your job: suggest per product-type discount percentages that maximise deal appeal while respecting the margin floor.',
    'Rules:',
    '- highMarginDiscount and mediumMarginDiscount are decimal fractions (e.g. 0.35 = 35%).',
    '- Values must be between 0.0 and 0.6.',
    '- Rationale must be a single sentence, plain English, no em-dashes.',
    '- Respond ONLY with a valid JSON array. No prose before or after.',
    'Output schema: Array<{ productType: string, highMarginDiscount: number, mediumMarginDiscount: number, rationale: string }>',
  ].join('\n')

  const user = [
    'Suggest discount settings for these product types:',
    typeList,
    '',
    'Return a JSON array with one entry per product type. Every type listed above MUST appear in the output exactly as written, including punctuation and capitalization.',
    'Keep each rationale under 60 characters. Brevity is required so the whole array fits in the response.',
  ].join('\n')

  let raw = ''
  try {
    raw = await generateWithSystem({ system, user, maxTokens: 4096, timeoutMs: 45000 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[pricing-suggestions] Claude call failed:', msg)
    return {
      suggestions: [],
      debug: { rawLength: 0, parsedCount: 0, rejectedCount: 0, rejectedReasons: [], rawPreview: '', error: `Claude call failed: ${msg}` },
    }
  }

  const rawPreview = raw.slice(0, 600)
  // Strip markdown fences if present, find the array start, then either parse
  // the whole array OR walk object-by-object recovering as much as we can if
  // the response was truncated mid-array.
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const arrStart = stripped.indexOf('[')
  if (arrStart < 0) {
    return {
      suggestions: [],
      debug: { rawLength: raw.length, parsedCount: 0, rejectedCount: 0, rejectedReasons: [], rawPreview, error: 'No JSON array found in Claude response.' },
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped.slice(arrStart))
  } catch {
    // Fall back: scan for balanced `{...}` blocks and parse each independently.
    const recovered: unknown[] = []
    let depth = 0
    let objStart = -1
    let inString = false
    let escape = false
    for (let i = arrStart; i < stripped.length; i++) {
      const ch = stripped[i]
      if (escape) { escape = false; continue }
      if (inString) {
        if (ch === '\\') escape = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') { inString = true; continue }
      if (ch === '{') {
        if (depth === 0) objStart = i
        depth++
      } else if (ch === '}') {
        depth--
        if (depth === 0 && objStart >= 0) {
          const objText = stripped.slice(objStart, i + 1)
          try {
            recovered.push(JSON.parse(objText))
          } catch { /* skip malformed */ }
          objStart = -1
        }
      }
    }
    parsed = recovered
  }

  if (!Array.isArray(parsed)) {
    return {
      suggestions: [],
      debug: { rawLength: raw.length, parsedCount: 0, rejectedCount: 0, rejectedReasons: [], rawPreview, error: 'Parsed payload was not an array.' },
    }
  }

  const suggestions: MarkupSuggestion[] = []
  const rejectedReasons: string[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') { rejectedReasons.push('non-object item'); continue }
    const pt = typeof item.productType === 'string' ? item.productType.trim() : null
    if (!pt) { rejectedReasons.push('missing productType'); continue }
    const high = clampDiscount(item.highMarginDiscount)
    const medium = clampDiscount(item.mediumMarginDiscount)
    if (high === null) { rejectedReasons.push(`${pt}: bad highMarginDiscount (${JSON.stringify(item.highMarginDiscount)})`); continue }
    if (medium === null) { rejectedReasons.push(`${pt}: bad mediumMarginDiscount (${JSON.stringify(item.mediumMarginDiscount)})`); continue }
    const rationale = typeof item.rationale === 'string' ? item.rationale.trim() : ''
    // Accept missing rationale rather than reject the whole row.
    suggestions.push({
      productType: pt,
      highMarginDiscount: high,
      mediumMarginDiscount: medium,
      rationale: rationale || '(no rationale provided)',
    })
  }

  console.log(`[pricing-suggestions] parsed=${parsed.length} accepted=${suggestions.length} rejected=${rejectedReasons.length}`)

  if (suggestions.length > 0) {
    await kvSet(key, suggestions, SUGGESTION_TTL)
  }

  return {
    suggestions,
    debug: {
      rawLength: raw.length,
      parsedCount: parsed.length,
      rejectedCount: rejectedReasons.length,
      rejectedReasons,
      rawPreview,
    },
  }
}
