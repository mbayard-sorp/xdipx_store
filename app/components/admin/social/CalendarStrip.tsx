import type { SocialPostRow } from './types'

const PLATFORM_DOTS: Record<string, string> = {
  x: 'bg-ink',
  instagram: 'bg-pink-500',
  tiktok: 'bg-plum',
  facebook: 'bg-blue-600',
}

/**
 * Seven-day strip over the review queue: which days have drafts proposed
 * (social_posts.scheduled_for), one dot per platform. Tap a day to filter the
 * queue to it; tap again to clear. Deliberately minimal — no drag-drop.
 */
export function CalendarStrip({ posts, selectedDay, onSelectDay }: {
  posts: SocialPostRow[]
  selectedDay: string | null
  onSelectDay: (day: string | null) => void
}) {
  const days: { iso: string; label: string; dow: string }[] = []
  const now = new Date()
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    days.push({
      iso,
      label: i === 0 ? 'Today' : i === 1 ? 'Tmrw' : String(d.getDate()),
      dow: d.toLocaleDateString('en-US', { weekday: 'short' }),
    })
  }

  const byDay = new Map<string, SocialPostRow[]>()
  for (const p of posts) {
    if (!p.scheduledFor) continue
    const list = byDay.get(p.scheduledFor) ?? []
    list.push(p)
    byDay.set(p.scheduledFor, list)
  }
  const unscheduled = posts.filter(p => !p.scheduledFor).length

  return (
    <div className="rounded-2xl border border-line bg-white p-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {days.map(d => {
          const dayPosts = byDay.get(d.iso) ?? []
          const active = selectedDay === d.iso
          return (
            <button
              key={d.iso}
              onClick={() => onSelectDay(active ? null : d.iso)}
              className={`flex flex-col items-center gap-1 min-w-[52px] px-2 py-2 rounded-xl border transition-colors ${
                active ? 'border-coral bg-coral-soft' : 'border-line hover:border-ink-4'
              }`}
            >
              <span className="text-[10px] uppercase tracking-wide text-ink-4">{d.dow}</span>
              <span className="text-sm font-semibold text-ink">{d.label}</span>
              <span className="flex gap-0.5 h-1.5">
                {[...new Set(dayPosts.map(p => p.platform))].map(p => (
                  <span key={p} className={`w-1.5 h-1.5 rounded-full ${PLATFORM_DOTS[p] ?? 'bg-ink-4'}`} />
                ))}
              </span>
            </button>
          )
        })}
      </div>
      {unscheduled > 0 && (
        <p className="text-[11px] text-ink-4 mt-1 px-1">
          {unscheduled} draft{unscheduled === 1 ? '' : 's'} without a proposed day (always shown).
        </p>
      )}
    </div>
  )
}
