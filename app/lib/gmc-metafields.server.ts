/**
 * GMC (Google Merchant Center) field derivation helpers.
 *
 * Pure functions -- no Shopify API calls. Used by the feed route and any
 * future backfill scripts that need to derive GMC values from existing
 * product metadata.
 */

// ─── Category mapping ─────────────────────────────────────────────────────

const GMC_CATEGORY_MAP: Record<string, string> = {
  vibrator:    '5391',
  dildo:       '5391',
  anal:        '5391',
  bondage:     '5391',
  'cock-ring': '5391',
  stroker:     '5391',
  couples:     '5391',
  harness:     '5391',
  extender:    '5391',
  pump:        '5391',
  enhancer:    '5391',
  novelty:     '5391',
  'sex-machine':'5391',
  wear:        '5391',
  'book-media':'5391',
  lube:        '776',
  massage:     '776',
  wellness:    '776',
  condom:      '776',
}

/**
 * Maps a product_type_dial value to a GMC numeric category string.
 * Falls back to "5391" (Adult) for unknown types.
 */
export function gmcProductCategory(productTypeDial: string | null): string {
  if (!productTypeDial) return '5391'
  return GMC_CATEGORY_MAP[productTypeDial] ?? '5391'
}

// ─── Gender ───────────────────────────────────────────────────────────────

/**
 * Derives the GMC gender field from audience_tags.
 * Returns 'male' when only for-him, 'female' when only for-her,
 * 'unisex' otherwise (couples, both, or empty).
 */
export function gmcGender(audienceTags: string[]): 'male' | 'female' | 'unisex' {
  const hasHim = audienceTags.includes('for-him')
  const hasHer = audienceTags.includes('for-her')
  if (hasHim && !hasHer) return 'male'
  if (hasHer && !hasHim) return 'female'
  return 'unisex'
}

// ─── Custom labels ────────────────────────────────────────────────────────

/**
 * custom_label_0: the product_type_dial value itself (e.g. "vibrator").
 * Empty string when null -- GMC tag should be omitted when empty.
 */
export function gmcCustomLabel0(productTypeDial: string | null): string {
  return productTypeDial ?? ''
}

/**
 * custom_label_1: audience bucket derived from audience_tags.
 * "for-him" | "for-her" | "couples" | "unisex"
 */
export function gmcCustomLabel1(audienceTags: string[]): string {
  const hasHim = audienceTags.includes('for-him')
  const hasHer = audienceTags.includes('for-her')
  const hasCouples = audienceTags.includes('couples')
  if (hasCouples) return 'couples'
  if (hasHim && hasHer) return 'unisex'
  if (hasHim) return 'for-him'
  if (hasHer) return 'for-her'
  return 'unisex'
}

/**
 * custom_label_2: deal score bucket.
 * high > 80, mid >= 60, low < 60. Null score -> "low".
 */
export function gmcCustomLabel2(dealScore: number | null): 'high' | 'mid' | 'low' {
  if (dealScore === null || dealScore === undefined) return 'low'
  if (dealScore > 80) return 'high'
  if (dealScore >= 60) return 'mid'
  return 'low'
}

/**
 * custom_label_3: deal vs vault.
 */
export function gmcCustomLabel3(isDailyDeal: boolean): 'deal' | 'vault' {
  return isDailyDeal ? 'deal' : 'vault'
}

/**
 * custom_label_4: price tier bucket.
 * under-30 | 30-to-60 | 60-plus
 */
export function gmcCustomLabel4(price: number): 'under-30' | '30-to-60' | '60-plus' {
  if (price < 30) return 'under-30'
  if (price <= 60) return '30-to-60'
  return '60-plus'
}

// ─── Spec parser ──────────────────────────────────────────────────────────

/**
 * Parses a specifications array of "Label: Value" strings and returns the
 * value for a given key (case-insensitive). Returns null when the key is
 * absent or the value is empty.
 *
 * Example:
 *   parseSpecValue(["Color: Black", "Material: Silicone"], "color") => "Black"
 */
export function parseSpecValue(specifications: string[], key: string): string | null {
  const lowerKey = key.toLowerCase()
  for (const spec of specifications) {
    const colonIdx = spec.indexOf(':')
    if (colonIdx === -1) continue
    const specKey = spec.slice(0, colonIdx).trim().toLowerCase()
    if (specKey === lowerKey) {
      const val = spec.slice(colonIdx + 1).trim()
      return val.length > 0 ? val : null
    }
  }
  return null
}
