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
