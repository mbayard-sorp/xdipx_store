/**
 * The four Ad Studio tabs (wires 3.2 and 3.3). One item list renders both the
 * phone bottom bar (under md) and the md+ side rail, so the two cannot drift.
 * Tabs are routes (NavLink), so back works and each tab can fail alone.
 * Not coral: the global AdminNav already paints "Ad Studio" coral.
 */
import { NavLink } from 'react-router'
import { ChartIcon, DollarIcon, ImageIcon, PenIcon } from '~/components/admin/social/icons'

type IconType = (p: { size?: number }) => React.JSX.Element

const ITEMS: Array<{ to: string; label: string; Icon: IconType; badgeKey?: 'ideas' | 'creatives' }> = [
  { to: '/admin/ad-studio/ideas', label: 'Ideas', Icon: PenIcon, badgeKey: 'ideas' },
  { to: '/admin/ad-studio/creatives', label: 'Creatives', Icon: ImageIcon, badgeKey: 'creatives' },
  { to: '/admin/ad-studio/live', label: 'Live', Icon: ChartIcon },
  { to: '/admin/ad-studio/spend', label: 'Spend', Icon: DollarIcon },
]

function Badge({ n }: { n: number }) {
  if (n <= 0) return null
  return (
    <span className="absolute -top-1 -right-2.5 min-w-4 rounded-full bg-ink px-1.5 text-center font-mono text-[10px] leading-4 text-white">
      {n > 99 ? '99+' : n}
    </span>
  )
}

export function StudioTabs({ badges }: { badges: { ideas: number; creatives: number } }) {
  return (
    <>
      {/* Phone bottom bar */}
      <nav
        aria-label="Ad Studio sections"
        className="md:hidden fixed bottom-0 inset-x-0 z-20 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="grid grid-cols-4">
          {ITEMS.map(({ to, label, Icon, badgeKey }) => (
            <li key={to}>
              <NavLink
                to={to}
                prefetch="intent"
                className={({ isActive }) =>
                  `relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] touch-manipulation ${
                    isActive ? 'text-ink font-semibold' : 'text-ink-4'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute top-0 inset-x-6 h-0.5 bg-ink" />}
                    <span className="relative">
                      <Icon size={20} />
                      {badgeKey && <Badge n={badges[badgeKey]} />}
                    </span>
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* md+ side rail */}
      <nav
        aria-label="Ad Studio sections"
        className="hidden md:flex md:sticky md:top-16 self-start flex-col gap-1"
      >
        {ITEMS.map(({ to, label, Icon, badgeKey }) => (
          <NavLink
            key={to}
            to={to}
            prefetch="intent"
            className={({ isActive }) =>
              `flex w-[72px] min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] touch-manipulation ${
                isActive ? 'border border-line-2 bg-paper text-ink shadow-sm' : 'border border-transparent text-ink-3 hover:bg-paper-3'
              }`
            }
          >
            <span className="relative">
              <Icon size={20} />
              {badgeKey && <Badge n={badges[badgeKey]} />}
            </span>
            {label}
          </NavLink>
        ))}
      </nav>
    </>
  )
}
