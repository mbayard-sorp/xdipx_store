/**
 * Guards the two instruments the design-critic gate now depends on:
 * design-crop.ts's bot-wall probe, and the integrity of the committed
 * calibration corpus in docs/homepage-team/calibration/ (ticket #18635).
 *
 * Both guards state, per the #16885 / run 1703 rule, how the class they pin
 * produces the pixel they prevent:
 *
 *  - `isBotWall` is the only mechanical thing standing between the gate and a
 *    repeat of run 1298, where three Vercel bot-wall pages were scored as
 *    storefront captures. If its thresholds drift UP past a real page's
 *    measured range (26-29% near-white at mean luminance 197-207) a valid
 *    capture gets rejected; if they drift DOWN past the bot wall's own
 *    (98.5-99.6% at 253-254) the error page gets scored. The assertions below
 *    pin both sides of that gap against the numbers actually measured.
 *  - A `bad-*` calibration fixture with no `injectCss` would be a screenshot of
 *    the HEALTHY page carrying a BLOCK label, which would calibrate the gate to
 *    block correct work — the exact inversion of what the corpus is for. The
 *    manifest guard makes that unrepresentable.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BOT_WALL_MEAN_LUMINANCE, BOT_WALL_WHITE_FRACTION, isBotWall } from './design-crop'
import { CALIBRATION } from './design-calibration'

describe('isBotWall', () => {
  it('flags the signature run 1298 scored three of (98.5-99.6% white at mean 253-254)', () => {
    expect(isBotWall(253, 0.985)).toBe(true)
    expect(isBotWall(254, 0.996)).toBe(true)
  })

  it('passes a real storefront capture (26-29% white at mean 197-207)', () => {
    expect(isBotWall(197.0, 0.26)).toBe(false)
    expect(isBotWall(206.9, 0.264)).toBe(false)
    expect(isBotWall(202.4, 0.277)).toBe(false)
  })

  it('needs BOTH signals, so a legitimately light or legitimately sparse crop still passes', () => {
    // The tab-bar crops are ~92% near-white at mean ~247 because the band is a
    // thin strip of paper with a few labels on it. Near-white alone must not
    // condemn it.
    expect(isBotWall(247.0, 0.924)).toBe(false)
    // An ink band is 1% white at mean 28 — the other extreme, equally real.
    expect(isBotWall(27.9, 0.011)).toBe(false)
  })

  it('keeps a usable gap between the two populations', () => {
    expect(BOT_WALL_WHITE_FRACTION).toBeGreaterThan(0.93)
    expect(BOT_WALL_MEAN_LUMINANCE).toBeGreaterThan(207)
    expect(BOT_WALL_MEAN_LUMINANCE).toBeLessThan(253)
  })
})

describe('calibration corpus', () => {
  const dir = join('docs', 'homepage-team', 'calibration')

  it('is five good and five bad', () => {
    expect(CALIBRATION.filter((e) => e.expected === 'PASS')).toHaveLength(5)
    expect(CALIBRATION.filter((e) => e.expected === 'BLOCK')).toHaveLength(5)
  })

  it('names every entry for the verdict it expects, so a mislabelled file is visible on disk', () => {
    for (const e of CALIBRATION) {
      expect(e.slug.startsWith(e.expected === 'PASS' ? 'good-' : 'bad-')).toBe(true)
    }
  })

  it('gives every bad entry a defect to reinstate, and every good entry none', () => {
    for (const e of CALIBRATION) {
      if (e.expected === 'BLOCK') expect(e.injectCss, `${e.slug} must reinstate a defect`).toBeTruthy()
      else expect(e.injectCss, `${e.slug} must be the unmodified page`).toBeUndefined()
    }
  })

  it('gives every entry exactly one way to find its region', () => {
    for (const e of CALIBRATION) {
      expect(Boolean(e.selector) !== Boolean(e.band), `${e.slug}: selector XOR band`).toBe(true)
    }
  })

  it('documents what each entry carries and which rule it is scored against', () => {
    for (const e of CALIBRATION) {
      expect(e.carries.length, `${e.slug}.carries`).toBeGreaterThan(40)
      expect(e.rule.length, `${e.slug}.rule`).toBeGreaterThan(10)
    }
  })

  it('has a committed image for every entry, each small enough to belong in the repo', () => {
    for (const e of CALIBRATION) {
      const file = join(dir, `${e.slug}.png`)
      expect(existsSync(file), `${file} is missing — regenerate with scripts/design-calibration.ts`).toBe(true)
      // #18635 rejected a corpus of full-page captures at roughly 25 MB total.
      // Crops are the point; 600 KB is a generous ceiling for any single one.
      expect(statSync(file).size, `${file} is too large to be a crop`).toBeLessThan(600_000)
    }
  })

  it('keeps manifest.json in step with the entry list', () => {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
      entries: { slug: string; expected: string }[]
    }
    expect(manifest.entries.map((e) => e.slug)).toEqual(CALIBRATION.map((e) => e.slug))
    expect(manifest.entries.map((e) => e.expected)).toEqual(CALIBRATION.map((e) => e.expected))
  })

  it('has a README that names every file, so no fixture is committed without its expected verdict', () => {
    const readme = readFileSync(join(dir, 'README.md'), 'utf8')
    for (const e of CALIBRATION) expect(readme).toContain(`${e.slug}.png`)
  })
})
