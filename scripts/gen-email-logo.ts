/**
 * One-off: rasterize the v3 wordmark (public/og/logo.svg) into the raster
 * pair the daily promo email header uses (ticket #14998). Run with:
 *   npx tsx scripts/gen-email-logo.ts
 *
 * public/og/logo.svg is square (viewBox ~1500x1500), so both outputs are
 * square too. DISPLAY_WIDTH is the <img width> the email actually renders
 * at; the @2x file is rendered at twice that for retina screens.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const DISPLAY_WIDTH = 160

const svg = readFileSync('public/og/logo.svg', 'utf8')

function rasterize(width: number): Buffer {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng()
  return Buffer.from(png)
}

mkdirSync('public/email', { recursive: true })
writeFileSync('public/email/xdipx-logo.png', rasterize(DISPLAY_WIDTH))
writeFileSync('public/email/xdipx-logo@2x.png', rasterize(DISPLAY_WIDTH * 2))
console.log(`wrote public/email/xdipx-logo.png (${DISPLAY_WIDTH}px) and xdipx-logo@2x.png (${DISPLAY_WIDTH * 2}px)`)
