/**
 * Daily promo email assembler (ticket #14999). Composes blocks from
 * `email-blocks.ts` into one HTML + plain-text body for a single send,
 * appending the block-level UTM every product and section link carries
 * (`utm_source=klaviyo&utm_medium=email&utm_campaign=daily-YYYYMMDD&
 * utm_content=<block>-<handle>`). Every product link is the canonical
 * `/products/{handle}` URL (CLAUDE.md's URL/canonical strategy); this file
 * never accepts a caller-supplied href for a product, only a handle, so a
 * canonical-URL mistake cannot ship from a section spec.
 *
 * `isSendDay` / `isWithinDraftWindow` own the Tue/Thu/Sat default plus the
 * marketing_calendar dated-send override (owner direction 2026-11-01, note
 * on this ticket): a `type:'campaign'` row whose `assetsJson.sends` covers
 * the date wins over the default, and a row naming itself in a later row's
 * `assetsJson.supersedes` is ignored.
 */
import { eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { marketingCalendar } from '../../db/schema'
import {
  bylineBlock,
  dealCodeBlock,
  dealsBlock,
  emmaNoteBlock,
  featuredBrandBlock,
  footerBlock,
  goodBetterBestBlock,
  headerBlock,
  heroBlock,
  navBlock,
  newInGridBlock,
  notebookCardBlock,
  seasonalBlock,
  tipBlock,
  yourAddOnsBlock,
  EMAIL_NAV_DEFAULT,
  type BylineBlockOpts,
  type CtaLabel,
  type DealItem,
  type EmailNavItem,
  type GoodBetterBestTier,
  type GridItem,
  type NotebookCardItem,
} from './email-blocks'
import { EMAIL_COLORS as C, emailHeadStyle, EMAIL_PREHEADER_FILLER } from './email-design-system'

const SITE_ORIGIN = 'https://xdipx.com'

// ---------------------------------------------------------------------------
// UTM
// ---------------------------------------------------------------------------

function campaignKey(date: string): string {
  return `daily-${date.replace(/-/g, '')}`
}

/** No leading `?`; `amp` matches the surrounding context (`&amp;` inside an HTML
 *  attribute, `&` in the plain-text companion) — the same convention
 *  `klaviyo-flow-templates.ts`'s `utmQuery()` already uses. */
function utmQuery(date: string, content: string, amp: '&amp;' | '&'): string {
  return `utm_source=klaviyo${amp}utm_medium=email${amp}utm_campaign=${campaignKey(date)}${amp}utm_content=${content}`
}

function withUtm(absoluteUrl: string, date: string, content: string, amp: '&amp;' | '&' = '&amp;'): string {
  const sep = absoluteUrl.includes('?') ? amp : '?'
  return `${absoluteUrl}${sep}${utmQuery(date, content, amp)}`
}

function productHref(handle: string, date: string, content: string, amp: '&amp;' | '&' = '&amp;'): string {
  return withUtm(`${SITE_ORIGIN}/products/${handle}`, date, content, amp)
}

function siteHref(path: string, date: string, content: string, amp: '&amp;' | '&' = '&amp;'): string {
  const abs = /^https?:\/\//.test(path) ? path : `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
  return withUtm(abs, date, content, amp)
}

function slugFromPath(path: string): string {
  const parts = path.replace(/^https?:\/\/[^/]+/, '').split('/').filter(Boolean)
  return parts[parts.length - 1] ?? 'home'
}

// ---------------------------------------------------------------------------
// Section inputs. A section never carries a precomputed href for a product or
// site link — only a handle or a site-relative path — so every link this
// module emits is canonical and UTM-tagged by construction.
// ---------------------------------------------------------------------------

export interface EmailProductRef {
  handle: string
  name: string
  imageUrl: string
}

export interface EmailDealProduct extends EmailProductRef {
  /** Formatted display price, e.g. "$24.99". */
  price: string
  /** Shopify `compareAtPrice`, formatted the same way as `price`. */
  compareAtPrice?: string | null
  /** `xdipx.map_restricted` metafield. When true, no struck/compare price renders. */
  mapRestricted?: boolean
  /** Free-form badge override (e.g. "Today's pick"). Never a bare price when unset and
   *  `mapRestricted` is true — see `dealBadge()`. */
  badge?: string
}

export type EmailSection =
  | { kind: 'hero'; headline: string; cta: CtaLabel; product: EmailProductRef }
  | { kind: 'newInGrid'; products: EmailProductRef[] }
  | { kind: 'deals'; products: EmailDealProduct[] }
  | { kind: 'seasonal'; headline: string; body: string; imageUrl: string; cta: CtaLabel; path: string }
  | { kind: 'yourAddOns' }
  | { kind: 'emmaNote'; note: string }
  | { kind: 'notebookCard'; items: { title: string; dek: string; slug: string; imageUrl?: string }[] }
  | { kind: 'tip'; kicker: string; title: string; body: string; product?: EmailProductRef }
  | { kind: 'byline'; opts: BylineBlockOpts }
  | { kind: 'dealCode'; code: string; headline: string; terms: string; path: string }
  | { kind: 'goodBetterBest'; kicker: string; title: string; body: string; tiers: Omit<GoodBetterBestTier, 'hrefOverride'>[] }
  | { kind: 'featuredBrand'; brand: string; line: string; products: EmailProductRef[] }

/** Deal badge text. Never a comparison against `compareAtPrice` when the product is
 *  `mapRestricted` — that is the one way this module can accidentally render a struck
 *  price xdipx is not allowed to advertise. */
function dealBadge(p: EmailDealProduct): string | undefined {
  if (p.badge) return p.badge
  if (p.compareAtPrice && !p.mapRestricted) return `${p.price} (was ${p.compareAtPrice})`
  return undefined
}

function renderSection(section: EmailSection, date: string): string {
  switch (section.kind) {
    case 'hero':
      return heroBlock({
        productName: section.product.name,
        headline: section.headline,
        imageUrl: section.product.imageUrl,
        href: productHref(section.product.handle, date, `hero-${section.product.handle}`),
        cta: section.cta,
      })
    case 'newInGrid': {
      const items: GridItem[] = section.products.map((p) => ({
        name: p.name,
        imageUrl: p.imageUrl,
        href: productHref(p.handle, date, `newin-${p.handle}`),
      }))
      return newInGridBlock(items)
    }
    case 'deals': {
      const items: DealItem[] = section.products.map((p) => {
        const badge = dealBadge(p)
        return {
          name: p.name,
          imageUrl: p.imageUrl,
          href: productHref(p.handle, date, `deals-${p.handle}`),
          ...(badge !== undefined ? { badge } : {}),
        }
      })
      return dealsBlock(items)
    }
    case 'seasonal':
      return seasonalBlock({
        headline: section.headline,
        body: section.body,
        imageUrl: section.imageUrl,
        href: siteHref(section.path, date, `seasonal-${slugFromPath(section.path)}`),
        cta: section.cta,
      })
    case 'yourAddOns':
      return yourAddOnsBlock()
    case 'emmaNote':
      return emmaNoteBlock(section.note)
    case 'notebookCard': {
      const items: NotebookCardItem[] = section.items.map((item) => ({
        title: item.title,
        dek: item.dek,
        href: siteHref(`/notebook/${item.slug}`, date, `notebook-${item.slug}`),
        ...(item.imageUrl !== undefined ? { imageUrl: item.imageUrl } : {}),
      }))
      return notebookCardBlock(items)
    }
    case 'tip':
      return tipBlock({
        kicker: section.kicker,
        title: section.title,
        body: section.body,
        ...(section.product
          ? { productHref: productHref(section.product.handle, date, `tip-${section.product.handle}`), productTitle: section.product.name }
          : {}),
      })
    case 'byline':
      return bylineBlock(section.opts)
    case 'dealCode':
      return dealCodeBlock({
        code: section.code,
        headline: section.headline,
        terms: section.terms,
        href: siteHref(section.path, date, `dealcode-${slugFromPath(section.path)}`),
      })
    case 'goodBetterBest': {
      const tiers: GoodBetterBestTier[] = section.tiers.map((t) => ({
        ...t,
        hrefOverride: productHref(t.handle, date, `gbb-${t.tier}-${t.handle}`),
      }))
      return goodBetterBestBlock({ kicker: section.kicker, title: section.title, body: section.body, tiers })
    }
    case 'featuredBrand': {
      const items: GridItem[] = section.products.map((p) => ({
        name: p.name,
        imageUrl: p.imageUrl,
        href: productHref(p.handle, date, `brand-${p.handle}`),
      }))
      return featuredBrandBlock({ brand: section.brand, line: section.line, items })
    }
  }
}

// ---------------------------------------------------------------------------
// Plain text companion. Independent of the HTML block markup so a client that
// renders text/plain never sees table/style noise; carries the same
// UTM-tagged canonical links.
// ---------------------------------------------------------------------------

function sectionPlainText(section: EmailSection, date: string): string | undefined {
  const pHref = (handle: string, content: string) => productHref(handle, date, content, '&')
  const sHref = (path: string, content: string) => siteHref(path, date, content, '&')
  switch (section.kind) {
    case 'hero':
      return `${section.headline}\n${pHref(section.product.handle, `hero-${section.product.handle}`)}`
    case 'newInGrid':
      return section.products.map((p) => `${p.name}: ${pHref(p.handle, `newin-${p.handle}`)}`).join('\n')
    case 'deals':
      return section.products
        .map((p) => {
          const badge = dealBadge(p)
          return `${p.name}${badge ? ` (${badge})` : ''}: ${pHref(p.handle, `deals-${p.handle}`)}`
        })
        .join('\n')
    case 'seasonal':
      return `${section.headline}\n${section.body}\n${sHref(section.path, `seasonal-${slugFromPath(section.path)}`)}`
    case 'yourAddOns':
      return undefined
    case 'emmaNote':
      return section.note
    case 'notebookCard':
      return section.items.map((item) => `${item.title}: ${sHref(`/notebook/${item.slug}`, `notebook-${item.slug}`)}`).join('\n')
    case 'tip':
      return `${section.title}\n${section.body}${section.product ? `\n${section.product.name}: ${pHref(section.product.handle, `tip-${section.product.handle}`)}` : ''}`
    case 'byline':
      return undefined
    case 'dealCode':
      return `${section.headline}\nCode: ${section.code}\n${section.terms}\n${sHref(section.path, `dealcode-${slugFromPath(section.path)}`)}`
    case 'goodBetterBest':
      return section.tiers
        .map((t) => `${t.tier.toUpperCase()}: ${t.name} ${t.price} — ${t.line}\n${pHref(t.handle, `gbb-${t.tier}-${t.handle}`)}`)
        .join('\n')
    case 'featuredBrand':
      return `${section.brand}\n${section.line}\n${section.products.map((p) => `${p.name}: ${pHref(p.handle, `brand-${p.handle}`)}`).join('\n')}`
  }
}

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

export interface AssembleDailyEmailInput {
  /** America/Phoenix calendar date of the send, `YYYY-MM-DD`. */
  date: string
  sections: EmailSection[]
  /** Site navigation row under the logo. Defaults to `EMAIL_NAV_DEFAULT`; the
   *  caller passes `getMainMenu()`'s result to keep it in sync with the site. */
  navItems?: readonly EmailNavItem[]
  subject: string
  /** Hypothesis under test for this send, recorded in an HTML comment only
   *  (never shown to the reader), so the email ledger can tie a send to it. */
  hypothesis?: string
}

export interface AssembledDailyEmail {
  html: string
  text: string
}

/** Pure render: no DB or Shopify calls. The caller resolves product/menu data first. */
export function assembleDailyEmail(input: AssembleDailyEmailInput): AssembledDailyEmail {
  const { date, sections, subject } = input
  const navItems = input.navItems ?? EMAIL_NAV_DEFAULT
  const utmFor = (content: string) => utmQuery(date, content, '&amp;')
  const bodyRows = [headerBlock(), navBlock(navItems, utmFor), ...sections.map((s) => renderSection(s, date)), footerBlock()].join('\n')

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${subject}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>td,th,p,a,span,div{font-family:Arial,Helvetica,sans-serif !important;} .x-serif,.x-serif *{font-family:Georgia,'Times New Roman',serif !important;}</style><![endif]-->
${emailHeadStyle()}
</head>
<body class="x-bg" bgcolor="${C.paper}" style="margin:0;padding:0;background-color:${C.paper};">
${input.hypothesis ? `<!-- hypothesis: ${input.hypothesis.replace(/-->/g, '')} -->` : ''}
<div class="x-body x-bg" role="article" aria-roledescription="email" aria-label="${subject}" lang="en" style="background-color:${C.paper};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.paper};opacity:0;">${EMAIL_PREHEADER_FILLER}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.paper}" class="x-bg" style="background-color:${C.paper};">
<tr><td align="center" bgcolor="${C.paper}" class="x-bg" style="background-color:${C.paper};">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td bgcolor="${C.paper}" style="background-color:${C.paper};"><![endif]-->
<table role="presentation" class="x-wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
${bodyRows}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>`

  const text = [`${subject}`, '', ...sections.map((s) => sectionPlainText(s, date)).filter((l): l is string => !!l)].join('\n\n')

  return { html, text }
}

// ---------------------------------------------------------------------------
// Send-day resolution
// ---------------------------------------------------------------------------

/** Tue/Thu/Sat in America/Phoenix (no DST, so the date string's own calendar
 *  weekday is already the Phoenix weekday). */
export function isSendDayDefault(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) throw new Error(`Bad date: ${date}`)
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  return day === 2 || day === 4 || day === 6 // Tue, Thu, Sat
}

export interface MarketingCalendarCampaignRow {
  id: number
  eventDate: string
  assetsJson: unknown
}

function addDays(date: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) throw new Error(`Bad date: ${date}`)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Extracts the full `YYYY-MM-DD` dates a campaign row's `assetsJson.sends` names.
 *  Two shapes exist in production data: a plain string per entry prefixed
 *  `MM-DD ...` (the row's own `eventDate` supplies the year), and an object per
 *  entry carrying a full `send` date. Anything else is ignored rather than
 *  thrown on, since this reads an operator-edited JSON blob with no schema. */
function extractSendDates(row: MarketingCalendarCampaignRow): Set<string> {
  const dates = new Set<string>()
  const assets = row.assetsJson as { sends?: unknown } | null
  if (!assets || !Array.isArray(assets.sends)) return dates
  const year = row.eventDate.slice(0, 4)
  for (const entry of assets.sends) {
    if (typeof entry === 'string') {
      const m = /^(\d{2})-(\d{2})/.exec(entry)
      if (m) dates.add(`${year}-${m[1]}-${m[2]}`)
    } else if (entry && typeof entry === 'object' && typeof (entry as { send?: unknown }).send === 'string') {
      dates.add((entry as { send: string }).send)
    }
  }
  return dates
}

function extractOffCadence(row: MarketingCalendarCampaignRow): Set<string> {
  const assets = row.assetsJson as { offCadence?: unknown } | null
  const out = new Set<string>()
  if (assets && Array.isArray(assets.offCadence)) {
    for (const d of assets.offCadence) if (typeof d === 'string') out.add(d)
  }
  return out
}

function rowCoversDate(row: MarketingCalendarCampaignRow, date: string): boolean {
  const assets = row.assetsJson as { endDate?: unknown } | null
  const end = assets && typeof assets.endDate === 'string' ? assets.endDate : row.eventDate
  return row.eventDate <= date && date <= end
}

/** `null` means no covering row was found; fall back to the Tue/Thu/Sat default. */
export function resolveSendOverride(rows: readonly MarketingCalendarCampaignRow[], date: string): boolean | null {
  const superseded = new Set<number>()
  for (const row of rows) {
    const assets = row.assetsJson as { supersedes?: unknown } | null
    if (assets && typeof assets.supersedes === 'number') superseded.add(assets.supersedes)
  }
  const covering = rows.filter((r) => !superseded.has(r.id) && rowCoversDate(r, date))
  if (covering.length === 0) return null
  // Highest id wins on an unresolved overlap (the newer row), consistent with
  // `supersedes` already preferring the replacement over what it replaces.
  const row = covering.reduce((a, b) => (b.id > a.id ? b : a))
  if (extractOffCadence(row).has(date)) return false
  return extractSendDates(row).has(date)
}

/**
 * Whether `date` (America/Phoenix, `YYYY-MM-DD`) is a send day. A `campaign`
 * marketing_calendar row covering the date overrides the Tue/Thu/Sat default
 * (owner direction 2026-11-01); pass `campaignRows` in tests, omit it in
 * production to read the live table.
 */
export async function isSendDay(date: string, campaignRows?: readonly MarketingCalendarCampaignRow[]): Promise<boolean> {
  const rows = campaignRows ?? (await loadMarketingCalendarCampaignRows())
  const override = resolveSendOverride(rows, date)
  return override ?? isSendDayDefault(date)
}

async function loadMarketingCalendarCampaignRows(): Promise<MarketingCalendarCampaignRow[]> {
  const rows = await db
    .select({ id: marketingCalendar.id, eventDate: marketingCalendar.eventDate, assetsJson: marketingCalendar.assetsJson })
    .from(marketingCalendar)
    .where(eq(marketingCalendar.type, 'campaign'))
  return rows as MarketingCalendarCampaignRow[]
}

/** A send date more than `maxDays` from `today` cannot be drafted yet (the plan
 *  is set well ahead of the send; the draft is built close to it). */
export function isWithinDraftWindow(sendDate: string, today: string, maxDays = 1): boolean {
  for (let i = -maxDays; i <= maxDays; i++) {
    if (addDays(today, i) === sendDate) return true
  }
  return false
}
