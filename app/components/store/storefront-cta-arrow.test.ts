import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ctaText, HERO_CTA_WHITELIST } from './StorefrontHome'

/**
 * Guard for ticket #8419 (design-critic, run 778): the couples-band CTA
 * rendered "Take a peek -> ->". Two of the four whitelisted CTA labels
 * already end in "→" ('Take a peek →', 'Find your fit →'); every render site
 * pairs the label with its own `<span aria-hidden="true">→</span>`, so a
 * label that already carries an arrow doubles it unless it is first passed
 * through `ctaText()`, which strips a trailing arrow. Three of the page's
 * four CTA render sites already did this; PhotoBand (the couples band) did
 * not.
 */

describe('ctaText — strips a trailing arrow so it can be re-added once', () => {
  it('strips the arrow from every whitelist label that carries one', () => {
    for (const label of HERO_CTA_WHITELIST) {
      const stripped = ctaText(label)
      expect(stripped.endsWith('→')).toBe(false)
      if (label.endsWith('→')) {
        expect(stripped).toBe(label.slice(0, -1).trimEnd())
      } else {
        expect(stripped).toBe(label)
      }
    }
  })

  it('is idempotent — running it twice never produces a doubled or empty result', () => {
    for (const label of HERO_CTA_WHITELIST) {
      const once = ctaText(label)
      const twice = ctaText(once)
      expect(twice).toBe(once)
      expect(twice.length).toBeGreaterThan(0)
    }
  })
})

describe('StorefrontHome.tsx — every {variable}-driven CTA arrow goes through ctaText()', () => {
  const source = readFileSync(fileURLToPath(new URL('./StorefrontHome.tsx', import.meta.url)), 'utf8')

  it('has no bare {label} immediately followed by the aria-hidden arrow span', () => {
    // A hardcoded string literal ("Take a peek <span...", "Show me <span...")
    // never carries its own arrow, so it is safe without ctaText() and this
    // pattern correctly does not match it — only a `{variable}` interpolation
    // sitting directly before the arrow span matches, which is exactly the
    // shape that doubled on ticket #8419.
    const bareVariableBeforeArrow = source.match(
      /\{[a-zA-Z_][a-zA-Z0-9_]*\}\s*<span aria-hidden="true">→<\/span>/g,
    ) ?? []
    expect(bareVariableBeforeArrow).toEqual([])
  })
})
