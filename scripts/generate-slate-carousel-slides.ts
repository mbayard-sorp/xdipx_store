/**
 * One-off: build the remaining carousel slides for the week-1 slate posts 88
 * and 90. Text slides are rendered typographically (brand tokens, Newsreader +
 * DM Sans) with headless Chromium, never by the image model, because baked
 * text in generated images is banned and unreliable. The product slide is a
 * `plate` archetype render from the real packshot. Every slide is rehosted to
 * Shopify Files under a `social-` filename so provenance passes, then the
 * row's media_urls is replaced with the full ordered set.
 *
 *   npx tsx scripts/generate-slate-carousel-slides.ts --out <dir> [--only 88,90] [--dry]
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env' }); loadEnv({ path: '.env.local' })

const FONT_DIR = resolve(process.cwd(), '../../../node_modules/@fontsource-variable')
function fontData(rel: string): string {
  return `data:font/woff2;base64,${readFileSync(join(FONT_DIR, rel)).toString('base64')}`
}

interface Slide { kind: 'text'; kicker?: string; text: string; tone: 'coral' | 'plum' | 'paper' }
interface ProductSlide { kind: 'product'; prompt: string }
/** The real packshot on a brand card: the one product representation that cannot drift. */
interface PackshotSlide { kind: 'packshot'; kicker: string; text: string; imageIndex?: number }
interface Post { id: number; handle: string; leadUrl: string; mood: string; slides: (Slide | ProductSlide | PackshotSlide)[] }

const POSTS: Post[] = [
  { id: 88, handle: 'womanizer-next-sage', mood: 'gap-carousel',
    leadUrl: 'https://cdn.shopify.com/s/files/1/0761/6872/4651/files/social-womanizer-next-sage-cast-gap-kitchen-morning-20260822-1_62839fec-ebbb-4e4c-bf1f-6b5fb0511240.jpg?v=1787442055',
    slides: [
      { kind: 'text', tone: 'coral', kicker: 'the orgasm gap', text: '95% of straight men usually or always orgasm during sex. 65% of straight women do.' },
      { kind: 'text', tone: 'paper', kicker: 'why', text: 'the difference isn’t effort. most sex is built around penetration, and most women orgasm from the clitoris, which penetration mostly misses.' },
      { kind: 'product', prompt: 'Product macro of a sage green Womanizer Next air-pulsation stimulator, the exact product in the reference photo, resting on a warm coral-soft plaster surface in bright window daylight, soft diagonal shadow, shallow depth of field, packaging-free, photoreal editorial still life, no text, no logos, 4:5 portrait.' },
      { kind: 'text', tone: 'plum', kicker: 'womanizer next', text: 'air pulsation over the clitoris instead of vibration into it. built around the thing that actually closes the gap.' },
      { kind: 'text', tone: 'paper', text: 'save this for the next time someone says women are harder to please. they’re under-served.' },
    ] },
  { id: 90, handle: 'womanizer-classic-2-rechargeable-silicone-pleasure-air-clitoral-stimulator', mood: 'wtf-carousel',
    leadUrl: 'https://cdn.shopify.com/s/files/1/0761/6872/4651/files/social-womanizer-classic-2-rechargeable-silicone-pleasure-air-clitoral-stimulator-cast-wtf-bathroom-midday-20260822-1_6ea3ccaf-4148-49a9-9f4c-978e96eb5b72.jpg?v=1787444291',
    slides: [
      { kind: 'text', tone: 'coral', text: 'it’s not a vibrator. nothing buzzes, and it never touches your clitoris.' },
      { kind: 'text', tone: 'paper', kicker: 'how it works', text: 'a soft silicone ring seals over the clitoris and pulses air pressure inside it: suction, release, suction, release, many times a second.' },
      { kind: 'packshot', kicker: 'womanizer classic 2', text: 'the nozzle seals over the clitoris. nothing else touches you.', imageIndex: 1 },
      { kind: 'text', tone: 'plum', kicker: 'womanizer classic 2', text: 'the one that made air pulsation click for people who tried a bullet and shrugged.' },
      { kind: 'text', tone: 'paper', kicker: 'first reaction', text: '“wait, that’s it?” then a very different noise about ninety seconds later.' },
      { kind: 'text', tone: 'coral', text: 'save this for the next time your group chat argues about which toy to buy first.' },
    ] },
]

const TONES = {
  coral: { bg: '#FFE6DD', fg: '#1A1418', accent: '#FF5A36' },
  plum: { bg: '#F3E8FB', fg: '#1A1418', accent: '#7A2BB8' },
  paper: { bg: '#FFFFFF', fg: '#1A1418', accent: '#FF5A36' },
}

function slideHtml(s: Slide, n: number, total: number): string {
  const t = TONES[s.tone]
  const size = s.text.length > 120 ? 64 : s.text.length > 70 ? 76 : 92
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:'Newsreader';src:url(${fontData('newsreader/files/newsreader-latin-wght-normal.woff2')}) format('woff2');font-weight:200 800}
  @font-face{font-family:'DM Sans';src:url(${fontData('dm-sans/files/dm-sans-latin-wght-normal.woff2')}) format('woff2');font-weight:100 900}
  html,body{margin:0;width:1080px;height:1350px;background:${t.bg};color:${t.fg}}
  .wrap{box-sizing:border-box;width:1080px;height:1350px;padding:120px 96px;display:flex;flex-direction:column;justify-content:space-between}
  .kicker{font-family:'DM Sans';font-weight:600;font-size:28px;letter-spacing:.18em;text-transform:uppercase;color:${t.accent}}
  .text{font-family:'Newsreader';font-weight:450;font-size:${size}px;line-height:1.14;letter-spacing:-.01em}
  .foot{display:flex;justify-content:space-between;align-items:flex-end;font-family:'DM Sans';font-size:26px;color:#6B5F68}
  .brand{font-weight:700;letter-spacing:.12em;color:${t.fg}}
  .rule{width:120px;height:6px;background:${t.accent};border-radius:3px;margin-bottom:40px}
  </style></head><body><div class="wrap">
    <div>${s.kicker ? `<div class="kicker">${s.kicker}</div>` : '<div class="rule"></div>'}</div>
    <div class="text">${s.text}</div>
    <div class="foot"><span class="brand">XDIPX</span><span>${n} / ${total}</span></div>
  </div></body></html>`
}

function packshotHtml(s: PackshotSlide, imgData: string, n: number, total: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:'Newsreader';src:url(${fontData('newsreader/files/newsreader-latin-wght-normal.woff2')}) format('woff2');font-weight:200 800}
  @font-face{font-family:'DM Sans';src:url(${fontData('dm-sans/files/dm-sans-latin-wght-normal.woff2')}) format('woff2');font-weight:100 900}
  html,body{margin:0;width:1080px;height:1350px;background:#FFFFFF;color:#1A1418}
  .wrap{box-sizing:border-box;width:1080px;height:1350px;padding:100px 96px;display:flex;flex-direction:column;justify-content:space-between}
  .kicker{font-family:'DM Sans';font-weight:600;font-size:28px;letter-spacing:.18em;text-transform:uppercase;color:#7A2BB8}
  .shot{flex:1;display:flex;align-items:center;justify-content:center;margin:40px 0}
  .shot img{max-height:680px;max-width:760px;object-fit:contain}
  .text{font-family:'Newsreader';font-weight:450;font-size:64px;line-height:1.14;letter-spacing:-.01em}
  .foot{display:flex;justify-content:space-between;align-items:flex-end;font-family:'DM Sans';font-size:26px;color:#6B5F68;margin-top:48px}
  .brand{font-weight:700;letter-spacing:.12em;color:#1A1418}
  </style></head><body><div class="wrap">
    <div class="kicker">${s.kicker}</div>
    <div class="shot"><img src="${imgData}"></div>
    <div class="text">${s.text}</div>
    <div class="foot"><span class="brand">XDIPX</span><span>${n} / ${total}</span></div>
  </div></body></html>`
}

async function main() {
  const args = process.argv.slice(2)
  const out = args[args.indexOf('--out') + 1]
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1]!.split(',').map(Number) : null
  const dry = args.includes('--dry')
  if (!out) throw new Error('--out required')
  mkdirSync(out, { recursive: true })

  // playwright-core is not a dependency of the repo; use the npx cache copy that `npx playwright` already resolves to.
  const pwPath = process.env['PLAYWRIGHT_CORE_PATH'] ?? '/Users/mikebayard/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs'
  const { chromium } = await import(pwPath)
  const { uploadMoodImageToShopifyFiles, getProductByHandle } = await import('../app/lib/shopify.server')
  const { generateAndUploadSocialImage } = await import('../app/lib/social-media.server')
  const { db } = await import('../app/lib/db.server')
  const { socialPosts } = await import('../db/schema')
  const { eq } = await import('drizzle-orm')

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 })
  const date = '20260822'

  for (const post of POSTS) {
    if (only && !only.includes(post.id)) continue
    const total = post.slides.length + 1
    const urls: string[] = [post.leadUrl]
    const product = await getProductByHandle(post.handle)
    // The nozzle-forward angle (second packshot when present) gives the model the feature it keeps inventing.
    const refImageUrl = product?.images?.[1]?.url ?? product?.images?.[0]?.url
    for (const [i, s] of post.slides.entries()) {
      const n = i + 2
      const filename = `social-${post.handle.slice(0, 40)}-card-${post.mood}-${date}-${n}.jpg`
      if (s.kind === 'text') {
        await page.setContent(slideHtml(s, n, total), { waitUntil: 'load' })
        await page.evaluate(() => (document as any).fonts.ready)
        const buf = await page.screenshot({ type: 'jpeg', quality: 92 })
        writeFileSync(join(out, `${post.id}-${n}.jpg`), buf)
        if (!dry) urls.push(await uploadMoodImageToShopifyFiles(Buffer.from(buf), filename))
        console.log(`post ${post.id} slide ${n}/${total} text card`)
      } else if (s.kind === 'packshot') {
        const src = product?.images?.[s.imageIndex ?? 0]?.url ?? product?.images?.[0]?.url
        if (!src) throw new Error(`post ${post.id}: no packshot for ${post.handle}`)
        const pbuf = Buffer.from(await (await fetch(src)).arrayBuffer())
        const imgData = `data:image/jpeg;base64,${pbuf.toString('base64')}`
        await page.setContent(packshotHtml(s, imgData, n, total), { waitUntil: 'load' })
        await page.evaluate(() => (document as any).fonts.ready)
        const buf = await page.screenshot({ type: 'jpeg', quality: 92 })
        writeFileSync(join(out, `${post.id}-${n}.jpg`), buf)
        if (!dry) urls.push(await uploadMoodImageToShopifyFiles(Buffer.from(buf), filename))
        console.log(`post ${post.id} slide ${n}/${total} packshot card`)
      } else {
        if (dry) { console.log(`post ${post.id} slide ${n}/${total} product (dry, skipped)`); continue }
        const r = await generateAndUploadSocialImage({
          prompt: s.prompt, handle: post.handle, archetype: 'plate', mood: post.mood, date, slide: n,
          aspect: '4:5', imageSize: { width: 1080, height: 1350 },
          ...(refImageUrl ? { refImageUrl } : {}), caller: 'owner-slate-preview', logCost: true,
        } as any)
        const url: string = (r as any).url ?? (r as any).urls?.[0]
        const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
        writeFileSync(join(out, `${post.id}-${n}.jpg`), buf)
        urls.push(url)
        console.log(`post ${post.id} slide ${n}/${total} product plate ${url}`)
      }
    }
    if (!dry) {
      await db.update(socialPosts).set({ mediaUrls: urls }).where(eq(socialPosts.id, post.id))
      const [row] = await db.select({ mediaUrls: socialPosts.mediaUrls, reviewStatus: socialPosts.reviewStatus }).from(socialPosts).where(eq(socialPosts.id, post.id))
      console.log(`post ${post.id} media_urls now ${row?.mediaUrls?.length} slides, review_status ${row?.reviewStatus}`)
    }
  }
  await browser.close()
}
main().catch(e => { console.error(e); process.exit(1) })
