import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Coral-budget regression guard for the PDP, the FBT rail, and the product
 * carousel (ticket #466). design-doctrine §3 gives coral ONE meaning — action —
 * and one primary element per viewport. Coral had drifted onto prices and
 * eyebrows, which both overspends the budget and fails WCAG AA: coral #FF5A36
 * on paper #FFFFFF is 3.10:1, under the 4.5:1 needed for text below 24px.
 *
 * These read the shipped source and pin the colour ROLES so the drift cannot
 * silently return. They intentionally assert on class strings rather than a
 * rendered DOM: the rule is "this token never colours this element again", and
 * the source is the smallest surface that expresses it. Sibling ticket #336
 * owns the same rule for the PLP VaultCard grid and is deliberately not touched
 * here.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')

describe('coral budget — prices are never coral below 24px', () => {
  it('FrequentlyBoughtWith renders its price in ink, not coral', () => {
    const src = read('./FrequentlyBoughtWith.tsx')
    // The price line is the one that formats p.price.
    const priceLine = src.split('\n').find(l => l.includes('${p.price.toFixed(2)}'))
    expect(priceLine, 'FBT price line not found — did the markup change?').toBeTruthy()
    expect(priceLine!).not.toContain('text-coral')
    expect(priceLine!).toContain('text-ink')
  })

  it('the PDP price is ink, so the one primary coral element is the buy button', () => {
    const src = read('../../routes/_layout.products.$slug.tsx')
    // The main price is the text-4xl font-black span in the Price block.
    const m = src.match(/text-4xl font-black text-(\w+)/)
    expect(m, 'PDP price span not found — did the Price block change?').toBeTruthy()
    expect(m![1]).not.toBe('coral')
    expect(m![1]).toBe('ink')
  })
})

describe('coral budget — the sensation dial spends coral only on the active pip', () => {
  it('does not paint every filled segment coral', () => {
    const src = read('./SensationDial.tsx')
    // The old drift filled all reached segments with coral. The active-pip rule
    // colours a single reached segment coral; the rest are ink-3 on a line-2
    // track. Guard the exact regressed expression, and the banned v2 alias.
    expect(src).not.toContain("i < value ? 'bg-coral'")
    expect(src).not.toContain('bg-cream-2')
    expect(src).toContain("i === value - 1 ? 'bg-coral'")
  })
})
