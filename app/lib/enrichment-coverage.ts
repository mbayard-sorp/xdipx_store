/**
 * Per-field enrichment coverage — pure scoring logic (no I/O).
 *
 * The Shopify walk and KV cache live in `enrichment-coverage.server.ts`; this
 * file holds only the field catalog and the presence/tally functions so they
 * stay unit-testable without touching the server boundary.
 *
 * Answers: of the products live on the storefront, what share carry each
 * enrichment metafield / tag (tagline, sensation_dial, mood/audience/matters
 * tags, ...). That is the moodTags-at-49% class of gap the
 * automation-audit-roadmap p1-8-pdp tracker carries (ticket #3891). FAQs are
 * deliberately absent: they are a Sanity-only field, not a Shopify metafield
 * (see emma-orchestrator.server.ts), so they are not a "metafield/tag" this
 * view can measure.
 */

export type FieldKind = 'text' | 'list' | 'json'

export interface EnrichmentFieldDef {
  /** xdipx-namespace metafield key. */
  key: string
  /** Admin-facing label. */
  label: string
  /** How its value serializes, which decides what "present" means. */
  kind: FieldKind
}

/**
 * The editorial fields the enricher writes, in the order the admin reads them.
 * Keep every key inside the `xdipx` namespace and mirrored by the enrichment
 * writer; a key here that nothing writes always reports 0% and misleads.
 */
export const ENRICHMENT_FIELDS: readonly EnrichmentFieldDef[] = [
  { key: 'tagline',             label: 'Tagline',           kind: 'text' },
  { key: 'full_story',          label: 'Full story',        kind: 'text' },
  { key: 'seo_meta_description',label: 'SEO meta desc',     kind: 'text' },
  { key: 'works_for_him',       label: 'Works for him',     kind: 'text' },
  { key: 'works_for_her',       label: 'Works for her',     kind: 'text' },
  { key: 'sensation_dial',      label: 'Sensation dial',    kind: 'json' },
  { key: 'mood_tags',           label: 'Mood tags',         kind: 'list' },
  { key: 'audience_tags',       label: 'Audience tags',     kind: 'list' },
  { key: 'matters_tags',        label: 'Matters tags',      kind: 'list' },
  { key: 'product_type_dial',   label: 'Product-type dial', kind: 'text' },
  { key: 'pairing_why',         label: 'Pairs-with copy',   kind: 'json' },
] as const

export interface FieldCoverage {
  key: string
  label: string
  /** Products carrying a non-empty value for this field. */
  covered: number
  /** Products scanned (== totalProducts). Carried per-field for easy render. */
  total: number
  /** covered / total as a 0–100 integer; 0 when total is 0. */
  pct: number
}

export interface EnrichmentCoverage {
  totalProducts: number
  fields: FieldCoverage[]
  /** ISO timestamp of when this snapshot was computed. */
  builtAt: string
}

/** One product's requested metafields, as the Shopify identifiers form returns. */
export interface CoverageProductNode {
  id: string
  /** `metafields(identifiers: [...])` returns nulls for absent keys. */
  metafields: ({ key: string; value: string | null } | null)[]
}

/** A list.text metafield is a JSON array; tolerate legacy comma-separated too. */
function listHasEntries(value: string): boolean {
  const v = value.trim()
  if (v.startsWith('[')) {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) && parsed.some(x => String(x).trim() !== '')
    } catch {
      return false
    }
  }
  return v.split(',').some(s => s.trim() !== '')
}

/** A json metafield counts as present only when it holds real content. */
function jsonHasContent(value: string): boolean {
  const v = value.trim()
  if (v === '') return false
  try {
    const parsed = JSON.parse(v)
    if (parsed == null) return false
    if (Array.isArray(parsed)) return parsed.length > 0
    if (typeof parsed === 'object') return Object.keys(parsed).length > 0
    // A primitive (number/string/bool) is content.
    return String(parsed).trim() !== ''
  } catch {
    // Not valid JSON — treat a non-empty raw string as present rather than
    // silently undercounting a field Shopify stored in an older shape.
    return true
  }
}

/** Whether a raw metafield value counts as "present" for the given kind. */
export function isFieldPresent(kind: FieldKind, value: string | null | undefined): boolean {
  if (value == null) return false
  switch (kind) {
    case 'text': return value.trim() !== ''
    case 'list': return listHasEntries(value)
    case 'json': return jsonHasContent(value)
  }
}

/**
 * Pure tally: given the scanned product nodes, count per-field presence and
 * compute percentages. No I/O, no clock — the caller stamps `builtAt`.
 */
export function tallyCoverage(nodes: CoverageProductNode[]): Omit<EnrichmentCoverage, 'builtAt'> {
  const total = nodes.length
  const covered = new Map<string, number>()
  for (const field of ENRICHMENT_FIELDS) covered.set(field.key, 0)

  for (const node of nodes) {
    const byKey = new Map<string, string | null>()
    for (const mf of node.metafields) {
      if (mf) byKey.set(mf.key, mf.value)
    }
    for (const field of ENRICHMENT_FIELDS) {
      if (isFieldPresent(field.kind, byKey.get(field.key))) {
        covered.set(field.key, (covered.get(field.key) ?? 0) + 1)
      }
    }
  }

  const fields: FieldCoverage[] = ENRICHMENT_FIELDS.map(f => {
    const c = covered.get(f.key) ?? 0
    return {
      key: f.key,
      label: f.label,
      covered: c,
      total,
      pct: total === 0 ? 0 : Math.round((c / total) * 100),
    }
  })

  return { totalProducts: total, fields }
}
