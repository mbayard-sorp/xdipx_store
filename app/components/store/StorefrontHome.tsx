/**
 * The new traditional storefront homepage (variant 'b') — "Emma's Edit".
 *
 * A content-rich, crawlable catalog front door that replaces "The Compass"
 * discovery tool at `/` (which moves to `/discover`). Built mobile-first @375px
 * on the v3 brand tokens, in the Emma editorial voice. Section order is the
 * stable "shell"; the daily merchandising team changes *content* (featured
 * products, copy, the deferred Sanity bands) inside it, never the structure.
 *
 * Locked design: docs/homepage-team/redesign-v2-spec.md (art direction +
 * section-by-section build spec, Routine B). Supersedes the section styling
 * in docs/homepage-team/homepage-redesign-brief.md; section ORDER and the
 * locked shell (announcement / hero / trust / email last) are unchanged from
 * the original brief.
 *
 * Voice: Emma is an AI guide with NO lived experience, she advises from
 * catalog knowledge, never claims to have used/owned/reached-for a product.
 * No em-dashes, no countdowns, CTAs from the whitelist only, heart motif only
 * in CTAs/asides.
 *
 * SSR-visible content everywhere (no client-only critical content) so it
 * indexes cleanly. Reveal is used for scroll polish but never wraps the LCP
 * hero image (zero CLS).
 */

import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { EmailSubscribe } from '~/components/store/EmailSubscribe'
import { StorefrontProductCard } from '~/components/store/StorefrontProductCard'
import { SensationMap } from '~/components/store/SensationMap'
import { ContentBlockRenderer } from '~/components/cms/ContentBlockRenderer'
import { NotebookRail } from '~/components/blog/NotebookRail'
import type { BlogPostCard } from '~/types/cms'
import { FAQStructuredData } from '~/components/seo/FAQStructuredData'
import { ItemListStructuredData } from '~/components/seo/ItemListStructuredData'
import { Reveal } from '~/components/motion/Reveal'
import { PanelDeck } from '~/components/home/panels/PanelDeck'
import {
  trackViewItemList,
  trackSelectItem,
  trackSelectPromotion,
  trackCtaClick,
  trackHomeVariantView,
  trackHomeScrollDepth,
  type GA4Item,
} from '~/lib/analytics.client'
import type { StorefrontData } from '~/lib/storefront-home.server'
import type { DiscoveryProduct, Rail } from '~/types/discovery'
import type {
  EmmaHeroSettings,
  WayfinderMosaicBlock,
  PlayTogetherBannerBlock,
  EmmaCuratedRailBlock,
  TrustBarBlock,
  HomepageFaqBlock,
} from '~/types/cms'
import type { LeanCardProduct } from '~/types'

/* Team-controlled Sanity block types the storefront renders (everything else
   in `singleton.homepage` is shell-owned or legacy and intentionally ignored). */
const TEAM_RAIL_TYPE = 'emmaCuratedRail'
const TEAM_NOTEBOOK_TYPE = 'editorialTiles'
const TEAM_WAYFINDER_TYPE = 'wayfinderMosaic'
const MAX_TEAM_RAILS = 4

/** Fires trackHomeScrollDepth once per page view when the band first becomes
    ~25% visible. Returns a ref for the band's <section>. Client-only effect,
    SSR renders the band untouched. */
function useSectionSeen(section: 'meet-emma' | 'couples') {
  const ref = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          trackHomeScrollDepth(section)
          io.disconnect()
        }
      },
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [section])
  return ref
}

const MONO = { fontFamily: 'var(--font-mono)' } as const

/* No-image wayfinder tiles cycle these tints so an unfilled row still has
   rhythm instead of three grey plates. */
const TILE_TINTS = ['bg-coral-soft', 'bg-plum-soft', 'bg-paper-3'] as const
const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 400 } as const
const DISPLAY_MED = { fontFamily: 'var(--font-display)', fontWeight: 500 } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

/* The above-the-fold guided entry. All five pills go straight to a matching
   live collection — the redesign v2 spec caps /discover at exactly two links
   on the page (the Nº 05 mosaic promo tile and the Nº 09 closer band), so
   "Surprise me" points at the best-sellers collection instead of the old
   /discover?preset=surprise-me deep link. */
const MOOD_PILLS = [
  { label: 'Just curious', to: '/collections/first-time' },
  { label: 'Slow nights', to: '/collections/massage-mood' },
  { label: 'For two', to: '/collections/couples' },
  { label: 'Hands-free', to: '/collections/wearable-toys' },
  { label: 'Surprise me', to: '/collections/best-sellers' },
]

/* ── Section numeral motif — "Nº 0X" mono tag used on major bands/tiles. ──── */

function SectionNumeral({ n, className = '', tone = 'ink-4' }: { n: string; className?: string; tone?: string }) {
  return (
    <span
      className={`text-[11px] uppercase tracking-[0.18em] text-${tone} ${className}`}
      style={MONO}
      aria-hidden="true"
    >
      Nº {n}
    </span>
  )
}

/* ── Nº 01 · Hero (editorial split, coral-soft product frame) ─────────────
   Text column first on mobile, product still bleeds full-width below it (the
   LCP candidate — priority, fixed aspect, never wrapped in Reveal). Text
   column is one Reveal("up") group, above the fold, so it renders visible
   immediately. */

/** Voice-charter CTA whitelist. A Sanity-supplied hero CTA label must be one
 *  of these exactly or the hero falls back to the default label. */
const HERO_CTA_WHITELIST = ['Take a peek →', 'Show me', 'Find your fit →', "I'll take it ♥"]

/** Strip a whitelist label's trailing arrow so the arrow can render as its own
 *  aria-hidden glyph (the label text itself stays exactly as whitelisted). */
function ctaText(label: string): string {
  return label.endsWith('→') ? label.slice(0, -1).trimEnd() : label
}

/** Default target for the hero's secondary CTA. Deliberately NOT `/collections`:
 *  that index is ~170 unsorted tiles, the worst possible landing for a nervous
 *  first-time visitor, and it sat one click from the hero. */
const SECONDARY_CTA_FALLBACK_HREF = '/collections/best-sellers'

/** The label the Meet Emma band (Nº 04) renders. Shared with the hero's
 *  secondary-CTA guard so the two can never drift into showing the same words
 *  for the same destination, which is the defect that made the Meet Emma button
 *  and the Nº 09 closer read as one duplicated CTA. */
const MEET_EMMA_CTA_LABEL = 'Find your fit →'

function Hero({
  featured,
  emmaHero,
  trustBar,
}: {
  featured: DiscoveryProduct[]
  emmaHero?: EmmaHeroSettings | null
  trustBar?: TrustBarBlock | undefined
}) {
  const lead = featured[0]
  const peekHref = lead ? `/products/${lead.handle}` : '/collections/best-sellers'

  // Hero deep-linking: the team can point the primary CTA at a product page
  // via singleton.emmaHeroStorefront (primaryCtaLink / primaryCtaLabel).
  // Internal paths only; anything else (or unset) keeps today's behavior.
  const ctaLink = emmaHero?.primaryCtaLink
  const primaryHref = ctaLink?.startsWith('/') ? ctaLink : peekHref
  const ctaLabel = emmaHero?.primaryCtaLabel
  const primaryLabel =
    ctaLabel && HERO_CTA_WHITELIST.includes(ctaLabel) ? ctaLabel : 'Take a peek →'

  // Secondary (ghost) CTA — same two guards as the primary (internal paths only,
  // whitelist labels only), plus a third: the label may not collide with another
  // CTA already on the page. Content proposes, the shell validates, exactly as
  // HERO_CTA_WHITELIST already does for the primary.
  //
  // The link is honored as published. The LABEL is rejected when it duplicates
  // the primary's or the Meet Emma band's, because a page that renders the same
  // words twice for the same destination reads as one broken CTA rather than
  // two choices (docs/design-doctrine.md §6: never duplicate the primary's
  // label on the secondary).
  const secondaryLink = emmaHero?.secondaryCtaLink
  const secondaryHref = secondaryLink?.startsWith('/') ? secondaryLink : SECONDARY_CTA_FALLBACK_HREF
  const secondaryLabelRaw = emmaHero?.secondaryCtaLabel
  const secondaryLabel =
    secondaryLabelRaw
    && HERO_CTA_WHITELIST.includes(secondaryLabelRaw)
    && secondaryLabelRaw !== primaryLabel
    && secondaryLabelRaw !== MEET_EMMA_CTA_LABEL
      ? secondaryLabelRaw
      // Unset (or a rejected value): keep the original "never show the same
      // label twice" behavior.
      : primaryLabel.startsWith('Take a peek') ? 'Show me' : 'Take a peek →'

  // Team-managed `singleton.emmaHero` (Sanity) drives the text/config, field
  // by field, so a half-filled draft never blanks out a section — anything
  // missing falls back to the discovery-derived defaults below. The LCP
  // product image always stays derived from `featured[0]`, never the doc.
  //
  // Emma has no top billing in the hero (owner decision): the eyebrow is a
  // plain category label, not an Emma byline, and the hero drops the Emma
  // aside chip entirely. She still appears mid-page in MeetEmma() below.
  const eyebrow = emmaHero?.eyebrow || "This week's pick"

  return (
    <section className="bg-paper">
      {/* Tighter vertical rhythm at 375px so the product still enters the first
          viewport (design-critic finding: the mobile fold was all type). */}
      <div className="mx-auto grid max-w-[1320px] items-center gap-7 px-6 py-7 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] md:gap-16 md:px-16 md:py-16">
        {/* text column — single Reveal group, above the fold */}
        <Reveal variant="up" disabled className="min-w-0">
          <p className="mb-5 text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
            {eyebrow}
          </p>
          {emmaHero?.headline ? (
            <h1
              className="text-[2.7rem] leading-[1.04] tracking-[-0.015em] text-ink md:text-[4.4rem]"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 450 }}
            >
              {emmaHero.headline}
            </h1>
          ) : (
            <h1
              className="text-[2.7rem] leading-[1.04] tracking-[-0.015em] text-ink md:text-[4.4rem]"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 450 }}
            >
              Pleasure, worth getting <em className="em">right</em>.
            </h1>
          )}

          {emmaHero?.body ? (
            <p className="mt-5 max-w-[46ch] text-[16.5px] leading-relaxed text-ink-3 line-clamp-3 md:mt-6 md:line-clamp-none" style={BODY}>
              {emmaHero.body}
            </p>
          ) : (
            <p className="mt-5 max-w-[46ch] text-[16.5px] leading-relaxed text-ink-3 line-clamp-3 md:mt-6 md:line-clamp-none" style={BODY}>
              A short, checked selection instead of a wall of options. Start with the one below, or
              tell us what you're after.
            </p>
          )}

          {/* Pull quote yields its fold space to the product still on mobile. */}
          {emmaHero?.pullQuote && (
            <p className="mt-6 hidden text-[1.05rem] italic text-sage md:block" style={DISPLAY}>
              ♥ {emmaHero.pullQuote}
            </p>
          )}

          {/* CTAs — one primary coral, one clearly-secondary ghost */}
          <div className="mt-5 flex flex-wrap items-center gap-3 md:mt-7">
            <Link
              to={primaryHref}
              onClick={() => trackCtaClick('hero-primary', 'hero')}
              className="inline-flex items-center gap-2 rounded-full bg-coral px-6 py-3.5 text-[15px] font-medium text-white transition-transform hover:-translate-y-0.5"
              style={BODY}
            >
              {primaryLabel.endsWith('→') ? (
                <>
                  {ctaText(primaryLabel)} <span aria-hidden="true">→</span>
                </>
              ) : (
                primaryLabel
              )}
            </Link>
            <Link
              to={secondaryHref}
              onClick={() => trackCtaClick('hero-secondary', 'hero')}
              className="inline-flex items-center gap-2 rounded-full border border-line-2 px-5 py-3 text-[15px] font-medium text-ink transition-colors hover:border-ink-3"
              style={BODY}
            >
              {/* Never duplicate the primary's label (both are whitelist picks). */}
              {ctaText(secondaryLabel)} <span aria-hidden="true">→</span>
            </Link>
          </div>

          {/* guided prompt + horizontal mood pills */}
          <p className="mt-5 text-[14px] text-ink-3 md:mt-7" style={BODY}>
            Where do you want to start?
          </p>
          <div className="-mx-1 mt-3 flex gap-2.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {MOOD_PILLS.map(pill => (
              <Link
                key={pill.label}
                to={pill.to}
                onClick={() => trackCtaClick(`mood-pill:${pill.label}`, 'hero')}
                className="flex-none whitespace-nowrap rounded-full border border-line bg-paper px-[18px] py-2.5 text-[14px] text-ink transition-colors hover:bg-paper-2"
                style={BODY}
              >
                {pill.label}
              </Link>
            ))}
          </div>
        </Reveal>

        {/* product still — static LCP, never animated, coral-soft frame w/ inset vignette.
            The frame is wrapped in a Link to the SAME destination as the primary
            CTA: the biggest, most product-looking thing on the page was inert,
            and visitors were clicking it into nothing. `block` keeps the box
            model identical to the bare div it replaced, and the image markup is
            untouched (no Reveal, no opacity/transform wrapper) so the LCP
            candidate renders exactly as before with zero CLS. */}
        <div className="relative min-w-0">
          <Link
            to={primaryHref}
            onClick={() => trackCtaClick('hero-image', 'hero')}
            className="block"
          >
            <div
              className="relative aspect-[4/5] w-full overflow-hidden rounded-[var(--radius-lg)] border border-line bg-coral-soft"
              style={{ boxShadow: 'inset 0 -60px 90px rgba(26,20,24,0.07)' }}
            >
              <span
                className="absolute left-4 top-4 z-[1] rounded-full bg-paper/85 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-ink-3"
                style={MONO}
              >
                Nº 01, this week's pick
              </span>
              {lead?.imageUrl ? (
                <OptimizedImage
                  src={lead.imageUrl}
                  alt={lead.imageAlt ?? lead.title}
                  priority
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-5xl text-sage">♥</div>
              )}
            </div>
          </Link>
        </div>
      </div>

      {/* Nº 02 · Trust strip — raised into the hero band, inside the first viewport.
          Content-controlled: a published `trustBar` block wins, the array below
          is the fallback. */}
      <Reveal variant="fade" as="div" className="border-t border-line">
        <div className="mx-auto grid max-w-[1320px] grid-cols-2 gap-x-6 gap-y-3.5 px-6 py-[18px] md:grid-cols-5 md:items-start md:gap-x-8 md:px-16">
          {trustStripItems(trustBar).map(item => (
            <div key={item.headline} className="flex items-start gap-2.5 text-[13.5px] text-ink-3" style={BODY}>
              <span className="mt-px shrink-0 text-sage" aria-hidden="true">♥</span>
              <span>
                {item.headline}
                {item.subheadline && (
                  <span className="block text-[12px] text-ink-4">{item.subheadline}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  )
}

/**
 * Shell fallback for the Nº 02 trust strip, used when the team has published no
 * `trustBar` block.
 *
 * Per docs/design-doctrine.md §6, discretion copy names the dreaded moments
 * (the box, the label, the card statement) rather than stating a flat fact, so
 * "Billed as XDIPX" is now a promise about what a partner or a bank statement
 * will actually show. The free-shipping line is the verified Shopify delivery
 * profile threshold ($99 US; HI/AK/PR differs and is stated at checkout, not
 * promised here). No fabricated proof: every line is a mechanic we can honor.
 */
const TRUST_STRIP_FALLBACK: TrustStripItem[] = [
  { headline: 'Ships in plain packaging' },
  { headline: 'No logo on the box, no product name on the label' },
  { headline: 'Your statement reads XDIPX' },
  { headline: 'Free US shipping over $99' },
  { headline: 'Hand-checked, not auto-listed' },
]

interface TrustStripItem {
  headline: string
  subheadline?: string | undefined
}

/** Published trust items win; drop null/inactive refs, then fall back to the
 *  shell array when nothing usable survives (never render an empty strip). */
function trustStripItems(block?: TrustBarBlock | undefined): TrustStripItem[] {
  const published = (block?.trustItems ?? [])
    .filter(i => i != null && i.active !== false && !!i.headline)
    .map(i => ({ headline: i.headline, subheadline: i.subheadline }))
  return published.length > 0 ? published : TRUST_STRIP_FALLBACK
}

/* ── 3 · Meet Emma ─────────────────────────────────────────────────────────
   Who she is, in her own AI-guide voice (E-E-A-T + brand trust). */

/* ── Nº 03 · "A good place to start" — promoted primary grid ───────────────
   The single biggest structural change: the anchor product set moves up
   from the buried rail zone to a bright, static grid immediately after the
   trust strip, so the page opens with a wall of clickable product. Its source
   is the team's curated anchor collection (default best-sellers), falling back
   to the discovery best-of when that collection is empty or unreachable. */

/** Split a heading around the first occurrence of an emphasis word/phrase.
    Returns null when the emphasis is absent from the heading, so callers can
    render the heading plain instead of appending a stray, unspaced <em> to
    the end. Uses indexOf/slice (not split) so a heading containing the
    emphasis word more than once is never truncated -- only the first
    occurrence is wrapped, and everything after it (including any repeat)
    survives in `after`. */
export function emphasisParts(text: string, emphasis: string): { before: string; match: string; after: string } | null {
  const idx = text.indexOf(emphasis)
  if (idx === -1) return null
  return { before: text.slice(0, idx), match: emphasis, after: text.slice(idx + emphasis.length) }
}

/** Render a heading with a given word/phrase italicized in the plum emphasis
    style, matching the editorial headline treatment across the page. When
    `emphasis` is omitted, falls back to italicizing the last word. When
    `emphasis` is provided but not actually present in `text`, renders the
    heading plain -- no <em> is appended, so a mismatched Sanity emphasis
    field can never garble the published heading. */
function EmphasizedHeading({ text, emphasis }: { text: string; emphasis?: string }) {
  const trimmed = text.trim()
  if (emphasis) {
    const parts = emphasisParts(trimmed, emphasis)
    if (!parts) return <>{trimmed}</>
    return <>{parts.before}<em className="em">{parts.match}</em>{parts.after}</>
  }
  const trailing = trimmed.match(/[.?!]$/)?.[0] ?? ''
  const core = trailing ? trimmed.slice(0, -1) : trimmed
  const words = core.split(' ')
  if (words.length < 2) return <>{trimmed}</>
  const last = words.pop() as string
  return <>{words.join(' ')} <em className="em">{last}</em>{trailing}</>
}

/** Adapt a full Shopify product (team-rail fetch) to the lean grid-card shape.
    Only the fields StorefrontProductCard reads matter; the rest are inert. */
function shopifyToDiscovery(p: LeanCardProduct): DiscoveryProduct {
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    defaultVariantId: null,
    price: p.price,
    priceMax: null,
    // Shopify's compareAtPrice already encodes what we're allowed to strike
    // (MAP-restricted products have it unset upstream).
    compareAtPrice: p.compareAtPrice && p.compareAtPrice > p.price ? p.compareAtPrice : null,
    colorValues: [],
    sizeValues: [],
    imageUrl: p.images[0]?.url ?? null,
    imageAlt: p.images[0]?.altText ?? null,
    category: 'Pleasure',
    // brand now has its own field on DiscoveryProduct; no longer overloaded
    // into subcategory. The card renders brand as the mono eyebrow.
    subcategory: '',
    brand: p.brand ?? null,
    mood: [],
    audience: [],
    matters: [],
    totalInventory: null,
    productType: null,
    productTypeDial: null,
  }
}

/** Wrap a team `emmaCuratedRail` block's fetched products in the Rail shape
    the Nº 03 grid renders, so the day's slate gets grid density instead of a
    horizontal scroller. */
function teamRailToGridRail(products: LeanCardProduct[]): Rail {
  return {
    category: 'Pleasure',
    score: 0,
    total: products.length,
    items: products.map(p => ({ score: 0, product: shopifyToDiscovery(p) })),
  }
}

/**
 * Default eyebrow / heading for the Nº 03 anchor grid. Editorial-curation
 * framing, deliberately NOT a popularity or sales-volume claim: the band's
 * contents are a merchandised collection, not sales data (GA4 showed ~1
 * purchase in 90 days), so the old "What's working" / "Most picked, right now"
 * overstated proof the store cannot back (ticket #464, design-doctrine §6
 * "never fabricate proof"). Exported so a test can pin the no-proof-claim rule;
 * merchandising still overrides both via the team rail's own eyebrow/heading.
 */
export const ANCHOR_GRID_DEFAULT_EYEBROW = 'Worth a look'
export const ANCHOR_GRID_DEFAULT_HEADING = 'A good place to start, chosen with care.'
export const ANCHOR_GRID_DEFAULT_EMPHASIS = 'chosen with care'

function ProductGrid({
  rail,
  eyebrow = ANCHOR_GRID_DEFAULT_EYEBROW,
  heading,
  // No default destination. A See-all that points somewhere the section did
  // not actually rank sends visitors to a page with none of the products they
  // just saw (the /collections/best-sellers mismatch, ticket #441). When no
  // valid destination is configured the grid renders NO See-all rather than a
  // wrong one: a section with no exit is better than one that breaks its
  // promise. The real ranked destination is follow-up work (scopes 2-6).
  seeAllHref,
  seeAllLabel = 'See all →',
}: {
  rail: Rail
  eyebrow?: string
  heading?: string
  // `string | undefined` (not just `?`) so callers may pass an explicit
  // undefined destination under exactOptionalPropertyTypes; undefined means
  // "render no See-all", see the seeAllHref note above.
  seeAllHref?: string | undefined
  seeAllLabel?: string
}) {
  if (!rail.items.length) return null
  const items = rail.items.slice(0, 8)

  // GA4: See-all clicks fire select_promotion with native params so the Nº 03
  // funnel is readable end to end (view_item_list → select_promotion → …)
  // without a custom dimension. cta_click cannot serve this: its link_url
  // dimension ships empty, so a See-all click is indistinguishable from any
  // other CTA. `creativeSlot` is what separates the desktop header link from
  // the mobile below-grid link. This grid is the Nº 03 slot by construction
  // (see the hardcoded most-picked-grid list id below), so the promotion ids
  // are fixed here, matching that hardcoding.
  const fireSeeAllPromotion = (creativeSlot: 'header' | 'below-grid') =>
    trackSelectPromotion({
      promotionId: 'most-picked-see-all',
      promotionName: 'Most picked, right now',
      creativeSlot,
      locationId: 'home-no3',
    })

  // GA4: fire view_item_list once per page view when the grid renders.
  const firedView = useRef(false)
  useEffect(() => {
    if (firedView.current || !items.length) return
    firedView.current = true
    trackViewItemList('most-picked-grid', 'most-picked-grid', items.map((it, i) =>
      toGA4Item(it.product, i, 'most-picked-grid', 'most-picked-grid'),
    ))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="bg-paper py-16 md:py-20">
      <div className="mx-auto max-w-[1320px] px-6 md:px-16">
        <Reveal variant="up" className="mb-9 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
              {eyebrow}
            </p>
            <h2 className="text-[1.9rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.9rem]" style={DISPLAY}>
              {heading
                ? <EmphasizedHeading text={heading} />
                : <EmphasizedHeading text={ANCHOR_GRID_DEFAULT_HEADING} emphasis={ANCHOR_GRID_DEFAULT_EMPHASIS} />}
            </h2>
          </div>
          {seeAllHref && (
            <Link
              to={seeAllHref}
              onClick={() => fireSeeAllPromotion('header')}
              className="hidden text-[15px] font-medium text-ink link-coral md:inline-block"
              style={BODY}
            >
              {seeAllLabel}
            </Link>
          )}
        </Reveal>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5">
          {items.map((it, i) => (
            <Reveal key={it.product.id} variant="up" index={i}>
              {/* No `priority` on any grid card. This grid always renders below
                  the Hero and trust strip, so its first image is never the LCP
                  (the Hero's featured[0] image is, and it is the only image the
                  page should fetchpriority=high). Marking the grid's first card
                  priority was harmless only while the grid was sourced from the
                  discovery best-of, because gridRail[0] was then the SAME
                  product as featured[0] and the browser deduped the two eager
                  fetches into one. Once Nº 03 began sourcing a separate curated
                  collection (ticket #464), the grid's first image became a
                  DIFFERENT URL, so an eager fetchpriority=high card started
                  racing the Hero LCP image for the mobile connection and pushed
                  median LCP onto the 5500ms budget line (ticket #603). Lazy is
                  correct here: the wall sits at/just below the fold. */}
              <StorefrontProductCard
                product={it.product}
                fluid
                onSelect={() => trackSelectItem(
                  'most-picked-grid', 'most-picked-grid',
                  toGA4Item(it.product, i, 'most-picked-grid', 'most-picked-grid'), i,
                )}
              />
            </Reveal>
          ))}
        </div>

        {seeAllHref && (
          <Link
            to={seeAllHref}
            onClick={() => fireSeeAllPromotion('below-grid')}
            className="mt-7 inline-block text-[15px] font-medium text-ink link-coral md:hidden"
            style={BODY}
          >
            {seeAllLabel}
          </Link>
        )}
      </div>
    </section>
  )
}

/* ── Nº 04 · Meet Emma ──────────────────────────────────────────────────────
   Who she is, in her own AI-guide voice (E-E-A-T + brand trust). The
   headline is set as an oversized pull-quote — typographic art, not caption
   text — with a large coral opening ♥ as a display mark. */

function MeetEmma({ photoUrl, photoAlt }: { photoUrl?: string | null; photoAlt?: string | null } = {}) {
  const seenRef = useSectionSeen('meet-emma')
  // Canonical photorealistic portrait from Sanity (`singleton.editor.photo`),
  // the same asset `/about` uses. `/emma.webp` (the Compass-era illustration)
  // stays only as the Sanity-outage/cold-leg fallback. OptimizedImage handles
  // the Sanity CDN srcset when src is a Sanity URL and a plain <img> for the
  // bundled fallback.
  const src = photoUrl || '/emma.webp'
  const alt = photoAlt || 'Emma, the editorial AI guide for xdipx'
  return (
    <section id="meet-emma" ref={seenRef} className="bg-paper-2 py-16 md:py-20">
        {/* Owner direction 2026-07-30: the portrait is demoted from a co-equal
            420px column to a byline plate, because doctrine §2 already declares
            the words are the art in this band ("pull-quotes are typographic
            art, not caption text") and the old proportion contradicted that.
            `minmax(0,1fr)` on the copy track is load-bearing: a bare `1fr` lets
            long unbreakable display type blow past the container. */}
        <div className="mx-auto max-w-[1320px] px-6 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:items-start md:gap-x-10 md:px-16 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-x-16">
          {/* Numeral + kicker span both tracks, so the small portrait reads as
              deliberate rather than shrunken and its top edge keys to the
              pull-quote's cap line. */}
          <Reveal variant="up" className="mb-6 md:col-span-2 md:mb-9">
            <SectionNumeral n="04" className="mb-3 block" />
            <p className="text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
              Meet Emma
            </p>
          </Reveal>
          {/* `fade`, not `scale`: doctrine §5 scopes scale to hero-adjacent
              plates, and a 3% scale on a 128px box is sub-pixel theatre. The
              ring holds at ~2% of rendered width at every breakpoint, because a
              fixed 6px mat turns into a chunky avatar border as the plate
              shrinks. Radius steps down to the chip token on mobile for the
              same reason: 22px on a 128px plate reads halfway to a circle. */}
          <Reveal variant="fade" index={2} className="mb-6 w-[128px] md:mb-0 md:w-full">
            <div className="aspect-[4/5] w-full overflow-hidden rounded-[var(--radius-sm)] bg-paper-3 ring-2 ring-sage/20 md:rounded-[var(--radius-lg)] md:ring-4 md:ring-sage/15">
              <OptimizedImage
                src={src}
                alt={alt}
                widths={[128, 256, 288, 400, 520]}
                fallbackWidth={288}
                sizes="(min-width: 1024px) 260px, (min-width: 768px) 200px, 128px"
                className="h-full w-full object-cover"
              />
            </div>
          </Reveal>
          <Reveal variant="up" index={1} className="min-w-0">
            {/* Promoted from <p> to <h2>: every other major band on this page
                carries a real h2, and with the portrait demoted this line is
                both the band's typographic art and its keyword surface. The
                28ch cap keeps it a three-line stack instead of flattening into
                a banner across the 868px copy track at 1320+. */}
            <h2
              className="text-[1.9rem] leading-[1.16] tracking-[-0.01em] text-ink md:max-w-[28ch] md:text-[2.7rem] lg:text-[2.9rem]"
              style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 450 }}
            >
              <span className="mr-1 not-italic text-coral" aria-hidden="true">♥</span>
              I'm here to help you find what's actually <em className="em">right</em> for you,
              whatever that looks like.
            </h2>
            <p className="mt-6 max-w-[48ch] text-[16.5px] leading-relaxed text-ink-3" style={BODY}>
              Tell me a little about what you want, and I'll match it against the specs and the
              reviews. No wrong answers, just a little help finding your fit.
            </p>
            {/* Goes straight to /discover. It used to anchor-scroll to the Nº 09
                band, whose own button carried the SAME "Find your fit →" label
                and only then went to /discover: two clicks and two identical
                labels for one destination. The two buttons now carry different
                whitelist labels (this one "Find your fit →", the closer "Show
                me") so the page never shows the same CTA twice. */}
            <Link
              to="/discover"
              onClick={() => trackCtaClick('find-your-fit', 'meet-emma')}
              className="mt-7 inline-flex items-center gap-2 rounded-full border border-line-2 px-5 py-3 text-[15px] font-medium text-ink transition-colors hover:border-ink-3"
              style={BODY}
            >
              {ctaText(MEET_EMMA_CTA_LABEL)} <span aria-hidden="true">→</span>
            </Link>
          </Reveal>
        </div>
    </section>
  )
}

/* ── 4 · Find your way in (category mosaic) ────────────────────────────────
   Three category tiles + a larger plum-soft "Discover You" guided-finder tile.
   Replaces the retired "Vault" with "Discover You". */

const MOSAIC_TILES = [
  { label: 'New here?', to: '/collections/first-time' },
  { label: 'For two', to: '/collections/couples' },
  { label: 'Best sellers', to: '/collections/best-sellers' },
]

interface WayfinderTileNormalized {
  _key: string
  label: string
  link: string
  emmaAside?: string
  image?: { url?: string; alt?: string }
}

function FindYourWayIn({ block }: { block?: WayfinderMosaicBlock | undefined } = {}) {
  const tiles: WayfinderTileNormalized[] = block?.wayfinderTiles?.length
    ? block.wayfinderTiles
    : MOSAIC_TILES.map(t => ({ _key: t.label, label: t.label, link: t.to }))

  const eyebrow = block?.eyebrow || 'Where to begin'
  const heading = block?.heading || 'Find your way in.'
  const emphasis = block?.emphasis || 'way'

  const promo = block?.promo
  const promoEyebrow = promo?.eyebrow || 'Discover You'
  const promoHeading = promo?.heading || 'Not sure where you land? Discover You.'
  const promoEmphasis = promo?.emphasis || 'Discover'
  const promoBody = promo?.body
    || "Answer a few quiet questions and Emma narrows it down to a few that fit."
  const promoCtaLabel = promo?.ctaLabel || 'Find your fit →'
  // The mosaic promo slot is the one tile the mission brief allows to keep
  // /discover. This fallback only renders when no wayfinderMosaic block is
  // published; once the team publishes, ctaLink is content-controlled.
  const promoCtaLink = promo?.ctaLink || '/discover'

  return (
    <section className="bg-paper py-16 md:py-20">
        <div className="mx-auto max-w-[1320px] px-6 md:px-16">
          <Reveal variant="up">
            <SectionNumeral n="05" className="mb-3 block" />
            <p className="mb-3.5 text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
              {eyebrow}
            </p>
            <h2
              className="mb-9 text-[1.9rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.9rem]"
              style={DISPLAY}
            >
              <EmphasizedHeading text={heading} emphasis={emphasis} />
            </h2>
          </Reveal>

          {/* Split "editorial caption card": the image field never carries type,
              the label sits on solid paper-2, so legibility no longer depends on
              whatever photo the team publishes (owner rejection of the old
              text-over-packshot overlay, homepage-designer spec 2026-07-20). */}
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {tiles.map((t, i) => {
              const hasImage = !!t.image?.url
              return (
                <Reveal key={t._key} variant="up" index={i}>
                  <Link
                    to={t.link}
                    onClick={() => trackCtaClick(`wayfinder:${t.label}`, 'mosaic')}
                    className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-paper-2 transition-transform duration-[var(--duration-base)] hover:-translate-y-0.5"
                  >
                    {/* Zone 1 — image field. Fixed aspect = zero CLS; no text ever lands here. */}
                    <div className={`relative aspect-[4/3] w-full overflow-hidden ${hasImage ? 'bg-paper-3' : TILE_TINTS[i % TILE_TINTS.length]}`}>
                      {hasImage ? (
                        <OptimizedImage
                          src={t.image!.url!}
                          alt={t.image!.alt ?? t.label}
                          sizes="(max-width: 768px) 100vw, 33vw"
                          className="absolute inset-0 h-full w-full object-cover transition-transform duration-[var(--duration-slow)] group-hover:scale-[1.03]"
                        />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-[2rem] text-sage/50" aria-hidden="true">♥</span>
                      )}
                    </div>

                    {/* Zone 2 — solid caption ground; contrast guaranteed on paper-2. */}
                    <div className="flex flex-1 flex-col p-5">
                      <span className="text-[1.5rem] leading-[1.15] text-ink" style={DISPLAY_MED}>
                        {t.label}
                      </span>
                      {t.emmaAside && (
                        <p className="mt-1.5 text-[13.5px] italic leading-snug text-ink-3" style={DISPLAY}>
                          <span className="not-italic text-sage">♥</span> {t.emmaAside}
                        </p>
                      )}
                      <span
                        className="mt-auto inline-flex items-center gap-1 pt-4 text-[11px] uppercase tracking-[0.18em] text-ink-4 transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5"
                        style={MONO}
                      >
                        Take a peek <span aria-hidden="true">→</span>
                      </span>
                    </div>
                  </Link>
                </Reveal>
              )
            })}
          </div>

          {/* Discover You — larger plum-soft tile (or promo.image when set) */}
          <Reveal variant="scale">
            <Link
              to={promoCtaLink}
              onClick={() => trackCtaClick('find-your-fit', 'mosaic-promo')}
              className="relative flex flex-wrap items-center justify-between gap-5 overflow-hidden rounded-[var(--radius-lg)] bg-plum-soft p-7 transition-transform hover:-translate-y-0.5 md:p-11"
            >
              {promo?.image?.url && (
                <OptimizedImage
                  src={promo.image.url}
                  alt={promo.image.alt ?? promoHeading}
                  sizes="100vw"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )}
              <div className="relative z-[1] flex-1 basis-[320px]">
                <p className="mb-3.5 text-[11px] uppercase tracking-[0.18em] text-plum" style={MONO}>
                  {promoEyebrow}
                </p>
                <h3 className="mb-3 text-[1.7rem] leading-[1.1] text-ink md:text-[2.5rem]" style={DISPLAY}>
                  <EmphasizedHeading text={promoHeading} emphasis={promoEmphasis} />
                </h3>
                <p className="max-w-[46ch] text-[16px] leading-relaxed text-ink-3" style={BODY}>
                  {promoBody}
                </p>
              </div>
              <span
                className="relative z-[1] whitespace-nowrap rounded-full bg-coral px-6 py-3.5 text-[15px] font-medium text-white"
                style={BODY}
              >
                {promoCtaLabel}
              </span>
            </Link>
          </Reveal>
        </div>
    </section>
  )
}

/* ── 5 · Rotating rails (the team's experiment surface) ────────────────────
   Always-on "Best sellers" anchor + an "Emma's edit" curated rail. The daily
   merchandiser reorders/swaps these as content; the shell stays fixed. */

/** Maps a DiscoveryProduct into the GA4 item shape shared with the PDP's add_to_cart call. */
function toGA4Item(product: DiscoveryProduct, index: number, listId: string, listName: string): GA4Item {
  return {
    item_id: product.id,
    item_name: product.title,
    item_category: product.category,
    price: product.price,
    index,
    item_list_id: listId,
    item_list_name: listName,
  }
}

/* ── Nº 06 · Emma's edit — curated rail, kept as a horizontal scroller ─────
   Contrast with the Nº 03 grid gives the page rhythm; two identical grids
   would be monotone. The whole rail block gets one Reveal("fade") — no
   per-card reveal inside a horizontal scroller. */

function Rail({
  eyebrow,
  heading,
  emphasis,
  rail,
  listKey,
  leadPriority,
  aside,
}: {
  eyebrow: string
  heading: string
  emphasis: string
  rail: Rail
  /** Stable rail key for GA4 item_list_id/item_list_name (e.g. "bestsellers", "emmas-edit"). */
  listKey: string
  leadPriority?: boolean
  aside?: string
}) {
  // Fire view_item_list once per rail per page view, when the rail's products render.
  const firedView = useRef(false)
  useEffect(() => {
    if (firedView.current || !rail.items.length) return
    firedView.current = true
    trackViewItemList(
      listKey,
      listKey,
      rail.items.slice(0, 10).map((it, i) => toGA4Item(it.product, i, listKey, listKey)),
    )
  }, [rail.items, listKey])

  if (!rail.items.length) return null
  return (
    <Reveal variant="fade" className="py-2">
      <div className="mb-3 px-6 md:px-16">
        <SectionNumeral n="06" className="mb-3 block" />
        <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
          {eyebrow}
        </p>
        <h2 className="text-[1.8rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.7rem]" style={DISPLAY}>
          {heading} <em className="em">{emphasis}</em>
        </h2>
      </div>
      <div className="flex snap-x gap-[18px] overflow-x-auto px-6 pb-3.5 [scrollbar-width:none] md:px-16 [&::-webkit-scrollbar]:hidden">
        {rail.items.slice(0, 10).map((it, i) => (
          <div key={it.product.id} className="w-[220px] shrink-0 snap-start">
            <StorefrontProductCard
              product={it.product}
              priority={!!leadPriority && i === 0}
              onSelect={() => trackSelectItem(listKey, listKey, toGA4Item(it.product, i, listKey, listKey), i)}
            />
          </div>
        ))}
      </div>
      {aside && (
        <p className="px-6 pt-3 text-[1.05rem] italic text-sage md:px-16" style={DISPLAY}>
          ♥ {aside}
        </p>
      )}
    </Reveal>
  )
}

/** Emma's edit — the second populated rail (falls back to the first if only
 *  one rail has products). The best-of anchor rail (rails[0]) is promoted to
 *  the Nº 03 static grid above, so this section only needs the "second"
 *  curated set to avoid rendering the same products twice in a row. */
function EmmasEdit({ rails }: { rails: Rail[] }) {
  const populated = rails.filter(r => r.items.length > 0)
  if (!populated.length) return null
  const edit = populated[1] ?? populated[0]!
  return (
    <section id="emmas-edit" className="bg-paper-2 py-16 md:py-20">
      <Rail
        eyebrow="Emma's edit"
        heading="Chosen for how they"
        emphasis="feel."
        rail={edit}
        listKey="emmas-edit"
        aside="Picked for pacing and material, not just power. A calm place to start."
      />
    </section>
  )
}

/* ── Social proof ───────────────────────────────────────────────────────────
   Intentionally NOT rendered: the store is pre-launch and has no real customer
   reviews yet. We do not ship invented testimonials (brand voice + FTC
   endorsement rules). Re-add a real social-proof section once orders generate
   genuine reviews — wire the Sanity `testimonials` block (Routine B) so the
   team can publish real quotes without a deploy. */

/* ── Nº 08 · Couples — photographic band + rail ────────────────────────────
   Today's flat coral-soft box earns no clicks. Rebuilt as a full-bleed
   photographic banner (image + ink scrim + white label + CTA) with a couples
   product rail beneath it. Falls back to the flat banner alone when no
   couples-tagged rail is available (graceful degrade — never blank). */

function PhotoBand({
  block,
  fallbackHref = '/collections/couples',
}: {
  block?: PlayTogetherBannerBlock | undefined
  fallbackHref?: string
}) {
  const heading = block?.heading || 'Better together.'
  const emphasis = 'together'
  const body = block?.body
    || 'A few things designed for shared control, made for playing together rather than solo.'
  const ctaLabel = block?.ctaLabel && HERO_CTA_WHITELIST.includes(block.ctaLabel) ? block.ctaLabel : 'Show me'
  const ctaLink = block?.ctaLink || fallbackHref
  const hasImage = !!block?.image?.url

  return (
    <Reveal variant="scale">
      <Link
        to={ctaLink}
        className="relative flex min-h-[360px] flex-wrap items-end justify-between gap-5 overflow-hidden rounded-[var(--radius-lg)] bg-coral-soft p-8 transition-transform hover:-translate-y-0.5 md:p-14"
      >
        {hasImage && (
          <>
            <OptimizedImage
              src={block!.image!.url!}
              alt={block!.image!.alt ?? heading}
              sizes="100vw"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(to top, rgba(26,20,24,0.72), rgba(26,20,24,0.05) 55%)' }}
              aria-hidden="true"
            />
          </>
        )}
        <div className="relative z-[1] flex-1 basis-[320px]">
          <p
            className="mb-3.5 text-[11px] uppercase tracking-[0.18em]"
            style={{ ...MONO, color: hasImage ? 'white' : 'var(--color-ink-3)' }}
          >
            For two
          </p>
          <h2
            className="text-[2.1rem] leading-[1.05] tracking-[-0.01em] md:text-[3.2rem]"
            style={{ ...DISPLAY, color: hasImage ? 'white' : 'var(--color-ink)' }}
          >
            <EmphasizedHeading text={heading} emphasis={emphasis} />
          </h2>
          {hasImage && (
            <p className="mt-3 max-w-[42ch] text-[15px] leading-relaxed text-white/85" style={BODY}>
              {body}
            </p>
          )}
        </div>
        <span
          className="relative z-[1] inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-coral px-6 py-3.5 text-[15px] font-medium text-white transition-transform hover:-translate-y-0.5"
          style={BODY}
        >
          {ctaLabel} <span aria-hidden="true">→</span>
        </span>
      </Link>
    </Reveal>
  )
}

function Couples({
  block,
  rail,
}: {
  block?: PlayTogetherBannerBlock | undefined
  rail?: Rail | undefined
}) {
  const seenRef = useSectionSeen('couples')
  return (
    <section ref={seenRef} className="bg-paper-3 py-16 md:py-20">
        <div className="mx-auto max-w-[1320px] px-6 md:px-16">
          <PhotoBand block={block} />
        </div>
        {rail && rail.items.length > 0 && (
          <Reveal variant="fade" className="mt-8">
            <div className="mb-3 px-6 md:px-16">
              <p className="text-[1.05rem] italic text-sage" style={DISPLAY}>
                ♥ A few more, chosen for sharing.
              </p>
            </div>
            <div className="flex snap-x gap-[18px] overflow-x-auto px-6 pb-3.5 [scrollbar-width:none] md:px-16 [&::-webkit-scrollbar]:hidden">
              {rail.items.slice(0, 10).map((it, i) => (
                <div key={it.product.id} className="w-[220px] shrink-0 snap-start">
                  <StorefrontProductCard
                    product={it.product}
                    onSelect={() => trackSelectItem('couples', 'couples', toGA4Item(it.product, i, 'couples', 'couples'), i)}
                  />
                </div>
              ))}
            </div>
          </Reveal>
        )}
    </section>
  )
}

/* ── Nº 09 · "Still deciding?" dark band — the Compass closer → /discover ─── */

function StillDecidingBand() {
  return (
    <section id="discover" className="bg-ink text-paper">
        <Reveal variant="up" className="mx-auto max-w-[1320px] px-6 py-20 text-center md:px-16 md:py-32">
          <p className="mb-6 text-[11px] uppercase tracking-[0.18em] text-coral" style={MONO}>
            Still deciding?
          </p>
          <h2
            className="mx-auto mb-9 max-w-[20ch] text-[2.1rem] leading-[1.12] tracking-[-0.01em] text-paper md:text-[3.6rem]"
            style={DISPLAY}
          >
            Tell me what you're into, or what you're{' '}
            <em className="not-italic" style={{ fontStyle: 'italic', color: 'var(--color-coral-2)' }}>
              curious
            </em>{' '}
            about. Same thing.
          </h2>
          {/* "Show me", not "Find your fit →": the Meet Emma band above now
              links straight to /discover with that label, and the page must not
              render the same CTA label twice. Both are whitelist phrases. */}
          <Link
            to="/discover"
            onClick={() => trackCtaClick('show-me', 'still-deciding')}
            className="inline-flex items-center gap-2 rounded-full bg-coral px-7 py-4 text-[15px] font-medium text-white transition-transform hover:-translate-y-0.5"
            style={BODY}
          >
            Show me <span aria-hidden="true">→</span>
          </Link>
        </Reveal>
    </section>
  )
}

/* ── Nº 11 · FAQ (+ FAQPage JSON-LD for AEO) ───────────────────────────────── */

const FAQS = [
  {
    question: 'What is xdipx?',
    answer:
      'An editorially curated intimate wellness shop. We choose a small, vetted selection and help you find what fits, instead of listing everything and hoping you sort it out.',
  },
  {
    question: 'How discreet is shipping?',
    answer:
      'Everything ships in plain, unbranded packaging. No logos and no product names on the box or the label. Your statement reads XDIPX, nothing else.',
  },
  {
    question: 'Who is Emma?',
    answer:
      "Emma is xdipx's AI guide. She knows the catalog and the reviews cold and helps you find what fits. She is not a customer, and she has nothing to push.",
  },
  {
    question: 'What payment methods do you take?',
    answer:
      'All major cards, plus Apple Pay and Google Pay. However you pay, every charge appears as XDIPX.',
  },
]

/**
 * Homepage "From the Notebook" fallback — the branded section chrome around the
 * shared NotebookRail, shown when the team has not published a curated
 * `editorialTiles` block. Renders nothing when there are no posts.
 */
function HomeNotebookRail({ posts }: { posts: BlogPostCard[] }) {
  if (!posts.length) return null
  return (
    <section className="bg-paper py-16 md:py-20">
      <div className="mx-auto max-w-[1200px] px-6 md:px-16">
        <SectionNumeral n="10" className="mb-3 block" />
        {/* The Notebook is ~21% of sessions with ~20 minutes of dwell and sold
            nothing: no way deeper into the archive, no way across to a product.
            It now shows six posts, a real see-all link, and a product chip on
            any post that embeds one. No urgency, just an open door. */}
        <NotebookRail
          posts={posts}
          heading="From the Notebook"
          className=""
          seeAllHref="/notebook"
          seeAllLabel="More from the Notebook →"
          showProductChips
        />
      </div>
    </section>
  )
}

function FAQ({ block }: { block?: HomepageFaqBlock | undefined } = {}) {
  // A published `homepageFaq` block wins; the hardcoded array is the fallback.
  // FAQStructuredData is handed the SAME array that renders below, so the
  // JSON-LD can never advertise questions the page does not show.
  const published = (block?.faqItems ?? []).filter(f => f?.question && f?.answer)
  const faqs = published.length > 0 ? published : FAQS
  const heading = block?.heading?.trim()

  return (
    <section className="bg-paper-2 py-16 md:py-20">
      <FAQStructuredData faqs={faqs} />
        <Reveal variant="up" className="mx-auto max-w-[820px] px-6 md:px-16">
          <SectionNumeral n="11" className="mb-3 block" />
          <h2
            className="mb-9 text-[1.9rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.9rem]"
            style={DISPLAY}
          >
            {heading
              ? <EmphasizedHeading text={heading} />
              : <>Questions, <em className="em">answered</em>.</>}
          </h2>
          {faqs.map((f, i) => (
            <details
              key={f.question}
              className={`group border-t border-line ${i === faqs.length - 1 ? 'border-b' : ''}`}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-6 text-[1.3rem] text-ink [&::-webkit-details-marker]:hidden" style={DISPLAY}>
                {f.question}
                <span className="text-2xl leading-none text-ink-4 transition-transform group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="max-w-[60ch] pb-6 text-[16px] leading-relaxed text-ink-3" style={BODY}>
                {f.answer}
              </p>
            </details>
          ))}
        </Reveal>
    </section>
  )
}

/* ── Composition ───────────────────────────────────────────────────────────
   The team's Sanity blocks (rails, wayfinder, Notebook override, couples band)
   arrive already resolved on `contentBlocks` and render inline. They used to
   stream in as a deferred promise behind <Suspense>/<Await>, which never
   survived the storefront's edge cache, so every slot rendered its fallback
   forever (see storefront-home.server.ts). Each slot still degrades to the same
   shell fallback when the team has published nothing or the upstream failed —
   `contentBlocks` is then simply the empty payload.

   Band order lives in DEFAULT_BAND_ORDER rather than in the JSX, so the page can
   later render a Sanity-supplied order without the composition being rewritten.
   The hero stays first in every arrangement: it carries the H1 and the LCP
   image, and moving it would move the largest paint element. */

/** Every separately-orderable band of the storefront shell.
 *
 *  The trust strip and the mood pills are deliberately absent: both render
 *  inside the hero band rather than as siblings of it, so they are the hero's
 *  content, not their own slot. */
export const BAND_NAMES = [
  'hero',
  'anchorGrid',
  'teamRails',
  'meetEmma',
  'wayfinder',
  'emmasEdit',
  'sensationMap',
  'couples',
  'stillDeciding',
  'notebook',
  'faq',
  'emailCapture',
] as const

export type BandName = (typeof BAND_NAMES)[number]

/** The shipped order. Rendered when Sanity supplies no layout, which is also
 *  what makes an unpublished layout document a safe no-op. */
export const DEFAULT_BAND_ORDER: BandName[] = [
  'hero',
  'anchorGrid',
  'teamRails',
  'meetEmma',
  'wayfinder',
  'emmasEdit',
  'sensationMap',
  'couples',
  'stillDeciding',
  'notebook',
  'faq',
  'emailCapture',
]

const KNOWN_BAND = new Set<string>(BAND_NAMES)

/** A renderable slot: a shell band, or the panel deck placed by the layout. */
export type HomeSlot = BandName | 'panelDeck'

/**
 * Turn a published layout into the slot order to render.
 *
 * The rules are all about never letting a content edit break the page: the
 * hero always leads (it owns the H1 and the LCP image, and nothing — not even
 * the deck — may sit above the largest paint element), a slot may appear at
 * most once, and anything this deploy does not recognise is dropped rather
 * than trusted. A layout that survives none of that is treated as no layout
 * at all, which renders the shipped order.
 *
 * The deck only OCCUPIES a slot here; whether it has anything to show is the
 * payload's business (`panelDeck` null renders nothing in that slot).
 *
 * `opts.anchorReplaced` is true when a live team rail has explicitly claimed the
 * anchor slot (`replacesAnchor`). Only then may a layout drop the `anchorGrid`
 * band; otherwise the band is forced back in (see the anchor guard below).
 */
export function resolveBandOrder(
  layout?: { sections: { _type: string; band?: string; enabled?: boolean }[] } | null,
  opts?: { anchorReplaced?: boolean },
): HomeSlot[] {
  const anchorReplaced = opts?.anchorReplaced === true

  const order: HomeSlot[] = (() => {
    if (!layout?.sections?.length) return DEFAULT_BAND_ORDER

    const seen = new Set<string>()
    const ordered: HomeSlot[] = []
    for (const section of layout.sections) {
      if (section.enabled === false) continue
      if (section._type === 'panelDeckSection') {
        if (!seen.has('panelDeck')) {
          seen.add('panelDeck')
          ordered.push('panelDeck')
        }
        continue
      }
      if (section._type !== 'homeBand') continue
      const band = section.band
      if (!band || !KNOWN_BAND.has(band) || seen.has(band)) continue
      seen.add(band)
      ordered.push(band as BandName)
    }

    // A layout with no usable band renders the shipped order — a deck marker
    // alone is not a homepage.
    if (!ordered.some(slot => slot !== 'panelDeck')) return DEFAULT_BAND_ORDER

    // The hero is not reorderable. A layout that omits or demotes it would move
    // the largest paint element, so it is put back at the front rather than
    // honoured, and the page keeps its LCP guarantee whatever Sanity says.
    return ordered[0] === 'hero' ? ordered : ['hero', ...ordered.filter(b => b !== 'hero')]
  })()

  // Anchor guard, mirroring the hero-first guard. `anchorGrid` is the page's
  // bestseller wall. A bad layout publish (band disabled or dropped) or a rail
  // retirement must not silently delete it: unless a live rail has explicitly
  // taken the slot (`anchorReplaced`), the band is put back right after the
  // hero — its shipped position — rather than honouring its removal. The
  // DEFAULT order already carries it, so this only re-adds it when a layout
  // stripped it. The band itself renders null when it has nothing to show, so
  // forcing the slot back is safe even during a cold-KV outage.
  if (!anchorReplaced && !order.includes('anchorGrid')) {
    const at = order.indexOf('hero') + 1 // 0 when there is no hero (indexOf -1)
    return [...order.slice(0, at), 'anchorGrid', ...order.slice(at)]
  }
  return order
}

export function StorefrontHome({ featured, rails, anchorProducts, contentBlocks, emmaHero, emmaPhotoUrl, emmaPhotoAlt, notebookPosts, sensationMap, layout, panelDeck }: StorefrontData) {
  // Segment variant-b sessions in GA4 (flip keep/rollback analysis). Fires once
  // per page view; the localStorage flag distinguishes first-time visitors.
  useEffect(() => {
    let hadPriorSession = false
    try {
      hadPriorSession = localStorage.getItem('xdipx_home_seen') === '1'
      localStorage.setItem('xdipx_home_seen', '1')
    } catch {
      // Private mode / storage denied — report as a fresh session.
    }
    trackHomeVariantView({ variant: 'b', hadPriorSession })
  }, [])

  // Nº 03 grid + Nº 06 rail cold-start fallback — the discovery "best of" set
  // sourced straight from the loader payload's `rails[]` (no new Shopify
  // calls). rails[0] promotes to the bright static grid; rails[1] (or the
  // same rail again when there's only one populated) stays the calm scroller
  // so the two sections never render an identical product set back to back.
  const populatedRails = rails.filter(r => r.items.length > 0)
  // Nº 03 anchor grid source. The team's curated collection (default
  // best-sellers, resolved at build time into `anchorProducts`) is the primary
  // source so the page's most prominent wall is a merchandised selection tied
  // to the day, not the raw discovery ranking with a "most picked" claim behind
  // it (ticket #464). The discovery best-of (`rails[0]`) is the cold-start /
  // empty-collection fallback, i.e. the prior behaviour.
  const collectionAnchorRail = anchorProducts.length > 0
    ? teamRailToGridRail(anchorProducts)
    : undefined
  const gridRail = collectionAnchorRail ?? populatedRails[0]
  // slice(1) with no "or the same rail again" fallback: the old expression fed
  // rails[0] to BOTH the Nº 03 grid and the Nº 06 scroller whenever only one
  // rail was populated, printing the identical product set twice on one page.
  const editRails = populatedRails.slice(1)

  // Team-published Sanity surfaces, already resolved by the loader. An empty
  // payload (nothing published, or a degraded upstream) leaves every lookup
  // below undefined/empty, which is what selects the shell fallbacks.
  const { sections: teamSections, carouselProductMap } = contentBlocks
  const teamRails = teamSections
    .filter(b => b._type === TEAM_RAIL_TYPE)
    .slice(0, MAX_TEAM_RAILS) as EmmaCuratedRailBlock[]
  const firstTeamRail = teamRails[0]
  const restTeamRails = teamRails.slice(1)
  const firstTeamRailProducts = firstTeamRail ? carouselProductMap[firstTeamRail._key] ?? [] : []
  const wayfinderBlock = teamSections.find(b => b._type === TEAM_WAYFINDER_TYPE) as
    | WayfinderMosaicBlock
    | undefined
  const couplesBlock = teamSections.find(b => b._type === 'playTogetherBanner') as
    | PlayTogetherBannerBlock
    | undefined
  // The couples band has always accepted a `rail` prop and nothing ever passed
  // one, so the "chosen for sharing" strip was dead code. The band's own
  // `productHandles` are now resolved into carouselProductMap by the payload
  // builder, keyed by the block's _key like any rail.
  const couplesRailProducts = couplesBlock ? carouselProductMap[couplesBlock._key] ?? [] : []
  const couplesRail = couplesRailProducts.length > 0
    ? teamRailToGridRail(couplesRailProducts)
    : undefined
  const trustBarBlock = teamSections.find(b => b._type === 'trustBar') as
    | TrustBarBlock
    | undefined
  const faqBlock = teamSections.find(b => b._type === 'homepageFaq') as
    | HomepageFaqBlock
    | undefined
  const notebookBlocks = teamSections.filter(b => b._type === TEAM_NOTEBOOK_TYPE)

  // ── Nº 03 anchor grid vs the first team rail ────────────────────────────
  // The anchor grid ("A good place to start") used to be displaced by ANY
  // published team rail, so a single curated rail silently deleted the page's
  // anchor wall and the homepage ended up leading with a $9.99 lube. The
  // anchor now always renders; the team rail renders after it. A deliberate
  // takeover is still possible via the rail's additive `replacesAnchor` flag,
  // which defaults to false.
  const replacesAnchor = firstTeamRail?.replacesAnchor === true
  // No product may appear twice on the page. The team rail is deliberate
  // merchandising so it keeps its full set; the auto-generated anchor (12 items
  // ranked, 8 shown) gives up the overlap and still has slack.
  const teamRailHandles = new Set(firstTeamRailProducts.map(p => p.handle))
  const anchorRail = gridRail && teamRailHandles.size > 0
    ? { ...gridRail, items: gridRail.items.filter(it => !teamRailHandles.has(it.product.handle)) }
    : gridRail

  /* One entry per band. Each is the same JSX the composition rendered inline
     before; hoisting them into a map is what lets the order come from data. A
     band that has nothing to show still returns null here rather than being
     omitted, so the map stays total and a missing key is a real bug. */
  const bands: Record<BandName, ReactNode> = {
    hero: <Hero featured={featured} emmaHero={emmaHero} trustBar={trustBarBlock} />,

    /* Nº 03 · A good place to start — the curated anchor collection (default
       best-sellers, discovery best-of fallback) as a bright static grid. This
       ALWAYS renders now, whether or not the team published a rail, because it
       is the page's anchor product wall and the reason a first-time visitor
       sees curated product above the fold-ish. It is only skipped when a rail
       explicitly claims the slot (`replacesAnchor`), or when both the anchor
       collection and every discovery rail are empty (cold KV / outage), in
       which case nothing renders here and the page still reads complete. */
    anchorGrid: !replacesAnchor && anchorRail ? <ProductGrid rail={anchorRail} /> : null,

    /* The team's first `emmaCuratedRail`. With `replacesAnchor` it takes the
       Nº 03 slot as the dense grid (heading/eyebrow from Sanity, so
       merchandising owns the words). Otherwise it renders right AFTER the
       anchor through the normal Sanity render path, same as rails 2..N,
       which also gives the page grid-then-scroller rhythm instead of two
       identical grids stacked. */
    teamRails: firstTeamRail ? (
      replacesAnchor && firstTeamRailProducts.length > 0 ? (
        <ProductGrid
          rail={teamRailToGridRail(firstTeamRailProducts)}
          eyebrow={firstTeamRail.eyebrow || ANCHOR_GRID_DEFAULT_EYEBROW}
          heading={firstTeamRail.heading}
          seeAllHref={firstTeamRail.ctaLink || undefined}
          seeAllLabel={firstTeamRail.ctaLabel || 'See all →'}
        />
      ) : (
        <ContentBlockRenderer block={firstTeamRail} carouselProductMap={carouselProductMap} />
      )
    ) : null,

    meetEmma: <MeetEmma photoUrl={emmaPhotoUrl} photoAlt={emmaPhotoAlt} />,

    /* Find your way in — the team's `wayfinderMosaic` block when published,
       otherwise the hardcoded fallback (an unset block and a degraded
       upstream both leave this undefined — never empty boxes). */
    wayfinder: <FindYourWayIn block={wayfinderBlock} />,

    /* Nº 06 · Emma's edit — the team's remaining `emmaCuratedRail` blocks
       (2nd..Nth) when published, otherwise the discovery rails not already
       used by the Nº 03 grid, rendered as the calm horizontal scroller.
       `editRails` excludes the anchor rail, so the fallback can never reprint
       the products already shown in the Nº 03 grid. */
    emmasEdit: (
      <>
        {restTeamRails.map(block => (
          <ContentBlockRenderer
            key={block._key}
            block={block}
            carouselProductMap={carouselProductMap}
          />
        ))}
        {teamRails.length === 0 && <EmmasEdit rails={editRails} />}
      </>
    ),

    /* Nº 07 · The Sensation Map — a plum-soft discovery instrument between the
       Emma's edit rail (paper-2) and Couples (paper-3) for a tinted beat in
       the ground rhythm. Skipped entirely on a cold index (no defaultState),
       so it never renders an empty band. */
    sensationMap:
      sensationMap.defaultState && sensationMap.defaultMatch ? (
        <SensationMap
          types={sensationMap.types}
          feels={sensationMap.feels}
          defaultState={sensationMap.defaultState}
          defaultMatch={sensationMap.defaultMatch}
        />
      ) : null,

    /* Nº 08 · Couples — the `playTogetherBanner` block supplies the band's
       photo + copy when published; fallback renders the coral-soft band
       with hardcoded copy (never blank). */
    couples: <Couples block={couplesBlock} rail={couplesRail} />,

    stillDeciding: <StillDecidingBand />,

    /* From the Notebook — a curated `editorialTiles` block wins when the team
       publishes one (each card can also link a product/collection); otherwise
       the section auto-populates with the latest published posts so fresh
       daily content always reaches the homepage with no merchandiser action. */
    notebook:
      notebookBlocks.length === 0 ? (
        <HomeNotebookRail posts={notebookPosts} />
      ) : (
        <>
          {notebookBlocks.map(block => (
            <ContentBlockRenderer
              key={block._key}
              block={block}
              carouselProductMap={carouselProductMap}
            />
          ))}
        </>
      ),

    faq: <FAQ block={faqBlock} />,

    emailCapture: (
      <EmailSubscribe
        heading="Good taste, delivered quietly."
        subcopy="Emma's picks, on an irregular schedule. Discreet, direct."
        buttonLabel="I'm in ♥"
      />
    ),
  }

  /* Every renderable slot: the twelve shell bands plus the deck. The deck's
     position comes from the layout; whether it shows anything comes from the
     payload. Both must agree before a visitor sees a door. */
  const slots: Record<HomeSlot, ReactNode> = {
    ...bands,
    panelDeck: panelDeck ? <PanelDeck deck={panelDeck} /> : null,
  }

  return (
    <>
      {/* SEO: ItemList only for the featured set (one lead product per
          populated rail). The canonical PDP owns the Product entity; a
          listing page must not emit a competing Product node, since the
          lean discovery-index shape can't populate brand/gtin/shipping and
          would collide on @id with the PDP's full node.
          Variant 'a'/legacy each own their own schema elsewhere, so this
          only renders for variant 'b'. Page-level, so it sits outside the
          band order and cannot be reordered away. */}
      {featured.length > 0 && (
        <ItemListStructuredData
          name="Emma's picks"
          url="https://xdipx.com/"
          items={featured.map(p => ({
            name:  p.title,
            url:   `https://xdipx.com/products/${p.handle}`,
            image: p.imageUrl,
          }))}
        />
      )}

      {resolveBandOrder(layout, { anchorReplaced: replacesAnchor }).map(name => (
        <Fragment key={name}>{slots[name]}</Fragment>
      ))}
    </>
  )
}
