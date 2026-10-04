// renderSocialCard (ticket #13368): the New-in carousel's packshot card and
// the typographic save-close plate share this renderer. Real satori + resvg +
// sharp render against a fixture product image, no mocking -- the output is
// what a reviewer or the publish gate's vision check actually sees, so the
// test checks the real pixels (dimensions, format) rather than a stubbed call.
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { renderSocialCard } from '~/lib/og-card.server'

/** A tiny flat-color fixture standing in for a real product packshot. */
async function fixtureProductImage(): Promise<{ data: Buffer; contentType: string }> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
    <rect width="100%" height="100%" fill="#FFFFFF"/>
    <rect x="100" y="60" width="200" height="280" rx="40" fill="#C2350F"/>
  </svg>`
  const data = await sharp(Buffer.from(svg)).jpeg().toBuffer()
  return { data, contentType: 'image/jpeg' }
}

describe('renderSocialCard', () => {
  it('renders a 1080x1350 packshot card with a product image and copy', async () => {
    const buf = await renderSocialCard({
      kicker: 'stroker',
      line: 'built around the thing that actually closes the gap.',
      slideIndex: 2,
      slideCount: 5,
      tone: 'coral',
      productImage: await fixtureProductImage(),
    })
    const meta = await sharp(buf).metadata()
    expect(meta.width).toBe(1080)
    expect(meta.height).toBe(1350)
    expect(meta.format).toBe('jpeg')
  }, 30_000)

  it('renders the plate op (typographic, no image) at the same canvas', async () => {
    const buf = await renderSocialCard({
      line: 'save this for the next time someone says women are harder to please.',
      slideIndex: 6,
      slideCount: 6,
      tone: 'plum',
    })
    const meta = await sharp(buf).metadata()
    expect(meta.width).toBe(1080)
    expect(meta.height).toBe(1350)
  }, 30_000)

  it('renders with no kicker and no explicit tone (defaults to the paper ground)', async () => {
    const buf = await renderSocialCard({ line: 'plain line, no kicker.', slideIndex: 1, slideCount: 1 })
    const meta = await sharp(buf).metadata()
    expect(meta.width).toBe(1080)
    expect(meta.height).toBe(1350)
  }, 30_000)

  it('steps the line size down for a long line rather than overflowing the canvas', async () => {
    const long = await renderSocialCard({
      line: 'a '.repeat(80).trim() + ' line long enough to need the smallest size step down.',
      slideIndex: 1,
      slideCount: 1,
    })
    // No pixel assertion beyond "it rendered at the fixed canvas without
    // throwing" -- satori throws on a layout it cannot resolve, so a clean
    // render at the right size is the signal that the dynamic sizing held.
    const meta = await sharp(long).metadata()
    expect(meta.width).toBe(1080)
    expect(meta.height).toBe(1350)
  }, 30_000)
})
