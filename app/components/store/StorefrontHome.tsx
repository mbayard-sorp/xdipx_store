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

import { Suspense, useEffect, useRef } from 'react'
import { Await, Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { EmailSubscribe } from '~/components/store/EmailSubscribe'
import { StorefrontProductCard } from '~/components/store/StorefrontProductCard'
import { ContentBlockRenderer } from '~/components/cms/ContentBlockRenderer'
import { NotebookTeaser } from '~/components/blog/NotebookTeaser'
import type { BlogPostCard } from '~/types/cms'
import { FAQStructuredData } from '~/components/seo/FAQStructuredData'
import { ItemListStructuredData } from '~/components/seo/ItemListStructuredData'
import { Reveal } from '~/components/motion/Reveal'
import { trackViewItemList, trackSelectItem, type GA4Item } from '~/lib/analytics.client'
import type { StorefrontData } from '~/lib/storefront-home.server'
import type { DiscoveryProduct, Rail } from '~/types/discovery'
import type { EmmaHeroSettings, WayfinderMosaicBlock, PlayTogetherBannerBlock, EmmaCuratedRailBlock } from '~/types/cms'
import type { Product } from '~/types'

/* Team-controlled Sanity block types the storefront renders (everything else
   in `singleton.homepage` is shell-owned or legacy and intentionally ignored). */
const TEAM_RAIL_TYPE = 'emmaCuratedRail'
const TEAM_NOTEBOOK_TYPE = 'editorialTiles'
const TEAM_WAYFINDER_TYPE = 'wayfinderMosaic'
const MAX_TEAM_RAILS = 4

const MONO = { fontFamily: 'var(--font-mono)' } as const
const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 400 } as const
const DISPLAY_MED = { fontFamily: 'var(--font-display)', fontWeight: 500 } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

/* The above-the-fold guided entry. All five pills go straight to a matching
   live collection — the redesign v2 spec caps /discover at exactly two links
   on the page (the Nº 05 mosaic promo tile and the Nº 08 closer band), so
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

function Hero({ featured, emmaHero }: { featured: DiscoveryProduct[]; emmaHero?: EmmaHeroSettings | null }) {
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
      <div className="mx-auto grid max-w-[1320px] items-center gap-10 px-6 py-10 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] md:gap-16 md:px-16 md:py-16">
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
            <p className="mt-6 max-w-[46ch] text-[16.5px] leading-relaxed text-ink-3" style={BODY}>
              {emmaHero.body}
            </p>
          ) : (
            <p className="mt-6 max-w-[46ch] text-[16.5px] leading-relaxed text-ink-3" style={BODY}>
              A short, checked selection instead of a wall of options. Start with the one below, or
              tell us what you're after.
            </p>
          )}

          {emmaHero?.pullQuote && (
            <p className="mt-6 text-[1.05rem] italic text-sage" style={DISPLAY}>
              ♥ {emmaHero.pullQuote}
            </p>
          )}

          {/* CTAs — one primary coral, one clearly-secondary ghost */}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              to={primaryHref}
              className="inline-flex items-center gap-2 rounded-full bg-coral px-6 py-3.5 text-[15px] font-medium text-white transition-transform hover:-translate-y-0.5"
              style={BODY}
            >
              {primaryLabel.endsWith('→') ? (
                <>
                  {primaryLabel.slice(0, -1).trimEnd()} <span aria-hidden="true">→</span>
                </>
              ) : (
                primaryLabel
              )}
            </Link>
            <Link
              to="/collections"
              className="inline-flex items-center gap-2 rounded-full border border-line-2 px-5 py-3 text-[15px] font-medium text-ink transition-colors hover:border-ink-3"
              style={BODY}
            >
              {/* Never duplicate the primary's label (both are whitelist picks). */}
              {primaryLabel.startsWith('Take a peek') ? 'Show me' : 'Take a peek'}{' '}
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          {/* guided prompt + horizontal mood pills */}
          <p className="mt-7 text-[14px] text-ink-3" style={BODY}>
            Where do you want to start?
          </p>
          <div className="-mx-1 mt-3 flex gap-2.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {MOOD_PILLS.map(pill => (
              <Link
                key={pill.label}
                to={pill.to}
                className="flex-none whitespace-nowrap rounded-full border border-line bg-paper px-[18px] py-2.5 text-[14px] text-ink transition-colors hover:bg-paper-2"
                style={BODY}
              >
                {pill.label}
              </Link>
            ))}
          </div>
        </Reveal>

        {/* product still — static LCP, never animated, coral-soft frame w/ inset vignette */}
        <div className="relative min-w-0">
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
        </div>
      </div>

      {/* Nº 02 · Trust strip — raised into the hero band, inside the first viewport */}
      <Reveal variant="fade" as="div" className="border-t border-line">
        <div className="mx-auto grid max-w-[1320px] grid-cols-2 gap-x-6 gap-y-3.5 px-6 py-[18px] md:flex md:flex-nowrap md:items-center md:justify-between md:gap-x-8 md:px-16">
          {[
            'Ships in plain packaging',
            'Billed as XDIPX',
            '30-day returns',
            'Hand-checked, not auto-listed',
          ].map(item => (
            <div key={item} className="flex items-center gap-2.5 text-[13.5px] text-ink-3" style={BODY}>
              <span className="text-sage" aria-hidden="true">♥</span> {item}
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  )
}

/* ── 3 · Meet Emma ─────────────────────────────────────────────────────────
   Who she is, in her own AI-guide voice (E-E-A-T + brand trust). */

/* ── Nº 03 · "Most picked, right now" — promoted primary grid ──────────────
   The single biggest structural change: the anchor best-seller set moves up
   from the buried rail zone to a bright, static grid immediately after the
   trust strip, so the page opens with a wall of clickable product. */

/** Render a heading with its last word in the italic plum emphasis style,
    matching the editorial headline treatment across the page. */
function EmphasizedHeading({ text }: { text: string }) {
  const trimmed = text.trim()
  const trailing = trimmed.match(/[.?!]$/)?.[0] ?? ''
  const core = trailing ? trimmed.slice(0, -1) : trimmed
  const words = core.split(' ')
  if (words.length < 2) return <>{trimmed}</>
  const last = words.pop() as string
  return <>{words.join(' ')} <em className="em">{last}</em>{trailing}</>
}

/** Adapt a full Shopify product (team-rail fetch) to the lean grid-card shape.
    Only the fields StorefrontProductCard reads matter; the rest are inert. */
function shopifyToDiscovery(p: Product): DiscoveryProduct {
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
    subcategory: p.brand ?? '',
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
function teamRailToGridRail(products: Product[]): Rail {
  return {
    category: 'Pleasure',
    score: 0,
    total: products.length,
    items: products.map(p => ({ score: 0, product: shopifyToDiscovery(p) })),
  }
}

function ProductGrid({
  rail,
  eyebrow = "What's working",
  heading,
  seeAllHref = '/collections/best-sellers',
  seeAllLabel = 'See all →',
}: {
  rail: Rail
  eyebrow?: string
  heading?: string
  seeAllHref?: string
  seeAllLabel?: string
}) {
  if (!rail.items.length) return null
  const items = rail.items.slice(0, 8)

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
                : <>Most picked, <em className="em">right now</em>.</>}
            </h2>
          </div>
          <Link
            to={seeAllHref}
            className="hidden text-[15px] font-medium text-ink link-coral md:inline-block"
            style={BODY}
          >
            {seeAllLabel}
          </Link>
        </Reveal>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5">
          {items.map((it, i) => (
            <Reveal key={it.product.id} variant="up" index={i}>
              <StorefrontProductCard
                product={it.product}
                priority={i === 0}
                fluid
                onSelect={() => trackSelectItem(
                  'most-picked-grid', 'most-picked-grid',
                  toGA4Item(it.product, i, 'most-picked-grid', 'most-picked-grid'), i,
                )}
              />
            </Reveal>
          ))}
        </div>

        <Link
          to={seeAllHref}
          className="mt-7 inline-block text-[15px] font-medium text-ink link-coral md:hidden"
          style={BODY}
        >
          {seeAllLabel}
        </Link>
      </div>
    </section>
  )
}

/* ── Nº 04 · Meet Emma ──────────────────────────────────────────────────────
   Who she is, in her own AI-guide voice (E-E-A-T + brand trust). The
   headline is set as an oversized pull-quote — typographic art, not caption
   text — with a large coral opening ♥ as a display mark. */

function MeetEmma() {
  return (
    <section id="meet-emma" className="bg-paper-2 py-16 md:py-20">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-10 px-6 md:gap-16 md:px-16">
          <Reveal variant="scale" className="min-w-[240px] max-w-[420px] flex-1">
            <div className="aspect-[4/5] w-full overflow-hidden rounded-[var(--radius-lg)] bg-paper-3 ring-[6px] ring-sage/15">
              <OptimizedImage
                src="/emma.png"
                alt="Emma, the editorial AI guide for xdipx"
                widths={[420, 840]}
                fallbackWidth={840}
                sizes="(max-width: 768px) 100vw, 420px"
                className="h-full w-full object-cover"
              />
            </div>
          </Reveal>
          <Reveal variant="up" className="min-w-[300px] flex-1">
            <SectionNumeral n="04" className="mb-3 block" />
            <p className="mb-5 text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
              Meet Emma
            </p>
            <p
              className="text-[1.9rem] leading-[1.16] tracking-[-0.01em] text-ink md:text-[2.9rem]"
              style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 450 }}
            >
              <span className="mr-1 not-italic text-coral" aria-hidden="true">♥</span>
              I know the catalog cold, every spec and the review patterns behind it, so I can
              point you to what actually <em className="em">fits</em>.
            </p>
            <p className="mt-6 max-w-[48ch] text-[16.5px] leading-relaxed text-ink-3" style={BODY}>
              I'm an AI guide, so I don't get embarrassed and I don't have a shelf to push. Tell me a
              little about what you're after and I'll do the reading for you.
            </p>
            {/* Anchors to the Compass closer band below. It keeps the guided-fit
                promise in this copy without adding a third /discover link (mission
                brief caps the page at the closer plus one preset pill). */}
            <Link
              to="#discover"
              className="mt-7 inline-flex items-center gap-2 rounded-full border border-line-2 px-5 py-3 text-[15px] font-medium text-ink transition-colors hover:border-ink-3"
              style={BODY}
            >
              Find your fit <span aria-hidden="true">→</span>
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
  // Render the heading with the emphasis word italicized, matching the
  // hardcoded fallback's `Find your <em>way</em> in.` structure.
  const headingParts = heading.includes(emphasis)
    ? heading.split(emphasis)
    : [heading, '']

  const promo = block?.promo
  const promoEyebrow = promo?.eyebrow || 'Discover You'
  const promoHeading = promo?.heading || 'Not sure where you land? Discover You.'
  const promoEmphasis = promo?.emphasis || 'Discover'
  const promoHeadingParts = promoHeading.includes(promoEmphasis)
    ? promoHeading.split(promoEmphasis)
    : [promoHeading, '']
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
              {headingParts[0]}<em className="em">{emphasis}</em>{headingParts[1]}
            </h2>
          </Reveal>

          <div className="mb-4 flex flex-wrap gap-4">
            {tiles.map((t, i) => {
              const hasImage = !!t.image?.url
              return (
                <Reveal key={t._key} variant="up" index={i} className="flex-1 basis-[180px]">
                  <Link
                    to={t.link}
                    className="relative flex min-h-[200px] w-full items-end overflow-hidden rounded-[var(--radius-lg)] border border-line bg-paper-3 p-5 transition-transform hover:-translate-y-0.5"
                  >
                    {hasImage && (
                      <>
                        <OptimizedImage
                          src={t.image!.url!}
                          alt={t.image!.alt ?? t.label}
                          sizes="(max-width: 768px) 100vw, 33vw"
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                        {/* Ink gradient scrim so the white label stays legible over any photo */}
                        <div
                          className="absolute inset-0"
                          style={{ background: 'linear-gradient(to top, rgba(26,20,24,0.75), rgba(26,20,24,0.05) 60%)' }}
                          aria-hidden="true"
                        />
                      </>
                    )}
                    <div className="relative z-[1]">
                      <span
                        className="text-[1.5rem] text-ink"
                        style={{ ...DISPLAY_MED, ...(hasImage ? { color: 'white' } : {}) }}
                      >
                        {t.label}
                      </span>
                      {t.emmaAside && (
                        <p
                          className="mt-1 text-[13.5px] italic text-sage"
                          style={{ ...DISPLAY, ...(hasImage ? { color: 'white' } : {}) }}
                        >
                          ♥ {t.emmaAside}
                        </p>
                      )}
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
                  {promoHeadingParts[0]}<em className="em">{promoEmphasis}</em>{promoHeadingParts[1]}
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

/* ── Nº 07 · Couples — photographic band + rail ────────────────────────────
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
  const headingParts = heading.includes(emphasis) ? heading.split(emphasis) : [heading, '']
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
            {headingParts[0]}<em className="em">{emphasis}</em>{headingParts[1]}
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
  return (
    <section className="bg-paper-3 py-16 md:py-20">
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

/* ── Nº 08 · "Still deciding?" dark band — the Compass closer → /discover ─── */

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
          <Link
            to="/discover"
            className="inline-flex items-center gap-2 rounded-full bg-coral px-7 py-4 text-[15px] font-medium text-white transition-transform hover:-translate-y-0.5"
            style={BODY}
          >
            Find your fit <span aria-hidden="true">→</span>
          </Link>
        </Reveal>
    </section>
  )
}

/* ── Nº 10 · FAQ (+ FAQPage JSON-LD for AEO) ───────────────────────────────── */

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
 * Homepage "From the Notebook" band (Nº 09) — the branded chrome (band bg,
 * aligned container, section numeral) around the shared `NotebookTeaser`, shown
 * when the team has not published a curated `editorialTiles` block. `NotebookTeaser`
 * runs in `bare` mode so this band owns the width/padding; it renders nothing
 * when there are no posts, so this whole band collapses to null too.
 */
function HomeNotebook({ posts }: { posts: BlogPostCard[] }) {
  if (!posts.length) return null
  return (
    <section className="bg-paper py-16 md:py-20">
      <div className="mx-auto max-w-[1200px] px-6 md:px-16">
        <SectionNumeral n="09" className="mb-3 block" />
        <NotebookTeaser posts={posts} bare />
      </div>
    </section>
  )
}

/**
 * Awaits the DEFERRED latest-posts payload, then renders the homepage Notebook
 * band. Kept as its own component so it can be dropped into both the pending
 * fallback and the resolved (no-`editorialTiles`) branch of the zone below. The
 * band is well below the fold, so a `null` fallback while it streams in is
 * fine; a failed leg already resolved to [] server-side, so `HomeNotebook`
 * simply renders nothing.
 */
function DeferredHomeNotebook({ posts }: { posts: Promise<BlogPostCard[]> }) {
  return (
    <Suspense fallback={null}>
      <Await resolve={posts} errorElement={null}>
        {resolved => <HomeNotebook posts={resolved} />}
      </Await>
    </Suspense>
  )
}

function FAQ() {
  return (
    <section className="bg-paper-2 py-16 md:py-20">
      <FAQStructuredData faqs={FAQS} />
        <Reveal variant="up" className="mx-auto max-w-[820px] px-6 md:px-16">
          <SectionNumeral n="10" className="mb-3 block" />
          <h2
            className="mb-9 text-[1.9rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.9rem]"
            style={DISPLAY}
          >
            Questions, <em className="em">answered</em>.
          </h2>
          {FAQS.map((f, i) => (
            <details
              key={f.question}
              className={`group border-t border-line ${i === FAQS.length - 1 ? 'border-b' : ''}`}
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
   Order is the stable shell. The deferred Sanity blocks (the team's
   notebook/promo/editorial surface) stream in between Couples and FAQ. */

export function StorefrontHome({ featured, rails, contentBlocks, emmaHero, notebookPosts }: StorefrontData) {
  // Nº 03 grid + Nº 06 rail cold-start fallback — the discovery "best of" set
  // sourced straight from the loader payload's `rails[]` (no new Shopify
  // calls). rails[0] promotes to the bright static grid; rails[1] (or the
  // same rail again when there's only one populated) stays the calm scroller
  // so the two sections never render an identical product set back to back.
  const populatedRails = rails.filter(r => r.items.length > 0)
  const gridRail = populatedRails[0]
  const editRails = populatedRails.length > 1 ? populatedRails.slice(1) : populatedRails

  return (
    <>
      {/* SEO: ItemList only for the featured set (one lead product per
          populated rail). The canonical PDP owns the Product entity; a
          listing page must not emit a competing Product node, since the
          lean discovery-index shape can't populate brand/gtin/shipping and
          would collide on @id with the PDP's full node.
          Variant 'a'/legacy each own their own schema elsewhere, so this
          only renders for variant 'b'. */}
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

      <Hero featured={featured} emmaHero={emmaHero} />

      {/* Nº 03 · Most picked, right now — the team's first `emmaCuratedRail`
          block when published (rendered as the existing carousel component,
          untouched — the Sanity render path is a restyle, not a data-layer
          change), otherwise the discovery best-of anchor rail as a bright
          static grid. Never blank: gridRail is undefined only when every
          discovery rail is empty (cold KV), in which case nothing renders
          here and the page still reads complete. */}
      <Suspense fallback={gridRail ? <ProductGrid rail={gridRail} /> : null}>
        <Await
          resolve={contentBlocks}
          errorElement={gridRail ? <ProductGrid rail={gridRail} /> : null}
        >
          {({ sections, carouselProductMap }) => {
            const teamRails = sections
              .filter(b => b._type === TEAM_RAIL_TYPE)
              .slice(0, MAX_TEAM_RAILS)
            const firstTeamRail = teamRails[0] as EmmaCuratedRailBlock | undefined
            if (firstTeamRail) {
              const products = carouselProductMap[firstTeamRail._key] ?? []
              if (products.length > 0) {
                // The day's slate gets the dense grid treatment (spec Nº 03),
                // not a horizontal scroller — heading/eyebrow come from the
                // team's Sanity block so merchandising still owns the words.
                return (
                  <ProductGrid
                    rail={teamRailToGridRail(products)}
                    eyebrow={firstTeamRail.eyebrow || "What's working"}
                    heading={firstTeamRail.heading}
                    seeAllHref={firstTeamRail.ctaLink || '/collections/best-sellers'}
                    seeAllLabel={firstTeamRail.ctaLabel || 'See all →'}
                  />
                )
              }
              // Product fetch failed/empty — fall back to the carousel path
              // rather than an empty grid.
              return (
                <ContentBlockRenderer
                  block={firstTeamRail}
                  carouselProductMap={carouselProductMap}
                />
              )
            }
            return gridRail ? <ProductGrid rail={gridRail} /> : null
          }}
        </Await>
      </Suspense>

      <MeetEmma />

      {/* Find your way in — the team's `wayfinderMosaic` block when published,
          otherwise the hardcoded fallback (unset block, pending promise, AND
          rejected promise all render the same fallback — never empty boxes). */}
      <Suspense fallback={<FindYourWayIn />}>
        <Await resolve={contentBlocks} errorElement={<FindYourWayIn />}>
          {({ sections }) => {
            const block = sections.find(b => b._type === TEAM_WAYFINDER_TYPE) as WayfinderMosaicBlock | undefined
            return <FindYourWayIn block={block} />
          }}
        </Await>
      </Suspense>

      {/* Nº 06 · Emma's edit — the team's remaining `emmaCuratedRail` blocks
          (2nd..Nth) when published, otherwise the discovery rails not already
          used by the Nº 03 grid, rendered as the calm horizontal scroller. */}
      <Suspense fallback={<EmmasEdit rails={editRails} />}>
        <Await resolve={contentBlocks} errorElement={<EmmasEdit rails={editRails} />}>
          {({ sections, carouselProductMap }) => {
            const teamRails = sections
              .filter(b => b._type === TEAM_RAIL_TYPE)
              .slice(0, MAX_TEAM_RAILS)
            const restTeamRails = teamRails.slice(1)
            if (restTeamRails.length > 0) {
              return (
                <>
                  {restTeamRails.map(block => (
                    <ContentBlockRenderer
                      key={block._key}
                      block={block}
                      carouselProductMap={carouselProductMap}
                    />
                  ))}
                </>
              )
            }
            if (teamRails.length === 1) return null // the one team rail already fed the Nº 03 grid
            return <EmmasEdit rails={editRails} />
          }}
        </Await>
      </Suspense>

      {/* Nº 07 · Couples — the `playTogetherBanner` block supplies the band's
          photo + copy when published; fallback renders the coral-soft band
          with hardcoded copy (never blank). */}
      <Suspense fallback={<Couples />}>
        <Await resolve={contentBlocks} errorElement={<Couples />}>
          {({ sections }) => (
            <Couples
              block={sections.find(b => b._type === 'playTogetherBanner') as PlayTogetherBannerBlock | undefined}
            />
          )}
        </Await>
      </Suspense>
      <StillDecidingBand />

      {/* From the Notebook — a curated `editorialTiles` block wins when the team
          publishes one (each card can also link a product/collection); otherwise
          the section auto-populates with the latest published posts (via the
          deferred `notebookPosts`, rendered with `NotebookTeaser`) so fresh
          daily content always reaches the homepage with no merchandiser action.
          Both payloads are deferred, so this whole zone streams in below the
          fold and never blocks the shell's TTFB. */}
      <Suspense fallback={<DeferredHomeNotebook posts={notebookPosts} />}>
        <Await
          resolve={contentBlocks}
          errorElement={<DeferredHomeNotebook posts={notebookPosts} />}
        >
          {({ sections, carouselProductMap }) => {
            const notebook = sections.filter(b => b._type === TEAM_NOTEBOOK_TYPE)
            if (notebook.length === 0) return <DeferredHomeNotebook posts={notebookPosts} />
            return (
              <>
                {notebook.map(block => (
                  <ContentBlockRenderer
                    key={block._key}
                    block={block}
                    carouselProductMap={carouselProductMap}
                  />
                ))}
              </>
            )
          }}
        </Await>
      </Suspense>

      <FAQ />
      <EmailSubscribe
        heading="Good taste, delivered quietly."
        subcopy="Emma's picks, on an irregular schedule. Discreet, direct."
        buttonLabel="I'm in ♥"
      />
    </>
  )
}
