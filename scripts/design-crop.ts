/**
 * design-crop.ts — measure and crop storefront captures for the design-critic
 * gate (Routine B step 4, ticket #18635 / run 1703's "keep the crop/measure
 * helpers in scripts/ rather than rebuilding them by hand each run").
 *
 * Four jobs, all of which Routine B had been doing by hand every cycle:
 *
 *   1. MEASURE — answer "is this capture actually the storefront?" before a
 *      gate scores it. Run 1298 scored three Vercel bot-wall pages without
 *      noticing: the transport 403'd, chromium rendered the error page happily,
 *      design-snapshots.ts wrote three PNGs and printed `done`. The tell was
 *      never in the exit code, it was in the pixels — 98.5-99.6% near-white at
 *      mean luminance 253-254, against a real homepage's 26-29% white at mean
 *      197-204. `measure` prints both numbers and FAILS (exit 2) on the
 *      bot-wall signature, so "the capture is wrong" stops being something a
 *      run has to remember to check.
 *
 *   2. CROP — a full-page storefront capture runs 375x18,000px and up. Run 1703
 *      found that handing design-critic the pre-cropped band under review
 *      instead of the whole page is the difference between a gate pass that
 *      completes and one that struggles. `crop` cuts a named band out of a
 *      capture, and is also how docs/homepage-team/calibration/ is regenerated.
 *
 *   3. PROBE — point/line/region pixel measurement (ticket #22811: run 2093's
 *      gate hand-rolled `probe.ts` with `px`/`rows`/`cols`/`region`/`uniq`
 *      subcommands rather than re-deriving per-pixel reads by eye, and did
 *      most of that run's real work with it — a 0px dial-alignment check, a
 *      141x37px void measurement, band luminances, and a contrast
 *      re-verification. Folded in here so the next gate finds it instead of
 *      writing it a fifth time. One throwaway tool from that session is
 *      deliberately NOT ported: `findcolor` (locating rows containing a
 *      target hex), which the ticket says the gate itself reported as noisy
 *      against dial dots and superseded by `grounds` below.
 *
 *   4. GROUNDS — walks a single column down a full-page capture and reports
 *      the band-ground sequence as nearest-v3-token hexes (ticket #22811).
 *      Doctrine §1 marks ground alternation MANDATORY and nothing else checks
 *      it; run 2093 called this "the fastest doctrine section 1 check I have
 *      found" after it caught /collections/pleasure running 4,620px (51% of
 *      the page) of unbroken white in one call.
 *
 * Usage:
 *   npx tsx scripts/design-crop.ts measure <png> [<png>...]
 *   npx tsx scripts/design-crop.ts crop <png> --top 640 --height 520 --out <png>
 *   npx tsx scripts/design-crop.ts crop <png> --top 640 --height 520 --left 0 --width 375 --out <png>
 *   npx tsx scripts/design-crop.ts probe px <png> --x 200 --y 1024
 *   npx tsx scripts/design-crop.ts probe rows <png> --x 200 [--from 0] [--to <h>] [--step 1]
 *   npx tsx scripts/design-crop.ts probe cols <png> --y 1024 [--from 0] [--to <w>] [--step 1]
 *   npx tsx scripts/design-crop.ts probe region <png> --left 0 --top 640 --width 375 --height 200
 *   npx tsx scripts/design-crop.ts probe uniq <png> [--left --top --width --height] [--top-n 10]
 *   npx tsx scripts/design-crop.ts grounds <png> --x 200 [--tolerance 24]
 *
 * Exit codes: 0 ok, 1 usage/IO error, 2 a measured capture matched the
 * bot-wall signature (measure only).
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import sharp from 'sharp'

/**
 * The bot-wall signature, from the three captures run 1298 scored by mistake.
 * A near-uniformly white page at this luminance is an error page, a login
 * redirect, or a challenge screen — never the xdipx storefront, whose lightest
 * doctrine viewport still carries ink type, coral CTAs and product photography.
 * Deliberately generous: a real capture measured 26-29% white at mean 197-204,
 * so there is ~65 points of headroom under the threshold.
 */
export const BOT_WALL_WHITE_FRACTION = 0.95
export const BOT_WALL_MEAN_LUMINANCE = 245
/** A pixel counts as "near-white" at or above this per-channel-average value. */
export const NEAR_WHITE_THRESHOLD = 250

export type CaptureMeasurement = {
  file: string
  width: number
  height: number
  meanLuminance: number
  whiteFraction: number
  looksLikeBotWall: boolean
}

/**
 * Both signals are required, and it is worth being honest about which one does
 * the work: the white FRACTION is load-bearing. A real storefront capture
 * measures 26-29% near-white, so it can never reach 95% whatever its mean
 * luminance is, and the mean threshold alone would never reject one. The mean
 * is there for the case the fraction cannot see — a page that is near-uniform
 * without being near-white, e.g. a challenge screen on a tinted ground — and to
 * keep an eventual threshold edit from quietly sliding into the real-page
 * population. `design-crop.test.ts` pins both sides of the gap for that reason.
 */
export function isBotWall(meanLuminance: number, whiteFraction: number): boolean {
  return whiteFraction >= BOT_WALL_WHITE_FRACTION && meanLuminance >= BOT_WALL_MEAN_LUMINANCE
}

export async function measureCapture(file: string): Promise<CaptureMeasurement> {
  const image = sharp(file)
  const meta = await image.metadata()
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
  const channels = info.channels
  const pixels = info.width * info.height

  let luminanceSum = 0
  let nearWhite = 0
  for (let i = 0; i < data.length; i += channels) {
    // Unweighted channel mean: this is a "how white is this page" probe, not a
    // perceptual measure, and the historical numbers it is compared against
    // (run 1298's 253-254, run 1703's 197-204) were read the same way.
    const value = (data[i] + data[i + 1] + data[i + 2]) / 3
    luminanceSum += value
    if (value >= NEAR_WHITE_THRESHOLD) nearWhite++
  }

  const meanLuminance = luminanceSum / pixels
  const whiteFraction = nearWhite / pixels
  return {
    file,
    width: meta.width ?? info.width,
    height: meta.height ?? info.height,
    meanLuminance,
    whiteFraction,
    looksLikeBotWall: isBotWall(meanLuminance, whiteFraction),
  }
}

export async function cropCapture(opts: {
  input: string
  out: string
  top: number
  height: number
  left?: number
  width?: number
}): Promise<{ out: string; width: number; height: number; bytes: number }> {
  const image = sharp(opts.input)
  const meta = await image.metadata()
  const sourceWidth = meta.width ?? 0
  const sourceHeight = meta.height ?? 0

  const left = Math.max(0, opts.left ?? 0)
  const width = Math.min(opts.width ?? sourceWidth - left, sourceWidth - left)
  const top = Math.max(0, opts.top)
  const height = Math.min(opts.height, sourceHeight - top)

  if (width <= 0 || height <= 0) {
    throw new Error(
      `crop region is empty: source ${sourceWidth}x${sourceHeight}, asked left=${left} top=${top} width=${opts.width ?? 'rest'} height=${opts.height}`,
    )
  }

  mkdirSync(dirname(opts.out), { recursive: true })
  const info = await image.extract({ left, top, width, height }).png({ compressionLevel: 9 }).toFile(opts.out)
  return { out: opts.out, width: info.width, height: info.height, bytes: info.size }
}

// ---------------------------------------------------------------------------
// PROBE — point/line/region pixel measurement.
// ---------------------------------------------------------------------------

export interface RGB {
  r: number
  g: number
  b: number
}

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase()
}

/** Unweighted channel mean — the same "how white/dark is this" convention
 *  `measureCapture` already uses, so a probe reading is comparable to one. */
export function rgbLuminance({ r, g, b }: RGB): number {
  return (r + g + b) / 3
}

function rgbDistance(a: RGB, b: RGB): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

/** Extracts a raw pixel region without writing a file — the read-only sibling
 *  of `cropCapture`'s `extract()` call, shared by every probe/grounds helper
 *  below so none of them re-decodes the full source image by hand. */
async function extractRaw(
  file: string,
  region: { left: number; top: number; width: number; height: number },
): Promise<{ data: Buffer; width: number; height: number; channels: number }> {
  const image = sharp(file)
  const meta = await image.metadata()
  const sourceWidth = meta.width ?? 0
  const sourceHeight = meta.height ?? 0

  const left = Math.max(0, region.left)
  const top = Math.max(0, region.top)
  const width = Math.min(region.width, sourceWidth - left)
  const height = Math.min(region.height, sourceHeight - top)

  if (width <= 0 || height <= 0) {
    throw new Error(
      `region is empty or outside the image: source ${sourceWidth}x${sourceHeight}, asked left=${left} top=${top} width=${region.width} height=${region.height}`,
    )
  }

  const { data, info } = await image.extract({ left, top, width, height }).raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

export interface PixelReading extends RGB {
  x: number
  y: number
  hex: string
  luminance: number
}

export async function probePixel(file: string, x: number, y: number): Promise<PixelReading> {
  const { data } = await extractRaw(file, { left: x, top: y, width: 1, height: 1 })
  const r = data[0]!, g = data[1]!, b = data[2]!
  return { x, y, r, g, b, hex: rgbToHex({ r, g, b }), luminance: rgbLuminance({ r, g, b }) }
}

export interface LineReading extends RGB {
  /** The varying coordinate: y for a `rows` scan, x for a `cols` scan. */
  pos: number
  hex: string
  luminance: number
}

/**
 * `rows`: fixed x, scans down the page (varying y) — the same axis
 * `groundBands` walks, but every sampled row instead of only the band
 * boundaries. `cols`: fixed y, scans across the page (varying x).
 */
export async function probeLine(
  file: string,
  opts: { axis: 'rows' | 'cols'; fixed: number; from: number; to: number; step?: number },
): Promise<LineReading[]> {
  const step = Math.max(1, Math.floor(opts.step ?? 1))
  const length = opts.to - opts.from
  const region =
    opts.axis === 'rows'
      ? { left: opts.fixed, top: opts.from, width: 1, height: length }
      : { left: opts.from, top: opts.fixed, width: length, height: 1 }
  const { data, channels, width, height } = await extractRaw(file, region)
  const count = opts.axis === 'rows' ? height : width

  const out: LineReading[] = []
  for (let i = 0; i < count; i += step) {
    const idx = i * channels
    const r = data[idx]!, g = data[idx + 1]!, b = data[idx + 2]!
    out.push({ pos: opts.from + i, r, g, b, hex: rgbToHex({ r, g, b }), luminance: rgbLuminance({ r, g, b }) })
  }
  return out
}

export interface RegionReading {
  left: number
  top: number
  width: number
  height: number
  pixels: number
  meanR: number
  meanG: number
  meanB: number
  meanHex: string
  meanLuminance: number
}

export async function probeRegion(
  file: string,
  region: { left: number; top: number; width: number; height: number },
): Promise<RegionReading> {
  const { data, width, height, channels } = await extractRaw(file, region)
  const pixels = width * height
  let sumR = 0, sumG = 0, sumB = 0
  for (let i = 0; i < data.length; i += channels) {
    sumR += data[i]!
    sumG += data[i + 1]!
    sumB += data[i + 2]!
  }
  const meanR = sumR / pixels, meanG = sumG / pixels, meanB = sumB / pixels
  return {
    left: region.left,
    top: region.top,
    width,
    height,
    pixels,
    meanR,
    meanG,
    meanB,
    meanHex: rgbToHex({ r: meanR, g: meanG, b: meanB }),
    meanLuminance: rgbLuminance({ r: meanR, g: meanG, b: meanB }),
  }
}

export interface ColorCount {
  hex: string
  count: number
  fraction: number
}

/** Exact-match top-colour histogram over a region (or the whole image when no
 *  region is given). Flat UI bands collapse to one entry each; photography
 *  fans out across many near-identical entries, which is itself a useful
 *  signal (a region dominated by one or two hexes is a ground, not a photo). */
export async function probeUniq(
  file: string,
  opts: { left?: number; top?: number; width?: number; height?: number; topN?: number } = {},
): Promise<ColorCount[]> {
  const meta = await sharp(file).metadata()
  const sourceWidth = meta.width ?? 0
  const sourceHeight = meta.height ?? 0
  const left = opts.left ?? 0
  const top = opts.top ?? 0
  const region = {
    left,
    top,
    width: opts.width ?? sourceWidth - left,
    height: opts.height ?? sourceHeight - top,
  }
  const { data, channels } = await extractRaw(file, region)

  const counts = new Map<string, number>()
  let total = 0
  for (let i = 0; i < data.length; i += channels) {
    const hex = rgbToHex({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! })
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
    total++
  }

  const topN = opts.topN ?? 10
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([hex, count]) => ({ hex, count, fraction: total > 0 ? count / total : 0 }))
}

// ---------------------------------------------------------------------------
// GROUNDS — the doctrine §1 ground-alternation check.
// ---------------------------------------------------------------------------

/**
 * The v3 ground-lock tokens (app/app.css `@theme`), the only palette doctrine
 * §1's "grounds alternate" rule is about. Kept to exactly the set
 * `ProductCarousel`'s own `StorefrontGround` type governs, plus `ink` for the
 * closer bands design-critic has measured on every homepage review: adding
 * every token in app.css (coral, plum, line, etc.) here would let a brand
 * accent or a hairline border get misread as a ground.
 */
export const V3_GROUND_TOKENS: Record<string, RGB> = {
  paper:        { r: 0xff, g: 0xff, b: 0xff },
  'paper-2':    { r: 0xfa, g: 0xfa, b: 0xf9 },
  'paper-3':    { r: 0xf4, g: 0xf3, b: 0xf1 },
  'coral-soft': { r: 0xff, g: 0xe6, b: 0xdd },
  'plum-soft':  { r: 0xf3, g: 0xe8, b: 0xfb },
  ink:          { r: 0x1a, g: 0x14, b: 0x18 },
}

/**
 * Nearest ground token within `maxDistance` (Euclidean RGB), or `null` when
 * every token is further than that — the pixel is content (photography, text,
 * a brand-accent element), not a ground. `maxDistance` defaults to 24: every
 * pairwise distance between the six tokens above is ≥26 except the three
 * near-white papers (9–22 apart), which only ever compete with each other for
 * "nearest" and never resolve wrong at this threshold; the point of the cutoff
 * is to reject colors far from ALL of them, not to separate close tokens from
 * each other (nearest-wins already does that).
 */
export function nearestGroundToken(rgb: RGB, maxDistance = 24): { token: string | null; distance: number } {
  let best: { token: string; distance: number } | null = null
  for (const [token, value] of Object.entries(V3_GROUND_TOKENS)) {
    const distance = rgbDistance(rgb, value)
    if (!best || distance < best.distance) best = { token, distance }
  }
  if (!best || best.distance > maxDistance) return { token: null, distance: best?.distance ?? Infinity }
  return best
}

export interface GroundBand {
  top: number
  bottom: number
  height: number
  /** The actual sampled hex at the band's first row. */
  hex: string
  /** Nearest v3 ground token, or `null` for a band of non-ground content. */
  token: string | null
}

/**
 * Walks a single column (`x`) down the full capture and collapses it into
 * ground bands by TOKEN, not by raw color: every row classifies to its
 * nearest v3 ground token (or `null` for content), and consecutive rows with
 * the same classification merge into one band. Classifying before collapsing
 * is what keeps anti-aliasing noise on a flat ground from splintering into
 * hundreds of one-pixel "bands" — a raw-color diff would do exactly that —
 * while still giving product photography its own `token: null` band instead
 * of being silently folded into whichever ground it sits on.
 */
export async function groundBands(file: string, opts: { x: number; tolerance?: number }): Promise<GroundBand[]> {
  const meta = await sharp(file).metadata()
  const sourceWidth = meta.width ?? 0
  const sourceHeight = meta.height ?? 0
  if (opts.x < 0 || opts.x >= sourceWidth) {
    throw new Error(`--x ${opts.x} is outside the image width (${sourceWidth}px)`)
  }

  const { data, height, channels } = await extractRaw(file, { left: opts.x, top: 0, width: 1, height: sourceHeight })

  const bands: GroundBand[] = []
  let bandStart = 0
  let bandToken: string | null = null
  let bandHex = ''

  for (let y = 0; y < height; y++) {
    const idx = y * channels
    const rgb: RGB = { r: data[idx]!, g: data[idx + 1]!, b: data[idx + 2]! }
    const { token } = nearestGroundToken(rgb, opts.tolerance)
    if (y === 0) {
      bandToken = token
      bandHex = rgbToHex(rgb)
      continue
    }
    if (token !== bandToken) {
      bands.push({ top: bandStart, bottom: y - 1, height: y - bandStart, hex: bandHex, token: bandToken })
      bandStart = y
      bandToken = token
      bandHex = rgbToHex(rgb)
    }
  }
  bands.push({ top: bandStart, bottom: height - 1, height: height - bandStart, hex: bandHex, token: bandToken })
  return bands
}

function num(argv: string[], name: string): number | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i === -1 || i === argv.length - 1) return undefined
  const parsed = Number(argv[i + 1])
  return Number.isFinite(parsed) ? parsed : undefined
}

function str(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i === -1 || i === argv.length - 1) return undefined
  return argv[i + 1]
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const command = argv[0]

  if (command === 'measure') {
    const files = argv.slice(1).filter((a) => !a.startsWith('--'))
    if (files.length === 0) {
      console.error('usage: design-crop.ts measure <png> [<png>...]')
      return 1
    }
    let failed = false
    for (const file of files) {
      if (!existsSync(file)) {
        console.error(`missing: ${file}`)
        return 1
      }
      const m = await measureCapture(file)
      const verdict = m.looksLikeBotWall ? 'BOT-WALL SIGNATURE' : 'looks like a real page'
      console.log(
        `${m.file}: ${m.width}x${m.height}, mean luminance ${m.meanLuminance.toFixed(1)}, ` +
          `near-white ${(m.whiteFraction * 100).toFixed(1)}% -> ${verdict}`,
      )
      if (m.looksLikeBotWall) failed = true
    }
    if (failed) {
      console.error(
        `\nAt least one capture is >=${BOT_WALL_WHITE_FRACTION * 100}% near-white at mean luminance ` +
          `>=${BOT_WALL_MEAN_LUMINANCE}. That is the signature of an error page, a login redirect or a ` +
          `bot challenge, not the storefront. Do NOT score it: a verdict that runs clean against the ` +
          `wrong input is a silent wrong answer.`,
      )
      return 2
    }
    return 0
  }

  if (command === 'crop') {
    const input = argv[1]
    const out = str(argv, 'out')
    const top = num(argv, 'top')
    const height = num(argv, 'height')
    if (!input || !out || top === undefined || height === undefined) {
      console.error('usage: design-crop.ts crop <png> --top <y> --height <px> [--left <x>] [--width <px>] --out <png>')
      return 1
    }
    if (!existsSync(input)) {
      console.error(`missing: ${input}`)
      return 1
    }
    const result = await cropCapture({
      input,
      out,
      top,
      height,
      left: num(argv, 'left'),
      width: num(argv, 'width'),
    })
    console.log(`${result.out}: ${result.width}x${result.height}, ${(result.bytes / 1024).toFixed(1)} KB`)
    return 0
  }

  if (command === 'probe') {
    const sub = argv[1]
    const input = argv[2]
    if (!input || !existsSync(input)) {
      console.error(`missing: ${input ?? '<png>'}`)
      return 1
    }

    if (sub === 'px') {
      const x = num(argv, 'x'), y = num(argv, 'y')
      if (x === undefined || y === undefined) {
        console.error('usage: design-crop.ts probe px <png> --x <px> --y <px>')
        return 1
      }
      const r = await probePixel(input, x, y)
      console.log(`(${r.x},${r.y}): ${r.hex}, luminance ${r.luminance.toFixed(1)}`)
      return 0
    }

    if (sub === 'rows' || sub === 'cols') {
      const fixed = num(argv, sub === 'rows' ? 'x' : 'y')
      if (fixed === undefined) {
        console.error(`usage: design-crop.ts probe ${sub} <png> --${sub === 'rows' ? 'x' : 'y'} <px> [--from <px>] [--to <px>] [--step <n>]`)
        return 1
      }
      const meta = await sharp(input).metadata()
      const axisLength = sub === 'rows' ? meta.height ?? 0 : meta.width ?? 0
      const from = num(argv, 'from') ?? 0
      const to = num(argv, 'to') ?? axisLength
      const readings = await probeLine(input, { axis: sub, fixed, from, to, step: num(argv, 'step') })
      for (const r of readings) {
        console.log(`${r.pos}: ${r.hex}, luminance ${r.luminance.toFixed(1)}`)
      }
      return 0
    }

    if (sub === 'region') {
      const left = num(argv, 'left'), top = num(argv, 'top')
      const width = num(argv, 'width'), height = num(argv, 'height')
      if (left === undefined || top === undefined || width === undefined || height === undefined) {
        console.error('usage: design-crop.ts probe region <png> --left <x> --top <y> --width <px> --height <px>')
        return 1
      }
      const r = await probeRegion(input, { left, top, width, height })
      console.log(
        `region ${r.left},${r.top} ${r.width}x${r.height} (${r.pixels} px): mean ${r.meanHex}, ` +
          `mean luminance ${r.meanLuminance.toFixed(1)}`,
      )
      return 0
    }

    if (sub === 'uniq') {
      const counts = await probeUniq(input, {
        left: num(argv, 'left'),
        top: num(argv, 'top'),
        width: num(argv, 'width'),
        height: num(argv, 'height'),
        topN: num(argv, 'top-n'),
      })
      for (const c of counts) {
        console.log(`${c.hex}: ${c.count}px (${(c.fraction * 100).toFixed(1)}%)`)
      }
      return 0
    }

    console.error('usage: design-crop.ts probe px|rows|cols|region|uniq <png> ...')
    return 1
  }

  if (command === 'grounds') {
    const input = argv[1]
    const x = num(argv, 'x')
    if (!input || x === undefined) {
      console.error('usage: design-crop.ts grounds <png> --x <px> [--tolerance <0-255>]')
      return 1
    }
    if (!existsSync(input)) {
      console.error(`missing: ${input}`)
      return 1
    }
    const bands = await groundBands(input, { x, tolerance: num(argv, 'tolerance') })
    for (const band of bands) {
      console.log(`y=${band.top}-${band.bottom} (${band.height}px): ${band.hex} -> ${band.token ?? 'content (no ground match)'}`)
    }
    return 0
  }

  console.error(
    'usage: design-crop.ts measure <png>... | crop <png> --top <y> --height <px> --out <png> | ' +
      'probe px|rows|cols|region|uniq <png> ... | grounds <png> --x <px>',
  )
  return 1
}

// Only run the CLI when invoked directly, so the test suite can import the
// measurement helpers without the process exiting under it.
if (process.argv[1]?.endsWith('design-crop.ts')) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
