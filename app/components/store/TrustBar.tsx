import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import type { TrustIcon, TrustItem } from '~/types/cms'

interface TrustBarProps {
  items: TrustItem[]
  /** When true, render without the default `bg-white border-y border-cream-2`
   *  frame so the parent can supply its own framing (e.g. a card-style wrapper
   *  matching the PDP summary grid). Padding is also dropped so the parent
   *  controls spacing. */
  frameless?: boolean
}

/**
 * The trust strip, rendered once per page shell and once per PDP.
 *
 * SSR emits the item text EXACTLY ONCE. That is a hard SEO constraint, not a
 * style preference. This component used to render two separate lists — a
 * desktop static row plus a mobile marquee whose track was `[...visible,
 * ...visible]` for a seamless loop — so every page shipped three copies of the
 * same ~77 words. Both variants land in the SSR HTML regardless of viewport
 * (CSS hides one from humans, but a crawler parses all of it), which on a PDP
 * carrying only ~230 unique words meant ~29% of the indexable text was one
 * triplicated boilerplate block. Google responded by treating unrelated PDPs
 * as duplicates of each other: "Duplicate, Google chose different canonical
 * than user" grew from 376 URLs on 2026-08-13 to 1,080 on 2026-09-06, with
 * pages falling out of "Submitted and indexed" into it.
 *
 * So the two lists are now one list, switched by CSS:
 *   - below md, a `w-max` marquee track;
 *   - at md and up, a full-width `justify-between` row (the animation is
 *     cancelled in app.css, not by a utility class, so it cannot lose a
 *     specificity race).
 *
 * The loop duplicate is appended on the CLIENT only, after mount, and carries
 * `md:hidden` + `aria-hidden`. It therefore never reaches the SSR HTML a
 * crawler sees. Before hydration (and with JS off) the track is a plain
 * swipeable overflow row, which is a fine end state rather than a broken one.
 */
export function TrustBar({ items, frameless = false }: TrustBarProps) {
  // Drop null entries — broken or unpublished Sanity refs dereference to null
  const visible = items.filter((i): i is TrustItem => i != null && i.active !== false)

  const reduced = useReducedMotion() ?? false
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (visible.length === 0) return null

  // The seamless loop needs a second copy so the -50% keyframe lands exactly on
  // the start of the repeat. Client-only and motion-gated: no duplicate text in
  // the server HTML, and none at all when the visitor asked for less motion.
  const looping = mounted && !reduced

  const wrapperClass = frameless
    ? 'overflow-hidden'
    : 'bg-white border-y border-cream-2 py-3 px-4 overflow-hidden'

  return (
    <div className={wrapperClass}>
      <div className="relative overflow-x-auto md:overflow-x-visible">
        <ul
          className={`flex w-max items-center gap-8 md:mx-auto md:w-full md:max-w-6xl md:justify-between md:gap-2 ${
            looping ? 'animate-marquee' : ''
          }`}
        >
          {visible.map((item, i) => (
            <TrustItemEl key={`${item.headline}-${i}`} item={item} />
          ))}
          {looping && visible.map((item, i) => (
            <TrustItemEl key={`dup-${item.headline}-${i}`} item={item} duplicate />
          ))}
        </ul>
      </div>
    </div>
  )
}

function TrustItemEl({ item, duplicate = false }: { item: TrustItem; duplicate?: boolean }) {
  const Icon = ICON_MAP[item.icon] ?? LockIcon
  return (
    <li
      className={`flex items-center gap-2 shrink-0 px-1${duplicate ? ' md:hidden' : ''}`}
      {...(duplicate ? { 'aria-hidden': true } : {})}
    >
      <span className="text-sage shrink-0" aria-hidden="true">
        <Icon />
      </span>
      <div>
        <p
          className="text-ink text-xs font-semibold leading-tight whitespace-nowrap"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {item.headline}
        </p>
        {item.subheadline && (
          <p className="text-ink-3 text-[11px] leading-tight whitespace-nowrap">
            {item.subheadline}
          </p>
        )}
      </div>
    </li>
  )
}
// ── Icons ────────────────────────────────────────────────────────────────────

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function PackageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function TruckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  )
}

function StarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function LeafIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3c6 0 15 3 15 12a6 6 0 0 1-12 0c0-5 4-8 9-9" />
      <path d="M6 3c0 9 6 15 15 15" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

const ICON_MAP: Record<TrustIcon, () => React.ReactElement> = {
  lock: LockIcon,
  shield: ShieldIcon,
  package: PackageIcon,
  heart: HeartIcon,
  truck: TruckIcon,
  star: StarIcon,
  leaf: LeafIcon,
  chat: ChatIcon,
}
