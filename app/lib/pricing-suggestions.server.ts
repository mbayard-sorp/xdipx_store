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
  if (typeof v !== 'number' || isNaN(v)) return null
  return Math.min(0.6, Math.max(0, v))
}

export async function suggestMarkupsByType(opts: {
  types: Array<{ productType: string; count: number }>
  globalHighDiscount: number
  globalMediumDiscount: number
}): Promise<MarkupSuggestion[]> {
  const { types, globalHighDiscount, globalMediumDiscount } = opts

  if (types.length === 0) return []

  const key = cacheKey(types)
  const cached = await kvGet<MarkupSuggestion[]>(key)
  if (cached) return cached

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
    'Return a JSON array with one entry per product type.',
  ].join('\n')

  let raw: string
  try {
    raw = await generateWithSystem({ system, user, maxTokens: 1024, timeoutMs: 20000 })
  } catch {
    return []
  }

  let parsed: unknown
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) return []
    parsed = JSON.parse(match[0])
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) return []

  const suggestions: MarkupSuggestion[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const pt = typeof item.productType === 'string' ? item.productType.trim() : null
    if (!pt) continue
    const high = clampDiscount(item.highMarginDiscount)
    const medium = clampDiscount(item.mediumMarginDiscount)
    const rationale = typeof item.rationale === 'string' ? item.rationale.trim() : ''
    if (high === null || medium === null || !rationale) continue
    suggestions.push({ productType: pt, highMarginDiscount: high, mediumMarginDiscount: medium, rationale })
  }

  if (suggestions.length > 0) {
    await kvSet(key, suggestions, SUGGESTION_TTL)
  }

  return suggestions
}
