import { useState } from 'react'
import { useFetcher } from 'react-router'
import { PostPreviewCard, PlatformChip } from './PostPreviewCard'
import { CalendarStrip } from './CalendarStrip'
import { groupByScheduledDay } from './review-batch'
import type { SocialPostRow } from './types'

const PLATFORM_FILTERS = ['all', 'x', 'instagram', 'tiktok', 'youtube'] as const
const STATUS_FILTERS = [
  { key: 'all', label: 'All pending' },
  { key: 'pending_review', label: 'New' },
  { key: 'needs_changes', label: 'Changes requested' },
] as const

function dayLabel(day: string | null): string {
  if (!day) return 'No scheduled day'
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

/**
 * The default Social Studio tab: every draft waiting on the owner, filterable
 * by platform / review state / calendar day, grouped by proposed day, rendered
 * as platform-native preview cards with per-draft approve / request-changes /
 * reject controls plus multi-select batch approve / reject so the owner can
 * clear the queue at volume (ticket #2016). The single-draft review contract
 * (the 'review' intent) is untouched; batch uses a separate 'review-batch'
 * intent that loops the same reviewSocialPost writer.
 */
export function ReviewQueue({ posts }: { posts: SocialPostRow[] }) {
  const [platform, setPlatform] = useState<string>('all')
  const [status, setStatus] = useState<string>('all')
  const [day, setDay] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const batch = useFetcher<{ ok: boolean; error?: string; updated?: number; requested?: number }>()

  const filtered = posts.filter(p =>
    (platform === 'all' || p.platform === platform) &&
    (status === 'all' || p.reviewStatus === status) &&
    (day === null || p.scheduledFor === day || p.scheduledFor === null),
  )

  const groups = groupByScheduledDay(filtered)
  const visibleIds = filtered.map(p => p.id)
  const selectedVisible = visibleIds.filter(id => selected.has(id))
  const allVisibleSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length
  const submitting = batch.state !== 'idle'

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelected(allVisibleSelected ? new Set() : new Set(visibleIds))
  }

  function submitBatch(decision: 'approved' | 'rejected') {
    if (selectedVisible.length === 0) return
    batch.submit(
      { intent: 'review-batch', decision, postIds: selectedVisible.join(',') },
      { method: 'post' },
    )
    // Approved/rejected drafts leave the pending queue on revalidation, so the
    // selection is spent either way; clear it optimistically.
    setSelected(new Set())
  }

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
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-ink-3 cursor-pointer">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                className="w-4 h-4 rounded border-line text-coral focus:ring-coral/30"
              />
              Select all ({visibleIds.length})
            </label>
            {selectedVisible.length > 0 && (
              <span className="text-xs text-ink-4">{selectedVisible.length} selected</span>
            )}
          </div>

          <div className="space-y-6">
            {groups.map(group => (
              <section key={group.day ?? 'unscheduled'} className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-4 px-1">
                  {dayLabel(group.day)}
                  <span className="ml-2 font-normal normal-case text-ink-4/80">
                    {group.posts.length} draft{group.posts.length === 1 ? '' : 's'}
                  </span>
                </h3>
                {group.posts.map(post => (
                  <div key={post.id} className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Select draft ${post.id}`}
                      checked={selected.has(post.id)}
                      onChange={() => toggle(post.id)}
                      className="mt-4 w-4 h-4 shrink-0 rounded border-line text-coral focus:ring-coral/30"
                    />
                    <div className="flex-1 min-w-0">
                      <PostPreviewCard post={post} />
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </>
      )}

      {selectedVisible.length > 0 && (
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-coral/40 bg-coral-soft px-4 py-3 shadow-sm">
          <span className="text-sm font-semibold text-ink">
            {selectedVisible.length} selected
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => submitBatch('approved')}
            disabled={submitting}
            className="px-4 py-2 bg-coral text-white rounded-full text-sm font-semibold hover:bg-coral-2 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Working…' : `Approve ${selectedVisible.length}`}
          </button>
          <button
            type="button"
            onClick={() => submitBatch('rejected')}
            disabled={submitting}
            className="px-4 py-2 bg-white text-red-600 rounded-full text-sm font-semibold border border-red-200 hover:border-red-400 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Working…' : `Reject ${selectedVisible.length}`}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="px-3 py-2 text-ink-3 rounded-full text-sm font-medium hover:text-ink transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {batch.data?.ok === false && (
        <p className="text-xs text-red-500 px-1">{batch.data.error}</p>
      )}
      {batch.data?.ok && batch.data.updated != null && (
        <p className="text-xs text-green-600 px-1">
          Reviewed {batch.data.updated} draft{batch.data.updated === 1 ? '' : 's'}.
        </p>
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
