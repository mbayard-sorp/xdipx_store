import { useState } from 'react'
import type { Review, ReviewAggregate } from '~/types/reviews'
import { ReviewList } from '~/components/reviews/ReviewList'
import { ReviewForm } from '~/components/reviews/ReviewForm'

interface ProductTabsProps {
  fullStory:       string
  boxContents:     string[]
  forHim:          string
  forHer:          string
  specifications?: string | undefined
  productId?:      string
  reviews?:        Review[]
  aggregate?:      ReviewAggregate | null
  reviewTotal?:    number
  reviewPage?:     number
  reviewSort?:     string
  reviewFilter?:   string
}

type Tab = 'The Full Story' | "What's In The Box" | 'Both Ways ♥' | 'Specs' | 'Reviews'

const proseBody =
  'prose prose-sm max-w-none text-brand-charcoal/80 leading-relaxed'

export function ProductTabs({
  fullStory, boxContents, forHim, forHer, specifications,
  productId, reviews = [], aggregate, reviewTotal = 0,
  reviewPage = 1, reviewSort = 'newest', reviewFilter = 'all',
}: ProductTabsProps) {
  const reviewCount = aggregate?.approvedCount ?? 0
  const hasForEither = Boolean(forHim || forHer)

  const visibleTabs: Tab[] = [
    ...(fullStory ? ['The Full Story' as Tab] : []),
    "What's In The Box",
    ...(hasForEither ? ['Both Ways ♥' as Tab] : []),
    ...(specifications ? ['Specs' as Tab] : []),
    ...(productId ? ['Reviews' as Tab] : []),
  ]

  const [active, setActive] = useState<Tab>(visibleTabs[0] ?? "What's In The Box")

  const panelClass = (tab: Tab) => (active === tab ? '' : 'hidden')
  const panelId = (tab: Tab) => `tabpanel-${tab.replace(/\W+/g, '-').toLowerCase()}`
  const tabId = (tab: Tab) => `tab-${tab.replace(/\W+/g, '-').toLowerCase()}`

  return (
    <div className="mt-10">
      <div
        role="tablist"
        aria-label="Product details"
        className="flex gap-1 border-b border-brand-mist overflow-x-auto scrollbar-hide"
      >
        {visibleTabs.map(tab => {
          const isActive = active === tab
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
                'px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-all',
                isActive
                  ? 'border-brand-coral text-brand-coral'
                  : 'border-transparent text-brand-charcoal/60 hover:text-brand-charcoal',
              ].join(' ')}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {tab === 'Reviews' && reviewCount > 0 ? `Reviews (${reviewCount})` : tab}
            </button>
          )
        })}
      </div>

      <div className="py-6">
        {fullStory && (
          <section
            id={panelId('The Full Story')}
            role="tabpanel"
            aria-labelledby={tabId('The Full Story')}
            className={panelClass('The Full Story')}
          >
            <div className={proseBody} dangerouslySetInnerHTML={{ __html: fullStory }} />
          </section>
        )}

        <section
          id={panelId("What's In The Box")}
          role="tabpanel"
          aria-labelledby={tabId("What's In The Box")}
          className={panelClass("What's In The Box")}
        >
          <ul className="space-y-2">
            {boxContents.length > 0 ? (
              boxContents.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-brand-charcoal/80">
                  <span className="text-brand-purple mt-0.5 shrink-0" aria-hidden="true">♥</span>
                  {item}
                </li>
              ))
            ) : (
              <li className="text-sm text-brand-charcoal/50">
                Box contents not yet available.
              </li>
            )}
          </ul>
        </section>

        {hasForEither && (
          <section
            id={panelId('Both Ways ♥')}
            role="tabpanel"
            aria-labelledby={tabId('Both Ways ♥')}
            className={panelClass('Both Ways ♥')}
          >
            <div className="grid md:grid-cols-2 gap-6">
              {forHim && (
                <div>
                  <h3
                    className="font-bold text-brand-charcoal mb-2 flex items-center gap-2"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    <span className="text-brand-purple" aria-hidden="true">♥</span> For Him
                  </h3>
                  <div className={proseBody} dangerouslySetInnerHTML={{ __html: forHim }} />
                </div>
              )}
              {forHer && (
                <div>
                  <h3
                    className="font-bold text-brand-charcoal mb-2 flex items-center gap-2"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    <span className="text-brand-purple" aria-hidden="true">♥</span> For Her
                  </h3>
                  <div className={proseBody} dangerouslySetInnerHTML={{ __html: forHer }} />
                </div>
              )}
            </div>
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
              className={`${proseBody} [&_table]:w-full [&_table]:text-sm [&_th]:text-left [&_th]:font-semibold [&_th]:py-2 [&_th]:px-3 [&_th]:bg-brand-mist [&_td]:py-2 [&_td]:px-3 [&_tr]:border-b [&_tr]:border-brand-mist/60`}
              dangerouslySetInnerHTML={{ __html: specifications }}
            />
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
                <div className="text-center py-8 bg-brand-mist/40 rounded-2xl">
                  <p className="text-3xl mb-2" aria-hidden="true">♥</p>
                  <p className="text-brand-charcoal/50 text-sm">No reviews yet — be the first!</p>
                </div>
              )}

              <div className="border-t border-brand-mist pt-8">
                <h3
                  className="text-lg font-bold text-brand-charcoal mb-6"
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
