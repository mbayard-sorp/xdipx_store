import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tintedShelfKeys } from './CategoryBlockRenderer'
import type { ResolvedCategoryBlock } from '~/types/cms'

/**
 * Aisle ground rhythm (ticket #337, design-critic spot check 2026-07-29).
 * Doctrine §1 is mandatory: never ship six pale grounds in a row. Aisle
 * `categoryPage` docs commonly resolve to an all-pale stack (masthead, jump-to,
 * several shelves, trust) with no tinted block in the mix, so the renderer hands
 * one mid-run shelf a plum-soft ground. Sale keeps its quiet paper mandate.
 *
 * These blocks are pale grounds (paper / paper-2 / paper-3); only justLanded,
 * learnStrip, sensationLegend, and the tinted dropMasthead are non-pale.
 */
const PALE_TYPES = new Set([
  'categoryMasthead',
  'shelfNav',
  'shelfSection',
  'categoryTrust',
  'categoryFaq',
  'chooserBlock',
  'editorialFeature',
  'benefitEditorial',
  'makersNote',
  'dropTimeline',
  'comingSoon',
])

function block(type: string, key: string): ResolvedCategoryBlock {
  return { _type: type, key } as unknown as ResolvedCategoryBlock
}

/** Longest run of consecutive pale grounds given a tinted-key set. */
function longestPaleRun(
  blocks: ResolvedCategoryBlock[],
  tinted: Set<string>,
  dropTone?: 'tinted' | 'quiet',
): number {
  let run = 0
  let max = 0
  for (const b of blocks) {
    const nonPale =
      tinted.has(b.key) ||
      !PALE_TYPES.has(b._type) ||
      (b._type === 'dropMasthead' && dropTone !== 'quiet')
    if (nonPale) run = 0
    else max = Math.max(max, ++run)
  }
  return max
}

// The documented aisle stack that triggered the finding.
const aisleStack: ResolvedCategoryBlock[] = [
  block('categoryMasthead', 'masthead'),
  block('shelfNav', 'nav'),
  block('shelfSection', 'shelf-1'),
  block('shelfSection', 'shelf-2'),
  block('shelfSection', 'shelf-3'),
  block('shelfSection', 'shelf-4'),
  block('categoryTrust', 'trust'),
]

describe('category ground rhythm never ships six pale sections in a row', () => {
  it('tints a shelf on the all-pale aisle stack', () => {
    const tinted = tintedShelfKeys(aisleStack)
    expect(tinted.size).toBeGreaterThan(0)
    // Only shelfSection blocks are ever chosen for the tint.
    for (const key of tinted) {
      expect(aisleStack.find(b => b.key === key)?._type).toBe('shelfSection')
    }
  })

  it('leaves no run of six consecutive pale grounds (doctrine §1)', () => {
    const tinted = tintedShelfKeys(aisleStack)
    expect(longestPaleRun(aisleStack, tinted)).toBeLessThan(6)
  })

  it('holds for long shelf runs too', () => {
    const many: ResolvedCategoryBlock[] = [
      block('categoryMasthead', 'm'),
      block('shelfNav', 'n'),
      ...Array.from({ length: 12 }, (_, i) => block('shelfSection', `s-${i}`)),
      block('categoryTrust', 't'),
    ]
    const tinted = tintedShelfKeys(many)
    expect(longestPaleRun(many, tinted)).toBeLessThan(6)
  })

  it('never adds a tint under the quiet Sale mandate', () => {
    const saleStack: ResolvedCategoryBlock[] = [
      block('dropMasthead', 'drop'),
      block('shelfSection', 'shelf-1'),
      block('shelfSection', 'shelf-2'),
      block('categoryTrust', 'trust'),
    ]
    expect(tintedShelfKeys(saleStack, 'quiet').size).toBe(0)
  })
})

/**
 * Source-level pin: ShelfSection must carry a tinted branch and the collections
 * sidebar must be sticky + height-capped so the left third is not empty beside a
 * tall grid. No screenshot gate runs in scheduled passes, so we pin the CSS
 * mechanism at the source (the sanctioned source-geometry fallback).
 */
describe('ticket #337 source mechanisms', () => {
  it('ShelfSection can render a plum-soft tinted ground', () => {
    const src = readFileSync(fileURLToPath(new URL('./ShelfSection.tsx', import.meta.url)), 'utf-8')
    expect(src).toContain('tinted')
    expect(src).toContain('bg-plum-soft')
  })

  it('the collections sidebar is sticky, self-start, and height-capped', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../routes/_layout.collections.$handle.tsx', import.meta.url)),
      'utf-8',
    )
    const sidebar = src.split('\n').find(l => l.includes('md:w-[260px]') && l.includes('md:sticky'))
    expect(sidebar, 'sidebar wrapper is not sticky').toBeTruthy()
    expect(sidebar!).toContain('md:self-start')
    expect(sidebar!).toContain('md:overflow-y-auto')
  })
})
