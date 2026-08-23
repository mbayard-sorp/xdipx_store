/**
 * CalendarGrid: the desktop week grid (Social Studio v2 Phase 4, #4939).
 *
 * Columns are LA days with a weekday/date header and the per-platform cap
 * indicator; rows are hour bands 06:00-22:00 with a collapsed "other hours"
 * band above and below for anything outside. Chips are PostChips; drop
 * targets are the hour cells, found by `elementFromPoint` while a chip is in
 * flight so the grid, not the chip, decides where a drop lands.
 *
 * The grid scrolls inside its own overflow-x-auto wrapper at a 980px floor;
 * the page body never scrolls sideways.
 */
import { useState } from 'react'
import { PostChip } from './PostChip'
import { PLATFORM_SHORT, type CalendarPost } from './calendar-types'
import { HOUR_START, HOUR_END, cellFor, slotOf, shortDayLabel, hourLabel, type CalendarCell } from '~/lib/social-calendar'

export interface CalendarGridProps {
  days: string[]
  todayLa: string
  posts: CalendarPost[]
  caps: Record<string, number>
  capsByDay: Record<string, Record<string, number>>
  pendingId: number | null
  onOpen: (post: CalendarPost) => void
  /** Fired on a drop over a cell that differs from the chip's current cell. */
  onMove: (post: CalendarPost, date: string, hour: number) => void
}

const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i)

/** The cell under a viewport point, read off the drop target's data attribute. */
function cellAt(x: number, y: number): { date: string; hour: number } | null {
  if (typeof document === 'undefined') return null
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cal-cell]')
  const key = el?.dataset['calCell']
  if (!key) return null
  const [date, hour] = key.split('T')
  if (!date || hour == null) return null
  return { date, hour: Number(hour) }
}

export function CapIndicator({ day, caps, capsByDay }: { day: string; caps: Record<string, number>; capsByDay: Record<string, Record<string, number>> }) {
  const used = capsByDay[day] ?? {}
  const platforms = Object.keys(caps).filter(p => caps[p]! > 0 || (used[p] ?? 0) > 0)
  if (platforms.length === 0) return null
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px] tabular-nums">
      {platforms.map(p => {
        const n = used[p] ?? 0
        const cap = caps[p] ?? 0
        const over = cap > 0 && n > cap
        const full = cap > 0 && n === cap
        return (
          <span
            key={p}
            className={over ? 'text-red-700 font-semibold' : full ? 'text-ink' : 'text-ink-3'}
            title={over ? `${PLATFORM_SHORT[p] ?? p} is over its ${cap}/day cap; the publisher stops at ${cap}` : `${PLATFORM_SHORT[p] ?? p}: ${n} of ${cap} per day`}
          >
            {PLATFORM_SHORT[p] ?? p} {n}/{cap}{over ? ' over' : ''}
          </span>
        )
      })}
    </span>
  )
}

export function CalendarGrid({ days, todayLa, posts, caps, capsByDay, pendingId, onOpen, onMove }: CalendarGridProps) {
  const [hover, setHover] = useState<string | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)

  // Bucket every chip by cell once per render.
  const buckets = new Map<string, CalendarPost[]>()
  const early = new Map<string, CalendarPost[]>()
  const late = new Map<string, CalendarPost[]>()
  for (const p of posts) {
    const at = slotOf(p)
    if (!at) continue
    const c: CalendarCell = cellFor(at)
    const target = c.band === 'main' ? buckets : c.band === 'early' ? early : late
    const key = c.band === 'main' ? `${c.date}T${c.hour}` : c.date
    const list = target.get(key) ?? []
    list.push(p)
    target.set(key, list)
  }
  for (const m of [buckets, early, late]) {
    for (const list of m.values()) list.sort((a, b) => (slotOf(a)?.getTime() ?? 0) - (slotOf(b)?.getTime() ?? 0))
  }

  function handleDragEnd(post: CalendarPost, x: number, y: number) {
    setHover(null)
    setDragId(null)
    const cell = cellAt(x, y)
    if (!cell) return
    const at = slotOf(post)
    const cur = at ? cellFor(at) : null
    if (cur && cur.date === cell.date && cur.hour === cell.hour) return
    onMove(post, cell.date, cell.hour)
  }

  const chipProps = (post: CalendarPost) => ({
    post,
    draggable: post.status !== 'posted',
    pending: pendingId === post.id,
    onOpen,
    onDragStart: (p: CalendarPost) => setDragId(p.id),
    onDragMove: (_p: CalendarPost, x: number, y: number) => {
      const c = cellAt(x, y)
      setHover(c ? `${c.date}T${c.hour}` : null)
    },
    onDragEnd: handleDragEnd,
  })

  const cellBase = 'min-h-11 border-b border-l border-line p-1 space-y-1 transition-colors'

  return (
    <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0" data-dragging={dragId != null ? 'true' : undefined}>
      <div
        className="min-w-[980px] rounded-2xl border border-line bg-paper overflow-hidden"
        role="grid"
        aria-label="Week grid, Los Angeles time"
        aria-rowcount={HOURS.length + 3}
        aria-colcount={8}
      >
        {/* Header */}
        <div className="grid sticky top-0 z-10 bg-paper border-b border-line" style={{ gridTemplateColumns: '72px repeat(7, minmax(0, 1fr))' }} role="row">
          <div className="p-2 font-mono text-[10px] text-ink-4" role="columnheader">LA</div>
          {days.map(day => {
            const { weekday, label } = shortDayLabel(day)
            const isToday = day === todayLa
            return (
              <div key={day} className="p-2 border-l border-line" role="columnheader">
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-xs font-semibold ${isToday ? 'text-coral' : 'text-ink'}`}>{weekday}</span>
                  <span className="font-mono text-[11px] text-ink-3">{label}</span>
                  {isToday && <span className="kicker text-[9px] text-coral">today</span>}
                </div>
                <div className="mt-1">
                  <CapIndicator day={day} caps={caps} capsByDay={capsByDay} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Early band */}
        <div className="grid bg-paper-2" style={{ gridTemplateColumns: '72px repeat(7, minmax(0, 1fr))' }} role="row">
          <div className="p-2 font-mono text-[10px] text-ink-4 leading-tight" role="rowheader">before<br />6 AM</div>
          {days.map(day => (
            <div key={day} className={`${cellBase} bg-paper-2`} role="gridcell" title="Off-band slot: open the chip to set an exact time">
              {(early.get(day) ?? []).map(p => <PostChip key={p.id} {...chipProps(p)} />)}
            </div>
          ))}
        </div>

        {/* Hour bands */}
        {HOURS.map(hour => (
          <div key={hour} className="grid" style={{ gridTemplateColumns: '72px repeat(7, minmax(0, 1fr))' }} role="row">
            <div className="p-2 font-mono text-[10px] text-ink-4 border-b border-line" role="rowheader">{hourLabel(hour)}</div>
            {days.map(day => {
              const key = `${day}T${hour}`
              const isHover = hover === key
              return (
                <div
                  key={key}
                  data-cal-cell={key}
                  role="gridcell"
                  aria-label={`${shortDayLabel(day).weekday} ${shortDayLabel(day).label} ${hourLabel(hour)}`}
                  className={`${cellBase} ${isHover ? 'bg-plum-soft outline outline-2 -outline-offset-2 outline-plum' : day === todayLa ? 'bg-coral-soft/30' : ''}`}
                >
                  {(buckets.get(key) ?? []).map(p => <PostChip key={p.id} {...chipProps(p)} />)}
                </div>
              )
            })}
          </div>
        ))}

        {/* Late band */}
        <div className="grid bg-paper-2" style={{ gridTemplateColumns: '72px repeat(7, minmax(0, 1fr))' }} role="row">
          <div className="p-2 font-mono text-[10px] text-ink-4 leading-tight" role="rowheader">10 PM<br />and later</div>
          {days.map(day => (
            <div key={day} className={`${cellBase} border-b-0 bg-paper-2`} role="gridcell" title="Off-band slot: open the chip to set an exact time">
              {(late.get(day) ?? []).map(p => <PostChip key={p.id} {...chipProps(p)} />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
