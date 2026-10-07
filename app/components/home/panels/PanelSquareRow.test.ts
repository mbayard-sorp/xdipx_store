import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { panelSquareRowMdColsClass } from './PanelSquareRow'

/**
 * Guard for ticket #8419 (design-critic, run 778): a panel-deck square row
 * with fewer than 4 items ("Last Chance"/"Couples", 2 items) rendered on a
 * fixed 4-column grid, left-aligning into columns 1-2 and leaving columns
 * 3-4 an empty, visibly-tinted half-row.
 */
describe('panelSquareRowMdColsClass', () => {
  it('sizes the grid to a partial row instead of leaving a fixed 4-column grid half-empty', () => {
    expect(panelSquareRowMdColsClass(1)).toBe('md:grid-cols-1')
    expect(panelSquareRowMdColsClass(2)).toBe('md:grid-cols-2')
    expect(panelSquareRowMdColsClass(3)).toBe('md:grid-cols-3')
  })

  it('keeps the standard 4-up for a full row, and for any row past 4', () => {
    expect(panelSquareRowMdColsClass(4)).toBe('md:grid-cols-4')
    expect(panelSquareRowMdColsClass(5)).toBe('md:grid-cols-4')
  })

  it('degrades a zero-item row to the standard 4-up rather than a degenerate grid-cols-0 (the row never renders in this case — PanelSquareRow returns null first — but the class picker itself must not produce nonsense)', () => {
    expect(panelSquareRowMdColsClass(0)).toBe('md:grid-cols-4')
  })
})

describe('PanelSquareRow.tsx — every possible column class survives Tailwind\'s JIT scan', () => {
  const source = readFileSync(fileURLToPath(new URL('./PanelSquareRow.tsx', import.meta.url)), 'utf8')

  it('has all four md:grid-cols-N classes present as literal strings', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(source).toContain(`md:grid-cols-${n}`)
    }
  })
})

/**
 * #12612 defect 3 (design-critic, run 1298). The cases above were written for
 * #8419, where a short row on a fixed 4-column grid stranded "Last Chance" and
 * "Couples" beside empty cells. The `default:` arm reproduced that same defect
 * above 4: the live deck serves SIX squares, so row 1 took four and row 2 took
 * two, leaving a measured 589x232px void of bare paper-2 at 1440 — stranding
 * the same two tiles, one row down.
 */
describe('panelSquareRowMdColsClass — rows longer than 4 (#12612 defect 3)', () => {
  it('splits six squares into two complete rows of three, not 4+2', () => {
    expect(panelSquareRowMdColsClass(6)).toBe('md:grid-cols-3')
  })

  it('keeps a clean 4-up for counts that already divide by four', () => {
    expect(panelSquareRowMdColsClass(4)).toBe('md:grid-cols-4')
    expect(panelSquareRowMdColsClass(8)).toBe('md:grid-cols-4')
    expect(panelSquareRowMdColsClass(12)).toBe('md:grid-cols-4')
  })

  it('prefers 3-up for other multiples of three', () => {
    expect(panelSquareRowMdColsClass(9)).toBe('md:grid-cols-3')
  })

  it('leaves 5 and 7 at 4-up rather than inventing a thin 5-column row', () => {
    // No even divisor at 3 or 4 exists, and md:grid-cols-5 would render ~150px
    // tiles at 768. Mission brief §11c caps the deck at 4 squares, so these
    // counts are already over the cap; the grid degrades toward the rule.
    expect(panelSquareRowMdColsClass(5)).toBe('md:grid-cols-4')
    expect(panelSquareRowMdColsClass(7)).toBe('md:grid-cols-4')
  })

  it('returns only literal Tailwind classes, so the JIT scanner sees every branch', () => {
    const emitted = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 12].map(panelSquareRowMdColsClass))
    for (const cls of emitted) {
      expect(cls).toMatch(/^md:grid-cols-[1-4]$/)
      expect(cls).not.toContain('[')
    }
  })
})
