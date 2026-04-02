import { useState } from 'react'

interface ProductTabsProps {
  fullStory:       string
  boxContents:     string[]
  forHim:          string
  forHer:          string
  specifications?: string
}

const TABS = ['The Full Story', "What's In The Box", 'Both Ways ♥', 'Specs'] as const
type Tab = typeof TABS[number]

export function ProductTabs({ fullStory, boxContents, forHim, forHer, specifications }: ProductTabsProps) {
  const [active, setActive] = useState<Tab>('The Full Story')

  const visibleTabs = specifications
    ? TABS
    : TABS.filter(t => t !== 'Specs')

  return (
    <div className="mt-10">
      {/* Tab nav */}
      <div className="flex gap-1 border-b border-brand-mist overflow-x-auto scrollbar-hide">
        {visibleTabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={[
              'px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-all',
              active === tab
                ? 'border-brand-coral text-brand-coral'
                : 'border-transparent text-brand-charcoal/60 hover:text-brand-charcoal',
            ].join(' ')}
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="py-6">
        {active === 'The Full Story' && (
          <div
            className="prose prose-sm max-w-none text-brand-charcoal/80 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: fullStory }}
          />
        )}

        {active === "What's In The Box" && (
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
        )}

        {active === 'Both Ways ♥' && (
          <div className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3
                  className="font-bold text-brand-charcoal mb-2 flex items-center gap-2"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  <span className="text-brand-purple">♥</span> For Him
                </h3>
                <div
                  className="prose prose-sm max-w-none text-brand-charcoal/80 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: forHim }}
                />
              </div>
              <div>
                <h3
                  className="font-bold text-brand-charcoal mb-2 flex items-center gap-2"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  <span className="text-brand-purple">♥</span> For Her
                </h3>
                <div
                  className="prose prose-sm max-w-none text-brand-charcoal/80 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: forHer }}
                />
              </div>
            </div>
          </div>
        )}

        {active === 'Specs' && specifications && (
          <div
            className="prose prose-sm max-w-none text-brand-charcoal/80 [&_table]:w-full [&_table]:text-sm [&_th]:text-left [&_th]:font-semibold [&_th]:py-2 [&_th]:px-3 [&_th]:bg-brand-mist [&_td]:py-2 [&_td]:px-3 [&_tr]:border-b [&_tr]:border-brand-mist/60"
            dangerouslySetInnerHTML={{ __html: specifications }}
          />
        )}
      </div>
    </div>
  )
}
