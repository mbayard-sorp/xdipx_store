/**
 * SEO coverage gauge version guard.
 *
 * `coverageCounters()` in seo-daily.server.ts reads the precomputed discovery
 * payload to report catalog size and taxonomy coverage into seo_coverage_daily.
 * It used to select `WHERE version = 'v7'` as a literal. Because the payload is
 * namespaced by INDEX_VERSION and a bump writes a NEW row rather than updating
 * the old one, the v8 bump on 2026-08-16 left that query pointing at a frozen
 * five-week-old row: the gauge kept reporting 4,380 products, and identical
 * numbers day over day, while the live v9 index held 4,982.
 *
 * Nothing failed. The dashboard simply lied, and every routine reading
 * seo_coverage_daily inherited the lie — which is how it went unnoticed for
 * three weeks. So the guard is static and deliberately blunt: the query must
 * derive its version from the single exported constant, and the file must not
 * reintroduce a hardcoded version literal.
 *
 * This proves the wiring, not the returned row — honest about what it covers.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const seoDaily = readFileSync(join(root, 'app/lib/seo-daily.server.ts'), 'utf8')
const discovery = readFileSync(join(root, 'app/lib/discovery.server.ts'), 'utf8')

describe('discovery index version is single-sourced', () => {
  it('discovery.server.ts exports INDEX_VERSION', () => {
    expect(discovery).toMatch(/export const INDEX_VERSION = '(v\d+)'/)
  })

  it('seo-daily.server.ts imports INDEX_VERSION rather than naming a version', () => {
    expect(seoDaily).toMatch(/import \{ INDEX_VERSION \} from '~\/lib\/discovery\.server'/)
  })

  it('the coverage query interpolates INDEX_VERSION', () => {
    expect(seoDaily).toContain('FROM discovery_index_payload WHERE version = ${INDEX_VERSION}')
  })

  it('seo-daily.server.ts contains no hardcoded discovery version literal', () => {
    // Matches `version = 'v7'`, `version='v12'`, etc. — the exact shape that
    // froze the gauge. Comments referencing a version in prose are fine.
    const hardcoded = seoDaily.match(/version\s*=\s*'v\d+'/g)
    expect(hardcoded, `hardcoded version literal(s): ${hardcoded?.join(', ')}`).toBeNull()
  })
})
