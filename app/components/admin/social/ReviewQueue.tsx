import { useState } from 'react'
import { PostPreviewCard, PlatformChip } from './PostPreviewCard'
import { CalendarStrip } from './CalendarStrip'
import type { SocialPostRow } from './types'

const PLATFORM_FILTERS = ['all', 'x', 'instagram', 'tiktok'] as const
const STATUS_FILTERS = [
  { key: 'all', label: 'All pending' },
  { key: 'pending_review', label: 'New' },
  { key: 'needs_changes', label: 'Changes requested' },
] as const

/**
 * The default Social Studio tab: every draft waiting on the owner, filterable
 * by platform / review state / calendar day, rendered as platform-native
 * preview cards with approve / request-changes / reject controls.
 */
export function ReviewQueue({ posts }: { posts: SocialPostRow[] }) {
  const [platform, setPlatform] = useState<string>('all')
  const [status, setStatus] = useState<string>('all')
  const [day, setDay] = useState<string | null>(null)

  const filtered = posts.filter(p =>
    (platform === 'all' || p.platform === platform) &&
    (status === 'all' || p.reviewStatus === status) &&
    (day === null || p.scheduledFor === day || p.scheduledFor === null),
  )

  return (
    <div className="space-y-4">
      <CalendarStrip posts={posts} selectedDay={day} onSelectDay={setDay} />

      <div className="flex flex-wrap gap-2">
        {PLATFORM_FILTERS.map(p => (
          <FilterPill key={p} active={platform === p} onClick={() => setPlatform(p)}>
            {p === 'all' ? 'All platforms' : <PlatformChip platform={p} />}
          </FilterPill>
        ))}
        <span className="w-px bg-line self-stretch mx-1 hidden md:block" />
        {STATUS_FILTERS.map(s => (
          <FilterPill key={s.key} active={status === s.key} onClick={() => setStatus(s.key)}>
            {s.label}
          </FilterPill>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center">
          <p className="text-sm text-ink-3">Nothing waiting on you.</p>
          <p className="text-xs text-ink-4 mt-1">
            The social team drafts on its daily run; new posts land here for review.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(post => (
            <PostPreviewCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  )
}

function FilterPill({ active, onClick, children }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active ? 'border-coral bg-coral-soft text-ink' : 'border-line bg-white text-ink-3 hover:border-ink-4'
      }`}
    >
      {children}
    </button>
  )
}
