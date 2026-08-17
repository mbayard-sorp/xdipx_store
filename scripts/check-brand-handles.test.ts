import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateRegistryShape } from './check-brand-handles'

const REGISTRY_PATH = fileURLToPath(new URL('../docs/store-team/brand-ig-handles.json', import.meta.url))

describe('brand handle registry (ticket #3732)', () => {
  it('the checked-in registry passes shape validation', () => {
    const raw = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))
    expect(validateRegistryShape(raw)).toEqual([])
  })

  it('the checked-in registry carries at least 10 verified entries', () => {
    const raw = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as {
      vendors: Record<string, { instagram: string | null; x: string | null }>
    }
    const verified = Object.values(raw.vendors).filter(e => e.instagram != null || e.x != null)
    expect(verified.length).toBeGreaterThanOrEqual(10)
  })

  it('rejects a handle without a verified block (a guess is worse than no tag)', () => {
    const problems = validateRegistryShape({
      updated: '2026-08-16',
      vendors: { 'Some Brand': { instagram: 'somebrand', x: null } },
    })
    expect(problems.some(p => p.includes('verified'))).toBe(true)
  })

  it('rejects an all-null entry with no note', () => {
    const problems = validateRegistryShape({
      updated: '2026-08-16',
      vendors: { 'Some Brand': { instagram: null, x: null } },
    })
    expect(problems.some(p => p.includes('note'))).toBe(true)
  })

  it('rejects @-prefixed and illegal handles', () => {
    const problems = validateRegistryShape({
      updated: '2026-08-16',
      vendors: {
        A: { instagram: '@withat', x: null, verified: { date: '2026-08-16', evidence: 'site footer links it' } },
        B: { instagram: 'has spaces!', x: null, verified: { date: '2026-08-16', evidence: 'site footer links it' } },
      },
    })
    expect(problems.some(p => p.includes('@ prefix'))).toBe(true)
    expect(problems.some(p => p.includes('not a legal'))).toBe(true)
  })
})
