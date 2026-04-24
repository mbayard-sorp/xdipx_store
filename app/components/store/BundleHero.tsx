import { Link, useFetcher } from 'react-router'
import type { Bundle } from '~/types'

interface BundleHeroProps {
  bundle: Bundle
  buyButtonText?: string
  /** Render a smaller, card-style variant (used inside PDP "Bundle & Save" card). */
  compact?: boolean
}

export function BundleHero({ bundle, buyButtonText = 'Dip In ♥', compact = false }: BundleHeroProps) {
  const fetcher = useFetcher()
  const isPending = fetcher.state !== 'idle'
  const savings = +(bundle.originalTotal - bundle.bundlePrice).toFixed(2)

  const content = (
    <div className={compact ? 'space-y-4' : 'grid md:grid-cols-2 gap-8 lg:gap-12 items-start'}>
      <div className={compact ? '' : 'order-2 md:order-1'}>
        <p className="text-sage text-sm font-semibold uppercase tracking-widest">
          ♥ Bundle Deal
        </p>
        <h1
          className={
            compact
              ? 'text-xl font-bold text-ink mt-1 leading-snug'
              : 'text-2xl md:text-3xl font-bold text-ink mt-1 leading-snug'
          }
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {bundle.title}
        </h1>
        {bundle.tagline && (
          <p className="text-ink/70 mt-2 italic">{bundle.tagline}</p>
        )}

        <div className="flex items-baseline gap-3 flex-wrap mt-4">
          <span
            className={
              compact
                ? 'text-2xl font-black text-coral'
                : 'text-4xl font-black text-coral'
            }
            style={{ fontFamily: 'var(--font-display)' }}
          >
            ${bundle.bundlePrice.toFixed(2)}
          </span>
          <span className="text-ink/40 text-lg line-through">
            ${bundle.originalTotal.toFixed(2)}
          </span>
          {bundle.discountPct > 0 && (
            <span className="bg-coral text-white text-sm font-bold px-3 py-1 rounded-full">
              {bundle.discountPct}% off
            </span>
          )}
        </div>
        {savings > 0 && (
          <p className="text-sm text-sage font-semibold mt-1">
            You save ${savings.toFixed(2)}
          </p>
        )}

        <ul className="mt-5 space-y-2">
          {bundle.components.map(c => {
            const img = c.product.images[0]
            return (
              <li key={c.product.handle} className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-lg overflow-hidden bg-cream-2 shrink-0">
                  {img ? (
                    <img
                      src={img.url}
                      alt={img.altText || c.product.title}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-ink/20 text-xl">♥</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/products/${c.product.handle}`}
                    className="text-sm font-semibold text-ink hover:text-coral transition-colors line-clamp-2"
                  >
                    {c.product.title}
                  </Link>
                  {c.quantity > 1 && (
                    <span className="text-xs text-ink/50 ml-1">× {c.quantity}</span>
                  )}
                </div>
                <span className="text-sm text-ink/60 tabular-nums">
                  ${c.product.price.toFixed(2)}
                </span>
              </li>
            )
          })}
        </ul>

        <fetcher.Form method="post" action="/api/cart" className="mt-6">
          <input type="hidden" name="intent" value="add-bundle" />
          <input type="hidden" name="bundleHandle" value={bundle.handle} />
          <button
            type="submit"
            disabled={isPending}
            className="w-full py-4 rounded-full font-bold text-lg bg-coral text-white hover:opacity-90 hover:scale-[1.01] shadow-md shadow-coral/20 transition-all"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {isPending ? 'Adding...' : `${buyButtonText} — Add Bundle`}
          </button>
        </fetcher.Form>
      </div>

      {!compact && (
        <div className="order-1 md:order-2 grid grid-cols-2 gap-2">
          {bundle.images.slice(0, 4).map((img, i) => (
            <div
              key={i}
              className={`rounded-2xl overflow-hidden bg-cream-2 ${
                bundle.images.length === 1 ? 'col-span-2 aspect-video' : 'aspect-square'
              }`}
            >
              <img
                src={img.url}
                alt={img.altText || bundle.title}
                loading="eager"
                decoding="async"
                className="w-full h-full object-cover"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )

  if (compact) return content

  return (
    <section className="max-w-6xl mx-auto px-4 py-8 relative">
      {content}
    </section>
  )
}

export default BundleHero
