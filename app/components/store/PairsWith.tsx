import { useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { shopifyImageUrl, shopifyImageSrcSet } from '~/lib/shopify-image'

export interface PairsWithItem {
  shopifyProductId: string
  handle:           string
  title:            string
  image:            string | null
  price:            number
  compareAtPrice:   number | null
  variantId:        string
  /** Emma's warm "why" copy for this pairing. Optional. */
  why?:             string
}

/** The product the page is actually about — rendered as the anchor, never addable. */
export interface PairsWithMain {
  handle:  string
  title:   string
  image:   string | null
  price:   number
}

interface PairsWithProps {
  main:  PairsWithMain
  /** 1-2 accessories. Module hides entirely if this is empty. */
  items: PairsWithItem[]
}

const TINTS = ['bg-paper-3', 'bg-plum-soft'] as const

/**
 * 1l — Pairs-with module (PDP). Main anchor product (not addable) connected
 * to 1-2 accessories by a single coral hairline — vertical spine on mobile,
 * horizontal line on desktop. One warm why-sentence, a `+ add` button per
 * accessory. Items sit directly on paper, no cards, so the coral line stays
 * the loudest structural element.
 *
 * Cart-add reuses the PDP's existing mechanism: fetcher.submit with
 * intent=add-item / variantId / quantity to /api/cart (same contract as the
 * main buy box in _layout.products.$slug.tsx). No JS: the accessory name and
 * image are a real link to its own PDP; the `+ add` button progressively
 * enhances that link with in-place add-to-cart.
 */
export function PairsWith({ main, items }: PairsWithProps) {
  if (items.length === 0) return null
  const capped = items.slice(0, 2)
  const why = capped.find(i => i.why)?.why

  return (
    <section className="mt-12 mb-6" aria-labelledby="pairs-with-heading">
      <p id="pairs-with-heading" className="kicker mb-1.5">
        Pairs with
      </p>
      {why && (
        <p
          className="mb-[18px] max-w-[520px] text-[16.5px] text-ink-2 md:mb-6 md:text-[18px]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {why}
        </p>
      )}

      {/* Mobile — vertical spine */}
      <div className="flex flex-col md:hidden">
        <MainRow main={main} size={96} />
        {capped.map((item, i) => (
          <div key={item.handle} className="contents">
            <div className="ml-12 h-[26px] w-px bg-coral" aria-hidden="true" />
            <AccessoryRow item={item} size={72} tint={TINTS[i % TINTS.length]!} />
          </div>
        ))}
      </div>

      {/* Desktop — horizontal line */}
      <div className="hidden md:flex md:items-center md:gap-0">
        <div className="flex w-[190px] flex-col items-center gap-2 text-center">
          <div className="h-[150px] w-[150px] overflow-hidden rounded-[var(--radius)] bg-coral-soft">
            {main.image && (
              <img
                src={shopifyImageUrl(main.image, 300)}
                srcSet={shopifyImageSrcSet(main.image, [150, 300, 450]) ?? undefined}
                sizes="150px"
                alt={main.title}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover object-bottom"
              />
            )}
          </div>
          <p
            className="text-[16px] font-medium text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {main.title}
          </p>
          <p className="text-[12px] text-ink-3">what you're looking at</p>
          <p className="text-[13px] font-semibold text-ink">${main.price.toFixed(2)}</p>
        </div>

        {capped.map((item, i) => (
          <div key={item.handle} className="contents">
            <div className="mb-[52px] h-px min-w-[40px] flex-1 bg-coral" aria-hidden="true" />
            <AccessoryColumn item={item} tint={TINTS[i % TINTS.length]!} />
          </div>
        ))}
      </div>
    </section>
  )
}

function MainRow({ main, size }: { main: PairsWithMain; size: number }) {
  return (
    <div className="flex items-center gap-3.5">
      <div
        className="shrink-0 overflow-hidden rounded-[var(--radius)] bg-coral-soft"
        style={{ width: size, height: size }}
      >
        {main.image && (
          <img
            src={shopifyImageUrl(main.image, size * 2)}
            alt={main.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover object-bottom"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[16px] font-medium text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {main.title}
        </p>
        <p className="text-[12px] text-ink-3">what you're looking at</p>
      </div>
      <p className="shrink-0 text-[13px] font-semibold text-ink">${main.price.toFixed(2)}</p>
    </div>
  )
}

function AccessoryRow({ item, size, tint }: { item: PairsWithItem; size: number; tint: string }) {
  return (
    <div className="flex items-center gap-3.5">
      <Link to={`/products/${item.handle}`} className="shrink-0">
        <div
          className={`overflow-hidden rounded-[var(--radius)] ${tint}`}
          style={{ width: size, height: size }}
        >
          {item.image && (
            <img
              src={shopifyImageUrl(item.image, size * 2)}
              alt={item.title}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-bottom"
            />
          )}
        </div>
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/products/${item.handle}`}>
          <p
            className="truncate text-[15px] font-medium text-ink hover:text-coral transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {item.title}
          </p>
        </Link>
        <p className="text-[12.5px] font-semibold text-ink">${item.price.toFixed(2)}</p>
      </div>
      <AddButton item={item} className="shrink-0" />
    </div>
  )
}

function AccessoryColumn({ item, tint }: { item: PairsWithItem; tint: string }) {
  return (
    <div className="flex w-[180px] flex-col items-center gap-2 text-center">
      <Link to={`/products/${item.handle}`}>
        <div className={`h-[120px] w-[120px] overflow-hidden rounded-[var(--radius)] ${tint}`}>
          {item.image && (
            <img
              src={shopifyImageUrl(item.image, 240)}
              alt={item.title}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-bottom"
            />
          )}
        </div>
      </Link>
      <Link to={`/products/${item.handle}`}>
        <p
          className="text-[16px] font-medium text-ink hover:text-coral transition-colors line-clamp-1"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {item.title}
        </p>
      </Link>
      <p className="text-[12.5px] font-semibold text-ink">${item.price.toFixed(2)}</p>
      <AddButton item={item} />
    </div>
  )
}

/**
 * `+ add` button — default (coral outline) / hover (coral fill) / active
 * (plum-2 pressed, .press scale) / added ("in the cart ♥", sage outline).
 *
 * The "added" state is optimistic client UI, not a live cart read: /api/cart
 * add-item doesn't return a lineId, so tapping again while "added" can't
 * issue a real remove-item call without first re-fetching the cart. It
 * flips the pill back to default and lets the shopper add again if they
 * tap it by mistake — the actual line stays in the cart until they open
 * the cart drawer and remove it there. Flagged in the PR per the build plan.
 */
function AddButton({ item, className = '' }: { item: PairsWithItem; className?: string }) {
  const fetcher = useFetcher()
  const [added, setAdded] = useState(false)
  const adding = fetcher.state !== 'idle'

  function handleClick() {
    if (added) {
      setAdded(false)
      return
    }
    const formData = new FormData()
    formData.set('intent',    'add-item')
    formData.set('variantId', item.variantId)
    formData.set('quantity',  '1')
    fetcher.submit(formData, { method: 'post', action: '/api/cart' })
    setAdded(true)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('xdipx:cart-added'))
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={adding}
      aria-pressed={added}
      className={[
        'press inline-flex items-center gap-1 rounded-full border px-3.5 py-2 text-[12px] font-semibold transition-colors disabled:opacity-60 md:px-4',
        added
          ? 'border-sage text-sage'
          : 'border-coral text-coral hover:bg-coral hover:text-paper active:bg-plum-2 active:border-plum-2 active:text-paper',
        className,
      ].join(' ')}
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {added ? (
        <>in the cart <span aria-hidden="true">♥</span></>
      ) : adding ? (
        '…'
      ) : (
        '+ add'
      )}
    </button>
  )
}
