/**
 * Pure derivation of a `social_posts.gate_status` value from deterministic
 * publish-check findings (Phase 3, ticket #4938). Client-safe: no imports.
 *
 * The admin gate route (`api.admin.social-gate`) runs only the mechanical
 * checks; the agent verdict (PASS) is never produced here. So the derivation
 * is one-directional: findings can lower a row to `block`, `hold` or `revise`,
 * and a clean result leaves `gateStatus` null until the social-publish-gate
 * agent issues the PASS on its next run.
 */

export type GateStatusValue = 'pass' | 'revise' | 'block' | 'hold'

export interface StoredGateFinding {
  check: string
  verdict: string
  note?: string
}

export interface RawFinding {
  check: string
  severity: 'block' | 'hold' | 'warn'
  detail: string
}

/** Map the deterministic gate's severity vocabulary onto the stored verdict. */
export function findingToStored(f: RawFinding): StoredGateFinding {
  const verdict = f.severity === 'block' ? 'block' : f.severity === 'hold' ? 'hold' : 'revise'
  return { check: f.check, verdict, note: f.detail }
}

/**
 * `block` when any finding blocks, else `hold` when any needs the owner, else
 * `revise` when anything else was found, else null (clean, awaiting the agent).
 */
export function deriveGateStatus(findings: readonly StoredGateFinding[]): GateStatusValue | null {
  if (findings.some(f => f.verdict === 'block')) return 'block'
  if (findings.some(f => f.verdict === 'hold')) return 'hold'
  if (findings.length > 0) return 'revise'
  return null
}

/** Named mechanical checks the panel lists even when they found nothing. */
export const MECHANICAL_CHECKS: readonly { check: string; label: string }[] = [
  { check: 'image-provenance', label: 'Image provenance' },
  { check: 'caption-sale', label: 'No selling language' },
  { check: 'caption-lexicon', label: 'Caption lexicon' },
  { check: 'caption-length', label: 'Caption length' },
  { check: 'caption-repetition', label: 'No repeated lines' },
  { check: 'product-stock', label: 'Product in stock' },
]

export interface PanelRow {
  check: string
  label: string
  verdict: GateStatusValue
  note?: string
}

/**
 * Merge stored findings over the named check list so the panel shows every
 * check with its verdict, passing ones included.
 */
export function panelRows(findings: readonly StoredGateFinding[] | null | undefined): PanelRow[] {
  const byCheck = new Map<string, StoredGateFinding[]>()
  for (const f of findings ?? []) {
    const key = checkFamily(f.check)
    byCheck.set(key, [...(byCheck.get(key) ?? []), f])
  }
  const rows: PanelRow[] = MECHANICAL_CHECKS.map(c => {
    const hits = byCheck.get(c.check) ?? []
    byCheck.delete(c.check)
    const verdict = deriveGateStatus(hits) ?? 'pass'
    const note = hits.map(h => h.note).filter(Boolean).join(' ')
    return note ? { check: c.check, label: c.label, verdict, note } : { check: c.check, label: c.label, verdict }
  })
  for (const [check, hits] of byCheck) {
    const note = hits.map(h => h.note).filter(Boolean).join(' ')
    const verdict = deriveGateStatus(hits) ?? 'pass'
    rows.push(note ? { check, label: check, verdict, note } : { check, label: check, verdict })
  }
  return rows
}

/** Fold finding slugs like `caption-sale-discount` into their named family. */
function checkFamily(check: string): string {
  for (const c of MECHANICAL_CHECKS) {
    if (check === c.check || check.startsWith(`${c.check}-`)) return c.check
  }
  if (check.startsWith('caption-')) return 'caption-lexicon'
  if (check.startsWith('stock') || check.includes('sellable') || check.includes('product')) return 'product-stock'
  return check
}
