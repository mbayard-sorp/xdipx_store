import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  runRepriceBelowWholesaleReadout,
  FALLBACK_DEDUPE_KEY,
  FALLBACK_TITLE,
  type RepriceReadoutDeps,
  type TargetBlocker,
} from './reprice-below-wholesale-readout.server'
import type { RepriceBelowWholesaleScanResult } from './reprice-below-wholesale-scan.server'

const SCAN: RepriceBelowWholesaleScanResult = {
  scannedProducts: 100,
  variantsScanned: 200,
  minMarkupPct: 0.1,
  violators: 3,
  repriceCount: 2,
  delistCount: 1,
  rows: [],
}

function makeDeps(overrides: Partial<RepriceReadoutDeps> = {}): RepriceReadoutDeps {
  return {
    scan: vi.fn(async () => SCAN),
    findTargetBlocker: vi.fn(async () => null),
    fileBlocker: vi.fn(async () => ({ id: 1, created: false, reopened: false })),
    ...overrides,
  }
}

describe('runRepriceBelowWholesaleReadout', () => {
  it('updates the existing blocker #1550 (by its real dedupeKey) when found open', async () => {
    const target: TargetBlocker = { dedupeKey: 'the-real-key', title: 'Reprice vs delist', category: 'decision', priority: 2 }
    const deps = makeDeps({ findTargetBlocker: vi.fn(async () => target) })
    const res = await runRepriceBelowWholesaleReadout(deps)

    expect(res.updatedTargetBlocker).toBe(true)
    expect(res.dedupeKey).toBe('the-real-key')
    expect(deps.fileBlocker).toHaveBeenCalledOnce()
    const call = (deps.fileBlocker as any).mock.calls[0][0]
    expect(call.dedupeKey).toBe('the-real-key')
    expect(call.title).toBe('Reprice vs delist')
    expect(call.category).toBe('decision')
    expect(call.detail).toContain('3 ACTIVE variant(s)')
    expect(call.detail).toContain('2 reprice candidate(s)')
    expect(call.detail).toContain('1 delist candidate(s)')
  })

  it('falls back to a clearly-labeled new row when blocker #1550 is not open', async () => {
    const deps = makeDeps() // findTargetBlocker resolves null
    const res = await runRepriceBelowWholesaleReadout(deps)

    expect(res.updatedTargetBlocker).toBe(false)
    expect(res.dedupeKey).toBe(FALLBACK_DEDUPE_KEY)
    const call = (deps.fileBlocker as any).mock.calls[0][0]
    expect(call.dedupeKey).toBe(FALLBACK_DEDUPE_KEY)
    expect(call.title).toBe(FALLBACK_TITLE)
    expect(call.category).toBe('decision')
  })

  it('never passes a verifyProbe and always supplies overrideNoProbeReason, so fileBlocker never rejects this row for a missing probe', async () => {
    const deps = makeDeps()
    await runRepriceBelowWholesaleReadout(deps)
    const call = (deps.fileBlocker as any).mock.calls[0][0]
    expect(call.verifyProbe).toBeUndefined()
    expect(typeof call.overrideNoProbeReason).toBe('string')
    expect(call.overrideNoProbeReason.length).toBeGreaterThan(0)
  })

  it('never calls a Shopify write: the scan and readout modules import no write function', () => {
    const scanSrc = readFileSync(new URL('./reprice-below-wholesale-scan.server.ts', import.meta.url), 'utf8')
    const readoutSrc = readFileSync(new URL('./reprice-below-wholesale-readout.server.ts', import.meta.url), 'utf8')
    // A doc comment is allowed to NAME updateVariantPricing (to say it's absent);
    // only an actual import of it would give either module a write path.
    expect(scanSrc).not.toMatch(/import\s*\{[^}]*updateVariantPricing/)
    expect(readoutSrc).not.toMatch(/import\s*\{[^}]*updateVariantPricing/)
  })
})
