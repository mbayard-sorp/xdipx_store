/**
 * Ads words mapped onto StatusPill's class strings (wires 6.2), so the colours
 * are defined once. Glyph plus word, never colour alone.
 */
import { STUDIO_STATUS_STYLES, type StudioStatus } from '~/components/admin/social/StatusPill'

export type AdStatus =
  | 'proposed' | 'queued' | 'rendering' | 'rendered' | 'exported' | 'live' | 'rejected' | 'failed' | 'blocked' | 'archived'

const MAP: Record<AdStatus, { base: StudioStatus; word: string }> = {
  proposed:  { base: 'draft',      word: 'Proposed' },
  queued:    { base: 'pending',    word: 'Queued' },
  rendering: { base: 'publishing', word: 'Rendering' },
  rendered:  { base: 'approved',   word: 'Rendered' },
  exported:  { base: 'approved',   word: 'Exported' },
  live:      { base: 'published',  word: 'Live' },
  rejected:  { base: 'rejected',   word: 'Rejected' },
  failed:    { base: 'failed',     word: 'Failed' },
  blocked:   { base: 'failed',     word: 'Blocked' },
  archived:  { base: 'deleted',    word: 'Archived' },
}

export function adStatusOfIdea(status: string): AdStatus {
  if (status === 'hearted') return 'queued'
  if (status in MAP) return status as AdStatus
  return 'proposed'
}

export function AdStatusPill({ status, className = '' }: { status: AdStatus; className?: string }) {
  const m = MAP[status] ?? MAP.proposed
  const s = STUDIO_STATUS_STYLES[m.base]
  const Icon = s.Icon
  const cls = s.cls.replace('animate-pulse', 'animate-pulse motion-reduce:animate-none')
  return (
    <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] font-semibold leading-none whitespace-nowrap ${cls} ${className}`}>
      <Icon size={12} />
      {m.word}
    </span>
  )
}
