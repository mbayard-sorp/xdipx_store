import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import type { ChatProductCard, ChatVariantOption } from '~/lib/ai-agent/chat-types'

interface Props {
  card: ChatProductCard
  onVariantPick?: (card: ChatProductCard, variant: ChatVariantOption) => void
  onTellMore?: (card: ChatProductCard) => void
}

export function AskEmmaProductCard({ card, onVariantPick, onTellMore }: Props) {
  const priceLabel = formatPrice(card.price)
  const showPct = card.phrasing === 'deal' && card.pctOff > 0
  const variants = card.variantOptions ?? []
  const pricesDiffer = variants.length > 0 && new Set(variants.map((v) => v.price)).size > 1
  const hasPicker = variants.length > 1 && !!onVariantPick
  const canQuickAdd = !hasPicker && card.inStock && !!card.variantId

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white transition-all hover:border-coral/40 hover:shadow-sm">
      <div className="flex items-center gap-2 p-2">
        <Link
          to={card.url}
          onClick={() => onTellMore?.(card)}
          aria-label={`${card.title} — open product page`}
          className="group flex flex-1 items-center gap-3 min-w-0 text-left"
        >
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-cream-2">
            {card.imageUrl ? (
              <img
                src={card.imageUrl}
                alt={card.imageAlt ?? card.title}
                width={48}
                height={48}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-ink/20">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18M9 21V9" />
                </svg>
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink group-hover:text-coral">
              {card.title}
            </p>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-coral">{priceLabel}</span>
              {showPct && (
                <span className="rounded-full bg-gradient-to-r from-coral to-coral-2 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  {card.pctOff}% off
                </span>
              )}
              {!card.inStock && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/50">
                  sold out
                </span>
              )}
            </div>
          </div>
        </Link>

        {canQuickAdd && <QuickAddButton variantId={card.variantId} title={card.title} />}
      </div>

      {hasPicker && (
        <div className="border-t border-line px-2 py-2">
          <p className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/50">
            Pick an option to add
          </p>
          <div className="flex flex-wrap gap-1">
            {variants.map((v) => (
              <button
                key={v.variantId}
                type="button"
                onClick={() => onVariantPick!(card, v)}
                disabled={!v.inStock}
                className="rounded-full border border-coral/30 bg-white px-2.5 py-1 text-[11px] font-medium text-coral transition hover:border-coral hover:bg-ink hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:border-ink/20 disabled:bg-cream-2 disabled:text-ink/40 disabled:hover:bg-cream-2 disabled:hover:text-ink/40"
              >
                {v.label}
                {pricesDiffer && <span className="ml-1 opacity-70">· {formatPrice(v.price)}</span>}
                {!v.inStock && <span className="ml-1 opacity-60">· sold out</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function QuickAddButton({ variantId, title }: { variantId: string; title: string }) {
  const fetcher = useFetcher()
  const wasSubmitting = useRef(false)
  const [added, setAdded] = useState(false)
  const isPending = fetcher.state !== 'idle'

  useEffect(() => {
    if (fetcher.state === 'submitting') {
      wasSubmitting.current = true
    } else if (fetcher.state === 'idle' && wasSubmitting.current) {
      wasSubmitting.current = false
      const data = fetcher.data as { ok?: boolean } | undefined
      if (data?.ok) {
        setAdded(true)
        window.dispatchEvent(new CustomEvent('xdipx:cart-added'))
        const t = setTimeout(() => setAdded(false), 1600)
        return () => clearTimeout(t)
      }
    }
  }, [fetcher.state, fetcher.data])

  return (
    <fetcher.Form method="post" action="/api/cart" className="shrink-0">
      <input type="hidden" name="intent" value="add-item" />
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="quantity" value="1" />
      <button
        type="submit"
        disabled={isPending || added}
        aria-label={added ? `${title} added to cart` : `Add ${title} to cart`}
        className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-r from-coral to-coral-2 text-white shadow-sm transition hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-80"
      >
        {added ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <span className="relative">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
              <path d="M3 6h18" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white text-coral" aria-hidden="true">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </span>
          </span>
        )}
      </button>
    </fetcher.Form>
  )
}

function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return ''
  return `$${n.toFixed(2)}`
}
