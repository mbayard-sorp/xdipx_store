import { Link } from 'react-router'
import type { Deal } from '~/types'

export type EmmaHeroVariant = 'loving' | 'bundle' | 'quote'

interface EmmaHeroProps {
  deal:     Deal
  variant?: EmmaHeroVariant
  /** When true, UI suppresses discount framing (struck price, "save $X"). */
  mapRestricted?: boolean
  /** Optional editorial copy overrides from Sanity. */
  copy?: {
    eyebrow?:   string
    headline?:  string
    body?:      string
    aside?:     string
    pullQuote?: string
  }
  /** Only used by `bundle` variant. Second product in the pair. */
  pairDeal?: Deal | null
  /** Combined bundle price when `pairDeal` is present. Optional; otherwise sum. */
  bundlePrice?:      number
  bundleCompareAt?:  number
}

export function EmmaHero({ deal, variant = 'loving', mapRestricted = false, copy, pairDeal = null, bundlePrice, bundleCompareAt }: EmmaHeroProps) {
  if (variant === 'bundle' && pairDeal) {
    return (
      <HeroBundle
        deal={deal}
        pair={pairDeal}
        {...(bundlePrice     !== undefined ? { bundlePrice }     : {})}
        {...(bundleCompareAt !== undefined ? { bundleCompareAt } : {})}
        {...(copy            !== undefined ? { copy }            : {})}
      />
    )
  }
  if (variant === 'quote') {
    return <HeroQuote deal={deal} mapRestricted={mapRestricted} copy={copy} />
  }
  return <HeroLoving deal={deal} mapRestricted={mapRestricted} copy={copy} />
}

// ── Variant 1: Currently loving ─────────────────────────────────────────────
function HeroLoving({ deal, mapRestricted, copy }: { deal: Deal; mapRestricted: boolean; copy?: EmmaHeroProps['copy'] }) {
  const savings = deal.msrp > deal.dealPrice ? deal.msrp - deal.dealPrice : 0
  const showDiscount = !mapRestricted && savings > 0
  const discountPct = showDiscount && deal.msrp > 0
    ? Math.round(((deal.msrp - deal.dealPrice) / deal.msrp) * 100)
    : 0
  const image = deal.images[0]
  return (
    <section className="bg-cream">
      <div className="max-w-6xl mx-auto px-4 py-8 md:py-14 grid gap-6 md:grid-cols-[1.25fr_1fr]">
        <div className="relative rounded-[var(--radius-lg)] overflow-hidden bg-cream-2 aspect-[4/5] md:aspect-auto md:min-h-[480px]">
          {image ? (
            <img
              src={image.url}
              alt={image.altText ?? deal.seoTitle}
              className="absolute inset-0 w-full h-full object-cover"
              loading="eager"
              fetchPriority="high"
            />
          ) : null}
          {showDiscount && discountPct > 0 && (
            <span
              className="absolute top-4 left-4 inline-flex items-center gap-1 bg-coral text-white text-[11px] tracking-[0.12em] uppercase font-bold px-3 py-1.5 rounded-full"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {discountPct}% off this week
            </span>
          )}
        </div>

        <div className="flex flex-col justify-center gap-4 md:py-6">
          <div className="flex items-center gap-2">
            <span className="text-coral text-xl leading-none" aria-hidden="true">♥</span>
            <span
              className="text-coral text-[11px] tracking-[0.18em] uppercase font-semibold"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {copy?.eyebrow ?? 'Currently loving'}
            </span>
          </div>

          <h1
            className="font-black text-ink leading-[1.05] text-3xl md:text-5xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {copy?.headline ?? deal.seoTitle}
          </h1>

          <p className="text-ink/75 text-base md:text-lg leading-relaxed max-w-prose">
            {copy?.body ?? deal.tagline}
          </p>

          <div className="flex items-baseline gap-3 mt-2">
            {showDiscount ? (
              <>
                <span className="text-3xl font-black text-coral" style={{ fontFamily: 'var(--font-display)' }}>
                  ${deal.dealPrice.toFixed(0)}
                </span>
                <span className="text-muted line-through">${deal.msrp.toFixed(0)}</span>
              </>
            ) : (
              <span className="text-3xl font-black text-ink" style={{ fontFamily: 'var(--font-display)' }}>
                ${deal.dealPrice.toFixed(0)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mt-1">
            <Link
              to={`/products/${deal.handle}`}
              className="inline-flex items-center gap-2 bg-coral hover:bg-coral-deep text-white font-semibold px-6 py-3 rounded-full transition-colors"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Take a peek →
            </Link>
            <button
              type="button"
              onClick={() => {
                if (typeof window === 'undefined') return
                window.dispatchEvent(new CustomEvent('emma:open', {
                  detail: { reason: 'why-this-pick', productHandle: deal.handle, productTitle: deal.seoTitle },
                }))
              }}
              className="inline-flex items-center gap-2 border border-ink/20 hover:border-ink/60 text-ink font-medium px-6 py-3 rounded-full transition-colors"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Ask Emma why
            </button>
          </div>

          <p className="text-muted text-xs mt-3 font-mono">
            {copy?.aside ?? "— Emma · changes when I find something new worth telling you about"}
          </p>
        </div>
      </div>
    </section>
  )
}

// ── Variant 2: Emma recommends — a pair ─────────────────────────────────────
function HeroBundle({ deal, pair, bundlePrice, bundleCompareAt, copy }: {
  deal: Deal
  pair: Deal
  bundlePrice?: number
  bundleCompareAt?: number
  copy?: EmmaHeroProps['copy']
}) {
  const price    = bundlePrice    ?? deal.dealPrice + pair.dealPrice
  const compare  = bundleCompareAt ?? deal.msrp + pair.msrp
  const savings  = compare > price ? compare - price : 0
  const image1   = deal.images[0]
  const image2   = pair.images[0]
  const combinedSlug = [deal.handle, pair.handle].sort().join('--')

  return (
    <section className="bg-cream-2">
      <div className="max-w-6xl mx-auto px-4 py-8 md:py-14 flex flex-col gap-6">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-coral text-xl leading-none" aria-hidden="true">♥</span>
          <span
            className="text-coral text-[11px] tracking-[0.18em] uppercase font-semibold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {copy?.eyebrow ?? 'Emma recommends · a pair'}
          </span>
          <span className="text-muted text-xs font-mono md:ml-auto">better together · save when you grab both</span>
        </div>

        <h1
          className="font-black text-ink leading-[1.05] text-3xl md:text-5xl"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {copy?.headline ?? 'These two were made for each other.'}
        </h1>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 md:gap-6">
          <div className="relative rounded-[var(--radius)] overflow-hidden bg-paper aspect-square">
            {image1 && (
              <img
                src={image1.url}
                alt={image1.altText ?? deal.seoTitle}
                className="absolute inset-0 w-full h-full object-cover"
                loading="eager"
              />
            )}
          </div>
          <span
            className="text-coral text-3xl md:text-4xl font-black bg-paper border border-ink/15 px-3 py-1 rounded-full rotate-[-4deg]"
            style={{ fontFamily: 'var(--font-display)' }}
            aria-hidden="true"
          >
            +
          </span>
          <div className="relative rounded-[var(--radius)] overflow-hidden bg-paper aspect-square">
            {image2 && (
              <img
                src={image2.url}
                alt={image2.altText ?? pair.seoTitle}
                className="absolute inset-0 w-full h-full object-cover"
                loading="eager"
              />
            )}
          </div>
        </div>

        <p className="text-ink/75 text-base md:text-lg leading-relaxed max-w-prose">
          {copy?.body ?? 'Been telling everyone about this combo for weeks. One does the heavy lifting, the other\'s the reason you\'ll want to come back.'}
        </p>

        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-3xl font-black text-coral" style={{ fontFamily: 'var(--font-display)' }}>
            ${price.toFixed(0)}
          </span>
          {savings > 0 && (
            <>
              <span className="text-muted line-through">${compare.toFixed(0)}</span>
              <span className="text-sun bg-ink text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide">
                save ${savings.toFixed(0)} as a pair
              </span>
            </>
          )}
          <Link
            to={`/products/${combinedSlug}`}
            className="md:ml-auto inline-flex items-center gap-2 bg-coral hover:bg-coral-deep text-white font-semibold px-6 py-3 rounded-full transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            I'll take both ♥
          </Link>
        </div>

        <p className="text-muted text-xs font-mono">
          {copy?.aside ?? '— Emma · picked this pairing recently · will change it when I\'m into something new'}
        </p>
      </div>
    </section>
  )
}

// ── Variant 3: Emma says ────────────────────────────────────────────────────
function HeroQuote({ deal, mapRestricted, copy }: { deal: Deal; mapRestricted: boolean; copy?: EmmaHeroProps['copy'] }) {
  const showDiscount = !mapRestricted && deal.msrp > deal.dealPrice
  const discountPct = showDiscount && deal.msrp > 0
    ? Math.round(((deal.msrp - deal.dealPrice) / deal.msrp) * 100)
    : 0
  const image = deal.images[0]
  const defaultQuote = `I've been a little obsessed with this one — it's got a kind of slow-burn energy I wasn't expecting. Come see.`
  return (
    <section className="bg-cream">
      <div className="max-w-6xl mx-auto px-4 py-8 md:py-14 grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
        <div className="bg-paper border border-line rounded-[var(--radius-lg)] p-6 md:p-10 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-coral text-white inline-flex items-center justify-center font-bold" style={{ fontFamily: 'var(--font-display)' }} aria-hidden="true">
              E
            </span>
            <div>
              <p
                className="text-muted text-[11px] tracking-[0.18em] uppercase font-semibold"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {copy?.eyebrow ?? 'Emma says'}
              </p>
              <p className="text-muted text-xs font-mono">updated whenever I change my mind</p>
            </div>
          </div>

          <blockquote
            className="font-black text-ink leading-[1.1] text-2xl md:text-3xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            “{copy?.pullQuote ?? defaultQuote}”
          </blockquote>

          <div className="flex flex-wrap gap-2 mt-1">
            <Link
              to={`/products/${deal.handle}`}
              className="inline-flex items-center gap-2 bg-coral hover:bg-coral-deep text-white font-semibold px-6 py-3 rounded-full transition-colors"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Show me →
            </Link>
            <Link
              to="/collections/pleasure"
              className="inline-flex items-center gap-2 border border-ink/20 hover:border-ink/60 text-ink font-medium px-6 py-3 rounded-full transition-colors"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              What else she's into
            </Link>
          </div>
        </div>

        <div className="relative rounded-[var(--radius-lg)] overflow-hidden bg-cream-2 aspect-[4/5] md:aspect-auto md:min-h-[420px]">
          {image && (
            <img
              src={image.url}
              alt={image.altText ?? deal.seoTitle}
              className="absolute inset-0 w-full h-full object-cover"
              loading="eager"
              fetchPriority="high"
            />
          )}
          {showDiscount && discountPct > 0 && (
            <span
              className="absolute top-4 left-4 inline-flex items-center gap-1 bg-coral text-white text-[11px] tracking-[0.12em] uppercase font-bold px-3 py-1.5 rounded-full"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {discountPct}% off this week
            </span>
          )}
          <div className="absolute left-4 right-4 bottom-4 bg-paper/95 border border-line rounded-[var(--radius)] px-3 py-2">
            <p
              className="font-black text-ink text-sm md:text-base leading-tight"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {deal.brand ? `${deal.brand} · ` : ''}{deal.seoTitle}
            </p>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-coral font-semibold text-sm">${deal.dealPrice.toFixed(0)}</span>
              <span className="text-muted text-xs">· free shipping</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
