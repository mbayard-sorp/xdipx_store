/**
 * Designed OG share card for Notebook posts (image brief §5): white paper
 * base, kicker + Newsreader title + category chip + coral tick on the left,
 * the post's hero art bleeding off the right edge under a soft category wash.
 * Title text is real rendered type (satori), never baked into generated
 * imagery, so it stays crisp at thumbnail size in messages, feeds, and LLM
 * citation cards.
 *
 * satori (JSX-free element trees) → SVG → resvg → PNG. Fonts are the vendored
 * OFL TTFs in app/assets/og-fonts, inlined into the server bundle as data
 * URIs so serverless never touches the filesystem. Server-only.
 */
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import newsreaderFont from '~/assets/og-fonts/newsreader-500.ttf?inline'
import dmSansFont from '~/assets/og-fonts/dm-sans-400.ttf?inline'
import jetbrainsFont from '~/assets/og-fonts/jetbrains-mono-500.ttf?inline'
import { sanityImageUrl } from '~/lib/sanity-image'

const WIDTH = 1200
const HEIGHT = 630

// v3 tokens, mirrored from app/app.css (satori can't read CSS custom props).
// coral and the 'guides'/'care' category accents below were the pre-#3789
// (2026-08-19) values -- #FF5A36 and #7C8F78 failed WCAG AA and were darkened
// in app.css, but this hand-mirrored copy was missed (design-critic run 905,
// #9681), so share cards were shipping the old, non-AA colors.
const INK = '#1A1418'
const INK_3 = '#6B5F68'
const CORAL = '#C2350F'
const PAPER = '#FFFFFF'

// Category identity map (art direction §5), as raw hex for the chip + wash.
const CATEGORY_ACCENTS: Record<string, { text: string; tint: string; wash: string }> = {
  'guides': { text: '#C2350F', tint: '#FFE6DD', wash: 'rgba(255,230,221,0.55)' },
  'comparisons': { text: '#7A2BB8', tint: '#F3E8FB', wash: 'rgba(243,232,251,0.55)' },
  'care': { text: '#596756', tint: '#ECF0EA', wash: 'rgba(236,240,234,0.55)' },
  'wellness-basics': { text: '#6B5F68', tint: '#F4F3F1', wash: 'rgba(244,243,241,0.55)' },
}
const NEUTRAL_ACCENT = CATEGORY_ACCENTS['wellness-basics']!

function dataUriToBuffer(uri: string): Buffer {
  const base64 = uri.slice(uri.indexOf(',') + 1)
  return Buffer.from(base64, 'base64')
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

// satori element helper — plain object trees, no React import needed.
function el(type: string, style: Record<string, unknown>, children?: unknown, extra?: Record<string, unknown>) {
  return { type, props: { style, ...(extra ?? {}), ...(children !== undefined ? { children } : {}) } }
}

export interface OgCardInput {
  title: string
  categoryName?: string
  categorySlug?: string
  /** Post hero image URL (Sanity CDN); fetched and embedded when reachable. */
  heroImageUrl?: string
  /** Kicker line. Default THE NOTEBOOK. */
  kicker?: string
}

/** Fetch the hero as a data URI; null on any failure (card renders text-only). */
async function fetchHeroDataUri(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(sanityImageUrl(url, { w: 800, q: 70 }), { signal: ctrl.signal }).finally(() =>
      clearTimeout(timer),
    )
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? 'image/jpeg'
    // auto=format negotiates by Accept header; node fetch sends */* which can
    // yield webp — satori's image decoder handles png/jpeg only.
    if (!/png|jpe?g/.test(type)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return `data:${type};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

export async function renderNotebookOgCard(input: OgCardInput): Promise<Buffer> {
  const accent = (input.categorySlug && CATEGORY_ACCENTS[input.categorySlug]) || NEUTRAL_ACCENT
  const hero = input.heroImageUrl ? await fetchHeroDataUri(input.heroImageUrl) : null

  // Title scale: long question-form titles need to step down to stay ≤3 lines.
  const titleSize = input.title.length > 70 ? 52 : input.title.length > 45 ? 60 : 68

  const leftColumn = el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      width: hero ? 720 : WIDTH,
      height: '100%',
      padding: '64px 56px 56px 64px',
    },
    [
      el('div', { display: 'flex', flexDirection: 'column' }, [
        el(
          'div',
          {
            fontFamily: 'JetBrains Mono',
            fontSize: 22,
            letterSpacing: '0.18em',
            color: INK_3,
            marginBottom: 28,
          },
          (input.kicker ?? 'The Notebook').toUpperCase(),
        ),
        el(
          'div',
          {
            fontFamily: 'Newsreader',
            fontSize: titleSize,
            lineHeight: 1.06,
            letterSpacing: '-0.01em',
            color: INK,
            display: 'block',
            lineClamp: 3,
          },
          input.title,
        ),
        el('div', { width: 40, height: 3, backgroundColor: CORAL, marginTop: 30 }),
      ]),
      el('div', { display: 'flex', alignItems: 'center', gap: 20 }, [
        ...(input.categoryName
          ? [
              el(
                'div',
                {
                  display: 'flex',
                  backgroundColor: accent.tint,
                  color: accent.text,
                  fontFamily: 'DM Sans',
                  fontSize: 20,
                  letterSpacing: '0.06em',
                  padding: '8px 18px',
                  borderRadius: 999,
                },
                input.categoryName.toUpperCase(),
              ),
            ]
          : []),
        el('div', { fontFamily: 'DM Sans', fontSize: 22, color: INK_3 }, 'xdipx.com/notebook'),
      ]),
    ],
  )

  const rightColumn = hero
    ? el(
        'div',
        { display: 'flex', width: WIDTH - 720, height: '100%', position: 'relative' },
        [
          el('img', { width: '100%', height: '100%', objectFit: 'cover' }, undefined, { src: hero }),
          // Soft category wash so the photo sits inside the brand system.
          el('div', {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: `linear-gradient(90deg, ${PAPER} 0%, ${accent.wash} 18%, rgba(255,255,255,0) 55%)`,
          }),
        ],
      )
    : null

  const tree = el(
    'div',
    {
      display: 'flex',
      width: '100%',
      height: '100%',
      backgroundColor: PAPER,
    },
    rightColumn ? [leftColumn, rightColumn] : [leftColumn],
  )

  const svg = await satori(tree as never, {
    width: WIDTH,
    height: HEIGHT,
    fonts: loadFonts(),
  })

  const png = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng()
  return Buffer.from(png)
}

/**
 * Social brand card renderer (ticket #13368): the New-in carousel's packshot
 * card (routine-social-daily.md Step 2.9a) and the typographic save-close
 * plate. Same satori -> SVG -> resvg pipeline as `renderNotebookOgCard` above
 * (shared `loadFonts()`/`el()`), a different canvas and ground: 1080x1350
 * (4:5, Instagram's grid shape) instead of the 1200x630 share-card shape, and
 * a flat v3 tone ground instead of a photo bleed. Converted to JPEG before
 * returning (resvg only renders PNG) because every rehost target downstream
 * (`uploadMoodImageToShopifyFilesWithId`) declares `image/jpeg` regardless of
 * the filename's extension, and every other social asset filename convention
 * in this codebase is `.jpg`.
 *
 * Every word on the card -- kicker, line, wordmark, slide counter -- is real
 * rendered type (satori), never baked into generated pixels. That is what
 * `docs/store-team/instagram-campaigns.md` §3.3 requires ("No baked-in text
 * on any slide. Every word is rendered typography over a clean plate") and
 * what licenses the vision-gate carve-out in `isRenderedCardAsset`
 * (`app/lib/social-media.server.ts`): the gate's legible-text policy exists
 * to judge an AI image model's own hallucinated or baked-in text, not copy a
 * drafter wrote and this renderer laid out verbatim.
 *
 * Two archetypes, one function: pass `productImage` for the packshot card
 * (the New-in carousel's per-product slide, the real packshot cut out on the
 * tone ground); omit it for the plate op (the typographic save-close slide,
 * text only, no image). The caller fetches the product's default image and
 * passes the bytes in rather than this module fetching by URL, so the
 * renderer stays pure and is trivially unit-testable with a fixture buffer.
 */
export type SocialCardTone = 'coral' | 'plum' | 'paper'

const CARD_WIDTH = 1080
const CARD_HEIGHT = 1350
const PLUM = '#7A2BB8'

const SOCIAL_CARD_TONES: Record<SocialCardTone, { bg: string; accent: string }> = {
  coral: { bg: '#FFE6DD', accent: CORAL },
  plum: { bg: '#F3E8FB', accent: PLUM },
  paper: { bg: PAPER, accent: CORAL },
}

export interface SocialCardInput {
  /** Short mono label, e.g. 'STROKER' or 'NEW IN'. Omit for no kicker (a coral tick renders instead). */
  kicker?: string
  /** The card's one line of copy. */
  line: string
  /** 1-based position in the carousel. */
  slideIndex: number
  /** Total slides in the carousel. */
  slideCount: number
  tone?: SocialCardTone
  /** Pre-fetched product packshot bytes. Omit for a pure typographic plate. */
  productImage?: { data: Buffer; contentType: string }
}

export async function renderSocialCard(input: SocialCardInput): Promise<Buffer> {
  const tone = SOCIAL_CARD_TONES[input.tone ?? 'paper']
  const hasImage = !!input.productImage
  // Long line copy steps the size down, same reasoning as the OG card's title
  // scale above; an image card already has less vertical room for text.
  const lineSize = input.line.length > 100 ? 52 : input.line.length > 60 ? 64 : hasImage ? 52 : 80

  const kickerEl = input.kicker
    ? el(
        'div',
        { fontFamily: 'JetBrains Mono', fontSize: 26, letterSpacing: '0.18em', color: tone.accent },
        input.kicker.toUpperCase(),
      )
    : el('div', { width: 64, height: 4, backgroundColor: tone.accent, borderRadius: 2 })

  const imageEl = input.productImage
    ? el(
        'div',
        { display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', margin: '40px 0' },
        [
          el('img', { width: 720, height: 680, objectFit: 'contain' }, undefined, {
            src: `data:${input.productImage.contentType};base64,${input.productImage.data.toString('base64')}`,
          }),
        ],
      )
    : null

  const lineEl = el(
    'div',
    {
      fontFamily: 'DM Sans',
      fontWeight: 500,
      fontSize: lineSize,
      lineHeight: 1.16,
      letterSpacing: '-0.01em',
      color: INK,
      display: 'flex',
      ...(hasImage ? {} : { flex: 1, alignItems: 'center' }),
    },
    input.line,
  )

  const footerEl = el(
    'div',
    {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      fontFamily: 'DM Sans',
      fontSize: 24,
      color: INK_3,
      marginTop: 40,
    },
    [
      el('div', { fontFamily: 'DM Sans', fontWeight: 700, letterSpacing: '0.12em', color: INK }, 'XDIPX'),
      el('div', {}, `${input.slideIndex} / ${input.slideCount}`),
    ],
  )

  const tree = el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      width: '100%',
      height: '100%',
      backgroundColor: tone.bg,
      padding: '100px 96px',
    },
    [kickerEl, ...(imageEl ? [imageEl] : []), lineEl, footerEl],
  )

  const svg = await satori(tree as never, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: loadFonts(),
  })
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: CARD_WIDTH } }).render().asPng()

  // resvg only renders PNG; every downstream rehost/filename convention for
  // this asset family is JPEG (see file header).
  const sharp = (await import('sharp')).default
  return sharp(Buffer.from(png)).jpeg({ quality: 92 }).toBuffer()
}
