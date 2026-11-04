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
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { BOT_WALL_MEAN_LUMINANCE, BOT_WALL_WHITE_FRACTION, isBotWall, measureCapture } from './design-crop'
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
    // The case that actually pins the AND (qa-reviewer, run 1837): every
    // assertion above has a white fraction under the threshold, so all of them
    // stay green if the mean-luminance clause is deleted outright. Only a HIGH
    // fraction at a LOW mean — a near-uniform page that is not near-white, e.g.
    // a challenge screen on a tinted ground — can tell a two-signal test from a
    // fraction-only one. Without this line the guard's own name was a claim it
    // could not support.
    expect(isBotWall(200, 0.99)).toBe(false)
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

  it('cites a real doctrine or brief rule on every entry', () => {
    // The previous version asserted only that these strings were longer than
    // 40 and 10 characters, which 41 characters of `x` satisfied (qa-reviewer,
    // run 1837). A rule reference has to name a section of something binding.
    for (const e of CALIBRATION) {
      expect(e.carries.length, `${e.slug}.carries`).toBeGreaterThan(40)
      expect(e.rule, `${e.slug}.rule must cite a section`).toMatch(
        /(doctrine|mission brief|CLAUDE\.md|WCAG|§)/i,
      )
      expect(e.rule, `${e.slug}.rule must name which section`).toMatch(/§\d|WCAG|mobile-first/)
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
    for (const e of CALIBRATION) {
      // Not just `toContain(slug)`: a line saying "removed good-03.png" used to
      // satisfy that, which is the assertion title making a promise the
      // assertion did not keep (qa-reviewer, run 1837). The verdict word has to
      // appear in the same table row as the file.
      const row = readme.split('\n').find((l) => l.includes(`${e.slug}.png`))
      expect(row, `README has no row for ${e.slug}.png`).toBeTruthy()
    }
    // Both verdict words are stated as section headings, so neither class can
    // be committed without the README saying what it expects.
    expect(readme).toContain('Must score PASS')
    expect(readme).toContain('Must score BLOCK')
  })

  it('reinstates a real rule on every bad entry, not merely a truthy string', () => {
    // `toBeTruthy()` passed for `' '` or for a rule whose selector matches
    // nothing, either of which yields a HEALTHY-page screenshot carrying a
    // BLOCK label — the exact inversion the corpus exists to prevent
    // (qa-reviewer, run 1837).
    for (const e of CALIBRATION.filter((x) => x.expected === 'BLOCK')) {
      const css = e.injectCss ?? ''
      expect(css.trim().length, `${e.slug}: injectCss is blank`).toBeGreaterThan(20)
      expect(css, `${e.slug}: injectCss declares no property`).toMatch(/\{[^}]*:[^}]*\}/)
      expect(css, `${e.slug}: injectCss must win over the page's own rules`).toContain('!important')
    }
  })

  it('binds every committed PNG to the entry that named it', async () => {
    // Every other guard checks that a file EXISTS. None of them notices a
    // fixture re-shot at a different width, left stale after an `injectCss`
    // edit, or swapped between two slugs (qa-reviewer, run 1837). The hash and
    // the dimensions in manifest.json are the only thing that does, and
    // regenerating the corpus therefore means committing new hashes.
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
      entries: { slug: string; sha256: string; pixels: string; bytes: number }[]
    }
    for (const entry of manifest.entries) {
      const bytes = readFileSync(join(dir, `${entry.slug}.png`))
      expect(createHash('sha256').update(bytes).digest('hex'), `${entry.slug}.png does not match its manifest hash`)
        .toBe(entry.sha256)
      expect(bytes.length, `${entry.slug}.png byte length drifted from the manifest`).toBe(entry.bytes)
      const meta = await sharp(bytes).metadata()
      expect(`${meta.width}x${meta.height}`, `${entry.slug}.png dimensions drifted`).toBe(entry.pixels)
    }
  })

  it('makes every bad fixture a different image from its good twin', async () => {
    // A twin pair whose two members are byte-identical would mean the
    // injection never applied, and the bad member would be a healthy-page
    // screenshot labelled BLOCK.
    const hash = (slug: string) =>
      createHash('sha256').update(readFileSync(join(dir, `${slug}.png`))).digest('hex')
    const twins: [string, string][] = [
      ['good-01-rail-header-375', 'bad-01-rail-header-collision-375'],
      ['good-02-tab-bar-375', 'bad-02-tab-bar-runon-375'],
      ['good-02-tab-bar-375', 'bad-03-nav-serif-375'],
      ['good-05-ink-closer-1440', 'bad-04-plum-on-ink-1440'],
      ['good-03-rail-band-1440', 'bad-05-v2-card-chrome-1440'],
    ]
    for (const [good, bad] of twins) {
      expect(hash(bad), `${bad} is byte-identical to ${good}: the injection did not apply`).not.toBe(hash(good))
    }
  })

  it('runs the real bot-wall probe over every committed fixture', async () => {
    // Guard 4 pins the CONSTANTS; nothing exercised measureCapture's own
    // arithmetic, so a wrong channel mean would leave every assertion green
    // (qa-reviewer, run 1837). These ten PNGs are real storefront crops, so
    // none of them may read as a bot wall, and the probe runs on real files.
    for (const e of CALIBRATION) {
      const m = await measureCapture(join(dir, `${e.slug}.png`))
      expect(m.looksLikeBotWall, `${e.slug}.png reads as a bot wall`).toBe(false)
      expect(m.meanLuminance).toBeGreaterThanOrEqual(0)
      expect(m.meanLuminance).toBeLessThanOrEqual(255)
      expect(m.whiteFraction).toBeGreaterThanOrEqual(0)
      expect(m.whiteFraction).toBeLessThanOrEqual(1)
    }
  })

  it('documents the known deviations in any near-miss good fixture', () => {
    // good-03 is a PASS that carries two real doctrine deviations (a retail
    // carton as card art, a non-mono brand eyebrow). A critic marking it down
    // on those is RIGHT, so they are recorded rather than treated as a
    // calibration failure. If a good fixture declares deviations, the README
    // has to carry them too.
    const readme = readFileSync(join(dir, 'README.md'), 'utf8')
    for (const e of CALIBRATION.filter((x) => x.knownDeviations?.length)) {
      expect(e.expected).toBe('PASS')
      expect(readme, `README does not record ${e.slug}'s known deviations`).toContain('near-miss')
    }
  })
})
