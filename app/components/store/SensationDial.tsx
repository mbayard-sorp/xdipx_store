import type { ProductTypeDial, SensationDialItem } from '~/types'

const TYPE_CAPTION: Record<ProductTypeDial, string> = {
  'air-pulsation': 'Tuned for air-pulsation toys. Community-checked.',
  vibrator:        'Tuned for vibrators. Community-checked.',
  wand:            'Tuned for wands. Community-checked.',
  lube:            'Tuned for this lube. Community-checked.',
  wear:            'Tuned for wear. Community-checked.',
}

export function dialLabelSlug(label: string): string {
  return label.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

interface SensationDialProps {
  items:             SensationDialItem[]
  productTypeDial?:  ProductTypeDial
  /** Vote aggregates keyed by slugified label. */
  aggregates?:       Record<string, { agreePct: number; votes: number; up?: number; down?: number }>
  /** Vote handler — receives the slugified label. */
  onVote?:           (labelSlug: string, vote: 1 | -1) => void
  /** When false and onVote provided, vote buttons gate to sign-in. */
  isLoggedIn?:       boolean
}

export function SensationDial({ items, productTypeDial, aggregates, onVote, isLoggedIn }: SensationDialProps) {
  const visible = items.filter(it => it.value > 0).slice(0, 6)
  if (visible.length === 0) return null

  return (
    <section
      className="bg-cream border border-line rounded-[var(--radius-lg)] p-[22px]"
      aria-label="How it feels"
    >
      <header className="flex items-baseline justify-between gap-3 mb-1">
        <h3
          className="italic font-bold text-ink text-[20px] leading-tight"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          How it feels
        </h3>
        <span className="text-[11px] uppercase tracking-wide text-muted font-mono">
          5 = most
        </span>
      </header>
      <p className="text-[12px] text-muted mb-4">
        {productTypeDial ? TYPE_CAPTION[productTypeDial] : 'Tuned for this object. Community-checked.'}
      </p>

      <ul className="space-y-2.5">
        {visible.map((item) => {
          const slug = dialLabelSlug(item.label)
          return (
            <li key={slug} className="grid grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-3">
              <span
                className="text-[13px] font-medium text-ink flex items-center gap-1.5"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {item.label}
                {item.proposed && (
                  <span
                    className="inline-block text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-sun/30 text-ink-2"
                    title="Proposed by Emma — pending editor review"
                  >
                    new
                  </span>
                )}
              </span>
              <div
                className="flex gap-1"
                role="img"
                aria-label={`${item.label}: ${item.value} of 5`}
              >
                {Array.from({ length: 5 }).map((_, i) => (
                  <span
                    key={i}
                    className={[
                      'w-[18px] h-[18px] rounded-[3px] border-[1.5px] border-ink',
                      i < item.value ? 'bg-coral' : 'bg-transparent',
                    ].join(' ')}
                    aria-hidden="true"
                  />
                ))}
              </div>
              {onVote ? (
                <DialVotePair
                  labelSlug={slug}
                  onVote={onVote}
                  isLoggedIn={isLoggedIn ?? false}
                />
              ) : <span aria-hidden="true" className="w-0" />}
            </li>
          )
        })}
      </ul>

      {hasAnyVotes(visible, aggregates) && (
        <footer className="mt-4 pt-3 border-t border-dashed border-line flex items-center justify-between text-[12px]">
          <span className="text-muted font-mono">
            {totalVotes(visible, aggregates)} community {totalVotes(visible, aggregates) === 1 ? 'vote' : 'votes'}
          </span>
          <span className="text-sage font-medium">
            {avgAgreePct(visible, aggregates)}% agree
          </span>
        </footer>
      )}
    </section>
  )
}

function DialVotePair({
  labelSlug,
  onVote,
  isLoggedIn,
}: {
  labelSlug:  string
  onVote:     (labelSlug: string, vote: 1 | -1) => void
  isLoggedIn: boolean
}) {
  const handle = (vote: 1 | -1) => {
    if (!isLoggedIn) {
      window.location.href = `/account/login?redirect=${encodeURIComponent(window.location.pathname)}`
      return
    }
    onVote(labelSlug, vote)
  }
  return (
    <div className="flex items-center gap-1 text-[11px] text-muted whitespace-nowrap">
      <button
        type="button"
        onClick={() => handle(1)}
        className="w-6 h-6 rounded-full border border-line hover:border-coral hover:bg-coral/10 transition-colors leading-none"
        aria-label={`Agree with ${labelSlug} rating`}
      >
        <span className="text-[12px]">👍</span>
      </button>
      <button
        type="button"
        onClick={() => handle(-1)}
        className="w-6 h-6 rounded-full border border-line hover:border-coral hover:bg-coral/10 transition-colors leading-none"
        aria-label={`Disagree with ${labelSlug} rating`}
      >
        <span className="text-[12px]">👎</span>
      </button>
    </div>
  )
}

function hasAnyVotes(
  items: SensationDialItem[],
  aggregates?: Record<string, { votes: number }>,
): boolean {
  if (!aggregates) return false
  return items.some(it => (aggregates[dialLabelSlug(it.label)]?.votes ?? 0) > 0)
}

function totalVotes(
  items: SensationDialItem[],
  aggregates?: Record<string, { votes: number }>,
): number {
  if (!aggregates) return 0
  return items.reduce((acc, it) => acc + (aggregates[dialLabelSlug(it.label)]?.votes ?? 0), 0)
}

function avgAgreePct(
  items: SensationDialItem[],
  aggregates?: Record<string, { agreePct: number; votes: number }>,
): number {
  if (!aggregates) return 0
  let weightedSum = 0
  let weight = 0
  for (const it of items) {
    const a = aggregates[dialLabelSlug(it.label)]
    if (!a || a.votes <= 0) continue
    weightedSum += a.agreePct * a.votes
    weight      += a.votes
  }
  if (weight === 0) return 0
  return Math.round(weightedSum / weight)
}
