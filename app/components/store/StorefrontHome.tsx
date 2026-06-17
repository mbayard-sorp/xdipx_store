/**
 * The new traditional storefront homepage (variant 'b').
 *
 * A content-rich, crawlable catalog front door — replaces "The Compass"
 * discovery tool at `/` (which moves to `/discover`). Built mobile-first @375px
 * on the v3 brand tokens, in the Emma editorial voice. Section order is the
 * stable "shell"; the daily merchandising team changes *content* (featured
 * products, copy, the deferred Sanity bands) inside it, never the structure.
 *
 * SSR-visible content everywhere (no client-only critical content) so it
 * indexes cleanly. Reveal is used for scroll polish but never wraps the LCP
 * hero image (zero CLS).
 */

import { Suspense } from 'react'
import { Await, Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { ProductCarousel } from '~/components/cms/ProductCarousel'
import { EmailSubscribe } from '~/components/store/EmailSubscribe'
import { ContentBlockRenderer } from '~/components/cms/ContentBlockRenderer'
import { Reveal } from '~/components/motion/Reveal'
import { StorefrontProductCard } from '~/components/store/StorefrontProductCard'
import type { StorefrontData } from '~/lib/storefront-home.server'
import type { DiscoveryProduct, Rail } from '~/types/discovery'

/* ── Hero ─────────────────────────────────────────────────────────────────
   Brand statement on the left, a tidy featured-product collage on the right.
   The lead featured image is marked priority so it is the LCP candidate. */

function Hero({ featured }: { featured: DiscoveryProduct[] }) {
  const lead = featured[0]
  const rest = featured.slice(1, 4)
  return (
    <section className="bg-paper">
      <div className="mx-auto grid max-w-[1320px] items-center gap-10 px-6 py-12 md:grid-cols-2 md:gap-14 md:px-10 md:py-20">
        <div className="min-w-0">
          <p
            className="mb-5 text-[11px] uppercase tracking-[0.2em] text-ink-3"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            Sexual wellness, <span className="text-coral">edited</span>
          </p>
          <h1
            className="text-[2.6rem] leading-[0.98] tracking-[-0.03em] text-ink md:text-6xl"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
          >
            Pleasure, <em className="em">curated</em>.<br className="hidden sm:block" /> Never
            overwhelming.
          </h1>
          <p
            className="mt-5 max-w-md text-[16px] leading-relaxed text-ink-3"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Emma reads the specs, weighs the reviews, and points you to what actually fits. No
            clinical aisles, no guesswork. Discreet shipping, billed as XDIPX.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/vault"
              className="inline-flex items-center gap-2 rounded-full bg-coral px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-coral-2"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              Browse the edit <span aria-hidden="true">→</span>
            </Link>
            <Link
              to="/discover"
              className="inline-flex items-center gap-2 rounded-full border border-line-2 px-6 py-3 text-[15px] font-medium text-ink transition-colors hover:bg-paper-2"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              Find your fit
            </Link>
          </div>
        </div>

        {/* Featured collage — lead tile + up to 3 supporting tiles. */}
        {lead && (
          <div className="grid grid-cols-2 gap-3 md:gap-4">
            <Link
              to={`/products/${lead.handle}`}
              className="group relative col-span-2 aspect-[16/10] overflow-hidden rounded-[var(--radius-lg)] border border-line bg-paper-2"
              aria-label={lead.title}
            >
              {lead.imageUrl ? (
                <OptimizedImage
                  src={lead.imageUrl}
                  alt={lead.imageAlt ?? lead.title}
                  priority
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-[var(--duration-slow)] ease-[var(--ease-standard)] group-hover:scale-[1.03]"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-sage text-5xl">♥</div>
              )}
              <span
                className="absolute bottom-3 left-3 rounded-full bg-paper/90 px-3 py-1 text-[12px] font-medium text-ink backdrop-blur"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                Emma's pick · {lead.title}
              </span>
            </Link>
            {rest.map(p => (
              <Link
                key={p.id}
                to={`/products/${p.handle}`}
                className="group relative aspect-square overflow-hidden rounded-[var(--radius-lg)] border border-line bg-paper-2"
                aria-label={p.title}
              >
                {p.imageUrl ? (
                  <OptimizedImage
                    src={p.imageUrl}
                    alt={p.imageAlt ?? p.title}
                    sizes="(max-width: 768px) 50vw, 25vw"
                    widths={[240, 480]}
                    fallbackWidth={480}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-[var(--duration-slow)] ease-[var(--ease-standard)] group-hover:scale-[1.04]"
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-sage text-3xl">♥</div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/* ── Category tiles ──────────────────────────────────────────────────────── */

const CATEGORY_TILES: { label: string; sub: string; to: string }[] = [
  { label: 'For Him', sub: 'Strokers, rings, prostate', to: '/for-him' },
  { label: 'For Her', sub: 'Vibrators, wands, more', to: '/for-her' },
  { label: 'The Vault', sub: 'Every past pick', to: '/vault' },
  { label: 'Find your fit', sub: 'Answer a few, get matched', to: '/discover' },
]

function CategoryTiles() {
  return (
    <section className="bg-paper-2 border-y border-line">
      <div className="mx-auto max-w-[1320px] px-6 py-10 md:px-10 md:py-14">
        <header className="mb-6 flex items-end justify-between gap-4">
          <h2
            className="text-2xl text-ink md:text-3xl"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
          >
            Start <em className="em">somewhere</em>
          </h2>
        </header>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {CATEGORY_TILES.map((t, i) => (
            <Reveal key={t.to} variant="up" index={i} as="div">
              <Link
                to={t.to}
                className="group flex h-full flex-col justify-between rounded-[var(--radius-lg)] border border-line bg-paper p-5 transition-colors hover:border-coral hover:bg-coral-soft/40"
              >
                <p
                  className="text-lg text-ink group-hover:text-plum transition-colors"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                >
                  {t.label}
                </p>
                <p className="mt-6 text-[13px] text-ink-3" style={{ fontFamily: 'var(--font-body)' }}>
                  {t.sub} <span aria-hidden="true" className="text-coral">→</span>
                </p>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── Bestseller rail (a discovery category) ──────────────────────────────── */

function StorefrontRail({ rail, leadPriority }: { rail: Rail; leadPriority?: boolean }) {
  if (!rail.items.length) return null
  return (
    <section className="bg-paper">
      <div className="mx-auto max-w-[1320px] px-6 py-8 md:px-10 md:py-10">
        <header className="mb-5 flex items-end justify-between gap-4">
          <h2
            className="text-2xl text-ink md:text-3xl"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
          >
            The <em className="em">{rail.category}</em> edit
          </h2>
          <Link
            to="/discover"
            className="link-coral whitespace-nowrap text-[13px] text-ink"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Explore all <span aria-hidden="true">→</span>
          </Link>
        </header>
        <div className="-mx-6 flex snap-x gap-4 overflow-x-auto px-6 pb-2 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0 lg:grid-cols-5">
          {rail.items.slice(0, 10).map((it, i) => (
            <div key={it.product.id} className="snap-start">
              <StorefrontProductCard product={it.product} priority={!!leadPriority && i === 0} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── "Find your fit" editorial band → /discover ──────────────────────────── */

function FindYourFitBand() {
  return (
    <section className="bg-ink text-paper">
      <div className="mx-auto flex max-w-[1320px] flex-col items-start gap-6 px-6 py-14 md:flex-row md:items-center md:justify-between md:px-10 md:py-20">
        <div className="max-w-xl">
          <p
            className="mb-4 text-[11px] uppercase tracking-[0.2em] text-paper/60"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            Not sure where to start?
          </p>
          <h2
            className="text-3xl leading-tight md:text-5xl"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
          >
            Tell Emma a <em className="em" style={{ color: 'var(--color-coral-2)' }}>mood</em>. She'll
            find the fit.
          </h2>
          <p className="mt-4 text-[16px] text-paper/70" style={{ fontFamily: 'var(--font-body)' }}>
            A few taps on what matters to you, and the shelf reshapes around it.
          </p>
        </div>
        <Link
          to="/discover"
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-coral px-7 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-coral-2"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          Find your fit <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  )
}

/* ── Trust bar ───────────────────────────────────────────────────────────── */

const TRUST = [
  { t: 'Discreet shipping', s: 'Plain box, no branding' },
  { t: 'Billed as XDIPX', s: 'Nothing else on your statement' },
  { t: '30-day returns', s: 'Unopened, no questions' },
  { t: 'Vetted by humans', s: 'Specs and reviews, read for you' },
]

function TrustBar() {
  return (
    <section className="bg-paper-2 border-y border-line">
      <div className="mx-auto grid max-w-[1320px] grid-cols-2 gap-x-6 gap-y-7 px-6 py-10 md:grid-cols-4 md:px-10">
        {TRUST.map(item => (
          <div key={item.t}>
            <p className="text-[15px] text-ink" style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}>
              {item.t}
            </p>
            <p className="mt-1 text-[13px] text-ink-3" style={{ fontFamily: 'var(--font-body)' }}>
              {item.s}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── Composition ─────────────────────────────────────────────────────────── */

export function StorefrontHome({ featured, rails, forHim, forHer, contentBlocks }: StorefrontData) {
  return (
    <>
      <Hero featured={featured} />
      <CategoryTiles />

      {rails.map((rail, i) => (
        <StorefrontRail key={rail.category} rail={rail} leadPriority={i === 0} />
      ))}

      <FindYourFitBand />

      {forHim.length > 0 && (
        <ProductCarousel
          heading="Dialed in. Just for him. ♥"
          eyebrow="For Him"
          ctaLink="/for-him"
          ctaLabel="See all →"
          bgStyle="mist"
          products={forHim}
        />
      )}
      {forHer.length > 0 && (
        <ProductCarousel
          heading="Made for her. Obviously. ♥"
          eyebrow="For Her"
          ctaLink="/for-her"
          ctaLabel="See all →"
          bgStyle="cream"
          products={forHer}
        />
      )}

      <TrustBar />

      {/* Deferred Sanity merchandising surface — promos / editorial bands the
          autonomous team writes, streamed in below the stable shell. */}
      <Suspense fallback={null}>
        <Await resolve={contentBlocks} errorElement={null}>
          {({ sections, carouselProductMap }) =>
            sections.length > 0 ? (
              <>
                {sections
                  .filter(b => b._type !== 'announcementBar')
                  .map(block => (
                    <ContentBlockRenderer
                      key={block._key}
                      block={block}
                      carouselProductMap={carouselProductMap}
                    />
                  ))}
              </>
            ) : null
          }
        </Await>
      </Suspense>

      <EmailSubscribe />
    </>
  )
}
