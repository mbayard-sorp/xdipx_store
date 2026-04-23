import { useState } from 'react'
import type { Review, ReviewAggregate } from '~/types/reviews'
import type { CareInstructions } from '~/types'
import { ReviewList } from '~/components/reviews/ReviewList'
import { ReviewForm } from '~/components/reviews/ReviewForm'

interface ProductTabsProps {
  /** Sanitized HTML — pulled from Shopify product.descriptionHtml. Renders as "Emma's take". */
  descriptionHtml?: string
  boxContents?:     string[]
  /** Emma-generated short bullets, 3–5 items. */
  careInstructions?: CareInstructions
  specifications?:  string
  productId?:       string
  reviews?:         Review[]
  aggregate?:       ReviewAggregate | null
  reviewTotal?:     number
  reviewPage?:      number
  reviewSort?:      string
  reviewFilter?:    string
}

type Tab = "Emma's take" | 'Specs' | 'In the box' | 'Care' | 'Reviews'

const proseBody = 'prose prose-sm max-w-none text-ink/80 leading-relaxed'

export function ProductTabs({
  descriptionHtml, boxContents = [], careInstructions = [], specifications,
  productId, reviews = [], aggregate, reviewTotal = 0,
  reviewPage = 1, reviewSort = 'newest', reviewFilter = 'all',
}: ProductTabsProps) {
  const reviewCount = aggregate?.approvedCount ?? 0

  const visibleTabs: Tab[] = [
    ...(descriptionHtml ? ["Emma's take" as Tab] : []),
    ...(specifications ? ['Specs' as Tab] : []),
    ...(boxContents.length > 0 ? ['In the box' as Tab] : []),
    ...(careInstructions.length > 0 ? ['Care' as Tab] : []),
    ...(productId ? ['Reviews' as Tab] : []),
  ]

  const [active, setActive] = useState<Tab>(visibleTabs[0] ?? 'Reviews')

  const panelClass = (tab: Tab) => (active === tab ? '' : 'hidden')
  const panelId = (tab: Tab) => `tabpanel-${tab.replace(/\W+/g, '-').toLowerCase()}`
  const tabId   = (tab: Tab) => `tab-${tab.replace(/\W+/g, '-').toLowerCase()}`

  return (
    <div className="mt-10">
      <div
        role="tablist"
        aria-label="Product details"
        className="flex gap-2 border-b border-line overflow-x-auto scrollbar-hide"
      >
        {visibleTabs.map(tab => {
          const isActive = active === tab
          const label = tab === 'Reviews' && reviewCount > 0 ? `Reviews · ${reviewCount}` : tab
          return (
            <button
              key={tab}
              id={tabId(tab)}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={panelId(tab)}
              onClick={() => setActive(tab)}
              className={[
                'px-3 py-2 text-[13px] font-bold whitespace-nowrap rounded-full transition-all',
                isActive
                  ? 'bg-coral text-white'
                  : 'text-ink/60 hover:text-ink hover:bg-cream-2',
              ].join(' ')}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="py-6">
        {descriptionHtml && (
          <section
            id={panelId("Emma's take")}
            role="tabpanel"
            aria-labelledby={tabId("Emma's take")}
            className={panelClass("Emma's take")}
          >
            <div className={proseBody} dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
          </section>
        )}

        {specifications && (
          <section
            id={panelId('Specs')}
            role="tabpanel"
            aria-labelledby={tabId('Specs')}
            className={panelClass('Specs')}
          >
            <div
              className={`${proseBody} [&_table]:w-full [&_table]:text-sm [&_th]:text-left [&_th]:font-semibold [&_th]:py-2 [&_th]:px-3 [&_th]:bg-cream-2 [&_td]:py-2 [&_td]:px-3 [&_tr]:border-b [&_tr]:border-cream-2/60`}
              dangerouslySetInnerHTML={{ __html: specifications }}
            />
          </section>
        )}

        {boxContents.length > 0 && (
          <section
            id={panelId('In the box')}
            role="tabpanel"
            aria-labelledby={tabId('In the box')}
            className={panelClass('In the box')}
          >
            <ul className="space-y-2">
              {boxContents.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-ink/80">
                  <span className="text-sage mt-0.5 shrink-0" aria-hidden="true">♥</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}

        {careInstructions.length > 0 && (
          <section
            id={panelId('Care')}
            role="tabpanel"
            aria-labelledby={tabId('Care')}
            className={panelClass('Care')}
          >
            <ul className="space-y-2.5">
              {careInstructions.map((bullet, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-ink/80 leading-relaxed">
                  <span className="text-sage mt-0.5 shrink-0" aria-hidden="true">·</span>
                  {bullet}
                </li>
              ))}
            </ul>
          </section>
        )}

        {productId && (
          <section
            id={panelId('Reviews')}
            role="tabpanel"
            aria-labelledby={tabId('Reviews')}
            className={panelClass('Reviews')}
          >
            <div className="space-y-8">
              {aggregate ? (
                <ReviewList
                  reviews={reviews}
                  aggregate={aggregate}
                  productId={productId}
                  total={reviewTotal}
                  page={reviewPage}
                  sort={reviewSort}
                  filter={reviewFilter}
                />
              ) : (
                <div className="text-center py-8 bg-cream-2/40 rounded-2xl">
                  <p className="text-3xl mb-2" aria-hidden="true">♥</p>
                  <p className="text-ink/50 text-sm">No reviews yet — be the first!</p>
                </div>
              )}

              <div className="border-t border-cream-2 pt-8">
                <h3
                  className="text-lg font-bold text-ink mb-6"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Share your experience ♥
                </h3>
                <ReviewForm productId={productId} />
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
