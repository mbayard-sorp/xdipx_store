/**
 * Long-form sales pages for adult ad networks (ExoClick first), served at
 * curious.xdipx.com/<slug>. One Sanity `salesPage` document per page
 * (studio/schemas/salesPage.js) holds the words and their order; price,
 * images, variants and stock come from Shopify in the route loader.
 *
 * Isomorphic: types and the pure normalizer live here so tests and the view
 * can use them. The Sanity read is in sales-page.server.ts.
 */

export type SalesTone = 'paper' | 'paper-2' | 'plum-soft' | 'coral-soft' | 'ink'

export const SALES_CTA_LABELS = ["I'll take it ♥", 'Show me', 'Take a peek →', 'Find your fit →'] as const
const DEFAULT_CTA = SALES_CTA_LABELS[0]

const TONES: SalesTone[] = ['paper', 'paper-2', 'plum-soft', 'coral-soft', 'ink']
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/
const HANDLE_RE = /^[a-z0-9][a-z0-9-]*$/

export interface SalesImage {
  url: string
  alt: string
}

interface SectionBase {
  key: string
  kicker: string
  heading: string
  tone: SalesTone
}

export type SalesSection =
  | (SectionBase & { type: 'story'; paragraphs: string[]; image: SalesImage | null })
  | (SectionBase & { type: 'features'; items: { label: string; value: string }[] })
  | (SectionBase & { type: 'steps'; steps: { label: string; title: string; body: string }[] })
  | (SectionBase & { type: 'comparison'; usLabel: string; themLabel: string; rows: { feature: string; us: string; them: string }[] })
  | (SectionBase & { type: 'proof'; reviews: { quote: string; name: string }[] })
  | (SectionBase & { type: 'faq'; items: { q: string; a: string }[] })
  | (SectionBase & { type: 'buyBand'; body: string })
  | (SectionBase & { type: 'image'; image: SalesImage; caption: string })

export interface SalesPage {
  slug: string
  productHandle: string
  live: boolean
  buttonLabel: string
  announcement: string
  seoTitle: string
  kicker: string
  headline: string
  subhead: string
  heroPoints: string[]
  heroImage: SalesImage | null
  sections: SalesSection[]
  closer: string
  closerLine: string
}

export function isValidSalesSlug(slug: string): boolean {
  return SLUG_RE.test(slug)
}

/** Belt and braces for the charter: no em or en dashes reach the page. */
function clean(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s*[—–]\s*/g, ', ').trim() : ''
}

function cleanList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(clean).filter(Boolean) : []
}

function image(v: unknown): SalesImage | null {
  const r = v as { url?: unknown; alt?: unknown } | null | undefined
  return r && typeof r.url === 'string' && r.url ? { url: r.url, alt: clean(r.alt) } : null
}

function rows<T>(v: unknown, map: (r: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(v)) return []
  return v.map(r => (r && typeof r === 'object' ? map(r as Record<string, unknown>) : null)).filter((r): r is T => r !== null)
}

type RawSection = Record<string, unknown> & { _type?: string; _key?: string }

/** One raw section to its typed shape, or null when it is unusable. */
export function normalizeSection(raw: RawSection, index: number): SalesSection | null {
  const base: SectionBase = {
    key: typeof raw._key === 'string' ? raw._key : `s${index}`,
    kicker: clean(raw['kicker']),
    heading: clean(raw['heading']),
    tone: TONES.includes(raw['tone'] as SalesTone) ? (raw['tone'] as SalesTone) : 'paper',
  }
  switch (raw._type) {
    case 'spStory': {
      const paragraphs = cleanList(raw['paragraphs'])
      return base.heading || paragraphs.length ? { ...base, type: 'story', paragraphs, image: image(raw['image']) } : null
    }
    case 'spFeatures': {
      const items = rows(raw['items'], r => {
        const label = clean(r['label'])
        const value = clean(r['value'])
        return label && value ? { label, value } : null
      })
      return items.length ? { ...base, type: 'features', items } : null
    }
    case 'spSteps': {
      const steps = rows(raw['steps'], r => {
        const title = clean(r['title'])
        const body = clean(r['body'])
        return title && body ? { label: clean(r['label']), title, body } : null
      })
      return steps.length ? { ...base, type: 'steps', steps } : null
    }
    case 'spComparison': {
      const list = rows(raw['rows'], r => {
        const feature = clean(r['feature'])
        return feature ? { feature, us: clean(r['us']), them: clean(r['them']) } : null
      })
      return list.length
        ? { ...base, type: 'comparison', usLabel: clean(raw['usLabel']) || 'This one', themLabel: clean(raw['themLabel']) || 'Typical', rows: list }
        : null
    }
    case 'spProof': {
      // `source` is required in the Studio and never sent to the page.
      const reviews = rows(raw['reviews'], r => {
        const quote = clean(r['quote'])
        return quote ? { quote, name: clean(r['name']) } : null
      })
      return reviews.length ? { ...base, type: 'proof', reviews } : null
    }
    case 'spFaq': {
      const items = rows(raw['items'], r => {
        const q = clean(r['q'])
        const a = clean(r['a'])
        return q && a ? { q, a } : null
      })
      return items.length ? { ...base, type: 'faq', items } : null
    }
    case 'spBuyBand':
      return base.heading ? { ...base, tone: 'coral-soft', type: 'buyBand', body: clean(raw['body']) } : null
    case 'spImage': {
      const img = image(raw['image'])
      return img ? { ...base, type: 'image', image: img, caption: clean(raw['caption']) } : null
    }
    default:
      return null
  }
}

/** Map a raw Sanity row to a page, or null when a required field is bad. */
export function normalizeSalesPage(raw: Record<string, unknown> | null | undefined): SalesPage | null {
  if (!raw) return null
  const slug = typeof raw['slug'] === 'string' ? raw['slug'] : ''
  const productHandle = typeof raw['productHandle'] === 'string' ? raw['productHandle'] : ''
  if (!isValidSalesSlug(slug) || !HANDLE_RE.test(productHandle)) return null
  const headline = clean(raw['headline'])
  const subhead = clean(raw['subhead'])
  if (!headline || !subhead) return null
  const label = raw['buttonLabel']
  const sections = Array.isArray(raw['sections'])
    ? (raw['sections'] as RawSection[]).map((s, i) => (s && typeof s === 'object' ? normalizeSection(s, i) : null)).filter((s): s is SalesSection => s !== null)
    : []
  return {
    slug,
    productHandle,
    live: raw['live'] === true,
    buttonLabel: typeof label === 'string' && (SALES_CTA_LABELS as readonly string[]).includes(label) ? label : DEFAULT_CTA,
    announcement: clean(raw['announcement']),
    seoTitle: clean(raw['seoTitle']),
    kicker: clean(raw['kicker']),
    headline,
    subhead,
    heroPoints: cleanList(raw['heroPoints']),
    heroImage: image(raw['heroImage']),
    sections,
    closer: clean(raw['closer']) || headline,
    closerLine: clean(raw['closerLine']),
  }
}
