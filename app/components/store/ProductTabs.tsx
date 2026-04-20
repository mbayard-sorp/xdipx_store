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

type Tab = "Emma's take" | 'In the box' | 'Both ways ♥' | 'Specs' | 'Reviews'

const proseBody =
  'prose prose-sm max-w-none text-ink/80 leading-relaxed'

export function ProductTabs({
  fullStory, boxContents, forHim, forHer, specifications,
  productId, reviews = [], aggregate, reviewTotal = 0,
  reviewPage = 1, reviewSort = 'newest', reviewFilter = 'all',
}: ProductTabsProps) {
  const reviewCount = aggregate?.approvedCount ?? 0
  const hasForEither = Boolean(forHim || forHer)

  const visibleTabs: Tab[] = [
    ...(fullStory ? ["Emma's take" as Tab] : []),
    'In the box',
    ...(hasForEither ? ['Both ways ♥' as Tab] : []),
    ...(specifications ? ['Specs' as Tab] : []),
    ...(productId ? ['Reviews' as Tab] : []),
  ]

  const [active, setActive] = useState<Tab>(visibleTabs[0] ?? 'In the box')

  const panelClass = (tab: Tab) => (active === tab ? '' : 'hidden')
  const panelId = (tab: Tab) => `tabpanel-${tab.replace(/\W+/g, '-').toLowerCase()}`
  const tabId = (tab: Tab) => `tab-${tab.replace(/\W+/g, '-').toLowerCase()}`

  return (
    <div className="mt-10">
      <div
        role="tablist"
        aria-label="Product details"
        className="flex gap-1 border-b border-cream-2 overflow-x-auto scrollbar-hide"
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
                  ? 'border-coral text-coral'
                  : 'border-transparent text-ink/60 hover:text-ink',
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
            id={panelId("Emma's take")}
            role="tabpanel"
            aria-labelledby={tabId("Emma's take")}
            className={panelClass("Emma's take")}
          >
            <div className={proseBody} dangerouslySetInnerHTML={{ __html: fullStory }} />
          </section>
        )}

        <section
          id={panelId('In the box')}
          role="tabpanel"
          aria-labelledby={tabId('In the box')}
          className={panelClass('In the box')}
        >
          <ul className="space-y-2">
            {boxContents.length > 0 ? (
              boxContents.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-ink/80">
                  <span className="text-sage mt-0.5 shrink-0" aria-hidden="true">♥</span>
                  {item}
                </li>
              ))
            ) : (
              <li className="text-sm text-ink/50">
                Box contents not yet available.
              </li>
            )}
          </ul>
        </section>

        {hasForEither && (
          <section
            id={panelId('Both ways ♥')}
            role="tabpanel"
            aria-labelledby={tabId('Both ways ♥')}
            className={panelClass('Both ways ♥')}
          >
            <div className="grid md:grid-cols-2 gap-6">
              {forHim && (
                <div>
                  <h3
                    className="font-bold text-ink mb-2 flex items-center gap-2"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    <span className="text-sage" aria-hidden="true">♥</span> For Him
                  </h3>
                  <div className={proseBody} dangerouslySetInnerHTML={{ __html: forHim }} />
                </div>
              )}
              {forHer && (
                <div>
                  <h3
                    className="font-bold text-ink mb-2 flex items-center gap-2"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    <span className="text-sage" aria-hidden="true">♥</span> For Her
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
              className={`${proseBody} [&_table]:w-full [&_table]:text-sm [&_th]:text-left [&_th]:font-semibold [&_th]:py-2 [&_th]:px-3 [&_th]:bg-cream-2 [&_td]:py-2 [&_td]:px-3 [&_tr]:border-b [&_tr]:border-cream-2/60`}
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
