/**
 * The layout layer for Ad Studio creatives (Ad Studio v2 PR-C). Text is never
 * generated into pixels: the plate is a text-free image and the slogan is set
 * here, in real type, at the exact format size.
 *
 * Path: satori (element trees) to SVG, resvg to PNG, the same stack
 * og-card.server.ts already ships, with sharp fitting the plate to its slot.
 * There is no headless browser in this repo, so the four templates are satori
 * trees rather than HTML files. Fonts are the vendored OFL TTFs (Newsreader,
 * DM Sans, JetBrains Mono). The one-coral-element rule holds: each template
 * draws exactly one coral mark, a short tick, and nothing else coral.
 *
 * Templates (minimal versions): plain-plate, type-card, banner-strip,
 * spec-diptych. A flat paper panel carries the text on every plate template,
 * so legibility never depends on what the plate looks like under it.
 */
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
import newsreaderFont from '~/assets/og-fonts/newsreader-500.ttf?inline'
import dmSansFont from '~/assets/og-fonts/dm-sans-400.ttf?inline'
import jetbrainsFont from '~/assets/og-fonts/jetbrains-mono-500.ttf?inline'
import { fitSlogan, isStripFormat, type LayoutTemplate, type PlateGround } from '~/lib/ad-render-rules'

// v3 tokens mirrored from app/app.css (satori cannot read CSS custom properties).
const INK = '#1A1418'
const INK_3 = '#6B5F68'
const CORAL = '#C2350F'
const PAPER = '#FFFFFF'
const GROUNDS: Record<PlateGround, string> = { 'coral-soft': '#FFE6DD', 'plum-soft': '#F3E8FB', plaster: '#FAFAF9' }

const GLYPH = 0.5 // conservative Newsreader advance for the wrap estimate

function dataUriToBuffer(uri: string): Buffer {
  return Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64')
}

let fonts: { name: string; data: Buffer; weight: 400 | 500; style: 'normal' }[] | null = null
function loadFonts() {
  fonts ??= [
    { name: 'Newsreader', data: dataUriToBuffer(newsreaderFont), weight: 500, style: 'normal' },
    { name: 'DM Sans', data: dataUriToBuffer(dmSansFont), weight: 400, style: 'normal' },
    { name: 'JetBrains Mono', data: dataUriToBuffer(jetbrainsFont), weight: 500, style: 'normal' },
  ]
  return fonts
}

type Node = { type: string; props: Record<string, unknown> }
function el(type: string, style: Record<string, unknown>, children?: unknown, extra?: Record<string, unknown>): Node {
  return { type, props: { style, ...(extra ?? {}), ...(children !== undefined ? { children } : {}) } }
}

export interface ComposeInput {
  template: LayoutTemplate
  width: number
  height: number
  slogan: string
  kicker: string
  ground: PlateGround
  /** Text-free plate bytes. Required for every template except type-card. */
  plate?: Buffer | null
  /** Mono spec rows for spec-diptych, at most three are set. */
  specLines?: readonly string[]
}

export interface ComposeMetrics {
  fontSize: number
  lines: number
  truncated: boolean
  minFont: number
}

export interface ComposeResult {
  png: Buffer
  metrics: ComposeMetrics
}

/** Fit the plate into its slot as a JPEG data URI that satori can decode. */
async function plateDataUri(buf: Buffer, w: number, h: number, position: string): Promise<string> {
  const out = await sharp(buf)
    .resize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), { fit: 'cover', position })
    .jpeg({ quality: 90 })
    .toBuffer()
  return `data:image/jpeg;base64,${out.toString('base64')}`
}

function minFontFor(w: number, h: number): number {
  return Math.max(11, Math.round(Math.min(w, h) * 0.035))
}

function tick(w: number, h: number): Node {
  return el('div', { width: w, height: h, backgroundColor: CORAL, flexShrink: 0 })
}

function wordmark(size: number): Node {
  return el('div', { fontFamily: 'Newsreader', fontSize: size, color: INK, letterSpacing: '-0.01em', lineHeight: 1 }, 'xdipx')
}

function kickerEl(text: string, size: number): Node {
  return el('div', { fontFamily: 'JetBrains Mono', fontSize: size, letterSpacing: '0.16em', color: INK_3, lineHeight: 1 }, text.toUpperCase())
}

function sloganEl(text: string, fontSize: number): Node {
  return el('div', {
    fontFamily: 'Newsreader', fontSize, lineHeight: 1.08, letterSpacing: '-0.01em', color: INK, display: 'block',
  }, text)
}

function specRows(lines: readonly string[], size: number): Node[] {
  return lines.slice(0, 3).map(l => el('div', {
    fontFamily: 'JetBrains Mono', fontSize: size, color: INK_3, lineHeight: 1.25, display: 'block',
  }, l.length > 52 ? `${l.slice(0, 49)}...` : l))
}

export async function composeAd(input: ComposeInput): Promise<ComposeResult> {
  const { width: w, height: h } = input
  const strip = isStripFormat({ width: w, height: h })
  const wide = !strip && w / h >= 1.5
  const story = h / w >= 1.6
  const min = minFontFor(w, h)
  const m = Math.round(Math.min(w, h) * (strip ? 0.08 : 0.055))
  const groundColor = GROUNDS[input.ground]
  const needsPlate = input.template !== 'type-card'
  if (needsPlate && !input.plate) throw new Error(`Template ${input.template} needs a plate`)

  let tree: Node
  let fit: ReturnType<typeof fitSlogan>

  if (input.template === 'type-card') {
    if (strip) {
      const kw = Math.round(w * 0.2)
      const boxW = w - kw - 2 * m - 12
      fit = fitSlogan({ text: input.slogan, boxWidth: boxW, boxHeight: h - 2 * m, maxFont: h * 0.34, minFont: min, maxLines: 3, glyphRatio: GLYPH })
      tree = el('div', { display: 'flex', width: w, height: h, backgroundColor: groundColor, alignItems: 'center', padding: m, gap: 12 }, [
        tick(3, Math.round(h * 0.5)),
        el('div', { display: 'flex', flex: 1 }, [sloganEl(input.slogan, fit.fontSize)]),
        el('div', { display: 'flex', width: kw, justifyContent: 'flex-end' }, [wordmark(Math.max(12, Math.round(h * 0.2)))]),
      ])
    } else {
      const footer = Math.max(11, Math.round(Math.min(w, h) * 0.03))
      const boxW = w - 2 * m
      const boxH = h - 2 * m - footer * 2 - Math.round(m * 1.4) - 40
      fit = fitSlogan({ text: input.slogan, boxWidth: boxW, boxHeight: boxH, maxFont: Math.min(w, h) * 0.13, minFont: min * 1.6, maxLines: 6, glyphRatio: GLYPH })
      tree = el('div', { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: w, height: h, backgroundColor: groundColor, padding: m }, [
        kickerEl(input.kicker, footer),
        el('div', { display: 'flex', flexDirection: 'column', gap: Math.round(m * 0.5) }, [
          sloganEl(input.slogan, fit.fontSize),
          tick(Math.max(32, Math.round(w * 0.06)), Math.max(3, Math.round(h * 0.004))),
        ]),
        el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
          wordmark(footer * 1.7),
          el('div', { fontFamily: 'DM Sans', fontSize: footer, color: INK_3 }, 'xdipx.com'),
        ]),
      ])
    }
  } else if (strip) {
    // banner-strip: text panel left, plate right.
    const pw = Math.round(w * 0.58)
    const plateW = w - pw
    const boxW = pw - 2 * m - 12
    const room = h >= 120
    const reserve = room ? Math.round(h * 0.09) + Math.round(h * 0.06) + 8 : 0
    fit = fitSlogan({ text: input.slogan, boxWidth: boxW - (room ? Math.round(h * 0.16) + 10 : 0), boxHeight: h - 2 * m - reserve, maxFont: h * 0.22, minFont: min, maxLines: 3, glyphRatio: GLYPH })
    const uri = await plateDataUri(input.plate!, plateW, h, 'right')
    tree = el('div', { display: 'flex', width: w, height: h, backgroundColor: PAPER }, [
      el('div', { display: 'flex', flexDirection: 'column', justifyContent: 'center', width: pw, height: h, padding: m, gap: Math.round(h * 0.06) }, [
        el('div', { display: 'flex', alignItems: 'center', gap: 10 }, [
          room ? tick(Math.round(h * 0.16), Math.max(3, Math.round(h * 0.014))) : tick(3, Math.round(h * 0.4)),
          el('div', { display: 'flex', flex: 1 }, [sloganEl(input.slogan, fit.fontSize)]),
        ]),
        ...(room ? [wordmark(Math.max(12, Math.round(h * 0.09)))] : []),
      ]),
      el('img', { width: plateW, height: h, objectFit: 'cover' }, undefined, { src: uri, width: plateW, height: h }),
    ])
  } else if (input.template === 'spec-diptych') {
    const specSize = Math.max(11, Math.round(Math.min(w, h) * 0.026))
    const footer = Math.max(11, Math.round(Math.min(w, h) * 0.028))
    if (wide) {
      const plateW = Math.round(w * 0.48)
      const boxW = w - plateW - 2 * m
      fit = fitSlogan({ text: input.slogan, boxWidth: boxW, boxHeight: h * 0.5, maxFont: h * 0.12, minFont: min, maxLines: 4, glyphRatio: GLYPH })
      const uri = await plateDataUri(input.plate!, plateW, h, 'centre')
      tree = el('div', { display: 'flex', width: w, height: h, backgroundColor: PAPER }, [
        el('img', { width: plateW, height: h, objectFit: 'cover' }, undefined, { src: uri, width: plateW, height: h }),
        el('div', { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: w - plateW, height: h, padding: m }, [
          kickerEl(input.kicker, footer),
          el('div', { display: 'flex', flexDirection: 'column', gap: Math.round(m * 0.45) }, [
            sloganEl(input.slogan, fit.fontSize),
            ...specRows(input.specLines ?? [], specSize),
            tick(Math.max(32, Math.round(w * 0.04)), 4),
          ]),
          wordmark(footer * 1.7),
        ]),
      ])
    } else {
      const plateH = Math.round(h * (story ? 0.46 : 0.5))
      const boxW = w - 2 * m
      fit = fitSlogan({ text: input.slogan, boxWidth: boxW, boxHeight: (h - plateH) * 0.42, maxFont: Math.min(w, h) * 0.08, minFont: min, maxLines: 3, glyphRatio: GLYPH })
      const uri = await plateDataUri(input.plate!, w, plateH, 'top')
      tree = el('div', { display: 'flex', flexDirection: 'column', width: w, height: h, backgroundColor: PAPER }, [
        el('img', { width: w, height: plateH, objectFit: 'cover' }, undefined, { src: uri, width: w, height: plateH }),
        el('div', { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: w, height: h - plateH, padding: m }, [
          el('div', { display: 'flex', flexDirection: 'column', gap: Math.round(m * 0.35) }, [
            kickerEl(input.kicker, footer),
            sloganEl(input.slogan, fit.fontSize),
            ...specRows(input.specLines ?? [], specSize),
          ]),
          el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
            tick(Math.max(32, Math.round(w * 0.06)), 4),
            wordmark(footer * 1.7),
          ]),
        ]),
      ])
    }
  } else if (wide) {
    // plain-plate on 1200x628: text panel left, plate right.
    const pw = Math.round(w * 0.42)
    const plateW = w - pw
    const footer = Math.max(11, Math.round(h * 0.034))
    const boxW = pw - 2 * m
    fit = fitSlogan({ text: input.slogan, boxWidth: boxW, boxHeight: h - 2 * m - footer * 3, maxFont: h * 0.12, minFont: min, maxLines: 5, glyphRatio: GLYPH })
    const uri = await plateDataUri(input.plate!, plateW, h, 'right')
    tree = el('div', { display: 'flex', width: w, height: h, backgroundColor: PAPER }, [
      el('div', { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: pw, height: h, padding: m }, [
        kickerEl(input.kicker, footer),
        el('div', { display: 'flex', flexDirection: 'column', gap: Math.round(m * 0.5) }, [
          sloganEl(input.slogan, fit.fontSize),
          tick(Math.max(32, Math.round(w * 0.04)), 4),
        ]),
        wordmark(footer * 1.8),
      ]),
      el('img', { width: plateW, height: h, objectFit: 'cover' }, undefined, { src: uri, width: plateW, height: h }),
    ])
  } else if (story) {
    // plain-plate on 9:16: plate full bleed, a flat paper card above the Snap safe zone.
    const bottomInset = Math.round(h * 0.16)
    const cardH = Math.round(h * 0.2)
    const footer = Math.round(w * 0.026)
    const boxW = w - 4 * m
    fit = fitSlogan({ text: input.slogan, boxWidth: boxW, boxHeight: cardH - 2 * m - footer * 3, maxFont: w * 0.075, minFont: min, maxLines: 3, glyphRatio: GLYPH })
    const uri = await plateDataUri(input.plate!, w, h, 'top')
    tree = el('div', { display: 'flex', width: w, height: h, position: 'relative', backgroundColor: PAPER }, [
      el('img', { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover' }, undefined, { src: uri, width: w, height: h }),
      el('div', {
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'absolute',
        left: m, right: m, bottom: bottomInset, height: cardH, padding: m, backgroundColor: PAPER, borderRadius: 22,
      }, [
        el('div', { display: 'flex', flexDirection: 'column', gap: Math.round(m * 0.3) }, [
          kickerEl(input.kicker, footer),
          sloganEl(input.slogan, fit.fontSize),
        ]),
        el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
          tick(Math.round(w * 0.06), 4),
          wordmark(footer * 1.8),
        ]),
      ]),
    ])
  } else {
    // plain-plate on square, portrait and 300x250: plate on top, text panel below.
    const smallCanvas = Math.min(w, h) < 400
    const ph = Math.round(h * (smallCanvas ? 0.42 : h > w ? 0.27 : 0.3))
    const footer = Math.max(10, Math.round(Math.min(w, h) * 0.028))
    const mm = smallCanvas ? Math.round(m * 0.9) : m
    const boxW = w - 2 * mm
    fit = fitSlogan({
      text: input.slogan, boxWidth: boxW,
      boxHeight: ph - 2 * mm - (smallCanvas ? footer * 1.6 : footer * 2.4),
      maxFont: Math.min(w, h) * (smallCanvas ? 0.09 : 0.075), minFont: min, maxLines: 3, glyphRatio: GLYPH,
    })
    const uri = await plateDataUri(input.plate!, w, h - ph, 'top')
    tree = el('div', { display: 'flex', flexDirection: 'column', width: w, height: h, backgroundColor: PAPER }, [
      el('img', { width: w, height: h - ph, objectFit: 'cover' }, undefined, { src: uri, width: w, height: h - ph }),
      el('div', { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: w, height: ph, padding: mm }, [
        el('div', { display: 'flex', flexDirection: 'column', gap: Math.round(mm * 0.3) }, [
          ...(smallCanvas ? [] : [kickerEl(input.kicker, footer)]),
          sloganEl(input.slogan, fit.fontSize),
        ]),
        el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
          tick(Math.max(24, Math.round(w * 0.06)), Math.max(3, Math.round(h * 0.004))),
          wordmark(footer * 1.8),
        ]),
      ]),
    ])
  }

  const svg = await satori(tree as never, { width: w, height: h, fonts: loadFonts() })
  const png = Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng())
  return {
    png,
    metrics: { fontSize: fit.fontSize, lines: fit.lines, truncated: fit.truncated, minFont: min },
  }
}
