import { Reveal } from '~/components/motion/Reveal'
import type { TrustBarBlock } from '~/types/cms'
import { FREE_SHIPPING_THRESHOLD } from '~/lib/shipping'

const BODY = { fontFamily: 'var(--font-body)' } as const

export interface TrustStripItem {
  headline: string
  subheadline?: string | undefined
}

/**
 * Shell fallback for the trust strip, used when the team has published no
 * `trustBar` block.
 *
 * Per docs/design-doctrine.md §6, discretion copy names the dreaded moments
 * (the box, the label, the card statement) rather than stating a flat fact, so
 * "Billed as XDIPX" is now a promise about what a partner or a bank statement
 * will actually show. The free-shipping line interpolates the shared
 * FREE_SHIPPING_THRESHOLD (~/lib/shipping) rather than a hardcoded dollar
 * figure, precisely so this line can't drift from the Shopify-verified
 * threshold the way a hand-typed "$99" would (HI/AK/PR differs and is stated
 * at checkout, not promised here). No fabricated proof: every line is a
 * mechanic we can honor.
 */
export const TRUST_STRIP_FALLBACK: TrustStripItem[] = [
  { headline: 'Ships in plain packaging' },
  { headline: 'No logo on the box, no product name on the label' },
  { headline: 'Your statement reads XDIPX' },
  { headline: `Free US shipping over $${FREE_SHIPPING_THRESHOLD}` },
  { headline: 'Hand-checked, not auto-listed' },
]

/** Published trust items win; drop null/inactive refs, then fall back to the
 *  shell array when nothing usable survives (never render an empty strip). */
export function trustStripItems(block?: TrustBarBlock | undefined): TrustStripItem[] {
  const published = (block?.trustItems ?? [])
    .filter(i => i != null && i.active !== false && !!i.headline)
    .map(i => ({ headline: i.headline, subheadline: i.subheadline }))
  return published.length > 0 ? published : TRUST_STRIP_FALLBACK
}

/**
 * The Nº 02 trust strip, extracted from StorefrontHome so collection pages can
 * hoist the same trust content under their masthead (ticket #3424: billing
 * descriptor, plain packaging, and shipping promises were only visible below
 * ~74% page depth on PLPs, invisible to a cold paid click).
 *
 * Variants:
 *  - `band` (default): the homepage hero-band treatment, full-bleed with the
 *    top hairline — byte-for-byte the markup StorefrontHome rendered inline.
 *  - `card`: a bordered rounded strip for use inside a constrained page
 *    column (collection pages), quiet enough to sit under a masthead.
 */
export function TrustStrip({
  trustBar,
  variant = 'band',
  className,
}: {
  trustBar?: TrustBarBlock | undefined
  variant?: 'band' | 'card'
  className?: string
}) {
  const items = trustStripItems(trustBar)

  if (variant === 'card') {
    return (
      <Reveal
        variant="fade"
        as="div"
        className={`rounded-2xl border border-line bg-paper px-4 py-3.5 md:px-6 ${className ?? ''}`}
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-5 md:items-start md:gap-x-8">
          {items.map(item => (
            <div key={item.headline} className="flex items-start gap-2.5 text-[13px] text-ink-3" style={BODY}>
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
    )
  }

  return (
    <Reveal variant="fade" as="div" className={`border-t border-line ${className ?? ''}`}>
      <div className="mx-auto grid max-w-[1320px] grid-cols-2 gap-x-6 gap-y-3.5 px-6 py-[18px] md:grid-cols-5 md:items-start md:gap-x-8 md:px-16">
        {items.map(item => (
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
  )
}
