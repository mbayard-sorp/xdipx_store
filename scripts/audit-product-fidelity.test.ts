import { describe, it, expect } from 'vitest'
import { classifyProductClass, summarizeFindings, PRODUCT_CLASSES, type ProductClass } from './audit-product-fidelity'
import type { ProductFidelityVerdict } from '../app/lib/social-product-fidelity.server'

function verdict(over: Partial<ProductFidelityVerdict> = {}): ProductFidelityVerdict {
  return {
    silhouette: 'match',
    colour: 'match',
    finish: 'match',
    brandMark: 'match',
    notes: 'clean',
    checkedAt: '2026-09-27T00:00:00Z',
    checkCompleted: true,
    ...over,
  }
}

function finding(over: {
  id: number
  productClass: ProductClass
  verdict: ProductFidelityVerdict
}) {
  return {
    id: over.id,
    url: `https://cdn.example.com/${over.id}.jpg`,
    productHandle: `handle-${over.id}`,
    productClass: over.productClass,
    referenceUrl: `https://cdn.example.com/ref-${over.id}.jpg`,
    verdict: over.verdict,
  }
}

describe('classifyProductClass (ticket #11923)', () => {
  it('classifies rose/air-pulse products by handle keyword', () => {
    expect(classifyProductClass({ handle: 'inbloom-rose-2-0' })).toBe('rose/air-pulse')
  })

  it('classifies rose/air-pulse products by product_type_dial when the handle has no keyword', () => {
    expect(classifyProductClass({ handle: 'romp-plus', productTypeDial: 'air-pulsation' })).toBe('rose/air-pulse')
  })

  it('classifies wands by handle keyword', () => {
    expect(classifyProductClass({ handle: 'le-wand-petite' })).toBe('wand')
  })

  it('classifies wands by product_type_dial', () => {
    expect(classifyProductClass({ handle: 'massage-tool', productTypeDial: 'wand' })).toBe('wand')
  })

  it('classifies bullets by handle keyword', () => {
    expect(classifyProductClass({ handle: 'mini-bullet-vibe' })).toBe('bullet')
  })

  it('classifies plugs by handle keyword', () => {
    expect(classifyProductClass({ handle: 'beginner-butt-plug' })).toBe('plug')
  })

  it('classifies lube bottles by handle or title keyword', () => {
    expect(classifyProductClass({ handle: 'silk-lube-4oz' })).toBe('lube bottle')
    expect(classifyProductClass({ handle: 'sku-4821', title: 'Water-Based Lubricant' })).toBe('lube bottle')
  })

  it('falls back to other when nothing matches', () => {
    expect(classifyProductClass({ handle: 'satin-sheets-set' })).toBe('other')
  })

  it('is case-insensitive and title carries the signal when the handle does not', () => {
    expect(classifyProductClass({ handle: 'sku-9012', title: 'ROMP Rose 2.0' })).toBe('rose/air-pulse')
  })
})

describe('summarizeFindings (ticket #11923)', () => {
  it('reports zero drift when every finding is clean', () => {
    const findings = [
      finding({ id: 1, productClass: 'wand', verdict: verdict() }),
      finding({ id: 2, productClass: 'wand', verdict: verdict() }),
    ]
    const summary = summarizeFindings(findings, 0)
    expect(summary.checked).toBe(2)
    expect(summary.driftCount).toBe(0)
    expect(summary.driftRate).toBe(0)
    expect(summary.byClass.wand).toEqual({ checked: 2, drift: 0, driftRate: 0 })
  })

  it('counts a single-axis drift as one drifted finding', () => {
    const findings = [
      finding({ id: 1, productClass: 'rose/air-pulse', verdict: verdict({ silhouette: 'drift' }) }),
    ]
    const summary = summarizeFindings(findings, 0)
    expect(summary.driftCount).toBe(1)
    expect(summary.driftRate).toBe(1)
    expect(summary.byClass['rose/air-pulse']).toEqual({ checked: 1, drift: 1, driftRate: 1 })
  })

  it('counts an all-axis drift the same as a single-axis drift (one drifted finding, not four)', () => {
    const findings = [
      finding({
        id: 1,
        productClass: 'rose/air-pulse',
        verdict: verdict({ silhouette: 'drift', colour: 'drift', finish: 'drift', brandMark: 'drift' }),
      }),
    ]
    const summary = summarizeFindings(findings, 0)
    expect(summary.driftCount).toBe(1)
    expect(summary.driftRate).toBe(1)
  })

  it('does not count not-applicable brandMark as drift', () => {
    const findings = [
      finding({ id: 1, productClass: 'wand', verdict: verdict({ brandMark: 'not-applicable' }) }),
    ]
    const summary = summarizeFindings(findings, 0)
    expect(summary.driftCount).toBe(0)
  })

  it('does not count an incomplete check as drift', () => {
    const findings = [
      finding({
        id: 1,
        productClass: 'other',
        verdict: {
          silhouette: null, colour: null, finish: null, brandMark: null,
          notes: 'could not complete', checkedAt: '2026-09-27T00:00:00Z', checkCompleted: false,
        },
      }),
    ]
    const summary = summarizeFindings(findings, 0)
    expect(summary.driftCount).toBe(0)
    expect(summary.checked).toBe(1)
  })

  it('breaks drift rate down per product class independently', () => {
    const findings = [
      finding({ id: 1, productClass: 'rose/air-pulse', verdict: verdict({ silhouette: 'drift' }) }),
      finding({ id: 2, productClass: 'rose/air-pulse', verdict: verdict() }),
      finding({ id: 3, productClass: 'wand', verdict: verdict() }),
    ]
    const summary = summarizeFindings(findings, 0)
    expect(summary.byClass['rose/air-pulse']).toEqual({ checked: 2, drift: 1, driftRate: 0.5 })
    expect(summary.byClass.wand).toEqual({ checked: 1, drift: 0, driftRate: 0 })
    expect(summary.driftRate).toBe(Number((1 / 3).toFixed(4)))
  })

  it('tracks skipped-no-reference separately from checked', () => {
    const summary = summarizeFindings([], 5)
    expect(summary.checked).toBe(0)
    expect(summary.skippedNoReference).toBe(5)
    expect(summary.driftRate).toBe(0)
  })

  it('every product class appears in the breakdown even with zero findings', () => {
    const summary = summarizeFindings([], 0)
    for (const c of PRODUCT_CLASSES) {
      expect(summary.byClass[c]).toEqual({ checked: 0, drift: 0, driftRate: 0 })
    }
  })
})
