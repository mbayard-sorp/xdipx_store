/**
 * Status pills: glyph plus word, never colour alone (plan section 4).
 * Palette per the design direction: draft ink-4, pending plum-soft, approved
 * sage, scheduled plum, publishing animated, published sage solid, failed red,
 * rejected ink-3 strikethrough. Every pair holds 4.5:1 on its ground.
 */
import { CheckIcon, ClockIcon, AlertIcon, CloseIcon, PenIcon, SendIcon, PauseIcon, MinusIcon } from './icons'

export type StudioStatus =
  | 'draft' | 'pending' | 'needs_changes' | 'approved' | 'scheduled' | 'publishing'
  | 'published' | 'failed' | 'rejected' | 'deleted'

const STYLES: Record<StudioStatus, { cls: string; word: string; Icon: (p: { size?: number }) => React.JSX.Element }> = {
  draft:         { cls: 'border-line text-ink-3 bg-paper',                     word: 'Draft',        Icon: PenIcon },
  pending:       { cls: 'border-plum/20 bg-plum-soft text-plum-2',             word: 'Pending',      Icon: ClockIcon },
  needs_changes: { cls: 'border-amber-300 bg-amber-50 text-amber-800',         word: 'Changes',      Icon: AlertIcon },
  approved:      { cls: 'border-sage/40 bg-sage/10 text-[#4F6150]',            word: 'Approved',     Icon: CheckIcon },
  scheduled:     { cls: 'border-plum bg-plum text-white',                      word: 'Scheduled',    Icon: ClockIcon },
  publishing:    { cls: 'border-plum/40 bg-plum-soft text-plum-2 animate-pulse', word: 'Publishing', Icon: SendIcon },
  published:     { cls: 'border-sage bg-sage text-white',                      word: 'Published',    Icon: CheckIcon },
  failed:        { cls: 'border-red-300 bg-red-50 text-red-800',               word: 'Failed',       Icon: AlertIcon },
  rejected:      { cls: 'border-line bg-paper-3 text-ink-3 line-through',      word: 'Rejected',     Icon: CloseIcon },
  deleted:       { cls: 'border-line bg-paper-3 text-ink-3',                   word: 'Deleted',      Icon: MinusIcon },
}

export function StatusPill({ status, className = '' }: { status: StudioStatus; className?: string }) {
  const s = STYLES[status] ?? STYLES.draft
  const Icon = s.Icon
  return (
    <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] font-semibold leading-none whitespace-nowrap ${s.cls} ${className}`}>
      <Icon size={12} />
      {s.word}
    </span>
  )
}

/** Collapse a social_posts row into one Studio status. */
export function studioStatusOf(post: {
  status: string
  reviewStatus: string
  scheduledAt?: string | Date | null
  scheduledFor?: string | null
}): StudioStatus {
  if (post.status === 'posted') return 'published'
  if (post.status === 'failed') return 'failed'
  if (post.status === 'deleted') return 'deleted'
  if (post.status === 'publishing') return 'publishing'
  if (post.reviewStatus === 'rejected') return 'rejected'
  if (post.reviewStatus === 'needs_changes') return 'needs_changes'
  if (post.reviewStatus === 'approved') return (post.scheduledAt || post.scheduledFor) ? 'scheduled' : 'approved'
  if (post.reviewStatus === 'pending_review') return 'pending'
  return 'draft'
}

/** Gate verdict pill, same vocabulary as gate_status. */
export function GatePill({ status }: { status: string | null | undefined }) {
  const map: Record<string, { cls: string; word: string; Icon: (p: { size?: number }) => React.JSX.Element }> = {
    pass:   { cls: 'border-sage/40 bg-sage/10 text-[#4F6150]', word: 'Gate pass', Icon: CheckIcon },
    revise: { cls: 'border-amber-300 bg-amber-50 text-amber-800', word: 'Gate revise', Icon: AlertIcon },
    block:  { cls: 'border-red-300 bg-red-50 text-red-800', word: 'Gate block', Icon: CloseIcon },
    hold:   { cls: 'border-plum/20 bg-plum-soft text-plum-2', word: 'Gate hold', Icon: PauseIcon },
  }
  const s = status ? map[status] : undefined
  if (!s) {
    return (
      <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full border border-dashed border-line text-[11px] font-semibold text-ink-3 whitespace-nowrap">
        <ClockIcon size={12} /> Not gated
      </span>
    )
  }
  const Icon = s.Icon
  return (
    <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] font-semibold whitespace-nowrap ${s.cls}`}>
      <Icon size={12} /> {s.word}
    </span>
  )
}
