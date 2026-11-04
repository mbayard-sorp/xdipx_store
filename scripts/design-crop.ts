/**
 * design-crop.ts — measure and crop storefront captures for the design-critic
 * gate (Routine B step 4, ticket #18635 / run 1703's "keep the crop/measure
 * helpers in scripts/ rather than rebuilding them by hand each run").
 *
 * Two jobs, both of which Routine B had been doing by hand every cycle:
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
 * Usage:
 *   npx tsx scripts/design-crop.ts measure <png> [<png>...]
 *   npx tsx scripts/design-crop.ts crop <png> --top 640 --height 520 --out <png>
 *   npx tsx scripts/design-crop.ts crop <png> --top 640 --height 520 --left 0 --width 375 --out <png>
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

  console.error('usage: design-crop.ts measure <png>... | design-crop.ts crop <png> --top <y> --height <px> --out <png>')
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
