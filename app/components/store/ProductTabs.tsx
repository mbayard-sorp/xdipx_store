import { useState } from 'react'

interface ProductTabsProps {
  fullStory: string
  bullets:   string[]
  forHim:    string
  forHer:    string
}

const TABS = ['The Full Story', "What's In The Box", 'Both Ways ♥'] as const
type Tab = typeof TABS[number]

export function ProductTabs({ fullStory, bullets, forHim, forHer }: ProductTabsProps) {
  const [active, setActive] = useState<Tab>('The Full Story')

  return (
    <div className="mt-10">
      {/* Tab nav */}
      <div className="flex gap-1 border-b border-brand-mist overflow-x-auto scrollbar-hide">
        {TABS.map(tab => (
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
          <div className="prose prose-sm max-w-none text-brand-charcoal/80 leading-relaxed">
            {fullStory.split('\n').map((p, i) => (
              <p key={i} className="mb-4 last:mb-0">{p}</p>
            ))}
          </div>
        )}

        {active === "What's In The Box" && (
          <ul className="space-y-2">
            {bullets.length > 0 ? (
              bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-brand-charcoal/80">
                  <span className="text-brand-purple mt-0.5 shrink-0" aria-hidden="true">♥</span>
                  {b}
                </li>
              ))
            ) : (
              <li className="text-sm text-brand-charcoal/50">
                Product details not yet available.
              </li>
            )}
          </ul>
        )}

        {active === 'Both Ways ♥' && (
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3
                className="font-bold text-brand-charcoal mb-2 flex items-center gap-2"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                <span className="text-brand-purple">♥</span> For Him
              </h3>
              <p className="text-sm text-brand-charcoal/80 leading-relaxed">{forHim}</p>
            </div>
            <div>
              <h3
                className="font-bold text-brand-charcoal mb-2 flex items-center gap-2"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                <span className="text-brand-purple">♥</span> For Her
              </h3>
              <p className="text-sm text-brand-charcoal/80 leading-relaxed">{forHer}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
