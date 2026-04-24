import { Link } from 'react-router'
import type { ChatProductCard, ChatVariantOption } from '~/lib/ai-agent/chat-types'

interface Props {
  card: ChatProductCard
  /** @deprecated add-to-cart removed from chat cards; prop kept for caller compatibility */
  onVariantPick?: ((card: ChatProductCard, variant: ChatVariantOption) => void) | undefined
  onTellMore?: ((card: ChatProductCard) => void) | undefined
}

export function AskEmmaProductCard({ card, onTellMore }: Props) {
  const priceLabel = formatPrice(card.price)
  const showPct = card.phrasing === 'deal' && card.pctOff > 0

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
      </div>
    </div>
  )
}

function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return ''
  return `$${n.toFixed(2)}`
}
