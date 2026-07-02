/**
 * The new traditional storefront homepage (variant 'b') — "Emma's Edit".
 *
 * A content-rich, crawlable catalog front door that replaces "The Compass"
 * discovery tool at `/` (which moves to `/discover`). Built mobile-first @375px
 * on the v3 brand tokens, in the Emma editorial voice. Section order is the
 * stable "shell"; the daily merchandising team changes *content* (featured
 * products, copy, the deferred Sanity bands) inside it, never the structure.
 *
 * Locked design: docs/homepage-team/homepage-redesign-brief.md +
 * docs/homepage-team/hifi-reference.html (claude.ai/design hi-fi pass).
 *
 * Voice: Emma is an AI guide with NO lived experience — she advises from
 * catalog knowledge, never claims to have used/owned/reached-for a product.
 * No em-dashes, no countdowns, ♥ only in CTAs/asides.
 *
 * SSR-visible content everywhere (no client-only critical content) so it
 * indexes cleanly. Reveal is used for scroll polish but never wraps the LCP
 * hero image (zero CLS).
 */

import { Suspense } from 'react'
import { Await, Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { EmailSubscribe } from '~/components/store/EmailSubscribe'
import { StorefrontProductCard } from '~/components/store/StorefrontProductCard'
import { ContentBlockRenderer } from '~/components/cms/ContentBlockRenderer'
import { FAQStructuredData } from '~/components/seo/FAQStructuredData'
import type { StorefrontData } from '~/lib/storefront-home.server'
import type { DiscoveryProduct, Rail } from '~/types/discovery'
import type { EmmaHeroSettings, WayfinderMosaicBlock } from '~/types/cms'

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

/* The above-the-fold guided entry. Each pill routes to the discovery finder;
   preset deep-linking (?preset=slug) is a follow-up once presets are published. */
const MOOD_PILLS = ['Just curious', 'Slow nights', 'For two', 'Hands-free', 'Surprise me']

/* ── 1 · Hero (Direction A: editorial split) ───────────────────────────────
   Text column on the left, one large static product still on the right (the
   LCP candidate — priority, fixed aspect, never wrapped in Reveal). */

function Hero({ featured, emmaHero }: { featured: DiscoveryProduct[]; emmaHero?: EmmaHeroSettings | null }) {
  const lead = featured[0]
  const peekHref = lead ? `/products/${lead.handle}` : '/vault'

  // Team-managed `singleton.emmaHero` (Sanity) drives the text/config, field
  // by field, so a half-filled draft never blanks out a section — anything
  // missing falls back to the discovery-derived defaults below. The LCP
  // product image always stays derived from `featured[0]`, never the doc.
  const eyebrow = emmaHero?.eyebrow || 'Curated by Emma, your AI guide'
  const aside = emmaHero?.aside || "Tell me what matters and I'll point you to the fit."

  return (
    <section className="bg-paper">
      <div className="mx-auto grid max-w-[1320px] items-center gap-10 px-6 py-10 md:grid-cols-2 md:gap-16 md:px-10 md:py-16">
        {/* text column */}
        <div className="min-w-0">
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

          {emmaHero?.body && (
            <p className="mt-6 max-w-[46ch] text-[16.5px] leading-relaxed text-ink-3" style={BODY}>
              {emmaHero.body}
            </p>
          )}

          {/* Emma byline chip */}
          <div className="mt-7 flex items-center gap-3.5">
            <OptimizedImage
              src="/emma.png"
              alt="Emma, your AI guide"
              widths={[46, 92]}
              fallbackWidth={92}
              className="h-[46px] w-[46px] flex-none rounded-full object-cover ring-[3px] ring-sage/30"
            />
            <div className="leading-snug">
              <div className="text-[14px] font-semibold text-ink" style={BODY}>
                Emma, your guide
              </div>
              <div className="text-[13.5px] text-ink-3" style={BODY}>
                {aside}
              </div>
            </div>
          </div>

          {emmaHero?.pullQuote && (
            <p className="mt-6 text-[1.05rem] italic text-sage" style={DISPLAY}>
              ♥ {emmaHero.pullQuote}
            </p>
          )}

          {/* CTAs — one primary coral, one clearly-secondary ghost */}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              to={peekHref}
              className="inline-flex items-center gap-2 rounded-full bg-coral px-6 py-3.5 text-[15px] font-medium text-white transition-transform hover:-translate-y-0.5"
              style={BODY}
            >
              Take a peek <span aria-hidden="true">→</span>
            </Link>
            <Link
              to="/discover"
              className="inline-flex items-center gap-2 rounded-full border border-line-2 px-5 py-3 text-[15px] font-medium text-ink transition-colors hover:border-ink-3"
              style={BODY}
            >
              Find your fit <span aria-hidden="true">→</span>
            </Link>
          </div>

          {/* guided prompt + horizontal mood pills */}
          <p className="mt-7 text-[14px] text-ink-3" style={BODY}>
            Where do you want to start?
          </p>
          <div className="-mx-1 mt-3 flex gap-2.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {MOOD_PILLS.map(pill => (
              <Link
                key={pill}
                to="/discover"
                className="flex-none whitespace-nowrap rounded-full border border-line bg-paper px-[18px] py-2.5 text-[14px] text-ink transition-colors hover:bg-paper-2"
                style={BODY}
              >
                {pill}
              </Link>
            ))}
          </div>
        </div>

        {/* product still — static LCP, never animated, fixed aspect */}
        <div className="min-w-0">
          <div className="aspect-[4/5] w-full overflow-hidden rounded-[var(--radius-lg)] border border-line bg-paper-2">
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

      {/* 2 · Trust strip — raised into the hero band, inside the first viewport */}
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-x-8 gap-y-3.5 px-6 py-[18px] md:px-10">
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
      </div>
    </section>
  )
}

/* ── 3 · Meet Emma ─────────────────────────────────────────────────────────
   Who she is, in her own AI-guide voice (E-E-A-T + brand trust). */

function MeetEmma() {
  return (
    <section id="meet-emma" className="bg-paper-2">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-10 px-6 py-16 md:gap-16 md:px-10 md:py-24">
          <div className="min-w-[240px] max-w-[420px] flex-1">
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
          </div>
          <div className="min-w-[300px] flex-1">
            <p className="mb-5 text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
              Meet Emma
            </p>
            <h2
              className="text-[1.9rem] leading-[1.12] tracking-[-0.01em] text-ink md:text-[2.9rem]"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 450 }}
            >
              I'm Emma, xdipx's AI guide. I know the catalog cold, every spec and thousands of
              reviews, so I can point you to what actually <em className="em">fits</em>.
            </h2>
            <p className="mt-6 max-w-[48ch] text-[16.5px] leading-relaxed text-ink-3" style={BODY}>
              I don't get embarrassed, and I don't have a shelf to push. Tell me a little about what
              you're after and I'll do the reading for you.
            </p>
            <Link
              to="/discover"
              className="mt-7 inline-flex items-center gap-2 rounded-full border border-line-2 px-5 py-3 text-[15px] font-medium text-ink transition-colors hover:border-ink-3"
              style={BODY}
            >
              Find your fit <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
    </section>
  )
}

/* ── 4 · Find your way in (category mosaic) ────────────────────────────────
   Three category tiles + a larger plum-soft "Discover You" guided-finder tile.
   Replaces the retired "Vault" with "Discover You". */

const MOSAIC_TILES = [
  { label: 'For her', to: '/for-her' },
  { label: 'For him', to: '/for-him' },
  { label: 'First time?', to: '/discover' },
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
    || "Answer a few quiet questions and Emma builds you a short list that actually fits."
  const promoCtaLabel = promo?.ctaLabel || 'Find your fit →'
  const promoCtaLink = promo?.ctaLink || '/discover'

  return (
    <section className="bg-paper">
        <div className="mx-auto max-w-[1320px] px-6 py-16 md:px-10 md:py-24">
          <p className="mb-3.5 text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
            {eyebrow}
          </p>
          <h2
            className="mb-9 text-[1.9rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.9rem]"
            style={DISPLAY}
          >
            {headingParts[0]}<em className="em">{emphasis}</em>{headingParts[1]}
          </h2>

          <div className="mb-4 flex flex-wrap gap-4">
            {tiles.map(t => {
              const hasImage = !!t.image?.url
              return (
                <Link
                  key={t._key}
                  to={t.link}
                  className="relative flex min-h-[200px] flex-1 basis-[180px] items-end overflow-hidden rounded-[var(--radius-lg)] border border-line bg-paper-3 p-5 transition-transform hover:-translate-y-0.5"
                >
                  {hasImage && (
                    <OptimizedImage
                      src={t.image!.url!}
                      alt={t.image!.alt ?? t.label}
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
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
              )
            })}
          </div>

          {/* Discover You — larger plum-soft tile (or promo.image when set) */}
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
        </div>
    </section>
  )
}

/* ── 5 · Rotating rails (the team's experiment surface) ────────────────────
   Always-on "Best sellers" anchor + an "Emma's edit" curated rail. The daily
   merchandiser reorders/swaps these as content; the shell stays fixed. */

function Rail({
  eyebrow,
  heading,
  emphasis,
  rail,
  leadPriority,
  aside,
}: {
  eyebrow: string
  heading: string
  emphasis: string
  rail: Rail
  leadPriority?: boolean
  aside?: string
}) {
  if (!rail.items.length) return null
  return (
    <div className="py-2">
      <div className="mb-3 px-6 md:px-10">
        <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
          {eyebrow}
        </p>
        <h2 className="text-[1.8rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.7rem]" style={DISPLAY}>
          {heading} <em className="em">{emphasis}</em>
        </h2>
      </div>
      <div className="flex snap-x gap-[18px] overflow-x-auto px-6 pb-3.5 [scrollbar-width:none] md:px-10 [&::-webkit-scrollbar]:hidden">
        {rail.items.slice(0, 10).map((it, i) => (
          <div key={it.product.id} className="w-[220px] shrink-0 snap-start">
            <StorefrontProductCard product={it.product} priority={!!leadPriority && i === 0} />
          </div>
        ))}
      </div>
      {aside && (
        <p className="px-6 pt-3 text-[1.05rem] italic text-sage md:px-10" style={DISPLAY}>
          ♥ {aside}
        </p>
      )}
    </div>
  )
}

function RotatingRails({ rails }: { rails: Rail[] }) {
  const populated = rails.filter(r => r.items.length > 0)
  if (!populated.length) return null
  const best = populated[0]!
  const edit = populated[1] ?? populated[0]!
  return (
    <section id="rails" className="bg-paper-2 py-16 md:py-24">
        <Rail
          eyebrow="What's working"
          heading="The ones people"
          emphasis="keep coming back to."
          rail={best}
          leadPriority
        />
        {populated.length > 1 && (
          <div className="pt-8">
            <Rail
              eyebrow="Emma's edit"
              heading="The ones I'd point you to"
              emphasis="first."
              rail={edit}
              aside="the one I'd point you to for slow nights."
            />
          </div>
        )}
    </section>
  )
}

/* ── 6 · Social proof ──────────────────────────────────────────────────────
   Intentionally NOT rendered: the store is pre-launch and has no real customer
   reviews yet. We do not ship invented testimonials (brand voice + FTC
   endorsement rules). Re-add a real social-proof section once orders generate
   genuine reviews — wire the Sanity `testimonials` block (Routine B) so the
   team can publish real quotes without a deploy. */

/* ── 7 · Couples ───────────────────────────────────────────────────────────
   Play-together banner. The couples product rail is a follow-up (needs a
   confirmed couples collection/tag); banner ships now. */

function Couples() {
  return (
    <section className="bg-paper-3">
        <div className="mx-auto max-w-[1320px] px-6 py-16 md:px-10 md:py-24">
          <div className="flex flex-wrap items-end justify-between gap-5 rounded-[var(--radius-lg)] bg-coral-soft p-8 md:p-14">
            <div className="flex-1 basis-[320px]">
              <p className="mb-3.5 text-[11px] uppercase tracking-[0.18em] text-ink-3" style={MONO}>
                For two
              </p>
              <h2 className="text-[2.1rem] leading-[1.05] tracking-[-0.01em] text-ink md:text-[3.2rem]" style={DISPLAY}>
                Better <em className="em">together</em>.
              </h2>
            </div>
            <Link
              to="/discover"
              className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-coral px-6 py-3.5 text-[15px] font-medium text-white transition-transform hover:-translate-y-0.5"
              style={BODY}
            >
              Show me <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
    </section>
  )
}

/* ── 8 · "Still deciding?" dark band — second guided entry → /discover ──────── */

function StillDecidingBand() {
  return (
    <section id="discover" className="bg-ink text-paper">
        <div className="mx-auto max-w-[1320px] px-6 py-20 text-center md:px-10 md:py-32">
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
        </div>
    </section>
  )
}

/* ── 11 · FAQ (+ FAQPage JSON-LD for AEO) ──────────────────────────────────── */

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
      "Emma is xdipx's AI guide. She knows the catalog and the reviews cold and points you to what fits. She is not a customer, and she has nothing to push.",
  },
  {
    question: 'What payment methods do you take?',
    answer:
      'All major cards, plus Apple Pay and Google Pay. However you pay, every charge appears as XDIPX.',
  },
]

function FAQ() {
  return (
    <section className="bg-paper-2">
      <FAQStructuredData faqs={FAQS} />
        <div className="mx-auto max-w-[820px] px-6 py-16 md:px-10 md:py-24">
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
        </div>
    </section>
  )
}

/* ── Composition ───────────────────────────────────────────────────────────
   Order is the stable shell. The deferred Sanity blocks (the team's
   notebook/promo/editorial surface) stream in between Couples and FAQ. */

export function StorefrontHome({ featured, rails, contentBlocks, emmaHero }: StorefrontData) {
  const discoveryRails = <RotatingRails rails={rails} />
  return (
    <>
      <Hero featured={featured} emmaHero={emmaHero} />
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

      {/* Rotating rails — the team's `emmaCuratedRail` blocks when published,
          otherwise the discovery "best of" rails (cold-start fallback). The
          team owns this surface via Sanity; no deploy needed to reshuffle. */}
      <Suspense fallback={null}>
        <Await resolve={contentBlocks} errorElement={discoveryRails}>
          {({ sections, carouselProductMap }) => {
            const teamRails = sections
              .filter(b => b._type === TEAM_RAIL_TYPE)
              .slice(0, MAX_TEAM_RAILS)
            if (teamRails.length === 0) return discoveryRails
            return (
              <>
                {teamRails.map(block => (
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

      <Couples />
      <StillDecidingBand />

      {/* From the Notebook — team's `editorialTiles` blocks (each card also
          links a product/collection). Renders nothing until the team publishes. */}
      <Suspense fallback={null}>
        <Await resolve={contentBlocks} errorElement={null}>
          {({ sections, carouselProductMap }) => {
            const notebook = sections.filter(b => b._type === TEAM_NOTEBOOK_TYPE)
            if (notebook.length === 0) return null
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
        subcopy="Emma's picks, once a week. Discreet, direct."
        buttonLabel="I'm in ♥"
      />
    </>
  )
}
