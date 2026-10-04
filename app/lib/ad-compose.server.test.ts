import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { composeAd } from '~/lib/ad-compose.server'
import { AD_FORMATS } from '~/lib/ad-formats'
import { chooseLayout, getConcept } from '~/lib/ad-render-rules'

/** A text-free stand-in plate: a soft ground with one product-like capsule. */
async function fakePlate(w: number, h: number, ground: string): Promise<Buffer> {
  const r = Math.round(Math.min(w, h) * 0.22)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${ground}"/><rect x="${w * 0.5 - r * 0.6}" y="${h * 0.12}" width="${r * 1.2}" height="${h * 0.55}" rx="${r * 0.6}" fill="#7A2BB8"/><ellipse cx="${w * 0.5}" cy="${h * 0.72}" rx="${r * 0.9}" ry="${r * 0.12}" fill="rgba(26,20,24,0.18)"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

const OUT = process.env['AD_COMPOSE_OUT']

describe('composeAd', () => {
  it('renders every format at its exact pixel size with a fitted slogan', async () => {
    if (OUT) mkdirSync(OUT, { recursive: true })
    const concept = getConcept('sculpture-hall')
    for (const f of AD_FORMATS) {
      const layout = chooseLayout(concept, f, true)
      const plate = await fakePlate(f.family === 'story' ? 1080 : 1200, f.family === 'story' ? 1920 : 800, '#FFE6DD')
      const slogan = f.maxSloganChars <= 44 ? 'Never waits on a battery' : 'Corded, so it never waits on a battery.'
      const res = await composeAd({
        template: layout, width: f.width, height: f.height, slogan,
        kicker: concept.kicker, ground: 'coral-soft', plate,
      })
      const meta = await sharp(res.png).metadata()
      expect(meta.width).toBe(f.width)
      expect(meta.height).toBe(f.height)
      expect(res.metrics.truncated).toBe(false)
      if (OUT) writeFileSync(`${OUT}/${f.id.replace(':', 'x')}-${layout}.png`, res.png)
    }
  }, 60_000)

  it('renders the type card and the spec diptych', async () => {
    const f = AD_FORMATS.find(x => x.id === '1:1')!
    const tc = await composeAd({ template: 'type-card', width: f.width, height: f.height, slogan: "'Does it come in a plain box?' 'Plainer than your mail.'", kicker: 'At the xdipx counter', ground: 'plum-soft' })
    expect((await sharp(tc.png).metadata()).width).toBe(1080)
    const plate = await fakePlate(1200, 800, '#F3E8FB')
    const sd = await composeAd({
      template: 'spec-diptych', width: 1200, height: 628, slogan: 'Water-based or aloe, compared', kicker: 'Spec sheet', ground: 'plum-soft', plate,
      specLines: ['BASE      water | aloe', 'FEEL      slick | soft', 'BOTTLE    8.5 oz | 8 oz'],
    })
    expect((await sharp(sd.png).metadata()).height).toBe(628)
    if (OUT) {
      writeFileSync(`${OUT}/type-card-1x1.png`, tc.png)
      writeFileSync(`${OUT}/spec-diptych-1200x628.png`, sd.png)
    }
  }, 30_000)

  it('flags a slogan that cannot fit', async () => {
    const f = AD_FORMATS.find(x => x.id === '300x100')!
    const plate = await fakePlate(600, 300, '#FFE6DD')
    const res = await composeAd({
      template: 'banner-strip', width: f.width, height: f.height, kicker: 'x', ground: 'coral-soft', plate,
      slogan: 'This is far too long a line for a three hundred by one hundred banner to carry at any legible size at all',
    })
    expect(res.metrics.truncated).toBe(true)
  })
})
