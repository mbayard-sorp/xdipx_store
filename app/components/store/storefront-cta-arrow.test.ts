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

/**
 * #12612 defect 6 (design-critic, run 1298). The three Nº 05 wayfinder card
 * CTAs rendered as 11px uppercase mono kicker labels with no button and no
 * underline, so they read as metadata rather than as the action the whole tile
 * performs — while the Discover You promo immediately below them carried a
 * proper rounded-full coral pill. Two CTA languages inside one section.
 *
 * design-doctrine.md line 578: "CTA: rounded-full (22px), coral primary /
 * ghost secondary". Ghost here, not coral: the coral budget is one primary
 * element per viewport (doctrine §3) and the promo pill already spends it.
 */
describe('StorefrontHome.tsx — wayfinder card CTA takes the doctrine §6 treatment (#12612 defect 6)', () => {
  const source = readFileSync(fileURLToPath(new URL('./StorefrontHome.tsx', import.meta.url)), 'utf8')

  it('renders the tile CTA as a rounded-full ghost pill at body scale', () => {
    expect(source).toContain(
      'inline-flex items-center gap-1.5 rounded-full border border-line-2 px-4 py-2 text-[15px] font-medium text-ink',
    )
  })

  it('no longer styles any CTA label as an 11px uppercase mono kicker', () => {
    // The kicker motif is for section labels and Nº numerals (doctrine §2),
    // never for a call to action.
    expect(source).not.toContain(
      'mt-auto inline-flex items-center gap-1 pt-4 text-[11px] uppercase tracking-[0.18em] text-ink-4',
    )
  })

  it('keeps the whitelisted label, so this is a treatment change and not a copy change', () => {
    expect(HERO_CTA_WHITELIST).toContain('Take a peek →')
    expect(source).toContain('Take a peek <span aria-hidden="true">→</span>')
  })
})
