/**
 * Guards the `probe` and `grounds` subcommands added to design-crop.ts
 * (ticket #22811: design-critic run 2093's gate hand-rolled this exact
 * tooling a fifth time rather than finding it in scripts/, per the standing
 * rule in routine-design-cycle.md section 4 — "If you find yourself
 * hand-rolling a capture again, that is a code ticket against this script,
 * not a longer paragraph here.").
 *
 * No fixture PNGs are committed for this file. Every test builds a small
 * synthetic image in a temp directory from a raw pixel buffer via `sharp`,
 * so the exact color at every coordinate is known up front and the
 * assertions check the probe/grounds math against ground truth rather than
 * against an opaque screenshot. The committed calibration corpus in
 * docs/homepage-team/calibration/ (guarded by design-crop.test.ts) stays the
 * place for real-storefront fixtures; this file is purely about the pixel
 * arithmetic.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  V3_GROUND_TOKENS,
  groundBands,
  nearestGroundToken,
  probeLine,
  probePixel,
  probeRegion,
  probeUniq,
  rgbLuminance,
  rgbToHex,
} from './design-crop'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'design-crop-probe-'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Builds a `width`x`height` PNG where every pixel is `rgb`, writes it under
 *  `dir`, and returns the path. */
async function solidPng(name: string, width: number, height: number, rgb: { r: number; g: number; b: number }): Promise<string> {
  const path = join(dir, `${name}.png`)
  await sharp({
    create: { width, height, channels: 3, background: rgb },
  })
    .png()
    .toFile(path)
  return path
}

/** Builds a `width`-wide PNG stacking `bands` (each `{height, rgb}`) top to
 *  bottom, in order, and returns its path plus the cumulative top of each
 *  band for assertions. */
async function bandedPng(
  name: string,
  width: number,
  bands: Array<{ height: number; rgb: { r: number; g: number; b: number } }>,
): Promise<{ path: string; tops: number[] }> {
  const totalHeight = bands.reduce((sum, b) => sum + b.height, 0)
  const channels = 3
  const buf = Buffer.alloc(width * totalHeight * channels)
  const tops: number[] = []
  let y = 0
  for (const band of bands) {
    tops.push(y)
    for (let row = 0; row < band.height; row++) {
      for (let x = 0; x < width; x++) {
        const idx = ((y + row) * width + x) * channels
        buf[idx] = band.rgb.r
        buf[idx + 1] = band.rgb.g
        buf[idx + 2] = band.rgb.b
      }
    }
    y += band.height
  }
  const path = join(dir, `${name}.png`)
  await sharp(buf, { raw: { width, height: totalHeight, channels } }).png().toFile(path)
  return { path, tops }
}

describe('rgbToHex / rgbLuminance', () => {
  it('round-trips a known color', () => {
    expect(rgbToHex({ r: 0xc2, g: 0x35, b: 0x0f })).toBe('#C2350F') // coral
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000')
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe('#FFFFFF')
  })

  it('matches measureCapture\'s unweighted-mean convention', () => {
    expect(rgbLuminance({ r: 30, g: 30, b: 30 })).toBe(30)
    expect(rgbLuminance({ r: 0, g: 0, b: 255 })).toBeCloseTo(85, 5)
  })
})

describe('probePixel', () => {
  it('reads the exact color at a known coordinate', async () => {
    const path = await solidPng('px-coral', 20, 20, { r: 0xc2, g: 0x35, b: 0x0f })
    const r = await probePixel(path, 10, 10)
    expect(r.hex).toBe('#C2350F')
    expect(r.x).toBe(10)
    expect(r.y).toBe(10)
    expect(r.luminance).toBeCloseTo((0xc2 + 0x35 + 0x0f) / 3, 5)
  })
})

describe('probeLine', () => {
  it('rows: walks down a fixed column and reads each band exactly, ground truth from a known-height stack', async () => {
    const { path, tops } = await bandedPng('rows-bands', 10, [
      { height: 5, rgb: { r: 255, g: 255, b: 255 } },
      { height: 5, rgb: { r: 26, g: 20, b: 24 } },
    ])
    const readings = await probeLine(path, { axis: 'rows', fixed: 5, from: 0, to: 10 })
    expect(readings).toHaveLength(10)
    expect(readings[0]!.hex).toBe('#FFFFFF')
    expect(readings[tops[1]!]!.hex).toBe('#1A1418')
    expect(readings.map((r) => r.pos)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('cols: walks across a fixed row', async () => {
    const path = await solidPng('cols-flat', 20, 4, { r: 0xff, g: 0x7a, b: 0x5a }) // coral-2
    const readings = await probeLine(path, { axis: 'cols', fixed: 2, from: 0, to: 20 })
    expect(readings).toHaveLength(20)
    expect(readings.every((r) => r.hex === '#FF7A5A')).toBe(true)
  })

  it('honors --step without dropping the sampled pixel count', async () => {
    const path = await solidPng('rows-step', 4, 20, { r: 10, g: 10, b: 10 })
    const readings = await probeLine(path, { axis: 'rows', fixed: 2, from: 0, to: 20, step: 5 })
    expect(readings.map((r) => r.pos)).toEqual([0, 5, 10, 15])
  })
})

describe('probeRegion', () => {
  it('reports the exact mean over a flat region', async () => {
    const path = await solidPng('region-flat', 50, 50, { r: 250, g: 250, b: 249 }) // paper-2
    const r = await probeRegion(path, { left: 10, top: 10, width: 20, height: 20 })
    expect(r.pixels).toBe(400)
    expect(r.meanHex).toBe('#FAFAF9')
    expect(r.meanLuminance).toBeCloseTo((250 + 250 + 249) / 3, 1)
  })

  it('averages a half-and-half region to the midpoint, proving it is not sampling a single pixel', async () => {
    const { path } = await bandedPng('region-split', 10, [
      { height: 10, rgb: { r: 0, g: 0, b: 0 } },
      { height: 10, rgb: { r: 255, g: 255, b: 255 } },
    ])
    const r = await probeRegion(path, { left: 0, top: 0, width: 10, height: 20 })
    expect(r.meanR).toBeCloseTo(127.5, 1)
    expect(r.meanLuminance).toBeCloseTo(127.5, 1)
  })
})

describe('probeUniq', () => {
  it('ranks a dominant ground above a minority accent, over the whole image when no region is given', async () => {
    const { path } = await bandedPng('uniq-dominant', 10, [
      { height: 90, rgb: { r: 255, g: 255, b: 255 } },
      { height: 10, rgb: { r: 194, g: 53, b: 15 } }, // coral
    ])
    const counts = await probeUniq(path)
    expect(counts[0]!.hex).toBe('#FFFFFF')
    expect(counts[0]!.count).toBe(900)
    expect(counts[0]!.fraction).toBeCloseTo(0.9, 5)
    expect(counts.some((c) => c.hex === '#C2350F')).toBe(true)
  })

  it('respects an explicit region and --top-n', async () => {
    const { path } = await bandedPng('uniq-region', 10, [
      { height: 5, rgb: { r: 255, g: 255, b: 255 } },
      { height: 5, rgb: { r: 26, g: 20, b: 24 } },
    ])
    // Region covering only the top band: must read 100% white, zero ink.
    const counts = await probeUniq(path, { left: 0, top: 0, width: 10, height: 5, topN: 1 })
    expect(counts).toHaveLength(1)
    expect(counts[0]!.hex).toBe('#FFFFFF')
    expect(counts[0]!.fraction).toBe(1)
  })
})

describe('nearestGroundToken', () => {
  it('resolves every v3 ground token to itself at distance 0', () => {
    for (const [token, rgb] of Object.entries(V3_GROUND_TOKENS)) {
      expect(nearestGroundToken(rgb)).toEqual({ token, distance: 0 })
    }
  })

  it('rejects a far color as content, not a mis-tagged ground', () => {
    // Plum (#7A2BB8) is a brand accent, never a ground.
    const r = nearestGroundToken({ r: 0x7a, g: 0x2b, b: 0xb8 })
    expect(r.token).toBeNull()
  })

  it('a small jitter around a token still resolves to that token (anti-aliasing tolerance)', () => {
    const jittered = { r: V3_GROUND_TOKENS.paper!.r - 2, g: V3_GROUND_TOKENS.paper!.g - 1, b: V3_GROUND_TOKENS.paper!.b - 2 }
    expect(nearestGroundToken(jittered).token).toBe('paper')
  })
})

describe('groundBands', () => {
  it('collapses a clean multi-band stack into exactly one band per ground, in order, with correct heights', async () => {
    const { path } = await bandedPng('grounds-clean', 10, [
      { height: 40, rgb: V3_GROUND_TOKENS.paper! },
      { height: 30, rgb: V3_GROUND_TOKENS['coral-soft']! },
      { height: 50, rgb: V3_GROUND_TOKENS['paper-2']! },
      { height: 20, rgb: V3_GROUND_TOKENS.ink! },
    ])
    const bands = await groundBands(path, { x: 5 })
    expect(bands.map((b) => b.token)).toEqual(['paper', 'coral-soft', 'paper-2', 'ink'])
    expect(bands.map((b) => b.height)).toEqual([40, 30, 50, 20])
    expect(bands[0]!.top).toBe(0)
    expect(bands[0]!.bottom).toBe(39)
    expect(bands[3]!.bottom).toBe(139) // last row of a 140px-tall stack
  })

  it('reports a non-ground stretch as its own content band rather than folding it into a neighbor', async () => {
    const { path } = await bandedPng('grounds-content', 10, [
      { height: 20, rgb: V3_GROUND_TOKENS.paper! },
      { height: 15, rgb: { r: 0x7a, g: 0x2b, b: 0xb8 } }, // plum — never a ground
      { height: 20, rgb: V3_GROUND_TOKENS.paper! },
    ])
    const bands = await groundBands(path, { x: 5 })
    expect(bands.map((b) => b.token)).toEqual(['paper', null, 'paper'])
    expect(bands[1]!.height).toBe(15)
  })

  it('rejects an --x outside the image rather than silently clamping it', async () => {
    const path = await solidPng('grounds-oob', 10, 10, V3_GROUND_TOKENS.paper!)
    await expect(groundBands(path, { x: 999 })).rejects.toThrow(/outside the image width/)
  })

  it('a tighter --tolerance can turn a near-miss ground into its own content band', async () => {
    // 10 away from paper-3 on every channel — within the default 24 but
    // outside a caller-supplied 5.
    const { path } = await bandedPng('grounds-tolerance', 10, [
      { height: 10, rgb: V3_GROUND_TOKENS['paper-3']! },
      { height: 10, rgb: { r: V3_GROUND_TOKENS['paper-3']!.r - 10, g: V3_GROUND_TOKENS['paper-3']!.g - 10, b: V3_GROUND_TOKENS['paper-3']!.b - 10 } },
    ])
    const loose = await groundBands(path, { x: 5 })
    expect(loose).toHaveLength(1) // both bands classify as paper-3 at the default tolerance
    const tight = await groundBands(path, { x: 5, tolerance: 5 })
    expect(tight.map((b) => b.token)).toEqual(['paper-3', null])
  })
})
