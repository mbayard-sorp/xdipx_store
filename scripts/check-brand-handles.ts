/**
 * Validator for docs/store-team/brand-ig-handles.json (ticket #3732,
 * instagram-campaigns.md section 8: no verified registry, no tag).
 *
 * Two layers:
 *   1. Shape validation (always runs, no credentials needed, so it can run in
 *      CI): the registry must parse, every entry must be
 *      { instagram: string|null, x: string|null }, every non-null handle must
 *      be a legal handle, and every non-null handle must carry a `verified`
 *      block with a date and evidence. Null entries must carry a `note`
 *      explaining why they are null, so a null is a decision, not an omission.
 *   2. Shopify vendor check (runs only when SHOPIFY_STORE_DOMAIN +
 *      SHOPIFY_ADMIN_ACCESS_TOKEN are present; skipped with a notice in CI):
 *      every registry key must be a vendor the store actually carries, so a
 *      renamed vendor cannot silently orphan its registry entry.
 *
 * Usage:
 *   npx tsx scripts/check-brand-handles.ts
 *
 * Exit 0 = valid; exit 1 = problems printed.
 */

import './_load-env'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Instagram: 1-30 chars, letters/digits/dot/underscore. X: 1-15 word chars.
const IG_HANDLE_RE = /^[a-z0-9._]{1,30}$/i
const X_HANDLE_RE = /^\w{1,15}$/

export interface BrandHandleEntry {
  instagram: string | null
  x: string | null
  verified?: { date: string; evidence: string }
  note?: string
}

export interface BrandHandleRegistry {
  updated: string
  vendors: Record<string, BrandHandleEntry>
}

/** Returns a list of problems; empty = valid. Pure, so the test can drive it. */
export function validateRegistryShape(raw: unknown): string[] {
  const problems: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return ['registry root must be a JSON object']
  }
  const reg = raw as Record<string, unknown>
  if (typeof reg['updated'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reg['updated'])) {
    problems.push('`updated` must be a YYYY-MM-DD string')
  }
  const vendors = reg['vendors']
  if (!vendors || typeof vendors !== 'object' || Array.isArray(vendors)) {
    problems.push('`vendors` must be an object keyed by Shopify vendor name')
    return problems
  }
  const entries = Object.entries(vendors as Record<string, unknown>)
  if (entries.length === 0) problems.push('`vendors` is empty')

  for (const [vendor, value] of entries) {
    const at = `vendors["${vendor}"]`
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      problems.push(`${at} must be an object`)
      continue
    }
    const e = value as Record<string, unknown>
    for (const platform of ['instagram', 'x'] as const) {
      const h = e[platform]
      if (h === undefined) { problems.push(`${at}.${platform} is required (use null when unverified)`); continue }
      if (h === null) continue
      if (typeof h !== 'string') { problems.push(`${at}.${platform} must be a string or null`); continue }
      if (h.startsWith('@')) problems.push(`${at}.${platform} must not include the @ prefix`)
      const re = platform === 'instagram' ? IG_HANDLE_RE : X_HANDLE_RE
      if (!re.test(h.replace(/^@/, ''))) problems.push(`${at}.${platform} "${h}" is not a legal ${platform} handle`)
    }
    const hasHandle = e['instagram'] != null || e['x'] != null
    const verified = e['verified']
    if (hasHandle) {
      if (!verified || typeof verified !== 'object' || Array.isArray(verified)) {
        problems.push(`${at} carries a handle but no \`verified\` block: a handle without evidence is a guess, and a wrong tag is worse than no tag`)
      } else {
        const v = verified as Record<string, unknown>
        if (typeof v['date'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v['date'])) {
          problems.push(`${at}.verified.date must be YYYY-MM-DD`)
        }
        if (typeof v['evidence'] !== 'string' || (v['evidence'] as string).trim().length < 10) {
          problems.push(`${at}.verified.evidence must say what was checked`)
        }
      }
    } else if (typeof e['note'] !== 'string' || (e['note'] as string).trim().length === 0) {
      problems.push(`${at} is all-null but has no \`note\`: a null must be a documented decision`)
    }
  }
  return problems
}

async function checkVendorsExistInShopify(registry: BrandHandleRegistry): Promise<string[]> {
  const domain = process.env['SHOPIFY_STORE_DOMAIN']
  const token = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']
  if (!domain || !token) {
    console.log('[check-brand-handles] SHOPIFY credentials absent (CI): skipping vendor-existence check')
    return []
  }
  const res = await fetch(`https://${domain}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: `{ shop { productVendors(first: 250) { edges { node } } } }` }),
  })
  if (!res.ok) return [`Shopify vendor lookup failed: HTTP ${res.status}`]
  const body = await res.json() as { data?: { shop?: { productVendors?: { edges: Array<{ node: string }> } } }; errors?: unknown }
  if (body.errors || !body.data?.shop?.productVendors) return [`Shopify vendor lookup failed: ${JSON.stringify(body.errors ?? 'no data')}`]
  const known = new Set(body.data.shop.productVendors.edges.map(e => e.node))
  return Object.keys(registry.vendors)
    .filter(v => !known.has(v))
    .map(v => `vendor "${v}" is in the registry but not in Shopify's vendor list (renamed or dropped?)`)
}

async function main(): Promise<number> {
  const path = fileURLToPath(new URL('../docs/store-team/brand-ig-handles.json', import.meta.url))
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    console.error(`[check-brand-handles] cannot read/parse ${path}:`, err)
    return 1
  }

  const problems = validateRegistryShape(raw)
  if (problems.length === 0) {
    const registry = raw as unknown as BrandHandleRegistry
    problems.push(...await checkVendorsExistInShopify(registry))
    const verified = Object.values(registry.vendors).filter(e => e.instagram != null || e.x != null).length
    console.log(`[check-brand-handles] ${Object.keys(registry.vendors).length} vendors, ${verified} with verified handles`)
  }

  if (problems.length > 0) {
    console.error(`[check-brand-handles] ${problems.length} problem(s):`)
    for (const p of problems) console.error(`  - ${p}`)
    return 1
  }
  console.log('[check-brand-handles] OK')
  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().then(
    code => process.exit(code),
    err => { console.error('[check-brand-handles] failed:', err); process.exit(1) },
  )
}
