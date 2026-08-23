/**
 * PostChip: one post on the calendar (Social Studio v2 Phase 4, #4939).
 *
 * Desktop chips are draggable with the pointer via Motion `drag`; the chip
 * itself is the ghost (raised and slightly scaled while in flight) and a
 * dashed outline stays behind at the origin. Drop detection lives in the
 * grid: the chip only reports where the pointer is. Under reduced motion the
 * raise and the snap-back animation are off; drag still works.
 *
 * The chip body is a real button so Enter and Space open the Reschedule
 * sheet without a mouse. Status is a StatusPill (glyph plus word), never a
 * colour alone.
 */
import { useRef, useState } from 'react'
import { motion, useReducedMotion, type PanInfo } from 'motion/react'
import { StatusPill, studioStatusOf } from './StatusPill'
import { PlatformChip } from './PostPreviewCard'
import { PLATFORM_LABELS } from './types'
import { chipCaption, chipThumb, type CalendarPost } from './calendar-types'
import { utcToLaParts } from '~/lib/social-schedule'
import { laZoneAbbrev } from '~/lib/social-schedule-ui'
import { slotOf } from '~/lib/social-calendar'

export interface PostChipProps {
  post: CalendarPost
  /** Pointer drag on. Off on touch layouts, where the sheet is the only path. */
  draggable?: boolean
  /** True while a move for this post is in flight. */
  pending?: boolean
  onOpen: (post: CalendarPost) => void
  onDragStart?: (post: CalendarPost) => void
  onDragMove?: (post: CalendarPost, clientX: number, clientY: number) => void
  onDragEnd?: (post: CalendarPost, clientX: number, clientY: number) => void
  /** Extra trailing control (the mobile Reschedule button). */
  trailing?: React.ReactNode
  className?: string
}

function pointOf(event: MouseEvent | TouchEvent | PointerEvent): { x: number; y: number } {
  if ('clientX' in event) return { x: event.clientX, y: event.clientY }
  const t = event.changedTouches?.[0] ?? event.touches?.[0]
  return { x: t?.clientX ?? 0, y: t?.clientY ?? 0 }
}

export function PostChip({
  post, draggable = false, pending = false, onOpen, onDragStart, onDragMove, onDragEnd, trailing, className = '',
}: PostChipProps) {
  const reduced = useReducedMotion() ?? false
  const [dragging, setDragging] = useState(false)
  const justDragged = useRef(false)

  const at = slotOf(post)
  const la = at ? utcToLaParts(at) : null
  const timeLabel = la ? `${la.time} ${laZoneAbbrev(at!)}` : 'no slot'
  const status = studioStatusOf(post)
  const thumb = chipThumb(post)
  const caption = chipCaption(post)
  const platformName = PLATFORM_LABELS[post.platform] ?? post.platform
  const label = `#${post.id} ${platformName}, ${status}, ${la ? `${la.date} ${timeLabel}` : 'unscheduled'}. ${caption}`

  return (
    <div
      className={`relative ${dragging ? 'rounded-xl border border-dashed border-ink-4' : ''} ${className}`}
      data-post-chip={post.id}
    >
      <motion.div
        drag={draggable}
        dragMomentum={false}
        dragElastic={0}
        dragSnapToOrigin
        dragTransition={reduced ? { bounceStiffness: 100000, bounceDamping: 10000 } : { bounceStiffness: 600, bounceDamping: 35 }}
        whileDrag={reduced ? {} : { scale: 1.03, opacity: 0.95 }}
        transition={{ duration: reduced ? 0 : 0.15 }}
        onDragStart={() => {
          justDragged.current = true
          setDragging(true)
          onDragStart?.(post)
        }}
        onDrag={(e, _info: PanInfo) => {
          const p = pointOf(e)
          onDragMove?.(post, p.x, p.y)
        }}
        onDragEnd={(e, _info: PanInfo) => {
          const p = pointOf(e)
          setDragging(false)
          onDragEnd?.(post, p.x, p.y)
          // Let the click that follows pointerup see the flag, then clear it.
          setTimeout(() => { justDragged.current = false }, 0)
        }}
        style={{ pointerEvents: dragging ? 'none' : 'auto', touchAction: draggable ? 'none' : 'auto' }}
        className={`relative rounded-xl border bg-paper ${dragging ? 'z-50 border-plum' : 'border-line'} ${pending ? 'opacity-60' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        <button
          type="button"
          aria-label={label}
          onClick={() => {
            if (justDragged.current) return
            onOpen(post)
          }}
          className="w-full min-h-11 text-left p-2 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-plum"
        >
          <span className="flex items-center gap-1.5 flex-wrap">
            <PlatformChip platform={post.platform} />
            <StatusPill status={status} />
          </span>
          <span className="mt-1.5 flex items-start gap-2">
            {thumb ? (
              <img
                src={thumb}
                alt=""
                width={32}
                height={32}
                loading="lazy"
                className="w-8 h-8 rounded-md object-cover shrink-0 aspect-square bg-paper-3"
              />
            ) : (
              <span aria-hidden="true" className="w-8 h-8 rounded-md shrink-0 aspect-square border border-dashed border-line bg-paper-2" />
            )}
            <span className="min-w-0">
              <span className="block text-xs text-ink leading-snug break-words">{caption || <span className="text-ink-4">No caption yet</span>}</span>
              <span className="block font-mono text-[11px] text-ink-3 tabular-nums mt-0.5">
                #{post.id} · {timeLabel}{pending ? ' · moving' : ''}
              </span>
            </span>
          </span>
        </button>
        {trailing && <div className="px-2 pb-2">{trailing}</div>}
      </motion.div>
    </div>
  )
}
