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
const INK = '#1A1418'
const INK_3 = '#6B5F68'
const CORAL = '#FF5A36'
const PAPER = '#FFFFFF'

// Category identity map (art direction §5), as raw hex for the chip + wash.
const CATEGORY_ACCENTS: Record<string, { text: string; tint: string; wash: string }> = {
  'guides': { text: '#FF5A36', tint: '#FFE6DD', wash: 'rgba(255,230,221,0.55)' },
  'comparisons': { text: '#7A2BB8', tint: '#F3E8FB', wash: 'rgba(243,232,251,0.55)' },
  'care': { text: '#7C8F78', tint: '#ECF0EA', wash: 'rgba(236,240,234,0.55)' },
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
