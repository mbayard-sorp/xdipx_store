/**
 * Shared empty, error and loading slabs (wires 10). Text-only empties, a red
 * slab with one retry for errors, skeletons that are the final box with
 * bg-paper-3 blocks (no shimmer gradient).
 */
import type { ReactNode } from 'react'
import { AlertIcon } from '~/components/admin/social/icons'

export function EmptySlab({ kicker, heading, body, action }: {
  kicker: string
  heading: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-6">
      <p className="kicker">{kicker}</p>
      <h2 className="mt-2 font-display text-xl text-ink">{heading}</h2>
      {body && <p className="mt-1 text-sm text-ink-3 max-w-prose">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorSlab({ title, message, onRetry, retrying = false }: {
  title: string
  message?: string
  onRetry?: () => void
  retrying?: boolean
}) {
  return (
    <div role="alert" className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0"><AlertIcon size={16} /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{title}</p>
          {message && <p className="mt-0.5 break-words">{message}</p>}
        </div>
      </div>
      {onRetry && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="min-h-11 px-4 rounded-full border border-red-300 bg-paper text-red-800 font-medium hover:border-red-500 disabled:opacity-60 touch-manipulation"
          >
            {retrying ? 'Trying' : 'Try again'}
          </button>
        </div>
      )}
    </div>
  )
}

const block = 'rounded bg-paper-3'

export function IdeaCardSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-2xl border border-line bg-paper p-4 lg:p-5 animate-pulse motion-reduce:animate-none">
      <div className="flex items-center justify-between gap-4">
        <div className={`${block} h-3 w-24`} />
        <div className={`${block} h-6 w-20 rounded-full`} />
      </div>
      <div className={`${block} mt-3 h-5 w-5/6`} />
      <div className={`${block} mt-2 h-4 w-2/3`} />
      <div className={`${block} mt-2 h-3 w-1/2`} />
      <div className="mt-4 border-t border-line pt-3 flex items-center justify-between">
        <div className={`${block} h-3 w-16`} />
        <div className="flex gap-1">
          <div className="h-11 w-11 rounded-full bg-paper-3" />
          <div className="h-11 w-11 rounded-full bg-paper-3" />
        </div>
      </div>
    </div>
  )
}
