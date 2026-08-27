/**
 * The Video Studio workspace bar (ticket #5716): one row of NavLinks with
 * live counts, the Social Studio WorkspaceBar's shape with this studio's
 * vocabulary. Horizontal scroll on mobile, never a page-wide sideways scroll.
 */
import { NavLink } from 'react-router'
import { InboxIcon, PenIcon, ImageIcon, ChartIcon } from '../social/icons'

export interface VideoWorkspaceCounts {
  /** Episodes waiting on the owner's read (pending_approval). */
  needsRead: number
  /** Jobs parked at the frame gate plus finished cuts awaiting review. */
  renderNeedsYou: number
}

export function VideoWorkspaceBar({ counts }: { counts: VideoWorkspaceCounts }) {
  const items: Array<{ to: string; label: string; Icon: typeof InboxIcon; count?: number; accent?: boolean }> = [
    { to: '/admin/video-studio/board', label: 'Board', Icon: InboxIcon },
    { to: '/admin/video-studio/scripts', label: 'Scripts', Icon: PenIcon, count: counts.needsRead, accent: counts.needsRead > 0 },
    { to: '/admin/video-studio/render', label: 'Render', Icon: ImageIcon, count: counts.renderNeedsYou, accent: counts.renderNeedsYou > 0 },
    { to: '/admin/video-studio/learn', label: 'Learn', Icon: ChartIcon },
  ]
  return (
    <nav aria-label="Video Studio sections" className="-mx-4 px-4 md:mx-0 md:px-0 overflow-x-auto">
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
