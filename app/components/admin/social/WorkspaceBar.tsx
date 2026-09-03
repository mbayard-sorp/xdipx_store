/**
 * The Social Studio workspace bar: one row of NavLinks with live counts.
 * Horizontal scroll on mobile, never a page-wide sideways scroll.
 */
import { NavLink } from 'react-router'
import { CalendarIcon, InboxIcon, PenIcon, ImageIcon, ChartIcon, SlidersIcon, CommentIcon } from './icons'

export interface WorkspaceCounts {
  pending: number
  approved: number
  scheduled: number
  failed: number
  inboundComments: number
}

export function WorkspaceBar({ counts }: { counts: WorkspaceCounts }) {
  const items: Array<{ to: string; label: string; Icon: typeof InboxIcon; count?: number; accent?: boolean; end?: boolean }> = [
    { to: '/admin/socials/queue', label: 'Queue', Icon: InboxIcon, count: counts.pending, accent: counts.pending > 0 },
    { to: '/admin/socials/comments', label: 'Comments', Icon: CommentIcon, count: counts.inboundComments, accent: counts.inboundComments > 0 },
    { to: '/admin/socials/calendar', label: 'Calendar', Icon: CalendarIcon, count: counts.scheduled },
    { to: '/admin/socials/compose/new', label: 'Compose', Icon: PenIcon },
    { to: '/admin/socials/library', label: 'Library', Icon: ImageIcon },
    { to: '/admin/socials/analytics', label: 'Analytics', Icon: ChartIcon },
    { to: '/admin/socials/settings', label: 'Settings', Icon: SlidersIcon, count: counts.failed, accent: counts.failed > 0 },
  ]
  return (
    <nav aria-label="Social Studio sections" className="-mx-4 px-4 md:mx-0 md:px-0 overflow-x-auto">
      <ul className="flex gap-1 border-b border-line min-w-max md:min-w-0">
        {items.map(({ to, label, Icon, count, accent }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                `inline-flex items-center gap-2 h-11 px-3 -mb-px border-b-2 text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive ? 'border-coral text-ink' : 'border-transparent text-ink-3 hover:text-ink'
                }`
              }
            >
              <Icon size={16} />
              {label}
              {count != null && count > 0 && (
                <span
                  className={`font-mono text-[11px] leading-none px-1.5 py-1 rounded-full tabular-nums ${
                    accent ? 'bg-coral text-white' : 'bg-paper-3 text-ink-3'
                  }`}
                >
                  {count}
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
