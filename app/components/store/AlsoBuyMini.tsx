export interface AlsoBuyItem {
  handle:         string
  title:          string
  image:          string | null
  price:          number
  compareAtPrice: number | null
  variantId:      string
}

interface AlsoBuyMiniProps {
  items:    AlsoBuyItem[]
  /** Set of variantIds currently checked. Owned by the parent route so the
   *  Add-to-cart form can read the same state and switch its payload to
   *  intent=addMany when any are checked. */
  checked:  Set<string>
  onToggle: (variantId: string) => void
}

/**
 * Impulse-buy cross-sell that sits next to the sensation dial in the PDP
 * buy column. Each row is intentionally minimal — checkbox, thumbnail,
 * price — so the shopper can tick without a comprehension tax. The
 * thumbnail carries the recognition load.
 *
 * Stateless — the parent route owns `checked` so the Add-to-cart form
 * reads the same state and picks up extras on a single submission via
 * /api/cart's existing addMany intent.
 */
export function AlsoBuyMini({ items, checked, onToggle }: AlsoBuyMiniProps) {
  if (items.length === 0) return null

  return (
    <section aria-label="Customers also buy">
      <h3
        className="text-[11px] uppercase tracking-wider text-coral mb-2 font-medium text-left"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Customers also buy
      </h3>
      {/* Mobile: 2-column grid with image-dominant cards (full column width).
          lg+: vertical stack of compact horizontal rows next to the dial. */}
      <ul className="grid grid-cols-2 gap-3 lg:flex lg:flex-col lg:gap-2">
        {items.map(item => {
          const isChecked = checked.has(item.variantId)
          return (
            <li key={item.variantId}>
              <label className="relative flex flex-col cursor-pointer group lg:flex-row lg:items-center lg:justify-end lg:gap-3">
                {/* Checkbox: overlaid top-left of image on mobile;
                    inline before the image on lg+. */}
                <input
                  type="checkbox"
                  className="absolute top-2 left-2 z-20 h-5 w-5 rounded border-line text-coral focus:ring-coral focus:ring-offset-0 cursor-pointer accent-coral lg:static lg:order-1 lg:shrink-0 transition-opacity duration-200 lg:group-hover:opacity-0 lg:group-hover:pointer-events-none"
                  checked={isChecked}
                  onChange={() => onToggle(item.variantId)}
                  aria-label={`Add ${item.title} to cart`}
                />
                <div
                  className="relative w-full aspect-square lg:order-2 lg:w-24 lg:h-24 lg:aspect-auto lg:shrink-0 transition-transform duration-300 ease-out origin-center lg:group-hover:scale-[1.875] lg:group-hover:z-10 lg:group-hover:drop-shadow-lg"
                >
                  {/* Inner clipper — owns the rounded corners + overflow so
                      the outer wrapper can let the "Click to add" badge
                      hang off the top-right corner without being clipped. */}
                  <div className="absolute inset-0 rounded-md overflow-hidden bg-cream-2">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.title}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-ink/15 text-3xl lg:text-2xl">♥</div>
                    )}
                    {/* Title caption — gradient backdrop for legibility over
                        any product photo. Visible at all times so the row
                        is readable on touch devices that have no hover. */}
                    <div className="absolute inset-x-0 bottom-0 px-2 pt-4 pb-1.5 bg-gradient-to-t from-coral-deep/95 via-coral/65 to-transparent pointer-events-none lg:px-1.5 lg:pt-3 lg:pb-1">
                      <p className="text-white text-xs font-semibold leading-tight line-clamp-2 lg:text-[10px]">
                        {item.title}
                      </p>
                    </div>
                  </div>
                  {/* "Click to add" badge — desktop-only, fades in on hover.
                      Sits OUTSIDE the inner clipper so the negative offset
                      makes it hang off the top-right corner of the image.
                      pointer-events-none so the click reaches the label
                      and toggles the underlying checkbox. */}
                  <div className="hidden lg:block absolute -top-1.5 -right-1 pointer-events-none opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <span
                      className="bg-paper text-coral text-[7px] font-bold uppercase px-1.5 py-0.5 rounded-full shadow-md whitespace-nowrap border border-coral"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      Click to add
                    </span>
                  </div>
                </div>
                <span className="block mt-1.5 text-right text-coral font-bold text-sm tabular-nums lg:order-3 lg:mt-0 lg:text-left">
                  ${item.price.toFixed(2)}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
